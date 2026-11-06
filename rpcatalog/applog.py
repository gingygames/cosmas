"""Log file and crash reporting.

Everything the app prints (stdout / stderr, tracebacks of handled errors, JS console errors) goes to a rotating log
in <data>/logs/cosmas.log (1 MB × 5 files). Unhandled exceptions are logged and handed to `on_crash` (the main window
asks "Something went wrong – send a report?"). The log level is the `log_level` setting (info | debug).
"""
import logging
import logging.handlers
import os
import sys
import threading
import time
import traceback

from . import config

LOG_DIR = config.DATA_DIR / "logs"
LOG_PATH = LOG_DIR / "cosmas.log"
log = logging.getLogger("cosmas")
_crash_cb = None
_recent = {}


class _Tee:
    """Replaces sys.stdout / sys.stderr: lines go to the log (and to the console, when there is one)."""

    def __init__(self, orig, level):
        self.orig, self.level, self.buf = orig, level, ""
        self._lock = threading.RLock()
        self._inside = threading.local()

    def write(self, s):
        if self.orig is not None:
            try:
                self.orig.write(s)
            except Exception:
                pass
        # A failing log handler reports its error on sys.stderr, i.e. back here, while this thread is still inside
        # log.log(): that text only goes to the console (waiting for the lock or logging it again would hang or loop).
        if getattr(self._inside, "on", False):
            return len(s)
        with self._lock:
            self._inside.on = True
            try:
                self.buf += s
                while "\n" in self.buf:
                    line, self.buf = self.buf.split("\n", 1)
                    if line.strip():
                        log.log(self.level, line.rstrip())
            finally:
                self._inside.on = False
        return len(s)

    def flush(self):
        if self.orig is not None:
            try:
                self.orig.flush()
            except Exception:
                pass

    def isatty(self):
        return False

    @property
    def encoding(self):
        return getattr(self.orig, "encoding", "utf-8") or "utf-8"


def setup(level="info"):
    """Called once at start. Safe to call again (changes only the level)."""
    log.setLevel(logging.DEBUG if level == "debug" else logging.INFO)
    if level == "debug":
        os.environ["RPC_DEBUG"] = "1"
    if any(isinstance(h, logging.handlers.RotatingFileHandler) for h in log.handlers):
        return
    logging.raiseExceptions = False     # a log file that can't be written (rollover blocked, disk full) stays quiet
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=5, encoding="utf-8")
    except OSError:
        return
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)-5s %(threadName)s: %(message)s"))
    log.addHandler(fh)
    log.propagate = False
    if not isinstance(sys.stdout, _Tee):
        sys.stdout = _Tee(sys.stdout, logging.INFO)
    if not isinstance(sys.stderr, _Tee):
        sys.stderr = _Tee(sys.stderr, logging.WARNING)
    sys.excepthook = _excepthook
    threading.excepthook = lambda a: _excepthook(a.exc_type, a.exc_value, a.exc_traceback, a.thread)
    from . import __version__
    log.info("---- Cosmas %s start (python %s, %s, data %s)", __version__, sys.version.split()[0],
             "source checkout" if config.IS_DEV else "installed", config.DATA_DIR)


def set_level(level):
    setup(level)
    log.setLevel(logging.DEBUG if level == "debug" else logging.INFO)
    if level == "debug":
        os.environ["RPC_DEBUG"] = "1"
    else:
        os.environ.pop("RPC_DEBUG", None)


def on_crash(cb):
    """cb(text) – called (from any thread) with the formatted traceback of an unhandled exception."""
    global _crash_cb
    _crash_cb = cb


def _excepthook(etype, value, tb, thread=None):
    if etype is KeyboardInterrupt or etype is SystemExit:
        return
    text = "".join(traceback.format_exception(etype, value, tb))
    log.error("Unhandled exception%s:\n%s", f" in thread {thread.name}" if thread else "", text.rstrip())
    key = text.strip().splitlines()[-1] if text.strip() else ""
    now = time.time()
    if now - _recent.get(key, 0) < 600:        # the same error again within 10 minutes: logged only
        return
    _recent[key] = now
    if _crash_cb:
        try:
            _crash_cb(text)
        except Exception:
            pass


def tail(lines=2000, path=None):
    """The last `lines` lines of the log (current file, plus the previous one when the current is short)."""
    path = path or LOG_PATH
    out = []
    for p in (path, path.with_name(path.name + ".1")):
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                out = f.read().splitlines() + out
        except OSError:
            continue
        if len(out) >= lines:
            break
    return "\n".join(out[-lines:])
