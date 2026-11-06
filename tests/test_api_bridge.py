"""The JS bridge (api.py) and the update state for the UI: error texts, secrets kept from the page, the sync server
change, the storage quota, and refusing to self-update a copy the installer didn't make."""
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    from rpcatalog import api as apimod, config, update_ctl
    from rpcatalog import sync as websync
    from rpcatalog.store import Store
except ImportError:          # pragma: no cover
    apimod = None


class Host:
    def __init__(self):
        self.saved = 0
        self.rescans = []

    def save_settings(self):
        self.saved += 1

    def rescan(self, notify=False):
        self.rescans.append(notify)


@unittest.skipUnless(apimod, "PySide6 is needed")
class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cosmas-api-"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        for p in (mock.patch.object(apimod, "ATT_DIR", self.tmp / "att"),
                  mock.patch.object(config, "DB_PATH", self.tmp / "catalog.db")):
            p.start()
            self.addCleanup(p.stop)
        self.store = Store(self.tmp / "catalog.db")
        self.addCleanup(lambda: self.store.db.close())
        self.settings = {"sync_url": "https://gingygames.com", "sync_token": "krt_abc", "sync_user": "Jan",
                         "discord_token": "bot-secret"}
        self.host = Host()
        self.api = apimod.Api(self.store, self.settings, self.host)

    def call(self, method, **args):
        return json.loads(self.api.call(method, json.dumps(args)))

    def test_error_texts(self):
        self.assertEqual(apimod.error_text(ValueError("Fill in the name")), "Fill in the name")
        self.assertEqual(apimod.error_text(websync.SyncError("Server unreachable")), "Server unreachable")
        self.assertEqual(apimod.error_text(KeyError("x")), "KeyError: 'x'")      # a real bug keeps its class name
        self.assertEqual(self.call("no.such_method"), {"error": "unknown method no.such_method"})
        with mock.patch.object(apimod.Api, "m_media_get", side_effect=RuntimeError("boom"), create=True):
            self.assertEqual(self.call("media.get", id=1), {"error": "RuntimeError: boom"})

    def test_secrets_stay_in_python(self):
        s = self.call("settings.get")["ok"]
        self.assertNotIn("discord_token", s)
        self.assertNotIn("sync_token", s)
        self.assertTrue(s["discord_token_set"])
        self.call("settings.set", values={"discord_token": "new-bot"})
        self.assertEqual(self.settings["discord_token"], "new-bot")   # a new token can still be saved
        self.assertEqual(self.host.rescans, [True])                     # a settings change always reloads the UI

    def test_new_server_address_drops_the_token(self):
        with mock.patch.object(apimod.webauth, "revoke") as revoke:
            self.call("sync.settings", url="https://gingygames.com/", letters=True)     # same server
            self.assertEqual(self.settings["sync_token"], "krt_abc")
            self.call("sync.settings", url="https://other.example")
            self.assertNotIn("sync_token", self.settings)              # never sent to the new host
            self.assertNotIn("sync_user", self.settings)
            self.assertEqual(self.settings["sync_url"], "https://other.example")
        self.assertTrue(revoke.called)

    def test_quota(self):
        self.settings.pop("sync_token")
        self.assertEqual(self.api.m_sync_quota(), {"connected": False})     # no network without a sign-in
        self.settings["sync_token"] = "krt_abc"
        seen = []

        class FakeClient:
            def __init__(self, url, token, timeout=60):
                seen.append((url, token))

            def request(self, method, path, **kw):
                seen.append((method, path))
                return {"plan": "free", "storage": {"used": 10, "files": 2, "limit": 100}, "enforced": False,
                        "support_url": "javascript:alert(1)", "extra": "x"}
        with mock.patch.object(apimod.websync, "Client", FakeClient), mock.patch.object(self.api, "_bg", lambda fn: fn()):
            q = self.api.m_sync_quota()
        self.assertEqual(seen, [("https://gingygames.com", "krt_abc"), ("GET", "/me/quota")])
        self.assertEqual(q, {"connected": True, "plan": "free", "storage": {"used": 10, "files": 2, "limit": 100},
                             "enforced": False, "support_url": None})
        self.assertIn("sync.quota", apimod.Api.READ_ONLY)


@unittest.skipUnless(apimod, "PySide6 is needed")
class UpdateStatusTest(unittest.TestCase):
    def ctl(self, settings):
        return update_ctl.UpdateController(settings, lambda *a: None, lambda: None, lambda after: None)

    def test_support_url_and_install_state(self):
        st = self.ctl({"update_latest": {"version": "1.2.1", "support_url": "https://ko-fi.com/x"}}).status()
        self.assertEqual(st["support_url"], "https://ko-fi.com/x")
        self.assertIsNone(self.ctl({}).status()["support_url"])
        with mock.patch.multiple(config, IS_DEV=False, IS_INSTALLED=False):
            st = self.ctl({}).status()
            self.assertFalse(st["installed"])
            self.assertTrue(st["note"])

    def test_copy_without_installer_refuses_to_install(self):
        tmp = Path(tempfile.mkdtemp(prefix="cosmas-upd-"))
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        exe = tmp / "Cosmas-Setup-1.2.1.exe"
        exe.write_bytes(b"MZ installer")
        c = self.ctl({})
        c.state, c.path = "ready", exe
        c.info = {"version": "1.2.1", "sha256": hashlib.sha256(exe.read_bytes()).hexdigest()}
        with mock.patch.multiple(config, IS_DEV=False, IS_INSTALLED=False), \
                mock.patch.object(update_ctl.updater, "launch_installer") as launch:
            with self.assertRaises(ValueError):
                c.install()
            self.assertFalse(launch.called)


if __name__ == "__main__":
    unittest.main()
