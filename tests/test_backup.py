"""Automatic and manual backups of catalog.db, retention and restore at the next start."""
import shutil
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from rpcatalog import backup, config


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-bk-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        p = mock.patch.multiple(config, DATA_DIR=self.tmp, DB_PATH=self.tmp / "catalog.db")
        p.start()
        self.addCleanup(p.stop)
        self.db = sqlite3.connect(self.tmp / "catalog.db")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE media (id INTEGER PRIMARY KEY, title TEXT)")
        self.db.execute("INSERT INTO media (title) VALUES ('one')")
        self.db.commit()
        self.addCleanup(lambda: self.db.close())

    def titles(self, path=None):
        db = sqlite3.connect(path or self.tmp / "catalog.db")
        try:
            return [r[0] for r in db.execute("SELECT title FROM media ORDER BY id")]
        finally:
            db.close()

    def test_make_while_open_and_list(self):
        self.db.execute("INSERT INTO media (title) VALUES ('two')")       # not committed: not in the backup
        out = backup.make("manual")
        self.assertTrue(out.name.startswith("catalog-") and out.name.endswith("-manual.db"))
        self.assertEqual(self.titles(out), ["one"])
        self.assertFalse(Path(str(out) + "-wal").exists())
        self.assertEqual(backup.check(out), 1)
        b = backup.list_backups()
        self.assertEqual([(x["name"], x["kind"]) for x in b], [(out.name, "manual")])

    def test_auto_due_and_prune(self):
        s = {"backup_auto": True, "backup_every_hours": 24, "backup_keep": 3}
        self.assertTrue(backup.auto_due(s))
        self.assertFalse(backup.auto_due(dict(s, backup_auto=False)))
        bdir = backup.backup_dir()
        bdir.mkdir()
        base = time.time() - 10 * 86400
        for i in range(6):        # older automatic backups, one per day
            name = time.strftime("catalog-%Y%m%d-%H%M%S-auto.db", time.localtime(base + i * 86400))
            shutil.copy2(self.tmp / "catalog.db", bdir / name)
        shutil.copy2(self.tmp / "catalog.db", bdir / time.strftime("catalog-%Y%m%d-%H%M%S-manual.db", time.localtime(base)))
        out = backup.auto(s)
        self.assertIsNotNone(out)
        kinds = [x["kind"] for x in backup.list_backups()]
        self.assertEqual(kinds.count("auto"), 3)            # newest 3 automatic ones
        self.assertEqual(kinds.count("manual"), 1)          # manual backups are never pruned
        self.assertFalse(backup.auto_due(s))                # just made one
        self.assertIsNone(backup.auto(s))

    def test_restore_at_next_start(self):
        b = backup.make("manual")
        self.db.execute("INSERT INTO media (title) VALUES ('after the backup')")
        self.db.commit()
        backup.restore(b.name)
        self.assertTrue((self.tmp / "restore-pending.json").exists())
        self.db.close()                                      # the app has quit
        r = backup.apply_pending_restore()
        self.assertEqual(r["restored"], b.name)
        self.assertEqual(self.titles(), ["one"])
        saved = backup.backup_dir() / r["saved"]             # the replaced catalogue is kept
        self.assertEqual(self.titles(saved), ["one", "after the backup"])
        self.assertFalse((self.tmp / "restore-pending.json").exists())
        self.assertIsNone(backup.apply_pending_restore())
        self.db = sqlite3.connect(self.tmp / "catalog.db")

    def test_restore_refuses_bad_files(self):
        bdir = backup.backup_dir()
        bdir.mkdir()
        (bdir / "catalog-20260101-000000-manual.db").write_bytes(b"not a database at all" * 100)
        with self.assertRaises(ValueError):
            backup.restore("catalog-20260101-000000-manual.db")
        with self.assertRaises(FileNotFoundError):
            backup.restore("nope.db")
        self.assertFalse((self.tmp / "restore-pending.json").exists())


if __name__ == "__main__":
    unittest.main()
