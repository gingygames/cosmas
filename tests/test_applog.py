"""The log tee (sys.stdout / sys.stderr -> log file) must never hang the app.

A log handler that fails (rollover blocked by another process, disk full) reports the error on sys.stderr, which
is the tee itself: the tee used to wait for its own lock there, and every print() after that hung for good.
"""
import io
import logging
import sys
import threading
import unittest
from unittest import mock

from rpcatalog import applog


class _Failing(logging.Handler):
    """Like a RotatingFileHandler whose file can't be written: the error goes to handleError (-> sys.stderr)."""

    def emit(self, record):
        try:
            raise OSError(28, "No space left on device")
        except OSError:
            self.handleError(record)


class _Collect(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


class TeeTest(unittest.TestCase):
    def setUp(self):
        self.log = logging.getLogger("cosmas-test-tee")
        self.log.propagate = False
        self.log.setLevel(logging.INFO)
        self.addCleanup(lambda: [self.log.removeHandler(h) for h in list(self.log.handlers)])
        self.console = io.StringIO()
        self.tee = applog._Tee(self.console, logging.WARNING)

    def write_in_thread(self, text):
        done = threading.Event()

        def run():
            self.tee.write(text)
            done.set()
        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(5)
        return done.is_set()

    def test_failing_handler_does_not_hang(self):
        self.log.addHandler(_Failing())
        with mock.patch.object(applog, "log", self.log), mock.patch.object(sys, "stderr", self.tee), \
                mock.patch.object(logging, "raiseExceptions", True):      # handleError prints to sys.stderr = the tee
            self.assertTrue(self.write_in_thread("something went wrong\n"), "print() through the log hangs")
            self.assertTrue(self.write_in_thread("and again\n"))
        out = self.console.getvalue()
        self.assertIn("something went wrong", out)
        self.assertIn("Logging error", out)                 # the handler's error reached the console only

    def test_lines_still_reach_the_log(self):
        c = _Collect()
        self.log.addHandler(c)
        with mock.patch.object(applog, "log", self.log):
            self.tee.write("one\ntw")
            self.tee.write("o\n\n")
        self.assertEqual(c.lines, ["one", "two"])
        self.assertEqual(self.console.getvalue(), "one\ntwo\n\n")


if __name__ == "__main__":
    unittest.main()
