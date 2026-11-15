"""Recording folders of other programs (sources.py) and the extra video formats of the scanner."""
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rpcatalog import config, scanner, sources
from rpcatalog.store import Store


def touch(p, data=b"x"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


class DetectTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-src-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.videos = self.tmp / "Videos"
        self.appdata = self.tmp / "AppData"
        touch(self.videos / "Medal" / "Clips" / "Game" / "a.mp4")
        touch(self.videos / "Captures" / "Game 2026-11-01.mp4")
        touch(self.videos / "Captures" / "b.mp4")
        touch(self.videos / "Overwolf" / "Outplayed" / "Game" / "c.mkv")
        touch(self.videos / "Films" / "movie.mkv")
        (self.videos / "Radeon ReLive").mkdir()          # exists but empty
        for p in (mock.patch.object(sources, "_drives", lambda: []), mock.patch.object(sources, "nvidia_folders", lambda: [])):
            p.start()
            self.addCleanup(p.stop)

    def obs_profile(self, text, name="Untitled"):
        touch(self.appdata / "obs-studio" / "basic" / "profiles" / name / "basic.ini", ("\ufeff" + text).encode("utf-8"))

    def detect(self, roots=(), dismissed=()):
        return {s["id"]: s for s in sources.detect(roots, dismissed, videos=self.videos, appdata=self.appdata)}

    def test_finds_known_folders_with_counts(self):
        found = self.detect()
        self.assertEqual(set(found), {"medal", "xbox", "amd", "outplayed"})   # no OBS installed
        self.assertEqual(found["xbox"]["count"], 2)
        self.assertEqual(found["outplayed"]["count"], 1)
        self.assertEqual(found["amd"]["count"], 0)
        self.assertFalse(any(s["added"] or s["dismissed"] for s in found.values()))

    def test_obs_paths_come_from_its_profiles(self):
        rec = self.tmp / "OBS recordings"
        touch(rec / "2026-11-05 21-00-00.mkv")
        self.obs_profile(f"[Output]\nMode=Advanced\n[AdvOut]\nRecFilePath={rec.as_posix()}\n[SimpleOutput]\nFilePath=C:/ignored\n")
        found = self.detect()
        self.assertEqual(Path(found["obs"]["path"]), rec)
        self.assertEqual(found["obs"]["count"], 1)
        self.assertFalse(found["obs"]["whole_videos"])

    def test_obs_default_is_the_whole_videos_folder_with_a_warning(self):
        self.obs_profile("[Output]\nMode=Simple\n[SimpleOutput]\nRecFormat2=mkv\n")
        found = self.detect()
        self.assertEqual(Path(found["obs"]["path"]), self.videos)
        self.assertTrue(found["obs"]["whole_videos"])
        self.assertTrue(found["obs"]["note"])

    def test_added_and_dismissed_folders_are_marked(self):
        found = self.detect(roots=[str(self.videos / "Medal")], dismissed=[str(self.videos / "Captures")])
        self.assertTrue(found["medal"]["added"])
        self.assertTrue(found["xbox"]["dismissed"])
        found = self.detect(roots=[str(self.videos)])       # a parent folder covers everything inside
        self.assertTrue(all(s["added"] for s in found.values()))

    def test_medal_folders_and_default_roots(self):
        self.assertEqual(sources.medal_folders(self.videos), [self.videos / "Medal"])
        with mock.patch.object(sources, "videos_dir", lambda: self.videos):
            self.assertEqual(config.default_roots(), [str(self.videos / "Medal")])

    def test_videos_dir_is_a_folder(self):
        self.assertTrue(isinstance(sources.videos_dir(), Path))


class StrictExtTest(unittest.TestCase):
    """.ts / .flv / .avi / .m4v count only when ffprobe reads them (.ts is also TypeScript)."""
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-ext-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.root = self.tmp / "Rec"
        touch(self.root / "Game" / "obs.ts", b"v" * 100)
        touch(self.root / "Game" / "app.ts", b"export const x = 1;\n")
        touch(self.root / "Game" / "old.avi", b"v" * 100)
        self.store = Store(self.tmp / "catalog.db")
        self.addCleanup(lambda: self.store.db.close())
        probe = lambda p: {} if p.endswith("app.ts") else {"duration": 120.0, "tracks": [{"name": "", "role": "all"}]}
        for p in (mock.patch.object(scanner, "read_medal", lambda roots: {}),
                  mock.patch.object(config, "find_tool", lambda name: "C:/fake/" + name + ".exe"),
                  mock.patch.object(scanner, "ffprobe", probe),
                  mock.patch.object(scanner, "make_thumb", lambda path, duration: None)):
            p.start()
            self.addCleanup(p.stop)

    def test_only_readable_videos_are_added(self):
        scanner.scan(self.store, {"roots": [str(self.root)], "clip_max_seconds": 300}, cache_path=self.tmp / "c.json")
        names = sorted(os.path.basename(r[0]) for r in self.store.db.execute("SELECT path FROM media").fetchall())
        self.assertEqual(names, ["obs.ts", "old.avi"])


if __name__ == "__main__":
    unittest.main()
