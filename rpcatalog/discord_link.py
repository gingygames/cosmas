"""Discord: player names/avatars through the user's own bot, and "Holub" letters from
(a) a server channel via that bot, (b) Discord's official data export (messages you sent).

Reading other people's DMs is not possible legitimately (bots can't, and automating a personal
account breaks Discord's terms), so this module never touches user tokens."""
import csv
import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime

from . import __version__
from .i18n import tr

API = "https://discord.com/api/v10"
UA = f"DiscordBot (https://github.com/gingygames/cosmas, {__version__})"     # the form Discord asks bots to use


class DiscordError(Exception):
    pass


def _get(token, path, params=None):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": f"Bot {token}", "User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            if e.code == 429:          # rate limited
                try:
                    wait = float(json.loads(body).get("retry_after", 1))
                except ValueError:
                    wait = 1.0
                time.sleep(min(wait, 10) + 0.2)
                continue
            hints = {401: tr("Invalid bot token."),
                     403: tr("The bot lacks permissions (invite it to the server, enable 'Server Members Intent' "
                             "and, for letters, 'Message Content Intent' in the Discord Developer Portal)."),
                     404: tr("Server or channel not found – check the ID.")}
            raise DiscordError(hints.get(e.code) or tr("Discord returned error {code}: {body}", code=e.code, body=body[:200]))
        except urllib.error.URLError as e:
            raise DiscordError(tr("Could not connect to Discord: {reason}", reason=e.reason))
    raise DiscordError(tr("Discord is refusing too many requests, try again in a moment."))


def avatar_url(member):
    """Server avatar if set, else the account avatar, else Discord's default."""
    u = member.get("user") or {}
    if member.get("avatar") and member.get("guild_id"):
        return f"https://cdn.discordapp.com/guilds/{member['guild_id']}/users/{u['id']}/avatars/{member['avatar']}.png?size=256"
    if u.get("avatar"):
        return f"https://cdn.discordapp.com/avatars/{u['id']}/{u['avatar']}.png?size=256"
    try:
        idx = (int(u.get("id", 0)) >> 22) % 6
    except ValueError:
        idx = 0
    return f"https://cdn.discordapp.com/embed/avatars/{idx}.png"


def user(token, user_id):
    """Public profile of any user by ID - the bot does not need to share a server with them."""
    uid = str(user_id).strip()
    if not uid.isdigit() or not 15 <= len(uid) <= 21:
        raise DiscordError(tr("A Discord ID is a number with 17–20 digits (right-click the user → Copy User ID)."))
    u = _get(token, f"/users/{uid}")
    return {"id": u.get("id"), "username": u.get("username", ""), "global_name": u.get("global_name") or "",
            "nick": "", "display": u.get("global_name") or u.get("username", ""),
            "avatar": avatar_url({"user": u}), "bot": bool(u.get("bot"))}


def members(token, guild_id):
    out, after = [], "0"
    while True:
        batch = _get(token, f"/guilds/{guild_id}/members", {"limit": 1000, "after": after})
        for m in batch:
            m["guild_id"] = guild_id
            u = m.get("user") or {}
            out.append({"id": u.get("id"), "username": u.get("username", ""),
                        "global_name": u.get("global_name") or "", "nick": m.get("nick") or "",
                        "display": m.get("nick") or u.get("global_name") or u.get("username", ""),
                        "avatar": avatar_url(m), "bot": bool(u.get("bot"))})
        if len(batch) < 1000:
            break
        after = batch[-1]["user"]["id"]
    return [m for m in out if not m["bot"]]


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def _iso(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def _matches(text, marker):
    t = (text or "").lower()
    return bool(marker) and (marker.lower() in t or "🕊" in t)


def channel_letters(token, channel_id, marker, limit=5000):
    """Messages in a server channel that contain the marker (e.g. 'holub')."""
    out, before = [], None
    while len(out) < limit:
        params = {"limit": 100}
        if before:
            params["before"] = before
        batch = _get(token, f"/channels/{channel_id}/messages", params)
        if not batch:
            break
        for m in batch:
            if _matches(m.get("content"), marker):
                a = m.get("author") or {}
                out.append({"source_ref": f"dc:{m['id']}", "sent_at": _iso(m.get("timestamp")),
                            "body": m.get("content", ""), "author": a.get("global_name") or a.get("username", ""),
                            "author_discord_id": a.get("id", ""), "channel": f"#{channel_id}",
                            "source": "discord-channel"})
        before = batch[-1]["id"]
        if len(batch) < 100:
            break
    return out


def export_letters(path, marker):
    """Letters from Discord's data package (Settings → Data & Privacy → Request data).
    `path` is the downloaded .zip or its unpacked folder. Contains only messages YOU sent."""
    files, z = {}, None
    if os.path.isdir(path):
        for root, _, names in os.walk(path):
            for n in names:
                full = os.path.join(root, n)
                rel = os.path.relpath(full, path).replace("\\", "/")
                files[rel] = lambda full=full: open(full, "rb").read()
    elif zipfile.is_zipfile(path):
        z = zipfile.ZipFile(path)
        for n in z.namelist():
            files[n] = lambda n=n: z.read(n)
    else:
        raise DiscordError(tr("Choose the package.zip file from Discord or its unpacked folder."))
    try:
        return _export_letters(files, marker)
    finally:
        if z is not None:
            z.close()


def _export_letters(files, marker):
    def find(suffix):
        return [k for k in files if k.lower().endswith(suffix.lower())]

    index = {}
    for k in find("messages/index.json"):
        try:
            index.update(json.loads(files[k]().decode("utf-8")))
        except ValueError:
            pass
    out = []
    for k in [k for k in files if "/messages/" in "/" + k.lower() and k.lower().endswith(("messages.json", "messages.csv"))]:
        folder = k.rsplit("/", 1)[0].rsplit("/", 1)[-1]          # c123456789
        chan_id = folder[1:] if folder.startswith("c") else folder
        chan = index.get(chan_id) or folder
        raw = files[k]().decode("utf-8", "ignore")
        if k.lower().endswith(".json"):
            try:
                rows = json.loads(raw)
            except ValueError:
                continue
        else:
            rows = list(csv.DictReader(io.StringIO(raw)))
        for r in rows:
            text = r.get("Contents") or r.get("contents") or ""
            if not _matches(text, marker):
                continue
            mid = r.get("ID") or r.get("id")
            out.append({"source_ref": f"dx:{mid}", "sent_at": _iso(r.get("Timestamp") or r.get("timestamp") or ""),
                        "body": text, "author": "já", "channel": chan or "", "source": "discord-export"})
    if not out and not index:
        raise DiscordError(tr("I couldn't find a messages/ folder in the file – is it really a Discord data export?"))
    return out
