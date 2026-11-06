"""Update checks: version comparison, where the newest version comes from (mocked HTTP), what to do about it,
and the download (resume, SHA-256)."""
import hashlib
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from rpcatalog import config, updater


class VersionTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(updater.parse_version("v1.2.0"), (1, 2, 0, None))
        self.assertEqual(updater.parse_version("1.2"), (1, 2, 0, None))
        self.assertEqual(updater.parse_version("1.2.0-beta.1"), (1, 2, 0, ("beta", 1)))
        self.assertEqual(updater.parse_version("1.2.0+build.5"), (1, 2, 0, None))
        self.assertIsNone(updater.parse_version("latest"))
        self.assertIsNone(updater.parse_version(None))

    def test_compare(self):
        c = updater.compare
        self.assertEqual(c("1.2.0", "1.1.0"), 1)
        self.assertEqual(c("1.10.0", "1.9.9"), 1)          # numbers, not strings
        self.assertEqual(c("v1.2.0", "1.2.0"), 0)
        self.assertEqual(c("1.2", "1.2.0"), 0)
        self.assertEqual(c("1.2.0", "1.2.0-beta.2"), 1)    # a release is newer than its pre-releases
        self.assertEqual(c("1.2.0-beta.2", "1.2.0-beta.10"), -1)
        self.assertEqual(c("1.2.0-alpha", "1.2.0-beta"), -1)
        self.assertEqual(c("1.2.0-rc.1", "1.2.0-1"), 1)     # alphanumeric identifiers sort after numeric ones
        self.assertEqual(c("garbage", "0.0.1"), -1)
        self.assertTrue(updater.is_newer("1.2.0", "1.1.0"))
        self.assertFalse(updater.is_newer("1.1.0", "1.1.0"))
        self.assertTrue(updater.is_prerelease("2.0.0-beta.1"))
        self.assertFalse(updater.is_prerelease("2.0.0"))


SHA = "ab" * 32
ENDPOINT = {"version": "1.2.0", "tag": "v1.2.0", "published_at": "2026-11-06T10:00:00Z",
            "url": "https://github.com/gingygames/cosmas/releases/download/v1.2.0/Cosmas-Setup-1.2.0.exe",
            "size": 123, "sha256": SHA.upper(), "notes_md": "- new", "notes_url": "https://cosmas.gingygames.com/changelog"}
GH_RELEASE = {"tag_name": "v1.3.0", "published_at": "2026-12-01T00:00:00Z", "html_url": "https://github.com/x/releases/v1.3.0",
              "body": "notes", "draft": False, "prerelease": False,
              "assets": [{"name": "Cosmas-Setup-1.3.0.exe", "size": 99, "browser_download_url": "https://github.com/dl/Cosmas-Setup-1.3.0.exe"},
                         {"name": "Cosmas-Setup-1.3.0.exe.sha256", "size": 90, "browser_download_url": "https://github.com/dl/Cosmas-Setup-1.3.0.exe.sha256"}]}


def fake_get(routes):
    def get(url, timeout=15, accept=None):
        for prefix, val in routes.items():
            if url.startswith(prefix):
                if isinstance(val, Exception):
                    raise val
                return val if isinstance(val, bytes) else json.dumps(val).encode()
        raise urllib.error.URLError(f"no route for {url}")
    return get


class FetchTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ, {}, clear=False)
        p.start()
        os.environ.pop("KOSMAS_UPDATE_URL", None)
        self.addCleanup(p.stop)

    def test_endpoint(self):
        info = updater.fetch_latest(get=fake_get({updater.LATEST_URL: ENDPOINT}))
        self.assertEqual(info["version"], "1.2.0")
        self.assertEqual(info["sha256"], SHA)               # normalised to lower case
        self.assertEqual(info["source"], "web")
        self.assertEqual(info["size"], 123)
        self.assertIsNone(info["support_url"])

    def test_support_url_only_https_from_our_endpoint(self):
        ok = dict(ENDPOINT, support_url="https://ko-fi.com/gingygames")
        self.assertEqual(updater.fetch_latest(get=fake_get({updater.LATEST_URL: ok}))["support_url"], "https://ko-fi.com/gingygames")
        for bad in ("javascript:alert(1)", "http://x.example", "file:///C:/x", "", None, 5):
            info = updater.fetch_latest(get=fake_get({updater.LATEST_URL: dict(ENDPOINT, support_url=bad)}))
            self.assertIsNone(info["support_url"], bad)

    def test_beta_channel_asks_for_it(self):
        seen = []

        def get(url, timeout=15, accept=None):
            seen.append(url)
            return json.dumps(ENDPOINT).encode()
        updater.fetch_latest("beta", get=get)
        self.assertTrue(seen[0].endswith("?channel=beta"), seen)

    def test_falls_back_to_github_with_sha_file(self):
        get = fake_get({updater.LATEST_URL: urllib.error.URLError("down"),
                        updater.GITHUB_API + "/releases/latest": GH_RELEASE,
                        "https://github.com/dl/Cosmas-Setup-1.3.0.exe.sha256": (SHA + "  Cosmas-Setup-1.3.0.exe\n").encode()})
        info = updater.fetch_latest(get=get)
        self.assertEqual((info["version"], info["source"], info["sha256"]), ("1.3.0", "github", SHA))

    def test_github_digest_is_used(self):
        rel = json.loads(json.dumps(GH_RELEASE))
        rel["assets"] = [dict(rel["assets"][0], digest="sha256:" + "cd" * 32)]
        get = fake_get({updater.LATEST_URL: ValueError("bad json"), updater.GITHUB_API + "/releases/latest": rel})
        self.assertEqual(updater.fetch_latest(get=get)["sha256"], "cd" * 32)

    def test_both_fail(self):
        with self.assertRaises(updater.UpdateError):
            updater.fetch_latest(get=fake_get({}))

    def test_bad_answer_and_insecure_url_are_refused(self):
        with self.assertRaises(updater.UpdateError):
            updater.from_endpoint(get=fake_get({updater.LATEST_URL: {"hello": 1}}))
        with self.assertRaises(updater.UpdateError):
            updater.from_endpoint(get=fake_get({updater.LATEST_URL: dict(ENDPOINT, url="http://evil.example/x.exe")}))
        # http is fine for a local test server only
        info = updater.from_endpoint(get=fake_get({updater.LATEST_URL: dict(ENDPOINT, url="http://127.0.0.1:8977/Cosmas-Setup-1.2.0.exe")}))
        self.assertTrue(info["url"].startswith("http://127.0.0.1"))

    def test_test_server_is_never_mixed_with_github(self):
        with mock.patch.dict(os.environ, {"KOSMAS_UPDATE_URL": "http://127.0.0.1:1/latest"}):
            calls = []

            def get(url, timeout=15, accept=None):
                calls.append(url)
                raise urllib.error.URLError("down")
            with self.assertRaises(updater.UpdateError):
                updater.fetch_latest(get=get)
            self.assertEqual(calls, ["http://127.0.0.1:1/latest"])


class DecideTest(unittest.TestCase):
    info = {"version": "1.2.0", "url": "https://x/Cosmas-Setup-1.2.0.exe"}

    def d(self, settings=None, **kw):
        kw.setdefault("current", "1.1.0")
        kw.setdefault("is_dev", False)
        kw.setdefault("installed", True)
        return updater.decide(kw.pop("info", self.info), settings or {}, **kw)

    def test_newer_is_available_and_installable(self):
        r = self.d()
        self.assertTrue(r["available"])
        self.assertEqual(r["can_install"], os.name == "nt")
        self.assertFalse(r["auto_download"])
        self.assertEqual(self.d({"update_auto_download": True})["auto_download"], os.name == "nt")

    def test_same_or_older(self):
        self.assertFalse(self.d(current="1.2.0")["available"])
        self.assertFalse(self.d(current="1.3.0")["available"])
        self.assertEqual(self.d(info=None)["reason"], "no-info")

    def test_dev_checkout_only_announces(self):
        r = self.d({"update_auto_download": True}, is_dev=True)
        self.assertTrue(r["available"])
        self.assertFalse(r["can_install"])
        self.assertFalse(r["auto_download"])

    def test_copy_not_made_by_the_installer_only_announces(self):
        # e.g. a ZIP unpacked in Downloads: running the installer with /DIR= there would delete its python\ and app\
        r = self.d({"update_auto_download": True}, installed=False)
        self.assertTrue(r["available"])
        self.assertFalse(r["can_install"])
        self.assertFalse(r["auto_download"])
        self.assertEqual(r["reason"], "not-installed")

    def test_installed_layout(self):
        tmp = Path(tempfile.mkdtemp(prefix="cosmas-layout-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        app = tmp / "Kronikar" / "app"
        app.mkdir(parents=True)
        self.assertFalse(config._is_installed(app))                     # just the code
        (app.parent / "Kronikar.exe").write_bytes(b"MZ")
        self.assertFalse(config._is_installed(app))                     # no uninstaller: not from the installer
        (app.parent / "unins000.exe").write_bytes(b"MZ")
        self.assertTrue(config._is_installed(app))
        other = tmp / "Downloads" / "kosmas-1.2.0"                      # source / ZIP copy: code not in app\
        other.mkdir(parents=True)
        (other.parent / "Kronikar.exe").write_bytes(b"MZ")
        (other.parent / "unins000.exe").write_bytes(b"MZ")
        self.assertFalse(config._is_installed(other))
        with mock.patch.object(config, "IS_INSTALLED", False):
            self.assertIsNone(updater.install_dir())
        with mock.patch.multiple(config, IS_INSTALLED=True, APP_DIR=app):
            self.assertEqual(updater.install_dir(), app.parent)

    def test_skipped_version(self):
        self.assertFalse(self.d({"update_skip": "1.2.0"})["available"])
        r = self.d({"update_skip": "1.2.0", "update_auto_download": True}, manual=True)
        self.assertTrue(r["available"] and r["skipped"])
        self.assertFalse(r["auto_download"])                          # a skipped version is never fetched by itself
        self.assertTrue(self.d({"update_skip": "1.1.5"})["available"])   # a newer one than the skipped is offered

    def test_prerelease_only_on_beta(self):
        beta = {"version": "1.3.0-beta.1", "url": "https://x/Cosmas-Setup-1.3.0-beta.1.exe"}
        self.assertFalse(self.d(info=beta)["available"])
        self.assertTrue(self.d({"update_channel": "beta"}, info=beta)["available"])

    def test_due(self):
        self.assertTrue(updater.due({}, now=10**9))
        self.assertFalse(updater.due({"update_last_check": 10**9 - 3600}, now=10**9))
        self.assertTrue(updater.due({"update_last_check": 10**9 - 13 * 3600}, now=10**9))
        self.assertFalse(updater.due({"update_auto_check": False}, now=10**9))


class FakeResponse(io.BytesIO):
    def __init__(self, data, status=200, length=None):
        super().__init__(data)
        self.status = status
        self.headers = {"Content-Length": str(len(data) if length is None else length)}

    def getcode(self):
        return self.status


class DownloadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-upd-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.data = os.urandom(200_000)
        self.sha = hashlib.sha256(self.data).hexdigest()
        self.info = {"version": "1.2.0", "url": "https://x/dl/Cosmas-Setup-1.2.0.exe", "sha256": self.sha, "size": len(self.data)}
        self.requests = []

    def opener(self, req, timeout=30):
        self.requests.append(dict(req.header_items()))
        rng = req.get_header("Range")
        if rng:
            start = int(rng.split("=")[1].rstrip("-"))
            return FakeResponse(self.data[start:], status=206)
        return FakeResponse(self.data)

    def test_download_and_verify(self):
        seen = []
        path, ok = updater.download(self.info, self.tmp, progress=lambda d, t: seen.append((d, t)), opener=self.opener, chunk=4096)
        self.assertTrue(ok)
        self.assertEqual(path.name, "Cosmas-Setup-1.2.0.exe")
        self.assertEqual(path.read_bytes(), self.data)
        self.assertEqual(seen[-1], (len(self.data), len(self.data)))
        self.assertFalse(list(self.tmp.glob("*.part")))
        # already there and valid: no new request
        n = len(self.requests)
        self.assertEqual(updater.download(self.info, self.tmp, opener=self.opener)[1], True)
        self.assertEqual(len(self.requests), n)

    def test_resume(self):
        (self.tmp / "Cosmas-Setup-1.2.0.exe.part").write_bytes(self.data[:50_000])
        path, ok = updater.download(self.info, self.tmp, opener=self.opener)
        self.assertTrue(ok)
        self.assertEqual(self.requests[0].get("Range"), "bytes=50000-")
        self.assertEqual(path.read_bytes(), self.data)

    def test_server_ignoring_range_starts_over(self):
        (self.tmp / "Cosmas-Setup-1.2.0.exe.part").write_bytes(b"garbage" * 100)
        path, ok = updater.download(self.info, self.tmp, opener=lambda req, timeout=30: FakeResponse(self.data))
        self.assertTrue(ok)
        self.assertEqual(path.read_bytes(), self.data)

    def test_sha_mismatch_is_refused_and_deleted(self):
        bad = dict(self.info, sha256="00" * 32)
        with self.assertRaises(updater.ShaMismatch):
            updater.download(bad, self.tmp, opener=self.opener)
        self.assertEqual(list(self.tmp.iterdir()), [])

    def test_unknown_sha_is_reported(self):
        path, ok = updater.download(dict(self.info, sha256=None), self.tmp, opener=self.opener)
        self.assertIsNone(ok)
        self.assertIsNone(updater.verify(path, None))
        self.assertTrue(updater.verify(path, self.sha.upper()))
        self.assertFalse(updater.verify(path, "11" * 32))

    def test_cancel(self):
        ev = threading.Event()
        ev.set()
        with self.assertRaises(updater.UpdateError):
            updater.download(self.info, self.tmp, cancel=ev, opener=self.opener, chunk=1024)
        self.assertTrue((self.tmp / "Cosmas-Setup-1.2.0.exe.part").exists())     # kept for resuming

    def test_odd_file_name_gets_a_safe_one(self):
        self.assertEqual(updater.installer_name({"version": "1.2.0", "url": "https://x/download?id=5"}), "Cosmas-Setup-1.2.0.exe")
        self.assertEqual(updater.installer_name({"version": "1.2.0", "url": "https://x/../../evil.bat"}), "Cosmas-Setup-1.2.0.exe")

    def test_installer_args(self):
        args = updater.installer_args(Path("C:/u/Cosmas-Setup-1.2.0.exe"), "cs", r"C:\Users\x\AppData\Local\Programs\Kronikar")
        for a in ("/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/RELAUNCH", "/LANG=cs"):
            self.assertIn(a, args)
        self.assertIn(r"/DIR=C:\Users\x\AppData\Local\Programs\Kronikar", args)
        self.assertIn("/LANG=en", updater.installer_args("x.exe", "de"))


class PendingTest(unittest.TestCase):
    def test_after_update(self):
        tmp = Path(tempfile.mkdtemp(prefix="cosmas-pend-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        with mock.patch.multiple(updater, UPDATES_DIR=tmp, PENDING=tmp / "pending.json", __version__="1.2.0"):
            self.assertIsNone(updater.after_update())
            (tmp / "Cosmas-Setup-1.2.0.exe").write_bytes(b"x")
            updater.write_pending({"version": "1.2.0"}, tmp / "Cosmas-Setup-1.2.0.exe")
            self.assertEqual(updater.after_update()["updated"], "1.2.0")
            self.assertFalse((tmp / "Cosmas-Setup-1.2.0.exe").exists())          # installer removed
            updater.write_pending({"version": "1.3.0"}, tmp / "Cosmas-Setup-1.3.0.exe")
            self.assertEqual(updater.after_update(), {"failed": "1.3.0"})
            self.assertFalse((tmp / "pending.json").exists())


if __name__ == "__main__":
    unittest.main()
