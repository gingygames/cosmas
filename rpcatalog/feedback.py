"""Feedback and bug reports: payload, redaction, sending, offline queue.

POST https://gingygames.com/kosmas/api/feedback (Bearer token when signed in to the web)
  {kind: bug|idea|question|other, message, email?, app: {name, version, os, lang}, context?: {view, ...},
   log?, screenshot? (data URL), system?}
The answer's id (id | ref | reference) is shown to the user. Reports that can't be sent (offline, server down) wait in
<data>/feedback-queue and are retried later; a report the server refuses (4xx) is not retried.
Logs and tracebacks are redacted first: tokens, keys, e-mail addresses and the user's profile folder / name.
"""
import json
import os
import platform
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from . import __version__, config, i18n

FEEDBACK_PATH = "/kosmas/api/feedback"
KINDS = ("bug", "idea", "question", "other")
# limits of the server (gingygames.com/kosmas/api/feedback): message ≤ 5000 chars, log ≤ 50 KB, screenshot ≤ 2 MB
MAX_MESSAGE = 5000
MAX_LOG_LINES = 2000
MAX_LOG_BYTES = 48_000
MAX_SCREENSHOT = 2_000_000 * 4 // 3      # characters of the base64 data URL for a 2 MB image


def queue_dir():
    return config.DATA_DIR / "feedback-queue"


# ------------------------------------------------------------------ redaction
_PATTERNS = [
    (re.compile(r"\b(krt|krs|kra)_[A-Za-z0-9_\-]{8,}"), r"\1_[REDACTED]"),                     # Cosmas web tokens
    (re.compile(r"(?i)\b(bearer|bot)\s+[A-Za-z0-9._~+/=\-]{12,}"), r"\1 [REDACTED]"),
    (re.compile(r"\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}"), "[REDACTED-DISCORD-TOKEN]"),
    (re.compile(r"\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_\-]{16,}"), "sk-[REDACTED]"),               # Anthropic/OpenAI/OpenRouter
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"), "[REDACTED-GOOGLE-KEY]"),
    (re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{20,})"), "[REDACTED-GITHUB-TOKEN]"),
    (re.compile(r"(?i)([\"']?(?:token|access_token|refresh_token|api[_-]?key|secret|password|passwd|authorization|code_verifier)[\"']?\s*[:=]\s*[\"']?)([^\s\"',;&}]{4,})"),
     r"\1[REDACTED]"),
    (re.compile(r"(?i)([?&](?:token|key|code|state|access_token|sig|signature)=)[^&\s\"']+"), r"\1[REDACTED]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
]


def _home_variants():
    out = set()
    for p in {str(Path.home()), os.environ.get("USERPROFILE", ""), os.environ.get("HOME", "")}:
        if p and len(p) > 3:
            out |= {p, p.replace("\\", "/"), p.replace("\\", "\\\\"), p.replace("/", "\\")}
    return sorted(out, key=len, reverse=True)


def redact(text, secrets=()):
    """Removes what shouldn't leave the computer: the given secrets (exact values), tokens and keys, e-mail
    addresses, the user profile folder (-> %USERPROFILE%) and the Windows user name inside paths."""
    if not text:
        return text or ""
    s = str(text)
    for sec in secrets:
        if sec and len(str(sec)) >= 4:
            s = s.replace(str(sec), "[REDACTED]")
    for home in _home_variants():
        s = re.sub(re.escape(home), "%USERPROFILE%", s, flags=re.I)
    user = os.environ.get("USERNAME") or os.environ.get("USER") or ""
    if len(user) >= 2:
        s = re.sub(r"(?i)([\\/]Users[\\/]+)" + re.escape(user) + r"(?=[\\/\"'\s]|$)", r"\1%USERNAME%", s)
    for rx, rep in _PATTERNS:
        s = rx.sub(rep, s)
    return s


def secrets_of(settings):
    return [settings.get(k) for k in ("sync_token", "discord_token") if settings.get(k)]


# ------------------------------------------------------------------ system info
def _ram():
    try:
        import ctypes

        class MEM(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong),
                        ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = MEM()
        m.dwLength = ctypes.sizeof(MEM)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
            return m.ullTotalPhys
    except Exception:
        pass
    return 0


def os_name():
    if os.name == "nt":
        try:
            v = sys.getwindowsversion()
            name = "Windows 11" if v.major == 10 and v.build >= 22000 else f"Windows {platform.release()}"
            return f"{name} (build {v.build})"
        except Exception:
            pass
    return f"{platform.system()} {platform.release()}"


def system_info():
    info = {"app_version": __version__, "os": os_name(), "machine": platform.machine(),
            "python": platform.python_version(), "install": "source checkout" if config.IS_DEV else "installed",
            "lang": i18n.lang(), "ram_gb": round(_ram() / 2**30, 1)}
    try:
        from PySide6 import __version__ as qt
        info["qt"] = qt
    except Exception:
        pass
    try:
        from . import hardware
        hw = hardware.detect()
        info["gpus"] = [f"{g.get('name')} ({round((g.get('vram') or 0) / 2**30, 1)} GB)" for g in hw.get("gpus") or []]
        info["cpu"] = hw.get("cpu") or ""
        info["cores"] = hw.get("cores")
        if not info["ram_gb"] and hw.get("ram"):
            info["ram_gb"] = round(hw["ram"] / 2**30, 1)
    except Exception:
        pass
    return info


def diagnostics_text(settings, log_lines=200):
    """Plain text for "Copy diagnostics": system info + settings that matter + the end of the log (all redacted)."""
    from . import applog
    si = system_info()
    keep = ("lang", "update_channel", "update_auto_check", "update_auto_download", "ai_speech_provider",
            "ai_vision_provider", "ai_text_provider", "ai_whisper_device", "ai_whisper_model", "player_hwdec",
            "backup_auto", "log_level", "sync_auto")
    lines = [f"{i18n.app_name()} {__version__}", ""] + [f"{k}: {v}" for k, v in si.items()]
    lines += ["", "settings:"] + [f"  {k}: {settings.get(k)}" for k in keep if k in settings]
    lines += ["", f"data folder: {config.DATA_DIR}", f"last {log_lines} log lines:", applog.tail(log_lines)]
    return redact("\n".join(lines), secrets_of(settings))


# ------------------------------------------------------------------ payload
def build_payload(kind, message, settings, email=None, view=None, include_log=False, include_system=True,
                  screenshot=None, traceback_text=None, log_text=None):
    """The JSON body that will be sent (also shown in the preview)."""
    kind = kind if kind in KINDS else "other"
    message = str(message or "").strip()[:MAX_MESSAGE]
    if not message and not traceback_text:
        raise ValueError(i18n.tr("Write a message first."))
    sec = secrets_of(settings)
    p = {"kind": kind, "message": message,
         "app": {"name": "Cosmas", "version": __version__, "os": os_name(), "lang": i18n.lang()}}
    email = str(email or "").strip()
    if email:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 200:
            raise ValueError(i18n.tr("That e-mail address doesn't look right."))
        p["email"] = email
    ctx = {}
    if view:
        ctx["view"] = str(view)[:64]
    if traceback_text:
        ctx["traceback"] = redact(traceback_text, sec)[-20000:]
    if ctx:
        p["context"] = ctx
    if include_log:
        if log_text is None:
            from . import applog
            log_text = applog.tail(MAX_LOG_LINES)
        log = redact("\n".join(str(log_text).splitlines()[-MAX_LOG_LINES:]), sec)
        raw = log.encode("utf-8")
        if len(raw) > MAX_LOG_BYTES:         # the server takes ≤ 50 KB: keep the newest part, from a whole line
            log = raw[-MAX_LOG_BYTES:].decode("utf-8", "ignore").split("\n", 1)[-1]
        p["log"] = log
    if include_system:
        p["system"] = system_info()
    if screenshot:
        if not str(screenshot).startswith("data:image/") or len(screenshot) > MAX_SCREENSHOT:
            raise ValueError("bad screenshot")
        p["screenshot"] = screenshot
    return p


# ------------------------------------------------------------------ sending
class SendError(Exception):
    def __init__(self, msg, retry):
        super().__init__(msg)
        self.retry = retry


def endpoint(settings):
    from .sync import DEFAULT_URL, check_url
    base = os.environ.get("KOSMAS_FEEDBACK_URL")
    return base or check_url(settings.get("sync_url") or DEFAULT_URL) + FEEDBACK_PATH


def send(payload, settings, opener=urllib.request.urlopen, timeout=30):
    """POSTs the report; returns the reference id (or "" when the server sends none). SendError.retry tells whether
    it makes sense to try again later."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json",
               "User-Agent": f"Cosmas-desktop/{__version__}", "Accept-Language": i18n.lang()}
    if settings.get("sync_token"):
        headers["Authorization"] = f"Bearer {settings['sync_token']}"
    req = urllib.request.Request(endpoint(settings), data=body, headers=headers, method="POST")
    try:
        with opener(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read() or b"{}").get("error") or ""
        except Exception:
            detail = ""
        if e.code == 401 and "Authorization" in headers:      # stale token: send anonymously instead
            s2 = {k: v for k, v in settings.items() if k != "sync_token"}
            return send(payload, s2, opener, timeout)
        raise SendError(f"HTTP {e.code}{': ' + str(detail) if detail else ''}",
                        retry=e.code in (408, 425, 429) or e.code >= 500) from None
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise SendError(str(getattr(e, "reason", e)), retry=True) from None
    try:
        d = json.loads(raw or b"{}")
    except ValueError:
        d = {}
    if not isinstance(d, dict):
        d = {}
    return str(d.get("id") or d.get("ref") or d.get("reference") or "")


def enqueue(payload):
    q = queue_dir()
    q.mkdir(parents=True, exist_ok=True)
    p = q / f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.json"
    p.write_text(json.dumps({"payload": payload, "queued_at": time.time(), "tries": 0}, ensure_ascii=False), "utf-8")
    return p


def queued():
    q = queue_dir()
    return sorted(q.glob("*.json")) if q.is_dir() else []


def flush_queue(settings, opener=urllib.request.urlopen):
    """Tries to send the queued reports. Returns {"sent": [ids], "left": n}."""
    sent = []
    for p in queued():
        try:
            item = json.loads(p.read_text("utf-8"))
        except (OSError, ValueError):
            p.unlink(missing_ok=True)
            continue
        try:
            sent.append(send(item["payload"], settings, opener))
            p.unlink(missing_ok=True)
        except SendError as e:
            item["tries"] = item.get("tries", 0) + 1
            if not e.retry or item["tries"] >= 20 or time.time() - item.get("queued_at", 0) > 30 * 86400:
                p.unlink(missing_ok=True)
            else:
                p.write_text(json.dumps(item, ensure_ascii=False), "utf-8")
                break                     # still offline: try the rest next time
    return {"sent": sent, "left": len(queued())}


def submit(payload, settings, opener=urllib.request.urlopen):
    """Send now; when offline, queue it. {"status": "sent", "id": ref} | {"status": "queued"}; SendError for refusals."""
    try:
        return {"status": "sent", "id": send(payload, settings, opener)}
    except SendError as e:
        if e.retry:
            enqueue(payload)
            return {"status": "queued", "error": str(e)}
        raise
