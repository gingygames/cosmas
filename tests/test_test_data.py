"""Test records (is_test): hidden from every list unless shown, deletable in one go, videos never deleted."""
import shutil
import tempfile
import unittest
from pathlib import Path

from rpcatalog.store import TEST_TABLES, Store


class TestDataTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kosmas-testdata-"))
        self.st = Store(self.tmp / "catalog.db")
        st = self.st
        self.real_c, self.test_c = st.create_character("Skutečná"), st.create_character("Testovací")
        self.real_e, self.test_e = st.create_event("Skutečná událost"), st.create_event("Testovací událost")
        self.test_en = st.create_entry(self.test_e, title="Zápis")
        self.real_m = st.upsert_media({"path": str(self.tmp / "a.mp4"), "game": "Hra", "kind": "clip", "duration": 5})
        self.test_m = st.upsert_media({"path": str(self.tmp / "b.mp4"), "game": "Test", "kind": "clip", "duration": 5})
        st.commit()
        self.bm_on_test_media = st.create_bookmark(self.test_m, 1, title="Na testovacím videu")
        self.test_bm = st.create_bookmark(self.real_m, 2, title="Testovací moment")
        self.real_bm = st.create_bookmark(self.real_m, 3, title="Skutečný moment")
        self.test_f, self.test_p = st.create_faction("Testovací rod"), st.create_place("Testovací hrad")
        self.test_l = st.create_letter(title="Testovací dopis")
        self.test_pl = st.create_player("Tester")
        st.set_test("characters", [self.test_c])
        st.set_test("events", [self.test_e])
        st.set_test("media", [self.test_m])
        st.set_test("bookmarks", [self.test_bm])
        for t, i in (("factions", self.test_f), ("places", self.test_p), ("letters", self.test_l), ("players", self.test_pl)):
            st.set_test(t, i)

    def tearDown(self):
        self.st.db.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_hidden_everywhere_by_default(self):
        st = self.st
        self.assertEqual([c["id"] for c in st.characters()], [self.real_c])
        self.assertEqual([e["id"] for e in st.events()], [self.real_e])
        self.assertEqual([m.id for m in st.all_media()], [self.real_m])
        self.assertEqual({b["id"] for b in st.bookmarks()}, {self.real_bm})
        self.assertEqual(st.games(), [("Hra", 1)])
        self.assertEqual(st.entries(), [])
        self.assertEqual((st.factions(), st.places(), st.letters(), st.players()), ([], [], [], []))
        st.hide_test = False                  # Settings → Show test data
        self.assertEqual(len(st.characters()), 2)
        self.assertEqual(len(st.all_media()), 2)
        self.assertEqual(len(st.bookmarks()), 3)
        self.assertEqual(len(st.entries()), 1)

    def test_delete_test_data(self):
        st = self.st
        counts = st.delete_test_data()
        self.assertEqual(counts["characters"], 1)
        self.assertNotIn("media", counts)
        st.hide_test = False
        self.assertEqual([c["id"] for c in st.characters()], [self.real_c])
        self.assertEqual([e["id"] for e in st.events()], [self.real_e])
        self.assertEqual(st.entries(), [])
        self.assertEqual({m.id for m in st.all_media()}, {self.real_m, self.test_m})   # videos stay, still marked
        self.assertEqual(st.test_ids("media"), {self.test_m})
        self.assertEqual({b["id"] for b in st.bookmarks()}, {self.real_bm, self.bm_on_test_media})
        self.assertEqual(sum(v for t, v in st.test_counts().items() if t != "media"), 0)

    def test_migration_adds_column(self):
        for t in TEST_TABLES:
            self.assertIn("is_test", {r[1] for r in self.st.db.execute(f"PRAGMA table_info({t})")})
        self.st.db.close()
        self.st = Store(self.tmp / "catalog.db")          # reopening an existing catalogue keeps working
        self.assertEqual(self.st.test_ids("characters"), {self.test_c})


if __name__ == "__main__":
    unittest.main()
