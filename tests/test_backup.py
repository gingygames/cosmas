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

    def test_odd_characters_in_the_data_folder(self):
        # '#' and '%' end or change a "file:…?mode=ro" URI unless the path is escaped
        odd = self.tmp / "a#b %20 c"
        odd.mkdir()
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        shutil.copy2(self.tmp / "catalog.db", odd / "catalog.db")
        self.assertEqual(backup.check(odd / "catalog.db"), 1)
        out = backup.make("manual", db_path=odd / "catalog.db", dest=odd / "backups")
        self.assertEqual(self.titles(out), ["one"])


class RestoreSyncTest(unittest.TestCase):
    """A restored catalogue must not lose its records again at the next sync: what the web deleted since the backup
    (often exactly what the restore brings back) becomes a conflict, nothing is deleted silently."""

    class Client:
        token = "krt_test"

        def request(self, *a, **k):
            raise AssertionError(f"no network expected: {a}")

    def setUp(self):
        from rpcatalog import sync
        from rpcatalog.store import Store
        self.sync = sync
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-bk-sync-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        p = mock.patch.multiple(config, DATA_DIR=self.tmp, DB_PATH=self.tmp / "catalog.db")
        p.start()
        self.addCleanup(p.stop)
        st = Store(self.tmp / "catalog.db")
        self.cid = st.create_character("Hans")
        st.db.commit()
        st.db.close()
        s = self.syncer()
        rows, _ = s.collect()
        # as after a sync: published and unchanged since (the hash of the row), the last sync long ago
        s.set_pub("characters", self.cid, remote_id=500, rev=3, hash=sync._hash(rows["characters"][self.cid]))
        s.set_state("last_sync", 100)
        s.close()

    def syncer(self):
        return self.sync.Syncer(self.tmp / "catalog.db", {"sync_token": "krt_test"}, self.tmp / "att", client=self.Client())

    def deleted_on_web(self):
        return {"id": 500, "type": "character", "src": f"characters:{self.cid}", "deleted": True, "rev": 4}

    def test_without_restore_a_clean_row_follows_the_web(self):
        s = self.syncer()
        s.apply_remote([self.deleted_on_web()], [])
        self.assertIsNone(s.row("characters", self.cid))       # the normal case: deleted on the web -> deleted here
        s.close()

    def test_restored_row_becomes_a_conflict(self):
        b = backup.make("manual")
        backup.restore(b.name)
        r = backup.apply_pending_restore()
        self.assertEqual(r["restored"], b.name)
        s = self.syncer()
        self.assertIsNone(s.pub("characters", self.cid)["hash"])
        s.apply_remote([self.deleted_on_web()], [])
        self.assertIsNotNone(s.row("characters", self.cid))    # still here
        self.assertEqual([(c["local_id"], c["kind"]) for c in s.conflicts()], [(self.cid, "deleted_remote")])
        s.close()


if __name__ == "__main__":
    unittest.main()
