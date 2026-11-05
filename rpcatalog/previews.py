"""Seek-bar thumbnails and per-track loudness envelopes, generated once with ffmpeg and cached
under data/previews/<media id>/ (frames NNNN.jpg + meta.json, wave.json)."""
import json
import os
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

from PySide6.QtCore import QObject, Signal

from . import config

NO_WINDOW = 0x08000000 if os.name == "nt" else 0
LOW_PRIO = 0x00004000 if os.name == "nt" else 0     # BELOW_NORMAL_PRIORITY_CLASS
FRAME_W = 256


def preview_dir(media_id):
    return config.DATA_DIR / "previews" / str(media_id)


def frame_plan(duration):
    """(interval seconds, count) - about one frame per 4 s for short videos, at most 300 frames."""
    if not duration or duration <= 0:
        return None, 0
    count = int(max(8, min(300, duration / 4)))
    return duration / count, count


def _run(args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, creationflags=NO_WINDOW | LOW_PRIO)


def load_frames(media_id):
    meta = preview_dir(media_id) / "frames.json"
    try:
        d = json.loads(meta.read_text(encoding="utf-8"))
        return d if d.get("done") else None
    except (OSError, ValueError):
        return None


def make_frames(media, ffmpeg, progress=None):
    interval, count = frame_plan(media.duration)
    if not count:
        return None
    out = preview_dir(media.id)
    out.mkdir(parents=True, exist_ok=True)

    def one(i):
        dst = out / f"{i:04d}.jpg"
        if dst.exists():
            return
        t = min(media.duration - 0.5, (i + 0.5) * interval)
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, t):.2f}", "-i", media.path,
              "-frames:v", "1", "-an", "-vf", f"scale={FRAME_W}:-2", "-q:v", "6", "-y", str(dst)])

    # coarse to fine: the whole timeline gets some preview quickly, then it fills in
    order, seen = [], set()
    for step in (32, 16, 8, 4, 2, 1):
        for i in range(0, count, step):
            if i not in seen:
                seen.add(i)
                order.append(i)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for n, _ in enumerate(ex.map(one, order)):
            if progress and n % 20 == 0:
                progress(n / count)
    meta = {"interval": interval, "count": count, "done": True, "dir": str(out)}
    (out / "frames.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def load_wave(media_id):
    try:
        return json.loads((preview_dir(media_id) / "wave.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def make_wave(media, ffmpeg, n_internal):
    """Loudness (RMS, 0..1) per time bin for every audio track, in mpv's aid order
    (tracks inside the file first, then sidecar files). One decoding pass for all tracks."""
    if not media.duration:
        return None
    out = preview_dir(media.id)
    out.mkdir(parents=True, exist_ok=True)
    bin_s = max(0.5, media.duration / 1500)
    n = int(8000 * bin_s)
    inputs = [media.path] + [s["path"] for s in media.sidecar_list() if os.path.exists(s["path"])]
    streams = [(0, i) for i in range(n_internal)] + [(k, 0) for k in range(1, len(inputs))]
    if not streams:
        return None
    chains = []
    for j, (inp, si) in enumerate(streams):
        chains.append(f"[{inp}:a:{si}]aresample=8000,asetnsamples=n={n}:p=0,"
                      f"astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,"
                      f"ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=w{j}.txt[o{j}]")
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats"]
    for p in inputs:
        args += ["-vn", "-i", p]
    args += ["-filter_complex", ";".join(chains)]
    for j in range(len(streams)):
        args += ["-map", f"[o{j}]"]
    args += ["-f", "null", "-"]
    for j in range(len(streams)):
        try:
            os.remove(out / f"w{j}.txt")
        except OSError:
            pass
    _run(args, cwd=str(out))
    tracks = []
    for j in range(len(streams)):
        vals = []
        try:
            for line in (out / f"w{j}.txt").read_text(encoding="utf-8", errors="ignore").splitlines():
                if "RMS_level=" in line:
                    v = line.split("=", 1)[1].strip()
                    try:
                        db = float(v)
                    except ValueError:
                        db = -120.0
                    vals.append(round(max(0.0, min(1.0, (db + 60) / 54)), 3))   # -60 dB..-6 dB -> 0..1
            os.remove(out / f"w{j}.txt")
        except OSError:
            pass
        tracks.append(vals)
    data = {"bin": bin_s, "tracks": tracks}
    (out / "wave.json").write_text(json.dumps(data), encoding="utf-8")
    return data


class PreviewWorker(QObject):
    """Generates previews in background threads, one video at a time per kind."""
    frames_ready = Signal(int, object)   # media id, meta
    wave_ready = Signal(int, object)     # media id, data

    def __init__(self):
        super().__init__()
        self.ffmpeg = config.find_tool("ffmpeg")
        self._busy = set()
        self._lock = threading.Lock()

    def request(self, media):
        if not media or not self.ffmpeg or not media.duration or not os.path.exists(media.path):
            return
        fr = load_frames(media.id)
        if fr:
            self.frames_ready.emit(media.id, fr)
        else:
            interval, count = frame_plan(media.duration)
            if count:   # provisional: frames appear in the popup as soon as they exist
                self.frames_ready.emit(media.id, {"interval": interval, "count": count,
                                                  "dir": str(preview_dir(media.id)), "done": False})
            self._start(("f", media.id), lambda: self.frames_ready.emit(media.id, make_frames(media, self.ffmpeg)))
        wv = load_wave(media.id)
        if wv:
            self.wave_ready.emit(media.id, wv)
        else:
            n = max(1, len(media.track_names()))
            self._start(("w", media.id), lambda: self.wave_ready.emit(media.id, make_wave(media, self.ffmpeg, n)))

    def _start(self, key, job):
        with self._lock:
            if key in self._busy:
                return
            self._busy.add(key)

        def run():
            try:
                job()
            except Exception as e:  # never kill the app because of a preview
                print("preview failed:", e)
            finally:
                with self._lock:
                    self._busy.discard(key)
        threading.Thread(target=run, daemon=True).start()
