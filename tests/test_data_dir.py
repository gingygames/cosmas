"""Data folder safety: the dev-data pointer and the first-run import of an existing catalogue.

Everything runs in temporary folders; the module-level paths of rpcatalog.config are patched per test.
"""
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rpcatalog import config
from rpcatalog.store import Store


def _catalog(folder, n_chars=2):
    folder.mkdir(parents=True, exist_ok=True)
    st = Store(folder / "catalog.db")
    for i in range(n_chars):
        st.create_character(f"Postava {i}")
    att = folder / "attachments" / "a.png"
    att.parent.mkdir(exist_ok=True)
    att.write_bytes(b"png")
    st.add_attachment("character", 1, str(att), "a.png", "image/png", "image", 3)
    st.db.commit()
    st.db.close()
    (folder / "settings.json").write_text('{"roots": ["C:\\\\Medal"], "lang": "en"}', "utf-8")


def _snapshot(folder):
    return {str(p.relative_to(folder)): (p.stat().st_size, p.stat().st_mtime_ns, p.read_bytes() if p.is_file() else None)
            for p in sorted(folder.rglob("*"))}


class DataDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kosmas-datadir-"))
        self.user = self.tmp / "LocalAppData" / "Kronikar"
        self.dev = self.tmp / "checkout" / "data"
        self.patch()

    def tearDown(self):
        self._p.stop()
        self._home.stop()
        self._env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def patch(self, data_dir=None, env=None):
        if hasattr(self, "_p"):
            self._p.stop()
            self._home.stop()
            self._env.stop()
        d = data_dir or self.dev
        vals = {"USER_DIR": self.user, "_DEV_DATA": self.dev, "DATA_DIR": d, "DB_PATH": d / "catalog.db",
                "SETTINGS_PATH": d / "settings.json", "THUMB_DIR": d / "thumbs",
                "DEV_POINTER": self.user / "last_dev_data.txt", "IMPORT_DECLINED": self.user / "import_declined.txt"}
        self._p = mock.patch.multiple(config, **vals)
        self._p.start()
        self._home = mock.patch.object(config.Path, "home", return_value=self.tmp / "home")   # not the real Documents
        self._home.start()
        e = {k: v for k, v in os.environ.items() if k != "KRONIKAR_DATA"}
        e.update(env or {})
        self._env = mock.patch.dict(os.environ, e, clear=True)
        self._env.start()

    # ---- pointer
    def test_pointer_written_by_real_checkout(self):
        _catalog(self.dev)
        config.prepare_data_dir()
        self.assertEqual(config.DEV_POINTER.read_text("utf-8"), str(self.dev))

    def test_no_pointer_without_catalogue(self):
        self.dev.mkdir(parents=True)
        config.prepare_data_dir()
        self.assertFalse(config.DEV_POINTER.exists())

    def test_no_pointer_with_kronikar_data(self):
        _catalog(self.dev)
        self.patch(env={"KRONIKAR_DATA": str(self.dev)})
        config.prepare_data_dir()
        self.assertFalse(config.DEV_POINTER.exists())

    def test_valid_pointer_not_overwritten(self):
        other = self.tmp / "owner" / "data"
        _catalog(other)
        self.user.mkdir(parents=True)
        config.DEV_POINTER.write_text(str(other), "utf-8")
        _catalog(self.dev)                    # a second (test) checkout with its own catalogue
        config.prepare_data_dir()
        self.assertEqual(config.DEV_POINTER.read_text("utf-8"), str(other))

    def test_stale_pointer_replaced(self):
        self.user.mkdir(parents=True)
        config.DEV_POINTER.write_text(str(self.tmp / "gone"), "utf-8")
        _catalog(self.dev)
        config.prepare_data_dir()
        self.assertEqual(config.DEV_POINTER.read_text("utf-8"), str(self.dev))

    # ---- first-run import into an installed copy
    def test_import_copies_and_leaves_source_untouched(self):
        _catalog(self.dev, n_chars=3)
        self.user.mkdir(parents=True)
        config.DEV_POINTER.write_text(str(self.dev), "utf-8")
        before = _snapshot(self.dev)
        self.patch(data_dir=self.user)
        (self.user / "settings.json").write_text('{"lang": "cs"}', "utf-8")    # something from an earlier start
        cands = config.import_candidates()
        self.assertIn(self.dev, cands)
        config.import_data(self.dev)
        self.assertEqual(_snapshot(self.dev), before)                          # source byte-for-byte the same
        db = sqlite3.connect(self.user / "catalog.db")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM characters").fetchone()[0], 3)
        path = db.execute("SELECT path FROM attachments").fetchone()[0]
        db.close()
        self.assertTrue(path.startswith(str(self.user)), path)                 # paths point into the new folder
        self.assertTrue((self.user / "attachments" / "a.png").exists())
        backups = list(self.user.glob("backup-before-import-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "settings.json").read_text("utf-8"), '{"lang": "cs"}')
        self.assertIn("C:\\\\Medal", (self.user / "settings.json").read_text("utf-8"))
        self.assertEqual(config.import_candidates(), [])                       # has a catalogue now

    def test_no_candidates_when_declined_or_dev(self):
        _catalog(self.dev)
        self.user.mkdir(parents=True)
        config.DEV_POINTER.write_text(str(self.dev), "utf-8")
        self.assertEqual(config.import_candidates(), [])                       # a checkout never imports
        self.patch(data_dir=self.user, env={"KRONIKAR_DATA": str(self.user)})
        self.assertEqual(config.import_candidates(), [])                       # explicit data folder: no import
        self.patch(data_dir=self.user)
        self.assertEqual(config.import_candidates(), [self.dev])
        config.IMPORT_DECLINED.write_text("declined", "utf-8")
        self.assertEqual(config.import_candidates(), [])


if __name__ == "__main__":
    unittest.main()
