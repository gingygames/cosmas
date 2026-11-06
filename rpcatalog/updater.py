"""Update checks and updates of the installed app (no Qt here – see update_ctl.py for the UI side).

Where the newest version comes from:
  1. https://gingygames.com/kosmas/api/app/latest[?channel=beta]
     {version, tag, published_at, url, size, sha256, notes_md, notes_url}
  2. if that fails: the GitHub API (repos/gingygames/cosmas/releases/latest, or the newest release incl. pre-releases
     for the beta channel); the SHA-256 comes from the asset's digest or from the <installer>.sha256 asset.
KOSMAS_UPDATE_URL overrides (1) – used by tests and a local fake server.

An update = the installer downloaded into <data>/updates (resumable .part file), SHA-256 checked, then run silently
after the app has closed:  /SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /LANG=.. /DIR=.. /RELAUNCH
"""
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import __version__, config

LATEST_URL = "https://gingygames.com/kosmas/api/app/latest"
GITHUB_API = "https://api.github.com/repos/gingygames/cosmas"
RELEASES_PAGE = "https://github.com/gingygames/cosmas/releases"
UPDATES_DIR = config.DATA_DIR / "updates"
PENDING = UPDATES_DIR / "pending.json"
CHECK_EVERY = 12 * 3600
INSTALLER_RE = re.compile(r"^(Cosmas|Kosmas)-Setup-[\w.+-]+\.exe$", re.I)
_LOCAL = {"127.0.0.1", "localhost", "::1"}


class UpdateError(Exception):
    pass


class ShaMismatch(UpdateError):
    pass


# ------------------------------------------------------------------ versions
_VER_RE = re.compile(r"^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.\d+)*(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$")


def parse_version(s):
    """'v1.2.0-beta.1' -> (1, 2, 0, ('beta', 1)); a release has pre = None. Unparsable -> None."""
    m = _VER_RE.match(str(s or ""))
    if not m:
        return None
    pre = None
    if m.group(4):
        pre = tuple(int(p) if p.isdigit() else p.lower() for p in m.group(4).split("."))
    return int(m.group(1)), int(m.group(2) or 0), int(m.group(3) or 0), pre


def _pre_key(pre):
    # a release sorts after all of its pre-releases; numeric identifiers sort before alphanumeric ones (semver)
    if pre is None:
        return (1,)
    return (0,) + tuple((0, p, "") if isinstance(p, int) else (1, 0, p) for p in pre)


def compare(a, b):
    """-1 / 0 / 1 like cmp(a, b); an unparsable version counts as the oldest."""
    pa, pb = parse_version(a), parse_version(b)
    if pa is None or pb is None:
        return (pa is not None) - (pb is not None)
    ka, kb = (pa[:3], _pre_key(pa[3])), (pb[:3], _pre_key(pb[3]))
    return (ka > kb) - (ka < kb)


def is_newer(candidate, current=__version__):
    return compare(candidate, current) > 0


def is_prerelease(v):
    p = parse_version(v)
    return bool(p and p[3] is not None)


# ------------------------------------------------------------------ network
def _check_download_url(url):
    u = urllib.parse.urlsplit(str(url or ""))
    if u.scheme == "https" or (u.scheme == "http" and (u.hostname or "") in _LOCAL):
        return url
    raise UpdateError(f"refusing a download address that is not https: {url!r}")


def _get(url, timeout=15, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": f"Cosmas-desktop/{__version__}", "Accept": accept})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _sha(v):
    v = str(v or "").strip().lower()
    if v.startswith("sha256:"):
        v = v[7:]
    return v if re.fullmatch(r"[0-9a-f]{64}", v) else None


def _normalize(d, source):
    if not isinstance(d, dict) or not parse_version(d.get("version") or d.get("tag")) or not d.get("url"):
        raise UpdateError("unexpected answer from the update server")
    ver = str(d.get("version") or d.get("tag")).strip().lstrip("vV")
    size = d.get("size")
    return {"version": ver, "tag": d.get("tag") or ("v" + ver), "published_at": d.get("published_at"),
            "url": _check_download_url(d["url"]), "size": int(size) if isinstance(size, (int, float)) and size > 0 else None,
            "sha256": _sha(d.get("sha256")), "notes_md": str(d.get("notes_md") or "")[:20000],
            "notes_url": d.get("notes_url") or RELEASES_PAGE, "source": source,
            "file": d.get("file") if INSTALLER_RE.match(str(d.get("file") or "")) else None,
            "min_supported": d.get("min_supported") if parse_version(d.get("min_supported")) else None}


def from_endpoint(channel="stable", url=None, get=_get):
    url = url or os.environ.get("KOSMAS_UPDATE_URL") or LATEST_URL
    if channel == "beta":
        url += ("&" if "?" in url else "?") + "channel=beta"
    return _normalize(json.loads(get(url)), "web")


def from_github(channel="stable", get=_get):
    if channel == "beta":
        rels = [r for r in json.loads(get(GITHUB_API + "/releases?per_page=10")) if not r.get("draft")]
        if not rels:
            raise UpdateError("no releases on GitHub")
        rel = rels[0]
    else:
        rel = json.loads(get(GITHUB_API + "/releases/latest"))
    assets = rel.get("assets") or []
    exe = next((a for a in assets if INSTALLER_RE.match(a.get("name", "")) and not a["name"].lower().endswith("-test.exe")), None)
    if not exe:
        raise UpdateError("the newest release has no installer")
    sha = _sha(exe.get("digest"))
    if not sha:
        side = next((a for a in assets if a.get("name") == exe["name"] + ".sha256"), None)
        if side:
            try:
                sha = _sha(get(side["browser_download_url"], accept="application/octet-stream").decode("ascii", "replace").split()[0])
            except Exception:
                sha = None
    return _normalize({"version": rel.get("tag_name"), "tag": rel.get("tag_name"), "published_at": rel.get("published_at"),
                       "url": exe.get("browser_download_url"), "size": exe.get("size"), "sha256": sha,
                       "notes_md": rel.get("body") or "", "notes_url": rel.get("html_url")}, "github")


def fetch_latest(channel="stable", get=_get):
    """Info about the newest version (dict, see _normalize). Raises UpdateError when no source answers."""
    errors = []
    sources = [from_endpoint]
    if not os.environ.get("KOSMAS_UPDATE_URL"):       # a test server is never mixed with the real releases
        sources.append(from_github)
    for fn in sources:
        try:
            return fn(channel, get=get)
        except (UpdateError, urllib.error.URLError, OSError, ValueError, KeyError, TypeError) as e:
            errors.append(f"{fn.__name__}: {e}")
    raise UpdateError("; ".join(errors))


# ------------------------------------------------------------------ what to do
def decide(info, settings, current=__version__, is_dev=config.IS_DEV, manual=False):
    """What an update check means for this copy. Pure function (tested).
    available     – a newer version for the chosen channel (a skipped version only when checking manually)
    can_install   – it can be downloaded and installed from the app (never in a source checkout)
    auto_download – start downloading right away (setting update_auto_download)"""
    out = {"available": False, "version": None, "skipped": False, "can_install": False, "auto_download": False,
           "reason": ""}
    if not info:
        out["reason"] = "no-info"
        return out
    v = info.get("version")
    out["version"] = v
    channel = settings.get("update_channel") or "stable"
    if not is_newer(v, current):
        out["reason"] = "up-to-date"
        return out
    if channel == "stable" and is_prerelease(v):
        out["reason"] = "prerelease"
        return out
    out["skipped"] = settings.get("update_skip") == v
    if out["skipped"] and not manual:
        out["reason"] = "skipped"
        return out
    out["available"] = True
    out["can_install"] = not is_dev and os.name == "nt" and bool(info.get("url"))
    out["auto_download"] = out["can_install"] and bool(settings.get("update_auto_download")) and not out["skipped"]
    out["reason"] = "dev" if is_dev else "available"
    return out


def due(settings, now=None):
    """Automatic check wanted now? (setting update_auto_check, at most every 12 h)"""
    if not settings.get("update_auto_check", True):
        return False
    now = time.time() if now is None else now
    return now - float(settings.get("update_last_check") or 0) >= CHECK_EVERY - 60


# ------------------------------------------------------------------ download + verify
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(path, expected):
    """True / False when the expected SHA-256 is known, None when it isn't."""
    exp = _sha(expected)
    if not exp:
        return None
    return sha256_file(path) == exp


def installer_name(info):
    name = info.get("file") or Path(urllib.parse.urlsplit(info["url"]).path).name
    if not INSTALLER_RE.match(name):
        name = f"Cosmas-Setup-{re.sub(r'[^0-9A-Za-z.+-]', '', info['version'])}.exe"
    return name


def download(info, dest_dir=None, progress=None, cancel=None, opener=urllib.request.urlopen, chunk=1 << 16):
    """Downloads the installer (continues a .part file left by an interrupted download) and checks its SHA-256.
    progress(done, total) is called now and then; cancel is a threading.Event. Returns (path, verified) where
    verified is True (hash matches) or None (no hash published). A wrong hash deletes the file: ShaMismatch."""
    dest_dir = Path(dest_dir or UPDATES_DIR)
    dest_dir.mkdir(parents=True, exist_ok=True)
    final = dest_dir / installer_name(info)
    if final.exists():
        ok = verify(final, info.get("sha256"))
        if ok:
            return final, True
        final.unlink()
    part = final.with_name(final.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = {"User-Agent": f"Cosmas-desktop/{__version__}", "Accept": "application/octet-stream"}
    if have:
        headers["Range"] = f"bytes={have}-"
    req = urllib.request.Request(_check_download_url(info["url"]), headers=headers)
    try:
        r = opener(req, timeout=30)
    except urllib.error.HTTPError as e:
        if e.code == 416 and have:           # the .part is already complete (or stale): start over
            part.unlink()
            return download(info, dest_dir, progress, cancel, opener, chunk)
        raise
    with r:
        status = getattr(r, "status", None) or r.getcode()
        if status != 206:                    # the server ignored the range: whole file again
            have = 0
        length = r.headers.get("Content-Length")
        total = (have + int(length)) if length and length.isdigit() else info.get("size")
        with open(part, "ab" if have else "wb") as f:
            done, last = have, 0.0
            while True:
                if cancel is not None and cancel.is_set():
                    raise UpdateError("cancelled")
                buf = r.read(chunk)
                if not buf:
                    break
                f.write(buf)
                done += len(buf)
                if progress and time.time() - last > 0.25:
                    last = time.time()
                    progress(done, total)
    if progress:
        progress(done, total)
    if info.get("size") and part.stat().st_size != info["size"]:
        size = part.stat().st_size
        if size > info["size"]:
            part.unlink()
        raise UpdateError(f"incomplete download ({size} of {info['size']} bytes)")
    ok = verify(part, info.get("sha256"))
    if ok is False:
        part.unlink()
        raise ShaMismatch("the downloaded installer does not match its published SHA-256 – it was deleted")
    os.replace(part, final)
    return final, ok


def cleanup(dest_dir=None, keep=None):
    """Removes downloaded installers (except `keep`)."""
    dest_dir = Path(dest_dir or UPDATES_DIR)
    if not dest_dir.is_dir():
        return
    for p in dest_dir.iterdir():
        if p.is_file() and p != keep and (INSTALLER_RE.match(p.name.removesuffix(".part")) or p.suffix == ".part"):
            try:
                p.unlink()
            except OSError:
                pass


# ------------------------------------------------------------------ install
def install_dir():
    """The folder of this installed copy (…\\Programs\\Kronikar), None for a source checkout."""
    return None if config.IS_DEV else config.APP_DIR.parent


def installer_args(path, lang="en", target=None):
    args = [str(path), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
            f"/LANG={'cs' if lang == 'cs' else 'en'}", "/RELAUNCH"]
    if target:
        args.append(f"/DIR={target}")
    return args


def write_pending(info, path):
    UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    PENDING.write_text(json.dumps({"version": info["version"], "from": __version__, "installer": str(path),
                                   "at": time.time()}), "utf-8")


def after_update():
    """Called at start: {"updated": "1.2.0"} after a successful update, {"failed": "1.2.0"} when the installer
    did not bring the new version, None otherwise. Removes the downloaded installer once the update is in."""
    try:
        d = json.loads(PENDING.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    try:
        PENDING.unlink()
    except OSError:
        pass
    if compare(__version__, d.get("version")) >= 0:
        cleanup()
        return {"updated": __version__, "from": d.get("from")}
    if time.time() - float(d.get("at") or 0) > 7 * 86400:
        return None
    return {"failed": d.get("version")}


def launch_installer(path, lang="en", target=None):
    """Starts the installer detached from this process (it waits for the app to close via /CLOSEAPPLICATIONS)."""
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | 0x01000000   # BREAKAWAY_FROM_JOB
    args = installer_args(path, lang, target)
    try:
        return subprocess.Popen(args, creationflags=flags, close_fds=True, cwd=str(Path(path).parent))
    except OSError:
        if os.name == "nt":       # not allowed to break away from a job: start it without that flag
            return subprocess.Popen(args, creationflags=flags & ~0x01000000, close_fds=True, cwd=str(Path(path).parent))
        raise
