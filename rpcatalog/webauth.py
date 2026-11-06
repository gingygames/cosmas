"""Sign in to the web chronicle with Discord – no copying of tokens.

1. Loopback + PKCE (RFC 8252): a one-shot HTTP server on 127.0.0.1:<random port> waits for /callback,
   the browser opens {server}/kosmas/connect?redirect_uri=…&state=…&code_challenge=…; the user signs in with Discord
   and clicks Allow, the browser comes back to the loopback with ?code=&state=; the code is exchanged for a token
   (POST /kosmas/api/auth/token {code, code_verifier, redirect_uri}).
2. Device code (RFC 8628) when nothing can listen on loopback: POST /kosmas/api/auth/device, the user enters the code
   on the web, the app polls /kosmas/api/auth/device/poll.
3. POST /kosmas/api/auth/revoke with the token = "Disconnect this device".

Everything here blocks (network, waiting) – call it from a worker thread, never from the Qt main thread.
Tokens and codes are never logged.
"""
import base64
import hashlib
import html
import http.server
import json
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import i18n
from .i18n import tr
from .sync import DEFAULT_URL, NetworkError, SyncError, check_url

LOGIN_TIMEOUT = 300          # seconds the app waits for the browser


class Cancelled(SyncError):
    pass


class Denied(SyncError):
    pass


def pkce_pair():
    """(code_verifier, code_challenge) – S256, 43-char base64url challenge."""
    verifier = secrets.token_urlsafe(48)[:64]
    return verifier, challenge_for(verifier)


def challenge_for(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")


def new_state():
    return secrets.token_urlsafe(24)


def device_name():
    try:
        return socket.gethostname()[:60] or "Desktop"
    except OSError:
        return "Desktop"


def connect_url(server, redirect_uri, state, challenge, device=None):
    q = {"redirect_uri": redirect_uri, "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
         "device": device or device_name(), "client": "desktop", "lang": i18n.lang()}
    return check_url(server or DEFAULT_URL) + "/kosmas/connect?" + urllib.parse.urlencode(q)


# ------------------------------------------------------------------ loopback server
_PAGE = """<!doctype html><html lang="{lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Kosmas</title><style>body{{font:16px system-ui,sans-serif;background:#16181d;color:#eceef1;display:grid;place-items:center;
height:100vh;margin:0}}div{{max-width:420px;padding:28px;text-align:center}}h1{{font-size:22px;margin:0 0 10px}}p{{color:#aab0bb}}</style>
<div><h1>{title}</h1><p>{text}</p></div></html>"""


class CallbackServer:
    """One-shot loopback HTTP server. Accepts only GET /callback with the expected state;
    anything else gets 404/400 and the server keeps waiting."""

    def __init__(self, state, host="127.0.0.1"):
        self.state = state
        self.result = None                 # {"code": …} | {"error": …}
        self.done = threading.Event()
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):     # the query holds the one-time code – never log it
                pass

            def _page(self, status, title, text):
                body = _PAGE.format(lang=i18n.lang(), title=html.escape(title), text=html.escape(text)).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                u = urllib.parse.urlsplit(self.path)
                if u.path != "/callback":
                    self._page(404, "Kosmas", tr("Nothing here."))
                    return
                q = dict(urllib.parse.parse_qsl(u.query))
                if not secrets.compare_digest(q.get("state", ""), outer.state) or outer.done.is_set():
                    self._page(400, "Kosmas", tr("This sign-in link does not belong to the running sign-in. Start it again in Kosmas."))
                    return
                if q.get("code"):
                    outer.result = {"code": q["code"]}
                    self._page(200, tr("Kosmas is connected"), tr("You can close this tab and return to Kosmas."))
                else:
                    outer.result = {"error": q.get("error") or "invalid_request"}
                    self._page(200, tr("Sign-in cancelled"), tr("Kosmas was not connected. You can close this tab."))
                outer.done.set()

        self.httpd = http.server.HTTPServer((host, 0), Handler)   # OSError when loopback is unavailable
        self.httpd.timeout = 0.5
        self.port = self.httpd.server_address[1]
        self.redirect_uri = f"http://127.0.0.1:{self.port}/callback"
        self._thread = threading.Thread(target=self._serve, name="kosmas-login", daemon=True)
        self._thread.start()

    def _serve(self):
        try:
            while not self.done.is_set() and not getattr(self, "_closed", False):
                self.httpd.handle_request()
        except Exception:
            pass

    def wait(self, timeout=LOGIN_TIMEOUT, cancel=None):
        """Returns the authorization code. Raises Cancelled / Denied / SyncError (timeout)."""
        end = time.monotonic() + timeout
        try:
            while not self.done.wait(0.25):
                if cancel is not None and cancel.is_set():
                    raise Cancelled(tr("Sign-in cancelled."))
                if time.monotonic() > end:
                    raise SyncError(tr("Sign-in timed out – the browser did not come back to Kosmas. Try again or use a code."))
        finally:
            self.close()
        if self.result.get("error") == "access_denied":
            raise Denied(tr("Sign-in was declined in the browser."))
        if "code" not in self.result:
            raise SyncError(tr("Sign-in failed ({error}).", error=self.result.get("error")))
        return self.result["code"]

    def close(self):
        self._closed = True
        try:
            self.httpd.server_close()
        except OSError:
            pass


# ------------------------------------------------------------------ HTTP to the server (no token needed)
def _post(server, path, body, token=None, timeout=30):
    url = check_url(server or DEFAULT_URL) + "/kosmas/api" + path
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Kosmas-desktop/1.0",
               "Accept-Language": i18n.lang()}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode("utf-8"), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        msg = ""
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error") or ""
        except Exception:
            pass
        err = SyncError(tr("The server rejected the request ({code}): {reason}", code=e.code, reason=msg or e.reason))
        err.status = e.code
        raise err
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise NetworkError(tr("Connection to the server failed: {error}", error=getattr(e, "reason", e)))
    try:
        return json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError:
        raise SyncError(tr("The server returned an unreadable response – is the server address correct?"))


def _token_result(res):
    tok = str(res.get("token") or "")
    if not tok.startswith("krt_"):
        raise SyncError(tr("The server returned an unreadable response – is the server address correct?"))
    return {"token": tok, "user": res.get("user") or {}, "label": res.get("label") or ""}


def exchange(server, code, verifier, redirect_uri):
    return _token_result(_post(server, "/auth/token", {"code": code, "code_verifier": verifier, "redirect_uri": redirect_uri}))


def revoke(server, token):
    """Deletes the token on the server. Errors are swallowed – the token is forgotten locally anyway."""
    if not token:
        return False
    try:
        _post(server, "/auth/revoke", {}, token=token, timeout=15)
        return True
    except SyncError:
        return False


def loopback_login(server, open_url, cancel=None, timeout=LOGIN_TIMEOUT, on_ready=None):
    """Full loopback flow. open_url(url) opens the browser (called from this thread – pass something thread-safe).
    Raises OSError when nothing can listen on 127.0.0.1 (→ use device_login)."""
    verifier, challenge = pkce_pair()
    state = new_state()
    srv = CallbackServer(state)
    try:
        url = connect_url(server, srv.redirect_uri, state, challenge)
        if on_ready:
            on_ready(url)
        open_url(url)
        code = srv.wait(timeout, cancel)
    finally:
        srv.close()
    return exchange(server, code, verifier, srv.redirect_uri)


def device_start(server, device=None):
    res = _post(server, "/auth/device", {"device": device or device_name(), "client": "desktop"})
    if not res.get("device_code") or not res.get("user_code"):
        raise SyncError(tr("The server returned an unreadable response – is the server address correct?"))
    return res


def device_poll(server, device_code, cancel=None, interval=5, expires_in=600, sleep=None):
    """Polls until the user approves on the web. Returns {token, user, label}."""
    sleep = sleep or (lambda s: cancel.wait(s) if cancel is not None else time.sleep(s))
    end = time.monotonic() + expires_in
    while True:
        if cancel is not None and cancel.is_set():
            raise Cancelled(tr("Sign-in cancelled."))
        if time.monotonic() > end:
            raise SyncError(tr("The code has expired. Start the sign-in again."))
        sleep(max(1, interval))
        if cancel is not None and cancel.is_set():
            raise Cancelled(tr("Sign-in cancelled."))
        try:
            res = _post(server, "/auth/device/poll", {"device_code": device_code})
        except NetworkError:
            continue                               # flaky connection – keep trying until the code expires
        st = res.get("status")
        if res.get("token"):
            return _token_result(res)
        if st == "slow_down":
            interval = int(res.get("interval") or interval + 5)
        elif st == "denied":
            raise Denied(tr("Sign-in was declined in the browser."))
        elif st == "expired":
            raise SyncError(tr("The code has expired. Start the sign-in again."))
