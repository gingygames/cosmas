"""Update checks in the running app: timer, background check / download, state for the UI, install on restart.

State pushed to the web UI as the "update" notification (and returned by update.status):
  {state: idle|checking|uptodate|available|downloading|ready|error, current, info, decision, progress: [done, total],
   error, verified, last_check, can_install, dev, installed, note, support_url}
"""
import threading
import time
import traceback

from PySide6.QtCore import QObject, QTimer, Signal, Qt

from . import __version__, config, i18n, updater


class UpdateController(QObject):
    _done = Signal(object)          # worker thread -> GUI thread: a callable to run

    def __init__(self, settings, emit, save_settings, request_restart, badge=None):
        super().__init__()
        self.settings = settings
        self._emit = emit
        self._save = save_settings
        self._restart = request_restart       # restart(after_close_fn) – closes the app, then runs after_close_fn
        self._badge = badge or (lambda version: None)
        self.state = "idle"
        self.info = None
        self.decision = None
        self.progress = None
        self.error = None
        self.path = None
        self.verified = None
        self._cancel = threading.Event()
        self._busy = False
        self._done.connect(lambda fn: fn(), Qt.QueuedConnection)
        self.timer = QTimer(self, interval=30 * 60 * 1000)    # every 30 min: is a 12-hourly check due?
        self.timer.timeout.connect(self.auto_check)

    # ------------------------------------------------------------------ public
    def start(self, first_delay_ms=20000):
        cached = self.settings.get("update_latest")
        if isinstance(cached, dict) and cached.get("version"):
            self._apply(cached, manual=False, quiet=True)
        QTimer.singleShot(first_delay_ms, self.auto_check)
        self.timer.start()

    def auto_check(self):
        if updater.due(self.settings):
            self.check(manual=False)

    def status(self):
        latest = self.settings.get("update_latest")
        return {"state": self.state, "current": __version__, "info": self.info, "decision": self.decision,
                "progress": self.progress, "error": self.error, "verified": self.verified,
                "last_check": self.settings.get("update_last_check") or 0, "dev": config.IS_DEV,
                "installed": config.IS_INSTALLED,
                # why "Update now" is missing in a copy that isn't a source checkout (e.g. unpacked from a ZIP)
                "note": None if config.IS_INSTALLED or config.IS_DEV else i18n.tr(
                    "This copy wasn't installed with the installer, so it can't update itself. "
                    "Download the new version from the download page."),
                # from the last successful check of our own update endpoint (None from GitHub or when unknown)
                "support_url": (latest or {}).get("support_url") if isinstance(latest, dict) else None,
                "can_install": bool(self.decision and self.decision.get("can_install")),
                "auto_check": self.settings.get("update_auto_check", True),
                "auto_download": bool(self.settings.get("update_auto_download")),
                "channel": self.settings.get("update_channel") or "stable",
                "skip": self.settings.get("update_skip") or "", "releases_url": updater.RELEASES_PAGE}

    def check(self, manual=True):
        if self._busy:
            return self.status()
        self._busy = True
        if self.state not in ("downloading", "ready"):
            self._set("checking")
        channel = self.settings.get("update_channel") or "stable"

        def work():
            try:
                info, err = updater.fetch_latest(channel), None
            except Exception as e:
                info, err = None, str(e) or type(e).__name__
            self._done.emit(lambda: self._checked(info, err, manual))
        threading.Thread(target=work, name="cosmas-update-check", daemon=True).start()
        return self.status()

    def download(self):
        if not self.info or not (self.decision or {}).get("can_install") or self.state in ("downloading",):
            return self.status()
        if self.state == "ready" and self.path:
            return self.status()
        self._cancel.clear()
        self.error = None
        self.progress = [0, self.info.get("size")]
        self._set("downloading")
        info = dict(self.info)

        def prog(done, total):
            self.progress = [done, total]
            self._done.emit(lambda: self._push())

        def work():
            try:
                path, ok = updater.download(info, progress=prog, cancel=self._cancel)
                self._done.emit(lambda: self._downloaded(path, ok, None))
            except Exception as e:
                if not isinstance(e, updater.UpdateError):
                    traceback.print_exc()
                msg = str(e) or type(e).__name__
                self._done.emit(lambda: self._downloaded(None, None, msg))
        threading.Thread(target=work, name="cosmas-update-download", daemon=True).start()
        return self.status()

    def cancel(self):
        self._cancel.set()
        return self.status()

    def skip(self, version):
        self.settings["update_skip"] = version or ""
        self._save()
        if version and self.info and self.info.get("version") == version:
            self.decision = updater.decide(self.info, self.settings)
            self._set("uptodate" if not self.decision["available"] else self.state)
            self._badge(None)
        return self.status()

    def set_options(self, auto_check=None, auto_download=None, channel=None):
        if auto_check is not None:
            self.settings["update_auto_check"] = bool(auto_check)
        if auto_download is not None:
            self.settings["update_auto_download"] = bool(auto_download)
        if channel in ("stable", "beta") and channel != self.settings.get("update_channel", "stable"):
            self.settings["update_channel"] = channel
            self.settings["update_last_check"] = 0       # check the other channel soon
        self._save()
        return self.status()

    def install(self, accept_unverified=False):
        """Closes the app cleanly, then runs the installer silently; it starts the app again when done."""
        if self.state != "ready" or not self.path or not self.path.exists():
            raise RuntimeError("the update has not been downloaded yet")
        if config.IS_DEV:
            raise RuntimeError("a source checkout is not updated by the installer")
        if not config.IS_INSTALLED or not updater.install_dir():
            raise ValueError(i18n.tr("This copy wasn't installed with the installer, so it can't update itself. "
                                     "Download the new version from the download page."))
        ok = updater.verify(self.path, (self.info or {}).get("sha256"))
        if ok is False:
            self.path.unlink(missing_ok=True)
            self.path = None
            self._set("error", error=i18n.tr("The downloaded installer does not match its published SHA-256 – it was deleted."))
            return self.status()
        if ok is None and not accept_unverified:
            return dict(self.status(), need_confirm=True)
        path, info, lang = self.path, dict(self.info), i18n.lang()
        updater.write_pending(info, path)
        self._restart(lambda: updater.launch_installer(path, lang, updater.install_dir()))
        return self.status()

    # ------------------------------------------------------------------ internals
    def _checked(self, info, err, manual):
        self._busy = False
        self.settings["update_last_check"] = time.time()
        if info:
            self.settings["update_latest"] = info
        self._save()
        if err:
            print(f"[update] check failed: {err}")
            if self.state in ("downloading", "ready"):
                return self._push()
            # a failed automatic check stays quiet; a manual one says why
            return self._set("error" if manual else ("available" if self.decision and self.decision.get("available") else "idle"),
                             error=i18n.tr("Could not check for updates: {error}", error=err) if manual else None)
        self._apply(info, manual)

    def _apply(self, info, manual, quiet=False):
        if self.state in ("downloading", "ready") and self.info and self.info.get("version") == info.get("version"):
            return self._push()
        self.info = info
        self.decision = updater.decide(info, self.settings, manual=manual)
        if not self.decision["available"]:
            self._badge(None)
            return self._set("uptodate" if not quiet else "idle")
        self._badge(info["version"])
        self._set("available")
        if self.decision["auto_download"] and not quiet:
            self.download()

    def _downloaded(self, path, ok, err):
        if err:
            self.progress = None
            cancelled = err == "cancelled"
            return self._set("available" if cancelled else "error",
                             error=None if cancelled else i18n.tr("Download failed: {error}", error=err))
        self.path, self.verified = path, ok
        self._set("ready")

    def _set(self, state, error=None):
        self.state = state
        self.error = error
        self._push()

    def _push(self):
        self._emit("update", self.status())
