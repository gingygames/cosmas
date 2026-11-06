"""Queue for analysis.py: one worker process at a time, order and pause controllable while it runs,
automatic pause while a game is running, progress / ETA / speed and PC load for the UI."""
import json
import os
import subprocess
import sys
import threading
import time
import uuid

from PySide6.QtCore import QObject, Signal

from . import config

NO_WINDOW = 0x08000000 if os.name == "nt" else 0
PRIORITY = {"idle": 0x00000040, "below": 0x00004000, "normal": 0x00000020}
SPEAKERS = {"mic": "Já", "game": "Hra", "discord": "Discord"}
WORK_DIR = config.DATA_DIR / "analysis"


def speech_tracks(media, enabled=None):
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
    out = out or [{"speaker": "Zvuk", "input": media.path, "stream": 0}]
    if enabled is not None:
        out = [sp for sp in out if sp["speaker"].split(" ")[0] in enabled]
    return out


GAME_DIRS = ("\\steamapps\\common\\", "\\epic games\\", "\\xboxgames\\", "\\gog galaxy\\games\\", "\\gog games\\",
             "\\ubisoft game launcher\\games\\", "\\rockstar games\\", "\\ea games\\", "\\battle.net\\")
NOT_GAMES = ("launcher", "epiconlineservices", "eosoverlay", "crashreport", "redist", "steamworks shared", "helper", "updater",
             "unitycrashhandler", "easyanticheat", "battleye", "overlay")


def is_game_exe(exe):
    """A program started from a game library folder (Steam, Epic, Xbox, GOG…), not its launcher or tools."""
    e = exe.lower()
    return any(d in e for d in GAME_DIRS) and not any(x in e for x in NOT_GAMES)


def worker_config(s, queue_file, world=None):
    from . import ai_providers
    g = lambda k, d: s.get(k, config.DEFAULTS.get(k, d))   # noqa: E731
    eff = ai_providers.effective(s)
    return {
        "speech_provider": eff["speech"]["provider"], "speech_model": eff["speech"]["model"],
        "vision_provider": eff["vision"]["provider"], "text_provider": eff["text"]["provider"],
        "whisper_device": eff["whisper"]["device"], "whisper_compute": eff["whisper"]["compute"],
        "queue_file": str(queue_file), "ffmpeg": config.find_tool("ffmpeg"),
        "whisper": eff["speech"]["model"] if eff["speech"]["provider"] == "local" else "", "language": g("ai_language", "cs"),
        "batch_size": eff["whisper"]["batch"], "beam_size": g("ai_beam_size", 5),
        "vad_threshold": g("ai_vad_threshold", 0.5), "junk_filter": g("ai_junk_filter", True),
        "vision_model": eff["vision"]["model"], "vision_width": g("ai_vision_width", 768),
        "every": g("ai_base_every", 120), "vision_dialog": g("ai_vision_dialog", True),
        "dialog_every": g("ai_dialog_every", 8), "static_every": g("ai_static_every", 45),
        "motion_threshold": g("ai_motion_threshold", 0.06), "conv_gap": g("ai_conv_gap", 20),
        "detect_names": g("ai_detect_names", True), "detect_faces": g("ai_detect_faces", True),
        "appearance": g("ai_appearance", True),
        "context": g("ai_context", ""), "text_model": eff["text"]["model"],
        "chapter_minutes": g("ai_chapter_minutes", 15), "known_names": (world or {}).get("names", []),
        "world": world or {},
    }


class AnalysisJobs(QObject):
    event = Signal(object)    # progress / state of one job, or {"phase": "queue"} when the queue changed

    def __init__(self, settings, world_provider=lambda: {}):
        super().__init__()
        self.settings = settings
        self.world_provider = world_provider
        self.ffmpeg = config.find_tool("ffmpeg")
        self.queue = []           # jobs waiting, in order
        self.current = None       # job being processed, with live progress
        self.history = []         # finished jobs, newest first
        self.state = {}           # media id -> last event (for the video panel)
        self.paused = False
        self.auto_paused = ""     # name of the game that caused an automatic pause
        self.detected_games = []  # game executables seen in recordings (set by the app)
        self._proc = None
        self._lock = threading.Lock()
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        for f in ("pause.flag", "skip.flag"):
            (WORK_DIR / f).unlink(missing_ok=True)
        self._cpu_inited = False

    # ------------------------------------------------------------ queries
    def available(self):
        import importlib.util
        cloud = (self.settings.get("ai_speech_provider") or "local") != "local"
        return bool(self.ffmpeg and (cloud or importlib.util.find_spec("faster_whisper")))

    def snapshot(self):
        def j(job):
            return {k: job.get(k) for k in ("key", "id", "title", "duration", "speech", "vision", "chapters",
                                            "vision_ranges", "added", "phase", "p", "msg", "eta", "speed",
                                            "started", "phase_started")} | {"speech": bool(job.get("speech"))}
        return {"current": j(self.current) if self.current else None, "queue": [j(x) for x in self.queue],
                "history": self.history[:40], "paused": self.paused, "auto_paused": self.auto_paused,
                "running": self._proc is not None}

    # ------------------------------------------------------------ queue control
    def request(self, media_list, speech=True, vision=False, chapters=None, vision_ranges=None, prev=None):
        s = self.settings
        if chapters is None:
            chapters = bool(s.get("ai_chapters", True))
        enabled = s.get("ai_tracks") or ["Já", "Hra", "Discord", "Zvuk"]
        with self._lock:
            for m in media_list:
                if not m.duration or not os.path.exists(m.path):
                    continue
                same = next((q for q in self.queue if q["id"] == m.id), None)
                if same and not vision_ranges:      # already waiting: just add what is asked on top
                    same["vision"] = same["vision"] or vision
                    same["chapters"] = same["chapters"] or chapters
                    continue
                job = {"key": uuid.uuid4().hex[:10], "id": m.id, "path": m.path, "duration": m.duration,
                       "title": m.display_title, "speech": speech_tracks(m, enabled) if speech else [],
                       "vision": vision, "chapters": chapters, "vision_ranges": vision_ranges,
                       "prev_summary": (prev or {}).get(m.id, ""),
                       "added": time.time(), "phase": "queued", "p": 0, "msg": "Čeká ve frontě"}
                self.queue.append(job)
                self.state[m.id] = {"id": m.id, "key": job["key"], "phase": "queued", "p": 0, "msg": "Čeká ve frontě"}
                self.event.emit(self.state[m.id])
        self._changed()

    def remove(self, key):
        with self._lock:
            job = next((q for q in self.queue if q["key"] == key), None)
            if job:
                self.queue.remove(job)
                self.state.pop(job["id"], None)
        if job:
            self.event.emit({"id": job["id"], "key": key, "phase": "canceled", "p": None, "msg": "Odebráno z fronty"})
        self._changed()

    def move(self, key, index):
        with self._lock:
            job = next((q for q in self.queue if q["key"] == key), None)
            if job:
                self.queue.remove(job)
                self.queue.insert(max(0, min(index, len(self.queue))), job)
        self._changed()

    def skip_current(self):
        if self.current:
            (WORK_DIR / "skip.flag").write_text(self.current["key"], encoding="utf-8")

    def set_paused(self, paused):
        self.paused = bool(paused)
        self._apply_pause()

    def check_games(self):
        """Pause automatically while a game from the list runs (GPU for the game, not for transcripts)."""
        reason = ""
        if self.settings.get("ai_pause_gaming", True) and (self._proc or self.queue):
            names = {n.lower() for n in self.pause_processes()}
            any_game = self.settings.get("ai_pause_any_game", True)
            try:
                import psutil
                for p in psutil.process_iter(["name", "exe"]):
                    name = (p.info["name"] or "").lower()
                    if name in names or (any_game and is_game_exe(p.info.get("exe") or "")):
                        reason = p.info["name"]
                        break
            except ImportError:
                pass
        if reason != self.auto_paused:
            self.auto_paused = reason
            self._apply_pause()

    def pause_processes(self):
        own = [p.strip() for p in self.settings.get("ai_pause_processes") or [] if p.strip()]
        return own or self.detected_games

    def _apply_pause(self):
        flag = WORK_DIR / "pause.flag"
        if self.paused or self.auto_paused:
            flag.write_text(self.auto_paused or "manual", encoding="utf-8")
        else:
            flag.unlink(missing_ok=True)
        self._changed()

    def cancel(self):
        """Stop everything (app closing). Finished pieces stay; the next run continues from there."""
        with self._lock:
            dropped, self.queue = self.queue, []
            proc = self._proc
        for j in dropped:
            self.state.pop(j["id"], None)
        if proc:
            proc.kill()

    # ------------------------------------------------------------ worker process
    def _changed(self):
        self._write_queue()
        self.event.emit({"phase": "queue"})
        self._start()

    def _write_queue(self):
        tmp = WORK_DIR / "queue.tmp"
        tmp.write_text(json.dumps({"jobs": self.queue}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, WORK_DIR / "queue.json")

    def _start(self):
        with self._lock:
            if self._proc is not None or not self.queue:
                return
            cfg_file = WORK_DIR / "worker.json"
            cfg_file.write_text(json.dumps(worker_config(self.settings, WORK_DIR / "queue.json", self.world_provider()),
                                           ensure_ascii=False), encoding="utf-8")
            py = sys.executable.replace("pythonw.exe", "python.exe")
            prio = PRIORITY.get(self.settings.get("ai_priority", "below"), PRIORITY["below"]) if os.name == "nt" else 0
            self._proc = subprocess.Popen([py, "-m", "rpcatalog.analysis", str(cfg_file)], cwd=str(config.APP_DIR),
                                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                          encoding="utf-8", errors="replace", creationflags=NO_WINDOW | prio)
            proc = self._proc
        threading.Thread(target=self._read, args=(proc,), daemon=True).start()

    def _on_event(self, ev):
        now = time.time()
        with self._lock:
            job = next((q for q in self.queue if q["key"] == ev.get("key")), None)
            if job:                                  # the worker took it: from the queue to "current"
                self.queue.remove(job)
                job["started"] = now
                self.current = job
                self._write_queue()
            cur = self.current
        if cur and cur["key"] == ev.get("key"):
            if ev["phase"] not in (cur.get("phase"), "paused"):
                cur["phase_started"], cur["phase_p0"] = now, ev.get("p") or 0
                cur["audio_s"] = 0
            if ev["phase"] != "paused":
                cur["phase"] = ev["phase"]
            cur["p"], cur["msg"] = ev.get("p"), ev.get("msg")
            cur["audio_s"] = cur.get("audio_s", 0) + (ev.get("audio_s") or 0)
            el = now - cur.get("phase_started", now)
            done = (ev.get("p") or 0) - cur.get("phase_p0", 0)
            cur["eta"] = el / done * (1 - (ev.get("p") or 0)) if done > 0.02 and el > 5 else None
            cur["speed"] = cur["audio_s"] / el if cur["phase"] == "speech" and el > 5 and cur["audio_s"] else None
            ev = dict(ev, eta=cur["eta"], speed=cur["speed"])
            if ev["phase"] in ("done", "error", "skipped"):
                self.history.insert(0, {"key": cur["key"], "id": cur["id"], "title": cur["title"], "phase": ev["phase"],
                                        "msg": ev.get("msg"), "finished": now, "took": now - cur.get("started", now),
                                        "duration": cur["duration"]})
                self.current = None
        if "id" in ev:
            self.state[ev["id"]] = ev
        self.event.emit(ev)
        if ev["phase"] in ("done", "error", "skipped"):
            self.event.emit({"phase": "queue"})

    def _read(self, proc):
        with (WORK_DIR / "worker.log").open("a", encoding="utf-8") as log:
            for line in proc.stdout:
                log.write(line)
                log.flush()
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue          # library warnings and the like: only in the log
                if isinstance(ev, dict) and "phase" in ev:
                    self._on_event(ev)
            proc.wait()
        with self._lock:
            cur, self.current, self._proc = self.current, None, None
        if cur:     # killed or crashed in the middle of a video
            self._on_event_end(cur, proc.returncode)
        self.event.emit({"phase": "queue"})
        self._start()     # anything queued after the worker decided to stop

    def _on_event_end(self, cur, code):
        ev = {"id": cur["id"], "key": cur["key"], "phase": "skipped" if code else "error", "p": None,
              "msg": "Přerušeno – příště naváže, kde skončilo" if code else "Skončilo bez výsledku (viz data/analysis/worker.log)"}
        self.state[cur["id"]] = ev
        self.history.insert(0, {"key": cur["key"], "id": cur["id"], "title": cur["title"], "phase": ev["phase"],
                                "msg": ev["msg"], "finished": time.time(), "took": 0, "duration": cur["duration"]})
        self.event.emit(ev)

    # ------------------------------------------------------------ PC load
    def system_stats(self):
        out = {}
        try:
            import psutil
            if not self._cpu_inited:
                psutil.cpu_percent(None)
                self._cpu_inited = True
            vm = psutil.virtual_memory()
            out.update(cpu=psutil.cpu_percent(None), ram_used=vm.used, ram_total=vm.total)
            if self._proc:
                try:
                    wp = psutil.Process(self._proc.pid)
                    out["worker_ram"] = wp.memory_info().rss
                except psutil.Error:
                    pass
        except ImportError:
            pass
        try:
            r = subprocess.run(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,"
                                "power.draw,power.limit", "--format=csv,noheader,nounits"],
                               capture_output=True, text=True, timeout=3, creationflags=NO_WINDOW)
            name, util, mu, mt, temp, pw, pl = [x.strip() for x in r.stdout.splitlines()[0].split(",")]
            out["gpu"] = {"name": name, "util": float(util), "mem_used": float(mu) * 2**20, "mem_total": float(mt) * 2**20,
                          "temp": float(temp), "power": float(pw), "power_limit": float(pl)}
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            pass
        return out
