"""Speech transcript (faster-whisper, local GPU) and frame descriptions (local Ollama vision model).

Runs as its own process so the GPU work and its large libraries stay out of the app:
    python -m rpcatalog.analysis JOB.json
JOB.json: {"jobs": [{"id", "path", "duration", "speech": [{"speaker", "input", "stream"}],
           "vision": bool}], "whisper": "large-v3", "language": "cs", "vision_model": "...", "every": 30,
           "ffmpeg": "..."}
Progress goes to stdout as one JSON object per line: {"id", "phase", "p", "msg"}.

Results live in data/analysis/<media id>/: speech_<speaker>_<chunk>.json, captions.jsonl,
frames/, timeline.md (whole video as text) and done.json. Every step can resume where it stopped.
"""
import base64
import json
import os
import re
import site
import subprocess
import sys
import urllib.request
from pathlib import Path

from . import config

CHUNK_S = 900                 # audio is transcribed in 15 min pieces: low memory, resumable
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
OLLAMA = "http://localhost:11434"
# typical Whisper hallucinations on silence or music in Czech
JUNK_RE = re.compile(r"titulk|www\.|\.cz\b|\.com\b|děkuji za (pozornost|zhlédnutí|sledování)|odebírejte", re.I)


def analysis_dir(media_id):
    return config.DATA_DIR / "analysis" / str(media_id)


def load_results(media_id):
    """(rows for the transcript table, done.json or None). Speech and frame descriptions, sorted by time."""
    d = analysis_dir(media_id)
    rows = []
    for f in sorted(d.glob("speech_*.json")):
        try:
            rows += json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    cap = d / "captions.jsonl"
    if cap.exists():
        for line in cap.read_text(encoding="utf-8").splitlines():
            try:
                c = json.loads(line)
                rows.append({"speaker": "Obraz", "t": c["t"], "t_end": None, "text": c["caption"]})
            except (ValueError, KeyError):
                pass
    rows.sort(key=lambda r: r["t"])
    try:
        done = json.loads((d / "done.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        done = None
    return rows, done


def clock(sec):
    h, rem = divmod(int(sec), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"


# ------------------------------------------------------------------ worker process
def say(media_id, phase, p=None, msg=""):
    print(json.dumps({"id": media_id, "phase": phase, "p": p, "msg": msg}, ensure_ascii=False), flush=True)


def _cuda_paths():
    """CUDA DLLs come from the pip nvidia-* packages; Windows does not look there by itself."""
    for sp in [site.getusersitepackages(), *site.getsitepackages()]:
        for bin_dir in Path(sp, "nvidia").glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]


def _audio(ffmpeg, src, stream, start, length):
    import numpy as np
    raw = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", str(start), "-t", str(length),
                          "-i", src, "-map", f"0:a:{stream}", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True, creationflags=NO_WINDOW).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


def transcribe(job, cfg, model_holder):
    out = analysis_dir(job["id"])
    out.mkdir(parents=True, exist_ok=True)
    n_chunks = int(job["duration"] // CHUNK_S) + 1
    todo = [(sp, k) for sp in job["speech"] for k in range(n_chunks)]
    for i, (sp, k) in enumerate(todo):
        dst = out / f"speech_{sp['speaker']}_{k:03d}.json"
        say(job["id"], "speech", i / len(todo), f"Přepis řeči – {sp['speaker']} {clock(k * CHUNK_S)}")
        if dst.exists():
            continue
        audio = _audio(cfg["ffmpeg"], sp["input"], sp["stream"], k * CHUNK_S, CHUNK_S)
        rows = []
        if audio.size > 16000:
            if model_holder.get("m") is None:
                say(job["id"], "speech", i / len(todo), "Načítám model řeči…")
                from faster_whisper import BatchedInferencePipeline, WhisperModel
                model_holder["m"] = BatchedInferencePipeline(
                    WhisperModel(cfg["whisper"], device="cuda", compute_type="float16"))
            # batched: speech parts found by VAD are decoded 16 at a time (several times faster);
            # it never conditions on previous text, so no repeating loops on long recordings
            segs, _ = model_holder["m"].transcribe(audio, language=cfg["language"], batch_size=16, beam_size=5,
                                                   vad_filter=True)
            for s in segs:
                text = s.text.strip()
                if not text or JUNK_RE.search(text) or (s.no_speech_prob > 0.6 and s.avg_logprob < -1):
                    continue
                rows.append({"speaker": sp["speaker"], "t": round(k * CHUNK_S + s.start, 2),
                             "t_end": round(k * CHUNK_S + s.end, 2), "text": text})
        tmp = dst.with_suffix(".part")
        tmp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        tmp.replace(dst)


def _ollama(path, body=None, timeout=300):
    req = urllib.request.Request(OLLAMA + path, json.dumps(body).encode() if body else None,
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def describe_frames(job, cfg):
    out = analysis_dir(job["id"])
    frames = out / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    try:
        models = [m["name"] for m in _ollama("/api/tags", timeout=5).get("models", [])]
    except OSError:
        raise RuntimeError("Ollama neběží – spusť aplikaci Ollama, nebo vypni popis obrazu")
    if cfg["vision_model"] not in models:
        raise RuntimeError(f"V Ollamě chybí model {cfg['vision_model']} (ollama pull {cfg['vision_model']})")
    speech, _ = load_results(job["id"])
    speech = [r for r in speech if r["speaker"] != "Obraz"]
    cap_path = out / "captions.jsonl"
    done = set()
    if cap_path.exists():
        done = {json.loads(l)["t"] for l in cap_path.read_text(encoding="utf-8").splitlines() if l.strip()}
    every = cfg["every"]
    times = [n * every + every / 2 for n in range(int(job["duration"] // every) + 1)
             if n * every + every / 2 < job["duration"]]
    with cap_path.open("a", encoding="utf-8") as f:
        for i, t in enumerate(times):
            if t in done:
                continue
            say(job["id"], "vision", i / len(times), f"Popis obrazu {clock(t)}")
            img = frames / f"{int(t):06d}.jpg"
            if not img.exists():
                subprocess.run([cfg["ffmpeg"], "-hide_banner", "-loglevel", "error", "-ss", str(t), "-i", job["path"],
                                "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", "-y", str(img)],
                               creationflags=NO_WINDOW)
            if not img.exists():
                continue
            heard = " ".join(f"{r['speaker']}: {r['text']}" for r in speech if r["t_end"] > t - 15 and r["t"] < t + 15)
            prompt = ("Toto je snímek z videozáznamu hraní RP (hraní rolí) ve hře. Popiš stručně česky "
                      "(nejvýš 3 věty): kde postava je, kdo je kolem, co se děje, důležité předměty nebo text na obrazovce.")
            if heard:
                prompt += f" V tu chvíli zaznívá: \"{heard[:500]}\""
            resp = _ollama("/api/generate", {"model": cfg["vision_model"], "prompt": prompt, "stream": False,
                                             "images": [base64.b64encode(img.read_bytes()).decode()],
                                             "options": {"temperature": 0.2}})
            f.write(json.dumps({"t": t, "caption": resp["response"].strip()}, ensure_ascii=False) + "\n")
            f.flush()


def write_timeline(job, block=30):
    """The whole video as readable text (for reading it with Claude or anyone else)."""
    rows, _ = load_results(job["id"])
    lines = [f"# {job.get('title') or Path(job['path']).name}", f"Délka {clock(job['duration'])}", ""]
    cur = None
    for r in rows:
        b = int(r["t"] // block)
        if b != cur:
            cur = b
            lines += ["", f"## {clock(b * block)}"]
        lines.append(f"- **{r['speaker']}:** {r['text']}")
    (analysis_dir(job["id"]) / "timeline.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(job_file):
    sys.stdout.reconfigure(encoding="utf-8")    # the app reads progress as UTF-8, not the Windows code page
    _cuda_paths()
    cfg = json.loads(Path(job_file).read_text(encoding="utf-8"))
    model_holder = {}
    for job in cfg["jobs"]:
        try:
            transcribe(job, cfg, model_holder)
            if job.get("vision"):
                model_holder.pop("m", None)        # free GPU memory for the vision model
                describe_frames(job, cfg)
            write_timeline(job)
            (analysis_dir(job["id"]) / "done.json").write_text(json.dumps(
                {"speech": True, "vision": bool(job.get("vision")), "whisper": cfg["whisper"],
                 "vision_model": cfg["vision_model"] if job.get("vision") else None}), encoding="utf-8")
            say(job["id"], "done", 1)
        except Exception as e:   # one bad video must not stop the queue
            say(job["id"], "error", None, f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main(sys.argv[1])
