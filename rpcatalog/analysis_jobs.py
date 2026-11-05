"""Queue for analysis.py: runs one worker process at a time and reports its progress."""
import json
import os
import subprocess
import sys
import threading

from PySide6.QtCore import QObject, Signal

from . import config

NO_WINDOW = 0x08000000 if os.name == "nt" else 0
BELOW_NORMAL = 0x00004000 if os.name == "nt" else 0
SPEAKERS = {"mic": "Já", "game": "Hra", "discord": "Discord"}


def speech_tracks(media):
    """Which audio to transcribe: microphone, game (other players' in-game voice chat, NPCs) and Discord
    separately, so it is clear who speaks; without separate tracks the first one with everything mixed."""
    out = []
    for i, t in enumerate(media.track_names()):
        if t.get("role") in SPEAKERS:
            out.append({"speaker": SPEAKERS[t["role"]], "input": media.path, "stream": i})
    for s in media.sidecar_list():
        if s.get("role") in SPEAKERS and os.path.exists(s["path"]):
            out.append({"speaker": SPEAKERS[s["role"]], "input": s["path"], "stream": 0})
    seen = {}
    for sp in out:   # two microphones -> "Já", "Já 2"
        seen[sp["speaker"]] = seen.get(sp["speaker"], 0) + 1
        if seen[sp["speaker"]] > 1:
            sp["speaker"] += f" {seen[sp['speaker']]}"
    return out or [{"speaker": "Zvuk", "input": media.path, "stream": 0}]


class AnalysisJobs(QObject):
    event = Signal(object)    # {"id", "phase": queued|speech|vision|done|error|canceled, "p", "msg"}

    def __init__(self, settings):
        super().__init__()
        self.settings = settings
        self.ffmpeg = config.find_tool("ffmpeg")
        self._pending = []        # job dicts waiting for the next worker run
        self._proc = None
        self._lock = threading.Lock()
        self.state = {}           # media id -> last event

    def available(self):
        try:
            import importlib.util
            return bool(self.ffmpeg and importlib.util.find_spec("faster_whisper"))
        except ImportError:
            return False

    def request(self, media_list, vision=False):
        with self._lock:
            queued = {j["id"] for j in self._pending} | {i for i, s in self.state.items()
                                                         if s["phase"] in ("speech", "vision", "queued")}
            for m in media_list:
                if m.id in queued or not m.duration or not os.path.exists(m.path):
                    continue
                self._pending.append({"id": m.id, "path": m.path, "duration": m.duration,
                                      "title": m.display_title, "speech": speech_tracks(m), "vision": vision})
                self._set({"id": m.id, "phase": "queued", "p": 0, "msg": "Čeká ve frontě"})
            busy = self._proc is not None
        if not busy:
            self._start()

    def cancel(self):
        with self._lock:
            dropped, self._pending = self._pending, []
            proc = self._proc
        for j in dropped:
            self._set({"id": j["id"], "phase": "canceled", "p": None, "msg": "Zrušeno"})
        if proc:
            proc.kill()

    def _set(self, ev):
        self.state[ev["id"]] = ev
        self.event.emit(ev)

    def _start(self):
        with self._lock:
            if self._proc is not None or not self._pending:
                return
            jobs, self._pending = self._pending, []
            s = self.settings
            cfg = {"jobs": jobs, "ffmpeg": self.ffmpeg, "whisper": s.get("ai_whisper_model", "large-v3"),
                   "language": s.get("ai_language", "cs"), "vision_model": s.get("ai_vision_model", "qwen3.8:27b"),
                   "every": int(s.get("ai_vision_every", 30))}
            job_file = config.DATA_DIR / "analysis" / "job.json"
            job_file.parent.mkdir(parents=True, exist_ok=True)
            job_file.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
            py = sys.executable.replace("pythonw.exe", "python.exe")
            self._proc = subprocess.Popen([py, "-m", "rpcatalog.analysis", str(job_file)], cwd=str(config.APP_DIR),
                                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                          encoding="utf-8", errors="replace", creationflags=NO_WINDOW | BELOW_NORMAL)
        threading.Thread(target=self._read, args=(self._proc, jobs), daemon=True).start()

    def _read(self, proc, jobs):
        log = (config.DATA_DIR / "analysis" / "worker.log").open("w", encoding="utf-8")
        for line in proc.stdout:
            log.write(line)
            log.flush()
            try:
                ev = json.loads(line)
            except ValueError:
                continue          # library warnings and the like: only in the log
            if isinstance(ev, dict) and "phase" in ev:
                self._set(ev)
        proc.wait()
        log.close()
        for j in jobs:   # anything the worker never reported as finished (killed, crashed)
            if self.state.get(j["id"], {}).get("phase") not in ("done", "error"):
                self._set({"id": j["id"], "phase": "canceled" if proc.returncode else "error", "p": None,
                           "msg": "Přerušeno – příště naváže, kde skončilo" if proc.returncode
                           else "Skončilo bez výsledku (viz data/analysis/worker.log)"})
        with self._lock:
            self._proc = None
        self._start()
