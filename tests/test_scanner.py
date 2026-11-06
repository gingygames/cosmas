"""Rescans (every few minutes): no ffprobe / ffmpeg again for unchanged files, no UI reload when nothing changed,
and a game the user set survives. ffprobe, ffmpeg and Medal's database are mocked."""
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rpcatalog import config, scanner
from rpcatalog.store import Store


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-scan-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.root = self.tmp / "Videos"
        (self.root / "GameA").mkdir(parents=True)
        self.good = self.root / "GameA" / "obs-good.mp4"
        self.bad = self.root / "GameA" / "obs-broken.mp4"
        self.good.write_bytes(b"g" * 100)
        self.bad.write_bytes(b"b" * 50)
        self.store = Store(self.tmp / "catalog.db")
        self.addCleanup(lambda: self.store.db.close())
        self.probed, self.thumbed = [], []
        for p in (mock.patch.object(scanner, "read_medal", lambda roots: {}),
                  mock.patch.object(config, "find_tool", lambda name: "C:/fake/" + name + ".exe"),
                  mock.patch.object(scanner, "ffprobe", self.ffprobe),
                  mock.patch.object(scanner, "make_thumb", self.make_thumb)):
            p.start()
            self.addCleanup(p.stop)

    def ffprobe(self, path):
        self.probed.append(os.path.basename(path))
        return {"duration": 600.0, "tracks": [{"name": "", "role": "all"}]}

    def make_thumb(self, path, duration):
        self.thumbed.append(os.path.basename(path))
        return None if "broken" in path else str(self.tmp / "thumb.jpg")    # ffmpeg can't read the broken one

    def scan(self):
        return scanner.scan(self.store, {"roots": [str(self.root)], "clip_max_seconds": 300},
                            cache_path=self.tmp / "scan_cache.json")

    def mid(self, path):
        return self.store.db.execute("SELECT id FROM media WHERE path=?", (str(path),)).fetchone()[0]

    def test_unchanged_files_are_not_probed_again(self):
        r = self.scan()
        self.assertEqual((r["added"], r["changed"]), (2, 2))
        self.assertEqual(sorted(self.probed), ["obs-broken.mp4", "obs-good.mp4"])
        self.assertEqual(sorted(self.thumbed), ["obs-broken.mp4", "obs-good.mp4"])
        r = self.scan()
        self.assertEqual(r["changed"], 0)                       # nothing new: the UI isn't reloaded
        self.assertEqual(len(self.probed), 2)                   # cached by (path, size, mtime)
        self.assertNotIn("obs-broken.mp4", self.thumbed[2:])    # a failed thumbnail isn't retried every scan
        self.bad.write_bytes(b"b" * 80)                         # the file changed: probe and thumbnail again
        r = self.scan()
        self.assertEqual((r["updated"], r["changed"]), (1, 1))  # its size changed
        self.assertEqual(self.probed.count("obs-broken.mp4"), 2)
        self.assertEqual(self.thumbed.count("obs-broken.mp4"), 2)

    def test_new_and_missing_files_count_as_changes(self):
        self.scan()
        (self.root / "GameA" / "new.mp4").write_bytes(b"n")
        self.assertEqual(self.scan()["added"], 1)
        os.remove(self.root / "GameA" / "new.mp4")
        r = self.scan()
        self.assertEqual((r["missing"], r["changed"]), (1, 1))

    def test_user_game_survives_rescans(self):
        self.scan()
        mid = self.mid(self.good)
        self.store.update_media(mid, game="Red Dead RP")        # side panel / bulk "game" action
        r = self.scan()
        self.assertEqual(self.store.media(mid).game, "Red Dead RP")
        self.assertEqual(r["changed"], 0)
        self.good.write_bytes(b"g" * 120)                       # even when the file itself changes
        self.scan()
        self.assertEqual(self.store.media(mid).game, "Red Dead RP")
        self.store.update_media(mid, game="")                   # cleared: the scanner fills it in again
        self.scan()
        self.assertEqual(self.store.media(mid).game, "GameA")
        self.store.update_media(mid, game="GameA", title="t")   # saving the panel with the same game isn't a choice
        self.assertEqual(self.store.db.execute("SELECT game_user FROM media WHERE id=?", (mid,)).fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
