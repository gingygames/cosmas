"""One running app per data folder: a second start brings the window of the first one to the front and exits.

With close-to-tray and start-minimized a second start would otherwise run a second full app on the same catalogue
(two scanners, two syncs, two analysis workers, settings.json written by both, two writers of one log).
The lock is a QLockFile in the temp folder named after the data folder, so a test copy (KRONIKAR_DATA) runs next
to the real one; the first instance listens on a QLocalServer of the same name and shows its window on any
connection. A lock left by a crashed process is stale (its process is gone) and is taken over.
"""
import hashlib
import os
import time
from pathlib import Path

from PySide6.QtCore import QDir, QLockFile

from . import config


def key(data_dir=None):
    d = os.path.normcase(os.path.abspath(str(data_dir or config.DATA_DIR)))
    return "kosmas-" + hashlib.sha1(d.encode("utf-8")).hexdigest()[:16]


class Guard:
    def __init__(self, data_dir=None):
        self.name = key(data_dir)
        self.lock = QLockFile(str(Path(QDir.tempPath()) / (self.name + ".lock")))
        self.lock.setStaleLockTime(0)      # held as long as the app runs; only a dead owner makes it stale
        self.server = None

    def acquire(self):
        """True when this is the only instance for the data folder (the lock is held until release())."""
        return self.lock.tryLock(0)

    def listen(self, on_show):
        """Call on_show() (in the GUI thread) whenever another start of the app knocks."""
        from PySide6.QtNetwork import QLocalServer
        QLocalServer.removeServer(self.name)           # a socket file left by a crash (not needed on Windows)
        self.server = QLocalServer()
        self.server.newConnection.connect(lambda: self._accept(on_show))
        if not self.server.listen(self.name):
            print(f"[instance] can't listen on {self.name}: {self.server.errorString()}")

    def _accept(self, on_show):
        while self.server is not None and self.server.hasPendingConnections():
            c = self.server.nextPendingConnection()
            c.disconnected.connect(c.deleteLater)
            c.disconnectFromServer()
            on_show()

    def release(self):
        """Before the app starts itself again (update, restored backup): the new process must get the lock."""
        if self.server is not None:
            self.server.close()
            self.server = None
        if self.lock.isLocked():
            self.lock.unlock()


def notify_running(data_dir=None, timeout=4.0):
    """Asks the running instance to show its window. False when it doesn't answer (e.g. still starting up).
    Needs a Q(Core)Application object."""
    from PySide6.QtNetwork import QLocalSocket
    name = key(data_dir)
    if os.name == "nt":
        try:      # Windows lets only the foreground process raise a window: hand that right to the running app
            import ctypes
            ctypes.windll.user32.AllowSetForegroundWindow(-1)    # ASFW_ANY
        except (OSError, AttributeError):
            pass
    end = time.monotonic() + timeout
    while True:
        s = QLocalSocket()
        s.connectToServer(name)
        if s.waitForConnected(500):
            s.write(b"show\n")
            s.waitForBytesWritten(500)
            s.disconnectFromServer()
            return True
        if time.monotonic() >= end:
            return False
        time.sleep(0.25)
