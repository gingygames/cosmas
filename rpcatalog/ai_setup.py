"""Setting up the AI from the app: what this PC can do, signing in to paid services, installing Ollama,
downloading local models and the NVIDIA speed-up for speech. Long work runs in threads and reports
through api.emit("ai", {...})."""
import base64
import hashlib
import http.server
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

from . import ai_providers as ai
from . import config, hardware, keystore
from .i18n import tr

NO_WINDOW = 0x08000000 if os.name == "nt" else 0
OLLAMA_SETUP = "https://ollama.com/download/OllamaSetup.exe"
_busy = set()


def _bg(api, name, fn):
    if name in _busy:
        return False
    _busy.add(name)

    def run():
        try:
            fn()
        except Exception as e:     # noqa: BLE001 - reported to the page
            api.emit("ai", {"task": name, "state": "error", "msg": str(e)})
        finally:
            _busy.discard(name)
    threading.Thread(target=run, daemon=True).start()
    return True


# ------------------------------------------------------------------ state
def ollama_exe():
    p = shutil.which("ollama")
    if p:
        return p
    cand = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
    return str(cand) if cand.exists() else None


def ollama_state():
    try:
        with urllib.request.urlopen(ai.OLLAMA + "/api/tags", timeout=2) as r:
            tags = json.loads(r.read()).get("models", [])
        return {"installed": True, "running": True,
                "models": [{"name": t["name"], "size": t.get("size")} for t in tags]}
    except OSError:
        return {"installed": bool(ollama_exe()), "running": False, "models": []}


def cuda_state(rec):
    from .analysis import _have_cuda_libs
    return {"nvidia": rec.get("vendor") == "nvidia", "libs": _have_cuda_libs()}


def info(api):
    s = api.settings
    rec = hardware.recommend()
    provs = []
    for pid, p in ai.CATALOG.items():
        if p.get("local"):
            continue
        models = {}
        for task, ms in p.get("models", {}).items():
            models[task] = [{"id": m["id"], "label": tr(m["label"]), "default": bool(m.get("default")),
                             "czk_hour": round(ai.estimate(pid, task, m["id"], s) * ai.USD_CZK, 2)} for m in ms]
        provs.append({"id": pid, "label": tr(p["label"]), "note": tr(p.get("note", "")), "key_url": p.get("key_url"),
                      "price_url": p.get("price_url"), "login": p.get("login", "key"), "has_key": keystore.has(pid),
                      "models": models})
    media = [m for m in api.store.all_media() if m.duration]
    st = api.store.transcript_status()
    todo = sum(m.duration for m in media if not st.get(m.id, {}).get("speech")) / 3600
    usage = ai.usage_summary()
    return {"hw": rec, "providers": provs, "effective": ai.effective(s), "per_hour": ai.per_hour(s),
            "usage": usage, "usage_czk": round(sum(u["usd"] for u in usage.values()) * ai.USD_CZK, 1),
            "ollama": ollama_state(), "cuda": cuda_state(rec), "todo_hours": round(todo, 1),
            "usd_czk": ai.USD_CZK, "setup_done": bool(s.get("ai_setup_done")),
            "busy": sorted(_busy)}


# ------------------------------------------------------------------ keys and sign-in
def set_key(provider, key):
    key = (key or "").strip()
    if key:
        ai.check_key(provider, key)        # raises with a readable message when it does not work
    keystore.set(provider, key)
    return keystore.has(provider)


def login_openrouter(api):
    """OAuth PKCE: the browser asks the user to sign in, OpenRouter sends a code to a local address,
    the code becomes an API key stored in the Credential Manager."""
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    got = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):        # noqa: N802
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in q:
                got["code"] = q["code"][0]
            body = ("<html><meta charset='utf-8'><body style='font-family:sans-serif;padding:40px'>"
                    "<h2>" + tr("Done, you can go back to Kosmas.") + "</h2></body></html>").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = None
    for port in range(3000, 3020):
        try:
            srv = http.server.HTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if srv is None:
        raise RuntimeError(tr("Couldn't find a free port for signing in"))
    srv.timeout = 1
    cb = f"http://localhost:{srv.server_port}/callback"

    def run():
        api.emit("ai", {"task": "login", "state": "waiting", "provider": "openrouter",
                        "msg": tr("Sign in in the browser that just opened…")})
        webbrowser.open("https://openrouter.ai/auth?" + urllib.parse.urlencode(
            {"callback_url": cb, "code_challenge": challenge, "code_challenge_method": "S256", "key_label": "Kosmas"}))
        end = time.time() + 600
        try:
            while "code" not in got and time.time() < end:
                srv.handle_request()
        finally:
            srv.server_close()
        if "code" not in got:
            raise RuntimeError(tr("Sign-in timed out"))
        req = urllib.request.Request("https://openrouter.ai/api/v1/auth/keys", json.dumps(
            {"code": got["code"], "code_verifier": verifier, "code_challenge_method": "S256"}).encode(),
            {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            key = json.loads(r.read()).get("key")
        if not key:
            raise RuntimeError(tr("OpenRouter did not return a key"))
        keystore.set("openrouter", key)
        api.emit("ai", {"task": "login", "state": "done", "provider": "openrouter", "msg": tr("Signed in to OpenRouter")})
    return _bg(api, "login", run)


# ------------------------------------------------------------------ Ollama
def install_ollama(api):
    def run():
        exe = ollama_exe()
        if not exe:
            dst = Path(tempfile.gettempdir()) / "OllamaSetup.exe"
            with urllib.request.urlopen(OLLAMA_SETUP, timeout=60) as r, open(dst, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                done = 0
                while chunk := r.read(1 << 20):
                    f.write(chunk)
                    done += len(chunk)
                    api.emit("ai", {"task": "ollama", "state": "progress", "p": done / total if total else None,
                                    "msg": tr("Downloading Ollama… {mb} MB", mb=done >> 20)})
            api.emit("ai", {"task": "ollama", "state": "progress", "p": None, "msg": tr("Installing Ollama…")})
            subprocess.run([str(dst), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"], check=True)
            dst.unlink(missing_ok=True)
            exe = ollama_exe()
        if not ollama_state()["running"] and exe:
            app = Path(exe).with_name("ollama app.exe")
            subprocess.Popen([str(app)] if app.exists() else [exe, "serve"], creationflags=NO_WINDOW,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(30):
                if ollama_state()["running"]:
                    break
                time.sleep(1)
        ok = ollama_state()["running"]
        api.emit("ai", {"task": "ollama", "state": "done" if ok else "error",
                        "msg": tr("Ollama is running") if ok else tr("Ollama did not start – start it from the Start menu")})
    return _bg(api, "ollama", run)


def pull_model(api, model):
    def run():
        req = urllib.request.Request(ai.OLLAMA + "/api/pull", json.dumps({"model": model, "stream": True}).encode(),
                                     {"Content-Type": "application/json"})
        last = 0
        with urllib.request.urlopen(req, timeout=3600) as r:
            for line in r:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("error"):
                    raise RuntimeError(f"Ollama: {d['error']}")
                if time.time() - last > 0.5 or d.get("status") == "success":
                    last = time.time()
                    tot, comp = d.get("total"), d.get("completed")
                    api.emit("ai", {"task": "pull:" + model, "state": "progress", "p": comp / tot if tot and comp else None,
                                    "msg": f"{model}: {(comp or 0) / 2**30:.1f} / {tot / 2**30:.1f} GB" if tot else f"{model}: {d.get('status', '')}"})
        api.emit("ai", {"task": "pull:" + model, "state": "done", "msg": tr("Model {model} is downloaded", model=model)})
    return _bg(api, "pull:" + model, run)


# ------------------------------------------------------------------ NVIDIA speed-up for speech
def install_cuda(api):
    def run():
        py = sys.executable.replace("pythonw.exe", "python.exe")
        config.PYLIBS_DIR.mkdir(parents=True, exist_ok=True)
        cmd = [py, "-m", "pip", "install", "--target", str(config.PYLIBS_DIR), "--upgrade", "--no-warn-script-location",
               "--disable-pip-version-check", "--progress-bar", "off", "nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*"]
        api.emit("ai", {"task": "cuda", "state": "progress", "p": None, "msg": tr("Downloading NVIDIA libraries (~1.5 GB)…")})
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                             errors="replace", creationflags=NO_WINDOW)
        tail = []
        for line in p.stdout:
            line = line.strip()
            if line:
                tail = (tail + [line])[-8:]
                if line.startswith(("Collecting", "Downloading", "Installing")):
                    api.emit("ai", {"task": "cuda", "state": "progress", "p": None, "msg": line[:120]})
        if p.wait():
            raise RuntimeError(tr("Installation failed: {details}", details=" ".join(tail)[-300:]))
        api.emit("ai", {"task": "cuda", "state": "done", "msg": tr("Speech transcription will now run on the graphics card")})
    return _bg(api, "cuda", run)
