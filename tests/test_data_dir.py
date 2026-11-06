"""Data folder safety: the dev-data pointer and the first-run import of an existing catalogue.

Everything runs in temporary folders; the module-level paths of rpcatalog.config are patched per test.
"""
import json
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

    def test_import_while_the_log_is_open(self):
        """First start of an installed copy: the log (logs/cosmas.log) is open before the import is offered.
        On Windows an open file can't be moved aside – the import used to fail and leave an empty catalogue."""
        import logging
        _catalog(self.dev, n_chars=2)
        (self.dev / "logs").mkdir()
        (self.dev / "logs" / "cosmas.log").write_text("log of the old copy\n", "utf-8")
        self.patch(data_dir=self.user)
        (self.user / "logs").mkdir(parents=True)
        fh = logging.FileHandler(self.user / "logs" / "cosmas.log", encoding="utf-8")   # held open like applog's
        self.addCleanup(fh.close)
        fh.emit(logging.makeLogRecord({"msg": "this start"}))
        config.import_data(self.dev)
        db = sqlite3.connect(self.user / "catalog.db")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM characters").fetchone()[0], 2)
        db.close()
        fh.flush()
        self.assertEqual((self.user / "logs" / "cosmas.log").read_text("utf-8"), "this start\n")   # stays, not overwritten
        self.assertEqual(list(self.user.glob("backup-before-import-*")), [])     # nothing else was there

    def test_import_gets_its_own_sync_identity(self):
        """The original may keep syncing: the copy must not write the same records on the web as the same database."""
        from rpcatalog import sync
        _catalog(self.dev)
        db = sqlite3.connect(self.dev / "catalog.db")
        sync.ensure_schema(db)
        for k, v in (("db_uuid", "orig-uuid"), ("last_sync", 1700000000), ("account", "123"), ("id_offset", 5000)):
            db.execute("INSERT INTO sync_state (key, value) VALUES (?, ?)", (k, json.dumps(v)))
        db.execute("INSERT INTO published (local_type, local_id, remote_id, rev, hash) VALUES ('characters', 1, 77, 2, 'h')")
        db.execute("INSERT INTO published_links (src, remote_id, hash) VALUES ('character_links:1', 9, 'h')")
        db.commit()
        db.close()
        (self.dev / "settings.json").write_text(json.dumps({"lang": "en", "sync_token": "krt_secret", "sync_user": "Jan",
                                                            "sync_auto": True, "sync_url": "https://gingygames.com"}), "utf-8")
        self.patch(data_dir=self.user)
        config.import_data(self.dev)
        db = sqlite3.connect(self.user / "catalog.db")
        state = {k: json.loads(v) for k, v in db.execute("SELECT key, value FROM sync_state")}
        self.assertNotIn("db_uuid", state)               # a new one at the first sync -> the pairing question
        self.assertNotIn("last_sync", state)
        self.assertEqual((state["account"], state["id_offset"]), ("123", 5000))     # "pair by id" still matches
        self.assertEqual(db.execute("SELECT COUNT(*) FROM published").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM published_links").fetchone()[0], 0)
        db.close()
        s = json.loads((self.user / "settings.json").read_text("utf-8"))
        self.assertNotIn("sync_token", s)                # signs in on its own
        self.assertNotIn("sync_user", s)
        self.assertEqual((s["sync_auto"], s["lang"]), (True, "en"))
        src = json.loads((self.dev / "settings.json").read_text("utf-8"))
        self.assertEqual(src["sync_token"], "krt_secret")   # the original keeps everything

    # ---- speech language for new settings
    def test_ai_language_default_follows_the_ui(self):
        self.patch(data_dir=self.user)
        self.user.mkdir(parents=True)
        for lang, want in (("en", ""), ("cs", "cs")):
            config.SETTINGS_PATH.write_text(json.dumps({"lang": lang}), "utf-8")
            self.assertEqual(config.load_settings()["ai_language"], want, lang)
        config.SETTINGS_PATH.write_text(json.dumps({"lang": "en", "ai_language": "cs"}), "utf-8")
        self.assertEqual(config.load_settings()["ai_language"], "cs")           # an explicit choice stays
        config.SETTINGS_PATH.write_text(json.dumps({"lang": "cs", "ai_language": ""}), "utf-8")
        self.assertEqual(config.load_settings()["ai_language"], "")


if __name__ == "__main__":
    unittest.main()
