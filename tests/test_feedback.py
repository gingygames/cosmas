"""Feedback / bug reports: redaction of logs and tracebacks, the payload, sending and the offline queue (mocked HTTP)."""
import io
import json
import os
import shutil
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from rpcatalog import config, feedback


class RedactTest(unittest.TestCase):
    def test_tokens_and_keys(self):
        s = feedback.redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123 and krt_0123456789abcdefXYZ "
                            "sk-ant-api03-abcdefghijklmnopqrstuv sk-or-v1-0123456789abcdef0123 "
                            # a made-up Discord-style token, assembled at run time so secret scanners don't flag the file
                            '"discord_token": "' + ".".join(["MTIz" + "NDU2Nzg5MDEyMzQ1Njc4", "GAbCdE", "abcdefghijklmnopqrstuvwxyz0123456"]) + '" '
                            "https://x/cb?code=SECRETCODE123&state=abc token=hunter2hunter2")
        for leak in ("abcdefghijklmnopqrstuvwxyz123", "0123456789abcdefXYZ", "api03-abcdefghijklmnopqrstuv",
                     "v1-0123456789abcdef0123", "GAbCdE", "SECRETCODE123", "hunter2hunter2"):
            self.assertNotIn(leak, s)
        self.assertIn("krt_[REDACTED]", s)

    def test_exact_secrets(self):
        self.assertEqual(feedback.redact("my pass is s3cr3t-value!", ["s3cr3t-value"]), "my pass is [REDACTED]!")

    def test_profile_paths_and_user_name(self):
        home = r"C:\Users\Jana Nováková"
        with mock.patch.object(feedback, "_home_variants", lambda: [home, home.replace("\\", "/"), home.replace("\\", "\\\\")]), \
             mock.patch.dict(os.environ, {"USERNAME": "Jana Nováková"}):
            s = feedback.redact(f'File "{home}\\AppData\\Local\\Kronikar\\x.py", line 3\n'
                                f"open C:/Users/Jana Nováková/Videos/Medal/a.mp4\n"
                                f"json: \"C:\\\\Users\\\\Jana Nováková\\\\Documents\"\n"
                                r"D:\Users\Jana Nováková\Games")
        self.assertNotIn("Nováková", s)
        self.assertIn(r"%USERPROFILE%\AppData\Local\Kronikar", s)
        self.assertIn(r"D:\Users\%USERNAME%\Games", s)

    def test_email_addresses(self):
        self.assertEqual(feedback.redact("from jan.novak@example.cz now"), "from [email] now")

    def test_innocent_text_stays(self):
        t = "Traceback (most recent call last):\n  ValueError: invalid literal for int() with base 10: 'abc'"
        self.assertEqual(feedback.redact(t), t)


class PayloadTest(unittest.TestCase):
    settings = {"sync_token": "krt_supersecrettoken123", "discord_token": "abc.def.ghijklmnop"}

    def test_minimal(self):
        p = feedback.build_payload("idea", "  More themes please  ", self.settings, include_system=False)
        self.assertEqual(p["kind"], "idea")
        self.assertEqual(p["message"], "More themes please")
        self.assertEqual(p["app"]["name"], "Cosmas")
        self.assertTrue({"version", "os", "lang"} <= set(p["app"]))
        self.assertNotIn("log", p)
        self.assertNotIn("email", p)
        self.assertNotIn("system", p)

    def test_unknown_kind_and_empty_message(self):
        self.assertEqual(feedback.build_payload("rant", "x", {}, include_system=False)["kind"], "other")
        with self.assertRaises(ValueError):
            feedback.build_payload("bug", "   ", {})

    def test_email_is_checked(self):
        self.assertEqual(feedback.build_payload("bug", "x", {}, email=" a@b.cz ", include_system=False)["email"], "a@b.cz")
        with self.assertRaises(ValueError):
            feedback.build_payload("bug", "x", {}, email="not-an-email")

    def test_log_is_redacted_and_limited(self):
        log = "\n".join(f"line {i} token=krt_supersecrettoken123" for i in range(3000))
        p = feedback.build_payload("bug", "it broke", self.settings, include_log=True, log_text=log, include_system=False)
        lines = p["log"].splitlines()
        self.assertLessEqual(len(lines), feedback.MAX_LOG_LINES)
        self.assertLessEqual(len(p["log"].encode("utf-8")), 50_000)          # the server's limit
        self.assertTrue(lines[0].startswith("line "))                       # cut at a whole line
        self.assertTrue(lines[-1].startswith("line 2999"))
        self.assertNotIn("supersecret", p["log"])

    def test_traceback_and_view(self):
        p = feedback.build_payload("bug", "", self.settings, view="library", include_system=False,
                                   traceback_text="Traceback\nKeyError: 'krt_supersecrettoken123'")
        self.assertEqual(p["context"]["view"], "library")
        self.assertNotIn("supersecret", p["context"]["traceback"])

    def test_screenshot_must_be_an_image_data_url(self):
        p = feedback.build_payload("bug", "x", {}, screenshot="data:image/jpeg;base64,AAAA", include_system=False)
        self.assertTrue(p["screenshot"].startswith("data:image/jpeg"))
        with self.assertRaises(ValueError):
            feedback.build_payload("bug", "x", {}, screenshot="file:///C:/secret.txt", include_system=False)

    def test_system_info(self):
        si = feedback.system_info()
        self.assertTrue({"app_version", "os", "python", "lang", "ram_gb"} <= set(si))
        json.dumps(si)


class Resp(io.BytesIO):
    status = 201

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class SendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-fb-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        p = mock.patch.object(config, "DATA_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("KOSMAS_FEEDBACK_URL", None)
        self.payload = {"kind": "bug", "message": "x", "app": {"name": "Cosmas"}}
        self.reqs = []

    def ok_opener(self, req, timeout=30):
        self.reqs.append(req)
        return Resp(b'{"id": "FB-42"}')

    def test_send_with_token(self):
        ref = feedback.send(self.payload, {"sync_token": "krt_abc"}, opener=self.ok_opener)
        self.assertEqual(ref, "FB-42")
        req = self.reqs[0]
        self.assertEqual(req.full_url, "https://gingygames.com/kosmas/api/feedback")
        self.assertEqual(req.get_header("Authorization"), "Bearer krt_abc")
        self.assertEqual(json.loads(req.data)["message"], "x")

    def test_anonymous_and_stale_token(self):
        def opener(req, timeout=30):
            self.reqs.append(req)
            if req.get_header("Authorization"):
                raise urllib.error.HTTPError(req.full_url, 401, "no", {}, io.BytesIO(b"{}"))
            return Resp(b'{"ref": "R-1"}')
        self.assertEqual(feedback.send(self.payload, {"sync_token": "krt_old"}, opener=opener), "R-1")
        self.assertIsNone(self.reqs[-1].get_header("Authorization"))

    def test_offline_is_queued_and_flushed(self):
        def offline(req, timeout=30):
            raise urllib.error.URLError("no network")
        r = feedback.submit(self.payload, {}, opener=offline)
        self.assertEqual(r["status"], "queued")
        self.assertEqual(len(feedback.queued()), 1)
        self.assertEqual(feedback.flush_queue({}, opener=offline)["left"], 1)       # still offline: kept
        out = feedback.flush_queue({}, opener=self.ok_opener)
        self.assertEqual(out, {"sent": ["FB-42"], "left": 0})

    def test_refused_is_not_queued(self):
        def bad(req, timeout=30):
            raise urllib.error.HTTPError(req.full_url, 413, "too big", {}, io.BytesIO(b'{"error": "too large"}'))
        with self.assertRaises(feedback.SendError) as cm:
            feedback.submit(self.payload, {}, opener=bad)
        self.assertFalse(cm.exception.retry)
        self.assertIn("too large", str(cm.exception))
        self.assertEqual(feedback.queued(), [])

    def test_server_error_is_retried(self):
        def busy(req, timeout=30):
            raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, io.BytesIO(b""))
        self.assertEqual(feedback.submit(self.payload, {}, opener=busy)["status"], "queued")


class LogTest(unittest.TestCase):
    def test_tail_spans_rotated_file(self):
        from rpcatalog import applog
        tmp = Path(tempfile.mkdtemp(prefix="cosmas-log-"))
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        (tmp / "cosmas.log.1").write_text("\n".join(f"old {i}" for i in range(5)), "utf-8")
        (tmp / "cosmas.log").write_text("\n".join(f"new {i}" for i in range(3)), "utf-8")
        t = applog.tail(4, tmp / "cosmas.log").splitlines()
        self.assertEqual(t, ["old 4", "new 0", "new 1", "new 2"])

    def test_crash_hook(self):
        from rpcatalog import applog
        got = []
        applog.on_crash(got.append)
        self.addCleanup(lambda: applog.on_crash(None))
        try:
            raise RuntimeError("unique test failure 4711")
        except RuntimeError as e:
            applog._excepthook(type(e), e, e.__traceback__)
            applog._excepthook(type(e), e, e.__traceback__)      # the same again: only logged
        self.assertEqual(len(got), 1)
        self.assertIn("unique test failure 4711", got[0])


if __name__ == "__main__":
    unittest.main()
