"""One running app per data folder (single_instance.py): the lock, and the "show your window" knock."""
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

try:
    from PySide6.QtCore import QCoreApplication
    from rpcatalog import single_instance
except ImportError:          # pragma: no cover
    single_instance = None


@unittest.skipUnless(single_instance, "PySide6 is needed")
class GuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-inst-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))

    def guard(self, name):
        g = single_instance.Guard(self.tmp / name)
        self.addCleanup(g.release)
        return g

    def test_one_instance_per_data_folder(self):
        a, b, other = self.guard("data"), self.guard("data"), self.guard("test-data")
        self.assertTrue(a.acquire())
        self.assertFalse(b.acquire())              # second start on the same catalogue
        self.assertTrue(other.acquire())           # a test copy (KRONIKAR_DATA) runs next to it
        a.release()                                # e.g. before restarting for an update
        self.assertTrue(b.acquire())

    def test_key_follows_the_folder(self):
        self.assertEqual(single_instance.key(self.tmp / "data"), single_instance.key(str(self.tmp / "data") + os.sep))
        self.assertNotEqual(single_instance.key(self.tmp / "data"), single_instance.key(self.tmp / "data2"))
        if os.name == "nt":
            self.assertEqual(single_instance.key(r"C:\Users\X\Data"), single_instance.key("c:/users/x/data"))

    def test_second_start_shows_the_first(self):
        app = QCoreApplication.instance() or QCoreApplication([])
        a = self.guard("data")
        self.assertTrue(a.acquire())
        shown = []
        a.listen(lambda: shown.append(1))
        self.assertTrue(single_instance.notify_running(self.tmp / "data", timeout=3))
        end = time.monotonic() + 5
        while not shown and time.monotonic() < end:
            app.processEvents()
            time.sleep(0.02)
        self.assertEqual(shown, [1])
        a.release()
        self.assertFalse(single_instance.notify_running(self.tmp / "data", timeout=0.3))   # nobody listens any more


if __name__ == "__main__":
    unittest.main()
