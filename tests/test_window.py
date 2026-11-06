"""Main window size: it must fit small screens (1366×768 at 100–125 %), and a big default or saved size is clamped.

The real MainWindow is built in a child process on Qt's offscreen platform (an 800×600 screen) with an empty
temporary data folder; the child prints its measurements as JSON and exits without Qt teardown.
Skipped when PySide6 / QtWebEngine or libmpv are not available.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CHILD = r'''
import json, locale, os, sys
from unittest import mock
from pathlib import Path
from rpcatalog import config
d = Path(os.environ["KRONIKAR_DATA"])
with mock.patch.multiple(config, USER_DIR=d / "user", DEV_POINTER=d / "user" / "last_dev_data.txt", default_roots=lambda: []):
    config.ensure_dirs()
    from PySide6.QtWidgets import QApplication
    qa = QApplication(sys.argv[:1])
    locale.setlocale(locale.LC_NUMERIC, "C")
    from rpcatalog.app import MainWindow
    w = MainWindow()
    av = w.screen().availableGeometry()
    out = {"min_hint": [w.minimumSizeHint().width(), w.minimumSizeHint().height()],
           "min": [w.minimumSize().width(), w.minimumSize().height()],
           "size": [w.width(), w.height()], "screen": [av.x(), av.y(), av.width(), av.height()],
           "title": w.windowTitle(), "data": str(config.DATA_DIR)}
    w.resize(4000, 3000)          # e.g. geometry saved on a bigger monitor
    w.move(5000, 5000)
    w.fit_to_screen()
    g = w.frameGeometry()
    out["fitted"] = [g.x(), g.y(), g.width(), g.height()]
    w.player.shutdown()
    print("RESULT " + json.dumps(out), flush=True)
    os._exit(0)
'''


def _qt_available():
    try:
        import PySide6.QtWebEngineWidgets  # noqa: F401
        from rpcatalog.ui import player  # noqa: F401  (puts vendor/ on PATH and loads libmpv)
        return True
    except Exception:
        return False


@unittest.skipUnless(_qt_available(), "PySide6 with QtWebEngine and libmpv are needed")
class WindowSizeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="kosmas-window-"))
        env = dict(os.environ, QT_QPA_PLATFORM="offscreen", KRONIKAR_DATA=str(cls.tmp / "data"),
                   PYTHONPATH=str(ROOT), KOSMAS_TITLE_SUFFIX="TEST")
        env.pop("QTWEBENGINE_REMOTE_DEBUGGING", None)
        p = subprocess.run([sys.executable, "-B", "-c", CHILD], cwd=str(ROOT), env=env, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=120)
        line = next((l for l in p.stdout.splitlines() if l.startswith("RESULT ")), None)
        if line is None:
            raise AssertionError(f"window probe failed (exit {p.returncode}):\n{p.stdout[-2000:]}\n{p.stderr[-3000:]}")
        cls.r = json.loads(line[7:])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_can_shrink_to_small_screens(self):
        self.assertLessEqual(self.r["min_hint"][1], 700, self.r)
        self.assertLessEqual(self.r["min"][1], 700, self.r)
        self.assertLessEqual(self.r["min_hint"][0], 1000, self.r)

    def test_default_size_fits_the_screen(self):
        sx, sy, sw, sh = self.r["screen"]
        self.assertLessEqual(self.r["size"][0], sw, self.r)
        self.assertLessEqual(self.r["size"][1], sh, self.r)
        x, y, w, h = self.r["fitted"]
        self.assertLessEqual(w, sw, self.r)
        self.assertLessEqual(h, sh, self.r)
        self.assertTrue(sx <= x and sy <= y and x + w <= sx + sw and y + h <= sy + sh, self.r)

    def test_title_names_a_test_run_and_its_data_folder(self):
        self.assertRegex(self.r["title"], r"^(Cosmas|Kosmas) – TEST – ")
        self.assertTrue(self.r["title"].endswith(self.r["data"]), self.r)


if __name__ == "__main__":
    unittest.main()
