"""Speech transcript (faster-whisper, local GPU), picture descriptions (local Ollama vision model),
faces (OpenCV YuNet) and chapters with a summary (Ollama text model).

Runs as its own process so the GPU work and its large libraries stay out of the app:
    python -m rpcatalog.analysis CONFIG.json
CONFIG.json holds the settings and the path of the queue file. The app rewrites the queue file
(order, removed items) while this runs; the worker always takes the first job it has not handled yet,
so the speech model stays loaded between videos. Flag files: pause.flag (wait), skip.flag (job key
to stop now). Progress goes to stdout, one JSON object per line: {"id", "key", "phase", "p", "msg", ...}.

Results live in data/analysis/<media id>/ and every step resumes where it stopped:
  speech_<speaker>_<chunk>.json   transcript in 15 min pieces
  captions.jsonl                  one line per examined frame: description, names seen, faces
                                  ({"skip": true} = examined, the scene had not changed)
  frames/ faces/                  small frame previews and face crops
  chapters.json summary.json      chapters and the summary of the whole video
  timeline.md transcript.srt      the whole video as text / subtitles for the player
"""
import base64
import json
import os
import re
import site
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from . import config

CHUNK_S = 900                 # audio is transcribed in 15 min pieces: low memory, resumable
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
OLLAMA = "http://localhost:11434"
FACE_MODEL = config.DATA_DIR / "models" / "face_detection_yunet_2023mar.onnx"
FACE_MODEL_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
                  "face_detection_yunet_2023mar.onnx")
# typical Whisper hallucinations on silence or music in Czech
JUNK_RE = re.compile(r"titulk|www\.|\.cz\b|\.com\b|děkuji za (pozornost|zhlédnutí|sledování)|odebírejte", re.I)


def analysis_dir(media_id):
    return config.DATA_DIR / "analysis" / str(media_id)


def _read_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def load_frames(media_id):
    """Every examined frame: {t, caption?, names, people, faces, kind, skip?}."""
    out = []
    p = analysis_dir(media_id) / "captions.jsonl"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return sorted(out, key=lambda f: f["t"])


def load_speech(media_id):
    rows = []
    for f in sorted(analysis_dir(media_id).glob("speech_*.json")):
        rows += _read_json(f, [])
    return sorted(rows, key=lambda r: r["t"])


def load_results(media_id):
    """(rows for the transcript table: speech + frame descriptions, done.json or None)."""
    rows = load_speech(media_id)
    for f in load_frames(media_id):
        if f.get("caption"):
            rows.append({"speaker": "Obraz", "t": f["t"], "t_end": None, "text": f["caption"]})
    rows.sort(key=lambda r: r["t"])
    return rows, _read_json(analysis_dir(media_id) / "done.json")


def coverage(media_id):
    """What is done for one video: transcribed audio pieces per speaker, examined frames, chapters."""
    d = analysis_dir(media_id)
    chunks = {}
    for f in d.glob("speech_*.json"):
        speaker, k = f.stem[len("speech_"):].rsplit("_", 1)
        chunks.setdefault(speaker, []).append(int(k))
    return {"chunk_s": CHUNK_S, "speech_chunks": {s: sorted(v) for s, v in chunks.items()},
            "chapters": _read_json(d / "chapters.json", []), "summary": _read_json(d / "summary.json"),
            "done": _read_json(d / "done.json")}


def conversations(rows, gap=20.0, pad=2.0):
    """Time spans where somebody talks: speech segments closer than `gap` seconds are one conversation."""
    spans = []
    for r in sorted((r for r in rows if r["speaker"] != "Obraz"), key=lambda r: r["t"]):
        a, b = r["t"], r.get("t_end") or r["t"] + 3
        if spans and a - spans[-1][1] <= gap:
            spans[-1][1] = max(spans[-1][1], b)
        else:
            spans.append([a, b])
    return [(max(0.0, a - pad), b + pad) for a, b in spans]


def clock(sec):
    h, rem = divmod(int(sec), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"


# ------------------------------------------------------------------ worker process
class Skipped(Exception):
    pass


class Worker:
    def __init__(self, cfg):
        self.cfg = cfg
        self.whisper = None
        self.faces = None
        self.job = None
        self.flags = Path(cfg["queue_file"]).parent

    # ---- reporting and control
    def say(self, phase, p=None, msg="", **extra):
        print(json.dumps({"id": self.job["id"], "key": self.job["key"], "phase": phase, "p": p, "msg": msg, **extra},
                         ensure_ascii=False), flush=True)

    def checkpoint(self, phase, p, msg):
        """Between two pieces of work: honour pause and skip, report progress."""
        skip = self.flags / "skip.flag"
        if skip.exists() and skip.read_text(encoding="utf-8").strip() == self.job["key"]:
            skip.unlink(missing_ok=True)
            raise Skipped()
        if (self.flags / "pause.flag").exists():
            self.say("paused", p, "Pozastaveno")
            while (self.flags / "pause.flag").exists():
                time.sleep(1)
                if skip.exists():
                    break
            return self.checkpoint(phase, p, msg)
        self.say(phase, p, msg)

    # ---- speech
    def _audio(self, src, stream, start, length):
        import numpy as np
        raw = subprocess.run([self.cfg["ffmpeg"], "-hide_banner", "-loglevel", "error", "-ss", str(start), "-t", str(length),
                              "-i", src, "-map", f"0:a:{stream}", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                             capture_output=True, creationflags=NO_WINDOW).stdout
        return np.frombuffer(raw, np.int16).astype(np.float32) / 32768

    def transcribe(self):
        job, cfg = self.job, self.cfg
        out = analysis_dir(job["id"])
        n_chunks = int(job["duration"] // CHUNK_S) + 1
        todo = [(sp, k) for sp in job["speech"] for k in range(n_chunks)]
        for i, (sp, k) in enumerate(todo):
            dst = out / f"speech_{sp['speaker']}_{k:03d}.json"
            if dst.exists():
                continue
            self.checkpoint("speech", i / len(todo), f"Řeč · {sp['speaker']} · {clock(k * CHUNK_S)}")
            audio = self._audio(sp["input"], sp["stream"], k * CHUNK_S, CHUNK_S)
            rows = []
            if audio.size > 16000 and float(abs(audio).max()) > 0.003:      # silent track: nothing to do
                if self.whisper is None:
                    self.say("speech", i / len(todo), "Načítám model řeči…")
                    from faster_whisper import BatchedInferencePipeline, WhisperModel
                    self.whisper = BatchedInferencePipeline(
                        WhisperModel(cfg["whisper"], device="cuda", compute_type="float16"))
                # batched: speech parts found by VAD are decoded several at a time; it never conditions
                # on previous text, so no repeating loops on long recordings
                segs, _ = self.whisper.transcribe(
                    audio, language=cfg["language"] or None, batch_size=int(cfg["batch_size"]),
                    beam_size=int(cfg["beam_size"]), vad_filter=True,
                    vad_parameters={"threshold": float(cfg["vad_threshold"])})
                for s in segs:
                    text = s.text.strip()
                    if not text:
                        continue
                    if cfg["junk_filter"] and (JUNK_RE.search(text) or (s.no_speech_prob > 0.6 and s.avg_logprob < -1)):
                        continue
                    rows.append({"speaker": sp["speaker"], "t": round(k * CHUNK_S + s.start, 2),
                                 "t_end": round(k * CHUNK_S + s.end, 2), "text": text})
            tmp = dst.with_suffix(".part")
            tmp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
            tmp.replace(dst)
            self.say("speech", (i + 1) / len(todo), f"Řeč · {sp['speaker']} · {clock((k + 1) * CHUNK_S)}",
                     partial=bool(rows), audio_s=min(CHUNK_S, job["duration"] - k * CHUNK_S))

    # ---- picture
    def plan_frames(self):
        """[(t, kind)] to look at: dense during conversations, sparse elsewhere, plus ranges asked by hand."""
        job, cfg = self.job, self.cfg
        dur = job["duration"]
        spans = conversations(load_speech(job["id"]), float(cfg["conv_gap"]))
        plan = {}
        if job.get("vision_ranges"):
            for a, b, step in job["vision_ranges"]:
                t = max(0.0, a)
                while t < min(b, dur - 0.5):
                    plan[round(t, 1)] = "manual"
                    t += max(1.0, float(step))
            return sorted(plan.items())
        step = float(cfg["dialog_every"])
        if cfg["vision_dialog"] and step > 0:
            for a, b in spans:
                t = a + 1.0
                while t < min(b, dur - 0.5):
                    plan[round(t, 1)] = "dialog"
                    t += step
        every = float(cfg["every"])
        if every > 0:
            n = 0
            while n * every + every / 2 < dur:
                t = n * every + every / 2
                if not any(a <= t <= b for a, b in spans) or not cfg["vision_dialog"]:
                    plan.setdefault(round(t, 1), "base")
                n += 1
        return sorted(plan.items())

    def _frame(self, t, width):
        dst = analysis_dir(self.job["id"]) / "frames" / f"tmp_{os.getpid()}.jpg"
        dst.unlink(missing_ok=True)
        subprocess.run([self.cfg["ffmpeg"], "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", self.job["path"],
                        "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", "-y", str(dst)], creationflags=NO_WINDOW)
        return dst if dst.exists() else None

    def _faces(self, img, t):
        import cv2
        if self.faces is None:
            if not FACE_MODEL.exists():
                FACE_MODEL.parent.mkdir(parents=True, exist_ok=True)
                urllib.request.urlretrieve(FACE_MODEL_URL, FACE_MODEL)
            self.faces = cv2.FaceDetectorYN.create(str(FACE_MODEL), "", (320, 320), 0.75)
        h, w = img.shape[:2]
        self.faces.setInputSize((w, h))
        _, found = self.faces.detect(img)
        out = []
        fdir = analysis_dir(self.job["id"]) / "faces"
        fdir.mkdir(exist_ok=True)
        for k, f in enumerate(found if found is not None else []):
            x, y, fw, fh = (float(v) for v in f[:4])
            if fw < w * 0.04:                 # tiny faces in the distance tell nothing
                continue
            pad = 0.45
            x0, y0 = max(0, int(x - fw * pad)), max(0, int(y - fh * pad))
            x1, y1 = min(w, int(x + fw * (1 + pad))), min(h, int(y + fh * (1 + pad)))
            name = f"{int(t * 10):07d}_{k}.jpg"
            cv2.imwrite(str(fdir / name), img[y0:y1, x0:x1], [cv2.IMWRITE_JPEG_QUALITY, 88])
            out.append({"file": name, "box": [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h], "score": round(float(f[-1]), 2)})
        return out

    def describe(self):
        import cv2
        job, cfg = self.job, self.cfg
        out = analysis_dir(job["id"])
        (out / "frames").mkdir(parents=True, exist_ok=True)
        try:
            models = [m["name"] for m in _ollama("/api/tags", timeout=5).get("models", [])]
        except OSError:
            raise RuntimeError("Ollama neběží – spusť aplikaci Ollama, nebo vypni popis obrazu")
        if cfg["vision_model"] not in models:
            raise RuntimeError(f"V Ollamě chybí model {cfg['vision_model']} (ollama pull {cfg['vision_model']})")
        speech = load_speech(job["id"])
        done = {round(f["t"], 1) for f in load_frames(job["id"])}
        plan = [(t, k) for t, k in self.plan_frames() if t not in done]
        last_img, last_t = None, -1e9
        cap_path = out / "captions.jsonl"
        with cap_path.open("a", encoding="utf-8") as f:
            for i, (t, kind) in enumerate(plan):
                self.checkpoint("vision", i / max(1, len(plan)), f"Obraz · {clock(t)} · {len(plan) - i} snímků zbývá")
                path = self._frame(t, int(cfg["vision_width"]))
                if not path:
                    continue
                img = cv2.imread(str(path))
                small = cv2.cvtColor(cv2.resize(img, (64, 36), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
                change = float(abs(small.astype(int) - last_img).mean() / 255) if last_img is not None else 1.0
                if (kind == "dialog" and change < float(cfg["motion_threshold"])
                        and t - last_t < float(cfg["static_every"])):
                    # same scene as the last described frame (people sitting and talking): not worth a description
                    f.write(json.dumps({"t": t, "kind": kind, "skip": True, "change": round(change, 3)}) + "\n")
                    path.unlink(missing_ok=True)
                    continue
                rec = {"t": t, "kind": kind, "change": round(change, 3)}
                if cfg["detect_faces"] and kind in ("dialog", "manual"):
                    rec["faces"] = self._faces(img, t)
                heard = " ".join(f"{r['speaker']}: {r['text']}" for r in speech
                                 if (r.get("t_end") or r["t"]) > t - 12 and r["t"] < t + 12)
                try:
                    rec.update(self._ask_vision(path, heard))
                except (OSError, ValueError, KeyError) as e:      # one bad frame must not stop the video
                    self.say("vision", i / max(1, len(plan)), f"Obraz · {clock(t)} · přeskočeno ({type(e).__name__})")
                    f.write(json.dumps({"t": t, "kind": kind, "skip": True, "error": str(e)[:200]}) + "\n")
                    path.unlink(missing_ok=True)
                    continue
                thumb = out / "frames" / f"{int(t * 10):07d}.jpg"
                cv2.imwrite(str(thumb), cv2.resize(img, (320, int(320 * img.shape[0] / img.shape[1]))),
                            [cv2.IMWRITE_JPEG_QUALITY, 80])
                rec["thumb"] = thumb.name
                path.unlink(missing_ok=True)
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()
                last_img, last_t = small.astype(int), t
                self.say("vision", (i + 1) / len(plan), f"Obraz · {clock(t)}", partial=True)

    def _ask_vision(self, img, heard):
        cfg = self.cfg
        prompt = ("Toto je snímek z videozáznamu hraní RP (hraní rolí) ve hře. "
                  + (cfg["context"].strip() + " " if cfg.get("context", "").strip() else "")
                  + "Popiš stručně česky (nejvýš 2–3 krátké věty): kde postava je, kdo je kolem, co se děje, "
                    "důležité předměty nebo text na obrazovce.")
        if cfg["detect_names"]:
            prompt += (" Do pole 'jmena' opiš přesně jména, která jsou na obrázku napsaná nad hlavami postav "
                       "nebo v rozhraní (rozhovor, chat). Nic si nedomýšlej; když žádné nevidíš, dej prázdný seznam.")
            if cfg.get("known_names"):
                prompt += " Postavy v tomto světě jsou např.: " + ", ".join(cfg["known_names"][:60]) + "."
        if heard:
            prompt += f" V tu chvíli zaznívá: \"{heard[:600]}\""
        schema = {"type": "object", "required": ["popis", "jmena", "postav"], "properties": {
            "popis": {"type": "string"}, "jmena": {"type": "array", "items": {"type": "string"}},
            "postav": {"type": "integer"}, "misto": {"type": "string"}}}
        # num_predict caps the answer: a model that starts looping must not hold the GPU for minutes
        resp = _ollama("/api/generate", {"model": cfg["vision_model"], "prompt": prompt, "stream": False, "format": schema,
                                         "images": [base64.b64encode(img.read_bytes()).decode()],
                                         "options": {"temperature": 0.2, "num_predict": 700}}, timeout=240)
        try:
            d = json.loads(resp["response"])
            return {"caption": d.get("popis", "").strip(), "names": [n.strip() for n in d.get("jmena", []) if n.strip()]
                    if cfg["detect_names"] else [], "people": d.get("postav"), "place": d.get("misto", "")}
        except ValueError:
            return {"caption": resp["response"].strip(), "names": [], "people": None}

    # ---- chronicle: chapters, events, mentions and proposals with a running memory
    def blocks(self, rows):
        """Split the video into blocks for the text model. Boundaries go into silent gaps between
        conversations (never in the middle of one); gaps are written into the text so the model sees them."""
        cfg = self.cfg
        target = float(cfg["chapter_minutes"]) * 60
        blocks, cur, start, last_end, chars = [], [], None, None, 0
        for r in rows:
            gap = r["t"] - last_end if last_end is not None else 0
            length = r["t"] - start if start is not None else 0
            # the longer the block, the shorter the pause that may end it; people in game talk almost non-stop
            cut = cur and ((gap >= float(cfg["conv_gap"]) and length >= target)
                           or (gap >= 6 and (length >= target * 1.5 or chars >= 12000))
                           or length >= target * 2.5 or chars >= 20000)
            if cut:
                blocks.append((start, last_end, cur))
                cur, start, chars = [], None, 0
            elif cur and gap >= 60:
                cur.append(f"— — pauza {round(gap / 60)} min, nikdo nemluví — —")
            if start is None:
                start = r["t"]
            if r["speaker"] == "Obraz":
                cur.append(f"[{clock(r['t'])}] (obraz) {r['text']}")
            else:
                cur.append(f"[{clock(r['t'])}] {r['speaker']}: {r['text']}")
            chars += len(cur[-1])
            last_end = max(last_end or 0, r.get("t_end") or r["t"])
        if cur:
            blocks.append((start, last_end, cur))
        return blocks

    def chronicle(self):
        job, cfg = self.job, self.cfg
        out = analysis_dir(job["id"])
        rows, _ = load_results(job["id"])
        frames = {round(f["t"], 1): f for f in load_frames(job["id"])}
        for r in rows:     # names read in the picture help the model
            f = frames.get(round(r["t"], 1)) if r["speaker"] == "Obraz" else None
            if f and f.get("names"):
                r["text"] += f" [jmenovky: {', '.join(f['names'])}]"
        blocks = [b for b in self.blocks(rows) if sum(len(x) for x in b[2]) >= 250]
        state = _read_json(out / "chronicle.json", {}) or {}
        done = {b["t"]: b for b in state.get("blocks", [])}
        memory = state.get("memory", "")
        found = state.get("found", {})          # names met in this video -> type
        world = cfg.get("world") or {}
        world_txt = "\n".join(f"- {k}: {', '.join(v[:80])}" for k, v in
                              (("Postavy", world.get("characters", [])), ("Místa", world.get("places", [])),
                               ("Frakce a rody", world.get("factions", []))) if v)
        result = []
        for i, (a, z, lines) in enumerate(blocks):
            if a in done:
                result.append(done[a])
                continue
            self.checkpoint("chapters", i / max(1, len(blocks)), f"Kronika · blok {i + 1}/{len(blocks)} · {clock(a)}")
            text = "\n".join(lines)
            if len(text) > 22000:          # keep the start and the end of very long blocks
                text = text[:14000] + "\n— — (zkráceno) — —\n" + text[-8000:]
            prompt = (
                "Jsi kronikář RP (hraní rolí) serveru. Dostaneš část přepisu záznamu jednoho hráče: "
                "'Já' je hráč, který nahrával, 'Hra' jsou ostatní hráči a postavy ve hře (hlasový chat ve hře, NPC), "
                "'Discord' je hlasový chat, '(obraz)' jsou popisy snímků. Řádky '— — pauza … — —' znamenají ticho "
                "(často konec scény). Rozlišuj děj ve hře (IC) a mimoherní řeči (OOC) – OOC do kroniky nepatří.\n"
                + (f"O hře a serveru: {cfg['context'].strip()}\n" if cfg.get("context", "").strip() else "")
                + (f"\nZnámé záznamy v kronice (používej přesně tato jména, když jde o ně):\n{world_txt}\n" if world_txt else "")
                + (f"\nPředchozí večer (pro souvislosti): {job['prev_summary']}\n" if job.get("prev_summary") else "")
                + (f"\nDosavadní děj tohoto záznamu (paměť): {memory}\n" if memory else "")
                + (f"\nJména, která už v záznamu padla: {', '.join(f'{k} ({v})' for k, v in list(found.items())[:80])}\n" if found else "")
                + f"\nÚSEK {clock(a)}–{clock(z)}:\n{text}\n\n"
                "Vrať česky:\n"
                "- nazev: název kapitoly (nejvýš 6 slov)\n"
                "- shrnuti: 1–3 věty, co se v úseku stalo ve hře\n"
                "- udalosti: samostatné herní události v úseku (jednání, souboj, obchod, cesta, slavnost…) s časem "
                "od–do ve formátu H:MM:SS podle značek v přepisu, místem, účastníky (jména postav) a popisem 1–3 věty; "
                "jen to, co v přepisu opravdu je\n"
                "- zminky: postavy, místa a frakce/rody, o kterých se v úseku mluví nebo jsou vidět, s časem a krátkým kontextem\n"
                "- nove: jména postav, míst a frakcí, která nejsou mezi známými záznamy a vypadají jako skutečná součást "
                "herního světa (ne hráči OOC), s popisem, co o nich víme\n"
                "- pamet: aktualizovaná paměť – stručné shrnutí celého dosavadního děje záznamu včetně tohoto úseku "
                "(nejvýš 8 vět), aby navazující úsek věděl souvislosti")
            ent = {"type": "object", "required": ["jmeno", "typ"], "properties": {
                "jmeno": {"type": "string"}, "typ": {"type": "string", "enum": ["postava", "misto", "frakce"]},
                "cas": {"type": "string"}, "kontext": {"type": "string"}, "popis": {"type": "string"}}}
            d = _ask_text(cfg["text_model"], prompt, {
                "nazev": {"type": "string"}, "shrnuti": {"type": "string"},
                "udalosti": {"type": "array", "items": {"type": "object", "required": ["nazev", "od", "do"], "properties": {
                    "nazev": {"type": "string"}, "od": {"type": "string"}, "do": {"type": "string"},
                    "misto": {"type": "string"}, "ucastnici": {"type": "array", "items": {"type": "string"}},
                    "popis": {"type": "string"}}}},
                "zminky": {"type": "array", "items": ent}, "nove": {"type": "array", "items": ent},
                "pamet": {"type": "string"}}, ctx=32768)

            def ts(x, default):
                v = _parse_clock(x)
                return v if v is not None and a - 120 <= v <= z + 120 else default
            blk = {"t": a, "t_end": z, "title": (d.get("nazev") or "").strip(), "summary": (d.get("shrnuti") or "").strip(),
                   "events": [{"title": e.get("nazev", "").strip(), "t": ts(e.get("od"), a), "t_end": ts(e.get("do"), z),
                               "place": (e.get("misto") or "").strip(), "who": [w.strip() for w in e.get("ucastnici") or [] if w.strip()],
                               "text": (e.get("popis") or "").strip()} for e in d.get("udalosti") or [] if e.get("nazev")],
                   "mentions": [{"name": m["jmeno"].strip(), "type": m["typ"], "t": ts(m.get("cas"), a),
                                 "text": (m.get("kontext") or "").strip()} for m in d.get("zminky") or [] if m.get("jmeno")],
                   "new": [{"name": m["jmeno"].strip(), "type": m["typ"], "t": ts(m.get("cas"), a),
                            "text": (m.get("popis") or m.get("kontext") or "").strip()} for m in d.get("nove") or [] if m.get("jmeno")]}
            for m in blk["mentions"] + blk["new"]:
                found.setdefault(m["name"], m["type"])
            memory = (d.get("pamet") or memory).strip()
            result.append(blk)
            _write_json(out / "chronicle.json", {"blocks": result, "memory": memory, "found": found})
            _write_json(out / "chapters.json", [{k: b[k] for k in ("t", "t_end", "title", "summary")} for b in result])
            self.say("chapters", (i + 1) / len(blocks), f"Kronika · {clock(z)}", partial=True)
        _write_json(out / "chronicle.json", {"blocks": result, "memory": memory, "found": found})
        _write_json(out / "chapters.json", [{k: b[k] for k in ("t", "t_end", "title", "summary")} for b in result])
        if result:
            self.checkpoint("chapters", 1, "Shrnutí celého záznamu")
            d = _ask_text(cfg["text_model"],
                          "Toto jsou kapitoly jednoho večera hraní RP (jen herní děj). Napiš česky shrnutí celého večera "
                          "(4–8 vět, jako zápis do kroniky) a seznam nejdůležitějších momentů.\n"
                          + (f"Paměť z průběhu: {memory}\n\n" if memory else "\n")
                          + "\n".join(f"{clock(c['t'])} {c['title']}: {c['summary']}" for c in result)[:14000],
                          {"shrnuti": {"type": "string"}, "momenty": {"type": "array", "items": {"type": "string"}}})
            _write_json(out / "summary.json", {"text": d.get("shrnuti", ""), "moments": d.get("momenty", [])})

    # ---- outputs
    def write_text_outputs(self):
        job = self.job
        out = analysis_dir(job["id"])
        rows, _ = load_results(job["id"])
        chapters = _read_json(out / "chapters.json", [])
        summary = _read_json(out / "summary.json")
        lines = [f"# {job.get('title') or Path(job['path']).name}", f"Délka {clock(job['duration'])}", ""]
        if summary and summary.get("text"):
            lines += ["## Shrnutí", summary["text"], ""]
        ci, cur, last_end = 0, None, None
        for r in rows:
            if last_end is not None and r["t"] - last_end >= 60:
                lines += ["", f"_— pauza {round((r['t'] - last_end) / 60)} min —_"]
            last_end = max(last_end or 0, r.get("t_end") or r["t"])
            while ci < len(chapters) and chapters[ci]["t"] <= r["t"]:
                lines += ["", f"# {clock(chapters[ci]['t'])} {chapters[ci]['title']}", f"_{chapters[ci]['summary']}_"]
                ci += 1
            b = int(r["t"] // 30)
            if b != cur:
                cur = b
                lines += ["", f"## {clock(b * 30)}"]
            lines.append(f"- **{r['speaker']}:** {r['text']}")
        (out / "timeline.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        srt = []
        for i, r in enumerate((r for r in rows if r["speaker"] != "Obraz"), 1):
            end = r.get("t_end") or r["t"] + 3
            srt.append(f"{i}\n{_srt_time(r['t'])} --> {_srt_time(end)}\n{r['speaker']}: {r['text']}\n")
        (out / "transcript.srt").write_text("\n".join(srt), encoding="utf-8")

    def run_job(self, job):
        self.job = job
        out = analysis_dir(job["id"])
        out.mkdir(parents=True, exist_ok=True)
        started = time.time()
        try:
            if job.get("speech"):
                self.transcribe()
            if job.get("vision") or job.get("vision_ranges"):
                self.whisper = None              # free GPU memory for the vision model
                self.describe()
            if job.get("chapters"):
                self.whisper = None
                self.chronicle()
            self.write_text_outputs()
            prev = _read_json(out / "done.json", {})
            frames = load_frames(job["id"])
            (out / "done.json").write_text(json.dumps({
                **prev, "speech": bool(prev.get("speech") or job.get("speech")),
                "vision": bool(prev.get("vision") or frames), "chapters": (out / "chapters.json").exists(),
                "whisper": self.cfg["whisper"], "vision_model": self.cfg["vision_model"], "finished_at": time.time()}),
                encoding="utf-8")
            self.say("done", 1, f"Hotovo za {clock(time.time() - started)}")
        except Skipped:
            self.say("skipped", None, "Přeskočeno – příště naváže, kde skončilo")
        except Exception as e:   # one bad video must not stop the queue
            self.say("error", None, f"{type(e).__name__}: {e}")


def _write_json(p, data):
    tmp = Path(p).with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def _parse_clock(x):
    """'1:02:03' / '02:03' -> seconds."""
    try:
        parts = [float(v) for v in str(x).strip().split(":")]
    except ValueError:
        return None
    if not parts or len(parts) > 3:
        return None
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def _srt_time(s):
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{sec:02d},{int((s % 1) * 1000):03d}"


def _ollama(path, body=None, timeout=600):
    req = urllib.request.Request(OLLAMA + path, json.dumps(body).encode() if body else None,
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _ask_text(model, prompt, props, ctx=16384, max_tokens=4000):
    resp = _ollama("/api/generate", {"model": model, "prompt": prompt, "stream": False,
                                     "options": {"temperature": 0.3, "num_ctx": ctx, "num_predict": max_tokens},
                                     "format": {"type": "object", "properties": props, "required": list(props)}},
                   timeout=900)
    try:
        return json.loads(resp["response"])
    except ValueError:
        return {}


def _cuda_paths():
    """CUDA DLLs come from the pip nvidia-* packages; Windows does not look there by itself."""
    for sp in [site.getusersitepackages(), *site.getsitepackages()]:
        for bin_dir in Path(sp, "nvidia").glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]


def main(cfg_file):
    sys.stdout.reconfigure(encoding="utf-8")    # the app reads progress as UTF-8, not the Windows code page
    _cuda_paths()
    cfg = _read_json(cfg_file)
    worker = Worker(cfg)
    handled = set()
    while True:
        queue = _read_json(cfg["queue_file"], {}).get("jobs", [])
        job = next((j for j in queue if j["key"] not in handled), None)
        if job is None:
            break
        handled.add(job["key"])
        worker.run_job(job)


if __name__ == "__main__":
    main(sys.argv[1])
