"""Sign in with Discord (webauth.py) and the Share button (Syncer.share_*).

Unit tests (PKCE, state check, callback server) run always; the rest talks to the local backend
(kronikar-web: npm run dev, address KRONIKA_URL, default http://127.0.0.1:8790) and is skipped when it isn't running.
The browser part (Discord sign-in + Allow) is simulated with the dev header X-Dev-User and an Origin header.
"""
import base64
import hashlib
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import importlib.util

from rpcatalog import sync, webauth
from rpcatalog.store import Store

URL = os.environ.get("KRONIKA_URL", "http://127.0.0.1:8790")


def _backend_up():
    try:
        with urllib.request.urlopen(URL + "/kronika/api/me", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


class PkceTest(unittest.TestCase):
    def test_pair(self):
        v, c = webauth.pkce_pair()
        self.assertTrue(43 <= len(v) <= 128)
        self.assertRegex(v, r"^[A-Za-z0-9._~-]+$")
        self.assertRegex(c, r"^[A-Za-z0-9_-]{43}$")
        self.assertEqual(c, base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode())
        self.assertNotEqual(webauth.pkce_pair()[0], v)

    def test_connect_url(self):
        u = webauth.connect_url("http://127.0.0.1:8790", "http://127.0.0.1:5000/callback", "st", "c" * 43, device="PC")
        p = urllib.parse.urlsplit(u)
        q = dict(urllib.parse.parse_qsl(p.query))
        self.assertEqual(p.path, "/kronika/connect")
        self.assertEqual(q["redirect_uri"], "http://127.0.0.1:5000/callback")
        self.assertEqual((q["state"], q["code_challenge_method"], q["device"], q["client"]), ("st", "S256", "PC", "desktop"))
        with self.assertRaises(sync.SyncError):
            webauth.connect_url("http://example.com", "x", "s", "c")      # http only for local development


class CallbackServerTest(unittest.TestCase):
    def test_state_and_code(self):
        srv = webauth.CallbackServer("good-state")
        base = f"http://127.0.0.1:{srv.port}"
        self.assertEqual(srv.redirect_uri, base + "/callback")
        self.assertEqual(_get(base + "/favicon.ico")[0], 404)
        self.assertEqual(_get(base + "/callback?state=bad&code=x")[0], 400)
        self.assertFalse(srv.done.is_set())
        st, body = _get(base + "/callback?state=good-state&code=abc123")
        self.assertEqual(st, 200)
        self.assertIn("Kosmas", body)
        self.assertEqual(srv.wait(5), "abc123")
        with self.assertRaises(OSError):                 # one-shot: the port is closed afterwards
            urllib.request.urlopen(base + "/callback?state=good-state&code=again", timeout=2)

    def test_denied(self):
        srv = webauth.CallbackServer("s1")
        _get(f"http://127.0.0.1:{srv.port}/callback?state=s1&error=access_denied")
        with self.assertRaises(webauth.Denied):
            srv.wait(5)

    def test_cancel_and_timeout(self):
        srv = webauth.CallbackServer("s2")
        ev = threading.Event()
        threading.Timer(0.3, ev.set).start()
        with self.assertRaises(webauth.Cancelled):
            srv.wait(10, ev)
        srv = webauth.CallbackServer("s3")
        with self.assertRaises(sync.SyncError):
            srv.wait(0.5)


@unittest.skipUnless(_backend_up(), f"local backend {URL} is not running (npm run dev in kronikar-web)")
class BackendTest(unittest.TestCase):
    def setUp(self):
        self.user = {"id": "t" + uuid.uuid4().hex[:12], "name": "Test signin"}
        self.tmp = Path(tempfile.mkdtemp(prefix="kosmas-auth-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def browser(self, path, form):
        """The user's browser: signed in (X-Dev-User), same-origin form POST; follows redirects like a browser."""
        req = urllib.request.Request(URL + path, data=urllib.parse.urlencode(form).encode(), method="POST",
                                     headers={"X-Dev-User": json.dumps(self.user), "Origin": URL,
                                              "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")

    def me(self, token):
        req = urllib.request.Request(URL + "/kronika/api/me", headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read()).get("user")
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return None                              # revoked token
            raise

    def allow(self, url, action="allow"):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        q.pop("lang", None)
        q["action"] = action
        self.browser("/kronika/connect", q)              # 302 → the loopback /callback (urllib follows it)

    def test_loopback_login_and_revoke(self):
        res = webauth.loopback_login(URL, lambda url: threading.Thread(target=self.allow, args=(url,)).start(), timeout=30)
        self.assertTrue(res["token"].startswith("krt_"))
        self.assertEqual(res["user"]["id"], self.user["id"])
        self.assertEqual((self.me(res["token"]) or {}).get("id"), self.user["id"])
        self.assertTrue(webauth.revoke(URL, res["token"]))
        self.assertIsNone(self.me(res["token"]))

    def test_loopback_denied(self):
        with self.assertRaises(webauth.Denied):
            webauth.loopback_login(URL, lambda url: threading.Thread(target=self.allow, args=(url, "deny")).start(), timeout=30)

    def test_code_cannot_be_reused_or_stolen(self):
        got = {}
        orig = webauth.exchange

        def spy(server, code, verifier, redirect_uri):
            got.update(code=code, redirect_uri=redirect_uri)
            with self.assertRaises(sync.SyncError):     # wrong verifier → refused (and the code is burnt)
                orig(server, code, "x" * 50, redirect_uri)
            return orig(server, code, verifier, redirect_uri)
        webauth.exchange = spy
        try:
            with self.assertRaises(sync.SyncError):
                webauth.loopback_login(URL, lambda url: threading.Thread(target=self.allow, args=(url,)).start(), timeout=30)
        finally:
            webauth.exchange = orig

    def test_device_code(self):
        d = webauth.device_start(URL, device="Test PC")
        self.assertRegex(d["user_code"], r"^[A-Z]{4}-[A-Z]{4}$")
        self.assertIn("/kronika/connect/device", d["verification_uri"])
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(webauth.Cancelled):
            webauth.device_poll(URL, d["device_code"], cancel, interval=1)
        self.browser("/kronika/connect/device", {"code": d["user_code"], "action": "allow"})
        res = webauth.device_poll(URL, d["device_code"], interval=2, expires_in=60)
        self.assertEqual(res["user"]["id"], self.user["id"])
        self.assertEqual((self.me(res["token"]) or {}).get("id"), self.user["id"])
        webauth.revoke(URL, res["token"])

    def test_device_denied(self):
        d = webauth.device_start(URL)
        self.browser("/kronika/connect/device", {"code": d["user_code"], "action": "deny"})
        with self.assertRaises(webauth.Denied):
            webauth.device_poll(URL, d["device_code"], interval=2, expires_in=60)

    # ---------------------------------------------------------- Share button
    def test_share(self):
        token = webauth.loopback_login(URL, lambda url: threading.Thread(target=self.allow, args=(url,)).start(), timeout=30)["token"]
        db_path = self.tmp / "catalog.db"
        att = self.tmp / "att"
        att.mkdir()
        st = Store(db_path)
        try:
            c = st.create_character("Jindřich")
            ev = st.create_event("Bitva", start=1700000000)
            m = st.upsert_media({"path": "C:/videa/a.mp4", "game": "KCD2", "start_time": 1700000000, "duration": 60, "kind": "clip"})
            st.update_media(m, youtube="dQw4w9WgXcQ", title="Video")
            st.commit()
            bm = st.create_bookmark(m, 12.5, title="Útok")
            st.commit()
        finally:
            st.db.close()
        settings = {"sync_url": URL, "sync_token": token}

        def syncer(**kw):
            return sync.Syncer(db_path, dict(settings, **kw), att)

        # not signed in → no network, just "sign in first"
        s = syncer(sync_token="")
        try:
            info = s.share_info("character", c)
            self.assertEqual((info["signed_in"], info["published"], info["visibility"]), (False, False, "private"))
            with self.assertRaises(sync.SyncError):
                s.share_set("character", c, "link")
        finally:
            s.close()
        self.assertFalse(sync.is_published(db_path, "character", c))
        # not on the web yet → share_publish = full sync, then visibility
        s = syncer()
        try:
            res = s.share_publish("character", c, "link")
        finally:
            s.close()
        info = res["share"]
        self.assertTrue(info["published"])
        self.assertEqual(info["visibility"], "link")
        self.assertRegex(info["share_url"], r"/kronika/k/[A-Za-z0-9_-]+$")
        self.assertTrue(sync.is_published(db_path, "character", c))
        tok_old = info["share_url"].rsplit("/", 1)[1]
        self.assertEqual(_get(f"{URL}/kronika/k/{tok_old}")[0], 200)
        s = syncer()
        try:
            self.assertEqual(s.share_info("character", c)["share_url"], info["share_url"])
            rot = s.share_set("character", c, rotate=True)
            self.assertNotEqual(rot["share_url"], info["share_url"])
            self.assertEqual(_get(f"{URL}/kronika/k/{tok_old}")[0], 404)          # revoked link stops working
            self.assertEqual(_get(f"{URL}/kronika/k/{rot['share_url'].rsplit('/', 1)[1]}")[0], 200)
            pub = s.share_set("event", ev, "public")
            self.assertEqual(pub["visibility"], "public")
            self.assertIn("/kronika/z/", pub["share_url"])
            # a moment is shared through its video
            mom = s.share_set("bookmark", bm, "link")
            self.assertEqual(mom["via"]["type"], "video")
            self.assertEqual(mom["visibility"], "link")
            priv = s.share_set("character", c, "private")
            self.assertEqual((priv["visibility"], priv["share_url"]), ("private", None))
            self.assertEqual(s.pub("characters", c)["visibility"], "private")
            with self.assertRaises(sync.SyncError):
                s.share_info("letter", 1)
        finally:
            s.close()
        # a normal sync afterwards doesn't see the visibility change as a content conflict
        s = syncer()
        try:
            r = s.run()
        finally:
            s.close()
        self.assertEqual(r["conflicts"], 0)

    # ---------------------------------------------------------- the same through the Qt bridge (Api), event loop included
    @unittest.skipUnless(importlib.util.find_spec("PySide6"), "without PySide6")
    def test_api_sign_in_share_sign_out(self):
        import time
        from PySide6.QtCore import QCoreApplication
        from rpcatalog import api as apimod, config
        app = QCoreApplication.instance() or QCoreApplication([])
        db_path, att = self.tmp / "catalog.db", self.tmp / "att"
        old = config.DB_PATH, apimod.ATT_DIR
        config.DB_PATH, apimod.ATT_DIR = db_path, att
        st = Store(db_path)

        class Host:
            def save_settings(self):
                pass
        try:
            c = st.create_character("Hans")
            st.commit()
            settings = {"sync_url": URL}
            a = apimod.Api(st, settings, Host())
            events = []
            a.notify.connect(lambda k, p: events.append((k, json.loads(p))))
            a._open_url = lambda url: threading.Thread(target=self.allow, args=(url,)).start()

            def spin(cond, timeout=60):
                end = time.monotonic() + timeout
                while not cond() and time.monotonic() < end:
                    app.processEvents()
                    time.sleep(0.02)
                self.assertTrue(cond(), "timed out")

            self.assertEqual(a.m_auth_start("browser")["state"], "browser")
            spin(lambda: settings.get("sync_token"))
            self.assertEqual(a.m_auth_status()["state"], "done")
            self.assertEqual(a.m_sync_status()["user"], self.user["name"])
            self.assertNotIn("sync_token", a.m_settings_get())

            def bg(res):
                rid = res["_bg"]
                spin(lambda: any(k == "bg" and p["id"] == rid for k, p in events))
                return next(p for k, p in events if k == "bg" and p["id"] == rid)

            r = bg(a.m_share_get("character", c))
            self.assertEqual((r["ok"]["published"], r["ok"]["signed_in"]), (False, True))
            r = bg(a.m_share_set("character", c, "link"))         # not on the web yet → sync, then link
            self.assertEqual(r["ok"]["visibility"], "link")
            self.assertIn("/kronika/k/", r["ok"]["share_url"])
            r = bg(a.m_share_rotate("character", c))
            self.assertIn("/kronika/k/", r["ok"]["share_url"])
            tok = settings["sync_token"]
            a.m_auth_sign_out()
            self.assertNotIn("sync_token", settings)
            spin(lambda: self.me(tok) is None, 15)               # revoked on the server
            self.assertTrue(sync.is_published(db_path, "character", c))   # mapping kept
            r = bg(a.m_share_get("character", c))
            self.assertFalse(r["ok"]["signed_in"])
        finally:
            st.db.close()
            config.DB_PATH, apimod.ATT_DIR = old


if __name__ == "__main__":
    unittest.main()
