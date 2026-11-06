"""Synchronizace desktop ↔ webová Kronika (gingygames.com/kronika).

Průběh jedné synchronizace (Syncer.run):
  0. účet a databáze – GET /me; tato catalog.db má vlastní db_uuid zapsané na webu v nastavení účtu
             (desktop_dbs). Neznámá databáze proti webu, kde už jsou záznamy z desktopu → zeptat se
             (spárovat podle id / nahrát jako novou kopii).
  1. pull  – GET /sync?since=<poslední synchronizace>: změny z webu se promítnou do SQLite
             (konflikt = řádek se změnil na obou stranách → nic se nepřepíše, jen se zapíše do sync_conflicts)
  2. upload – změněné obrázky příloh (zmenšené na ≤ 1600 px) přes /upload se src=attachments:<id>
  3. push  – POST /import se změněnými řádky (podle otisku obsahu) + smazanými
  4. echo  – GET /sync?since=<čas z kroku 1>: vlastní změny se jen zapíšou do mapy (rev), cizí se promítnou

Mapa lokální řádek ↔ záznam na webu je v tabulce `published` (v databázi katalogu).
Síť jen přes urllib, běží mimo UI vlákno (vlastní spojení do SQLite v režimu autocommit;
transakce jen kolem čistě lokálních dávek, nikdy přes síťové volání – UI tak nečeká na zámek).
"""
import hashlib
import json
import mimetypes
import re
import secrets
import socket
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path

DEFAULT_URL = "https://gingygames.com"
TOKEN_URL = "https://gingygames.com/kronika/app/#settings"

TABLE_TYPE = {"servers": "server", "players": "player", "factions": "faction", "characters": "character",
              "places": "place", "events": "event", "entries": "entry", "letters": "letter", "media": "video",
              "bookmarks": "moment", "attachments": "image"}
TYPE_TABLE = {v: k for k, v in TABLE_TYPE.items()}
# pořadí zakládání lokálních řádků (kvůli cizím klíčům)
ORDER = ["servers", "players", "factions", "characters", "places", "events", "entries", "media", "bookmarks",
         "letters", "attachments"]
# sloupce, které se posílají na web (nic dalšího – žádné lokální cesty, kontakty apod.)
COLS = {
    "servers": "game name color active_from active_to notes position is_default",
    "players": "name color avatar_id summary body_html tags discord_id discord_name",
    "factions": "name kind color emblem_id summary body_html parent_id server_id",
    "characters": "name aliases kind status color portrait_id summary body_html gender player_id player status_date "
                  "status_ingame status_event_id status_note own_style server_id",
    "places": "name kind color image_id summary body_html parent_id owner_type owner_id ingame_location server_id",
    "events": "title description body_html start_time end_time color parent_id position location ingame_date cover_id "
              "status place_id server_id",
    "entries": "event_id title body_html entry_time ingame_date",
    "letters": "sent_at ingame_date title body sender_id recipient_ids author channel source event_id place_id",
    "bookmarks": "media_id t t_end title note color event_id source",
    "attachments": "owner_type owner_id orig_name mime kind caption taken_at size media_id media_offset",
}
COLS = {t: ["id"] + v.split() + ["created_at", "updated_at"] for t, v in COLS.items()}
LINK_COLS = {
    "faction_members": ["faction_id", "character_id", "role", "position"],
    "character_links": ["id", "character_id", "target_type", "target_id", "role", "source"],
    "character_relations": ["id", "a_id", "b_id", "label", "kind", "note"],
    "event_links": ["id", "event_id", "media_id", "offset", "note"],
}
# cizí klíče lokálních tabulek (sloupec -> cílová tabulka)
FK = {
    "events": {"parent_id": "events", "cover_id": "attachments", "place_id": "places", "server_id": "servers"},
    "entries": {"event_id": "events"},
    "characters": {"portrait_id": "attachments", "player_id": "players", "status_event_id": "events",
                   "server_id": "servers"},
    "factions": {"emblem_id": "attachments", "parent_id": "factions", "server_id": "servers"},
    "places": {"image_id": "attachments", "parent_id": "places", "server_id": "servers"},
    "players": {"avatar_id": "attachments"},
    "letters": {"sender_id": "characters", "event_id": "events", "place_id": "places"},
    "media": {"server_id": "servers"},
    "bookmarks": {"media_id": "media", "event_id": "events"},
    "attachments": {"media_id": "media"},
}
OWNER_TABLE = {"event": "events", "entry": "entries", "character": "characters", "faction": "factions",
               "place": "places", "player": "players"}
OWNER_TYPE = {v: k for k, v in OWNER_TABLE.items()}
MENTION_TYPE = {"events": "event", "entries": "entry", "characters": "character", "factions": "faction",
                "places": "place"}
# cíle vazeb postav: lokální target_type -> (tabulka, typ na webu)
CL_TARGET = {"event": ("events", "event"), "media": ("media", "video"), "entry": ("entries", "entry"),
             "bookmark": ("bookmarks", "moment"), "character": ("characters", "character"),
             "faction": ("factions", "faction"), "place": ("places", "place")}
CL_FROM_WEB = {"video": "media", "moment": "bookmark"}
# u videí, která jsou i lokálně jako soubor, z webu přebíráme jen tyto údaje
MEDIA_PULL = {"title", "description", "favorite", "server_id", "youtube"}
NOT_NULL = {"entries": {"event_id"}, "bookmarks": {"media_id", "t"}, "attachments": {"owner_id", "owner_type"}}
MAX_PX = 1600
UPLOAD_MIME = {"image/webp", "image/jpeg", "image/png", "image/gif", "image/avif"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS published (
    local_type TEXT NOT NULL,          -- lokální tabulka (characters, events, …)
    local_id INTEGER NOT NULL,
    remote_id INTEGER,                 -- kr_records.id na webu
    visibility TEXT,
    rev INTEGER,                       -- poslední známá revize na webu
    synced_at REAL,
    hash TEXT,                         -- otisk obsahu při poslední synchronizaci
    pending_hash TEXT,                 -- otisk odeslaný na web, na jehož potvrzení se čeká
    file_sig TEXT,                     -- přílohy: mtime:velikost nahraného souboru
    remote_key TEXT,                   -- přílohy: klíč obrázku na webu (/kronika/img/<key>)
    img_w INTEGER,                     -- přílohy: rozměry nahraného obrázku
    img_h INTEGER,
    PRIMARY KEY (local_type, local_id)
);
CREATE INDEX IF NOT EXISTS idx_published_remote ON published(remote_id);
CREATE TABLE IF NOT EXISTS published_links (
    src TEXT PRIMARY KEY,              -- faction_members:3:12, character_links:5, …
    remote_id INTEGER,
    hash TEXT,
    synced_at REAL
);
CREATE TABLE IF NOT EXISTS sync_conflicts (
    local_type TEXT NOT NULL,
    local_id INTEGER NOT NULL,
    remote_id INTEGER,
    kind TEXT,                         -- both | deleted_remote | deleted_local
    title TEXT,
    local_updated_at REAL,
    remote_updated_at REAL,
    PRIMARY KEY (local_type, local_id)
);
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
"""

IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.I)
ATT_ATTR_RE = re.compile(r'\sdata-att="(\d+)"')
SRC_ATTR_RE = re.compile(r'\ssrc="[^"]*"')
WEB_IMG_RE = re.compile(r'\ssrc="(?:https?://[^"/]+)?/kronika/img/([A-Za-z0-9._-]+)"')
CHAR_ID_RE = re.compile(r'data-char-id="(\d+)"')
YT_RE = re.compile(r"(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/|v/))([A-Za-z0-9_-]{11})")
TAG_RE = re.compile(r"<[^>]+>")


class SyncError(Exception):
    """Chyba synchronizace s českou zprávou pro uživatele."""


class NetworkError(SyncError):
    """Server není dostupný – nemá smysl pokračovat s dalšími položkami."""


class PairingNeeded(SyncError):
    """Tahle databáze se s účtem ještě nesynchronizovala a na webu už jsou záznamy z desktopu."""


def youtube_id(s):
    """ID videa z odkazu na YouTube nebo přímo z ID; jinak None."""
    s = str(s or "").strip()
    if not s:
        return None
    m = YT_RE.search(s)
    if m:
        return m.group(1)
    return s if re.fullmatch(r"[A-Za-z0-9_-]{11}", s) else None


def check_url(url):
    """Adresa serveru: https (http jen pro localhost). Vrací normalizovanou adresu, jinak SyncError."""
    url = (url or DEFAULT_URL).strip().rstrip("/")
    u = urllib.parse.urlsplit(url)
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host:
        raise SyncError("Adresa serveru musí začínat https://")
    if u.scheme != "https" and host not in LOCAL_HOSTS and not host.endswith(".localhost"):
        raise SyncError("Adresa serveru musí být https:// (http jde jen pro lokální vývoj).")
    return url


def ensure_schema(db):
    db.executescript(SCHEMA)
    if "youtube" not in {r[1] for r in db.execute("PRAGMA table_info(media)")}:
        db.execute("ALTER TABLE media ADD COLUMN youtube TEXT")
    if "pending_hash" not in {r[1] for r in db.execute("PRAGMA table_info(published)")}:
        db.execute("ALTER TABLE published ADD COLUMN pending_hash TEXT")


def mask_token(tok):
    tok = str(tok or "")
    if not tok:
        return ""
    return tok[:6] + "…" + tok[-4:] if len(tok) > 12 else "…"


def _hash(payload):
    p = {k: v for k, v in payload.items() if k not in ("created_at", "updated_at", "added_at")}
    return hashlib.sha1(json.dumps(p, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _file_sig(path):
    try:
        st = Path(path).stat()
        return f"{int(st.st_mtime)}:{st.st_size}"
    except (OSError, TypeError):
        return None


def _text(html):
    return " ".join(TAG_RE.sub(" ", str(html or "")).split())


def _same_value(a, b):
    if a in (None, "") and b in (None, ""):
        return True
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    try:
        return abs(float(a) - float(b)) < 1e-6
    except (TypeError, ValueError):
        return str(a) == str(b)


# ---------------------------------------------------------------- HTTP klient
class Client:
    def __init__(self, url, token, timeout=60):
        self.base = check_url(url) + "/kronika/api"
        self.token = (token or "").strip()
        self.timeout = timeout

    def request(self, method, path, body=None, data=None, ctype=None, query=None):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        headers = {"Authorization": f"Bearer {self.token}", "User-Agent": "Kronikar-desktop/1.0",
                   "Accept": "application/json"}
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
            ctype = "application/json"
        if ctype:
            headers["Content-Type"] = ctype
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            msg = ""
            try:
                msg = json.loads(e.read().decode("utf-8")).get("error") or ""
            except Exception:
                pass
            if e.code == 401:
                raise SyncError(msg or "Neplatný API token – vytvoř nový na webu (Nastavení → Synchronizace).")
            if e.code == 404 and not msg:
                msg = "Adresa neexistuje – zkontroluj adresu serveru."
            err = SyncError(f"Server odmítl požadavek ({e.code}): {msg or e.reason}")
            err.status = e.code
            raise err
        except urllib.error.URLError as e:
            raise NetworkError(f"Server {self.base} není dostupný: {e.reason}")
        except (TimeoutError, OSError) as e:
            raise NetworkError(f"Spojení se serverem selhalo: {e}")
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            raise SyncError("Server vrátil nečitelnou odpověď – je adresa serveru správně?")

    def get_bytes(self, path):
        url = self.base.rsplit("/api", 1)[0] + path
        req = urllib.request.Request(url, headers={"User-Agent": "Kronikar-desktop/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return r.read(), (r.headers.get("Content-Type") or "").split(";")[0]
        except urllib.error.HTTPError as e:
            raise SyncError(f"Obrázek {path} se nepodařilo stáhnout ({e.code}).")
        except (urllib.error.URLError, OSError) as e:
            raise NetworkError(f"Obrázek {path} se nepodařilo stáhnout: {e}")


# ---------------------------------------------------------------- obrázky
def prepare_image(path, mime=None):
    """Obrázek pro web: zmenšený na ≤ 1600 px, WebP (nebo JPEG). Vrací (bytes, mime, w, h)."""
    p = Path(path)
    mime = mime or mimetypes.guess_type(str(p))[0] or ""
    try:
        raw = p.read_bytes()
    except OSError as e:
        raise SyncError(f"Obrázek {p.name} nejde přečíst: {e}")
    try:
        from PySide6.QtCore import QBuffer, QByteArray, QIODevice, Qt
        from PySide6.QtGui import QImage
    except ImportError:
        QImage = None
    if QImage is not None and mime != "image/gif":
        img = QImage()
        if img.loadFromData(raw):
            if max(img.width(), img.height()) > MAX_PX:
                img = img.scaled(MAX_PX, MAX_PX, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            for fmt, mt in (("WEBP", "image/webp"), ("JPG", "image/jpeg")):
                ba = QByteArray()
                buf = QBuffer(ba)
                buf.open(QIODevice.WriteOnly)
                src = img if fmt == "WEBP" or not img.hasAlphaChannel() else img.convertToFormat(QImage.Format_RGB32)
                ok = src.save(buf, fmt, 85)
                buf.close()
                if ok and ba.size():
                    return bytes(ba.data()), mt, img.width(), img.height()
    if mime in UPLOAD_MIME and len(raw) <= 8 * 1024 * 1024:
        return raw, mime, None, None
    raise SyncError(f"Obrázek {p.name} se nepodařilo připravit k nahrání (nepodporovaný formát nebo větší než 8 MB).")


# ---------------------------------------------------------------- synchronizace
class Syncer:
    def __init__(self, db_path, settings, att_dir, client=None, progress=None, cancel=None):
        self.db = sqlite3.connect(str(db_path), timeout=30, isolation_level=None)   # autocommit
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        ensure_schema(self.db)
        self.db_path = Path(db_path)
        self.settings = settings
        self.att_dir = Path(att_dir)
        self.letters = bool(settings.get("sync_letters"))
        self.progress = progress or (lambda msg: None)
        self.cancel = cancel or threading.Event()
        self.client = client or Client(settings.get("sync_url") or DEFAULT_URL, settings.get("sync_token"))
        self.cols = {t: {r[1] for r in self.db.execute(f"PRAGMA table_info({t})")} for t in ORDER}
        self.off = int(self.state("id_offset", 0) or 0)
        self.att_paths = {}
        self.files = {}
        self.stats = {"sent": 0, "created_remote": 0, "uploaded": 0, "deleted_remote": 0,
                      "received": 0, "created_local": 0, "deleted_local": 0, "conflicts": 0}
        self.warnings = []

    def close(self):
        self.db.close()

    def check_cancel(self):
        if self.cancel.is_set():
            raise SyncError("Synchronizace přerušena.")

    @contextmanager
    def tx(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        self.db.execute("COMMIT")

    def warn(self, msg):
        if msg not in self.warnings:
            self.warnings.append(msg)

    # ---------- src (posun id u „nové kopie“ databáze)
    def src(self, table, lid):
        return f"{table}:{int(lid) + self.off}"

    def unsrc(self, src):
        m = re.fullmatch(r"([a-z_]+):(\d+)", str(src or ""))
        if not m or int(m.group(2)) <= self.off:
            return None, None
        return m.group(1), int(m.group(2)) - self.off

    def link_src(self, table, *ids):
        return table + ":" + ":".join(str(int(i) + self.off) for i in ids)

    # ---------- stav
    def state(self, key, default=None):
        r = self.db.execute("SELECT value FROM sync_state WHERE key=?", (key,)).fetchone()
        return json.loads(r[0]) if r else default

    def set_state(self, key, value):
        self.db.execute("INSERT INTO sync_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, json.dumps(value, ensure_ascii=False)))

    def pub(self, table, lid):
        r = self.db.execute("SELECT * FROM published WHERE local_type=? AND local_id=?", (table, lid)).fetchone()
        return dict(r) if r else None

    def pub_by_remote(self, rid):
        r = self.db.execute("SELECT * FROM published WHERE remote_id=?", (rid,)).fetchone()
        return dict(r) if r else None

    def set_pub(self, table, lid, **f):
        f["synced_at"] = time.time()
        if self.pub(table, lid):
            self.db.execute(f"UPDATE published SET {', '.join(k + '=?' for k in f)} WHERE local_type=? AND local_id=?",
                            list(f.values()) + [table, lid])
        else:
            f.update(local_type=table, local_id=lid)
            self.db.execute(f"INSERT INTO published ({', '.join(f)}) VALUES ({', '.join('?' * len(f))})", list(f.values()))

    def drop_pub(self, table, lid):
        self.db.execute("DELETE FROM published WHERE local_type=? AND local_id=?", (table, lid))
        self.db.execute("DELETE FROM sync_conflicts WHERE local_type=? AND local_id=?", (table, lid))

    def local_id(self, table, remote_id):
        if remote_id in (None, ""):
            return None
        r = self.db.execute("SELECT local_id FROM published WHERE local_type=? AND remote_id=?",
                            (table, remote_id)).fetchone()
        return r[0] if r else None

    def row(self, table, lid):
        r = self.db.execute(f"SELECT * FROM {table} WHERE id=?", (lid,)).fetchone()
        return dict(r) if r else None

    def conflicts(self):
        return [dict(r) for r in self.db.execute("SELECT * FROM sync_conflicts ORDER BY local_type, local_id")]

    def conflict_keys(self):
        return {(r[0], r[1]) for r in self.db.execute("SELECT local_type, local_id FROM sync_conflicts")}

    def add_conflict(self, table, lid, remote, kind, local_row=None):
        local_row = local_row or self.row(table, lid) or {}
        title = (local_row.get("name") or local_row.get("title") or local_row.get("orig_name")
                 or (remote or {}).get("title") or f"#{lid}")
        self.db.execute(
            "INSERT INTO sync_conflicts (local_type, local_id, remote_id, kind, title, local_updated_at, remote_updated_at) "
            "VALUES (?,?,?,?,?,?,?) ON CONFLICT(local_type, local_id) DO UPDATE SET remote_id=excluded.remote_id, "
            "kind=excluded.kind, remote_updated_at=excluded.remote_updated_at",
            (table, lid, (remote or {}).get("id"), kind, str(title)[:200],
             local_row.get("updated_at") or local_row.get("created_at"), (remote or {}).get("updated_at")))

    def _clear_mapping(self):
        with self.tx():
            for t in ("published", "published_links", "sync_conflicts"):
                self.db.execute(f"DELETE FROM {t}")
            self.set_state("last_sync", 0)

    # ---------- účet a databáze
    def check_account(self):
        me = self.client.request("GET", "/me")
        user = me.get("user")
        if not user:
            raise SyncError("Server token nepřijal – vytvoř nový na webu (Nastavení → Synchronizace).")
        prev = self.state("account")
        uid = str(user["id"])
        if prev is not None and str(prev).rsplit("|", 1)[-1] != uid:
            self._clear_mapping()                  # jiný účet → začít od nuly (adresa serveru nerozhoduje)
        self.set_state("account", uid)
        self.set_state("account_name", user.get("name") or "")
        return user

    def db_uuid(self):
        u = self.state("db_uuid")
        if not u:
            u = uuid.uuid4().hex
            self.set_state("db_uuid", u)
        return u

    def check_database(self, pairing=None):
        """Zná web tuhle databázi? Když ne a na webu už jsou záznamy z (jiné) desktopové databáze, zeptat se."""
        me_uuid = self.db_uuid()
        web_settings = self.client.request("GET", "/settings") or {}
        dbs = web_settings.get("desktop_dbs") or []
        if any(d.get("uuid") == me_uuid for d in dbs if isinstance(d, dict)):
            return
        n_pub = self.db.execute("SELECT COUNT(*) FROM published").fetchone()[0]
        if n_pub == 0 and pairing not in ("match", "copy"):
            full = self.client.request("GET", "/sync", query={"since": 0})
            if any(r.get("src") and not r.get("deleted") for r in full.get("records") or []):
                raise PairingNeeded("Tato databáze se s webem ještě nesynchronizovala, ale na webu už jsou záznamy "
                                    "z desktopu (jiná nebo obnovená databáze, nebo import na webu). Vyber, co s tím.")
        if pairing == "copy":
            self._clear_mapping()
            self.off = (secrets.randbelow(8_999) + 1) * 1_000_000_000     # src této kopie se nepotkají s ostatními
            self.set_state("id_offset", self.off)
        dbs = [d for d in dbs if isinstance(d, dict)] + [{
            "uuid": me_uuid, "name": f"{socket.gethostname()} – {self.db_path.name}", "first_sync": time.time(),
            "mode": pairing or "new"}]
        self.client.request("PUT", "/settings", dict(web_settings, desktop_dbs=dbs[-50:]))

    # ---------- lokální data → řádky pro web
    def _body_out(self, html, keys):
        """Obrázky vložené do textu (data-att) odkazují na web (/kronika/img/<key>)."""
        if not html or "<img" not in html:
            return html

        def fix(m):
            tag = m.group(0)
            a = ATT_ATTR_RE.search(tag)
            if not a or not keys.get(int(a.group(1))):
                return tag
            url = f' src="/kronika/img/{keys[int(a.group(1))]}"'
            return SRC_ATTR_RE.sub(url, tag, count=1) if SRC_ATTR_RE.search(tag) else tag[:4] + url + tag[4:]
        return IMG_TAG_RE.sub(fix, html)

    def collect(self):
        """Všechny řádky, které patří na web: {tabulka: {id: řádek}}, vazby {src: (tabulka, id pro smazání, řádek)}.
        Řádky obsahují jen povolené sloupce (COLS)."""
        from .store import Media
        q = lambda sql, a=(): [dict(r) for r in self.db.execute(sql, a)]
        pick = lambda t, r: {k: r.get(k) for k in COLS[t] if k in r}
        imgs = {r["local_id"]: r for r in q("SELECT local_id, remote_key, img_w, img_h FROM published "
                                            "WHERE local_type='attachments' AND remote_key IS NOT NULL")}
        keys = {k: v["remote_key"] for k, v in imgs.items()}
        rows = {}
        for t in ("servers", "players", "factions", "characters", "places", "entries"):
            rows[t] = {r["id"]: pick(t, r) for r in q(f"SELECT * FROM {t}")}
        ev_tags = {}
        for r in q("SELECT event_id, tag FROM event_tags ORDER BY tag"):
            ev_tags.setdefault(r["event_id"], []).append(r["tag"])
        rows["events"] = {}
        for r in q("SELECT * FROM events"):
            e = pick("events", r)
            e["tags"] = ev_tags.get(r["id"], [])
            rows["events"][r["id"]] = e
        rows["letters"] = {r["id"]: pick("letters", r) for r in q("SELECT * FROM letters")} if self.letters else {}
        mtags = {}
        for r in q("SELECT media_id, tag FROM media_tags ORDER BY tag"):
            mtags.setdefault(r["media_id"], []).append(r["tag"])
        rows["media"] = {}
        for r in q("SELECT * FROM media WHERE youtube IS NOT NULL AND youtube <> ''"):
            m = Media(r)
            rows["media"][r["id"]] = {
                "id": r["id"], "youtube": r["youtube"], "title": m.display_title, "description": r["description"] or "",
                "game": r["game"] or "", "start_time": r["start_time"], "duration": r["duration"],
                "favorite": 1 if r["favorite"] else 0, "server_id": r["server_id"], "kind": m.effective_kind,
                "tags": mtags.get(r["id"], []), "created_at": r["added_at"]}
        rows["bookmarks"] = {r["id"]: pick("bookmarks", r) for r in q("SELECT * FROM bookmarks WHERE hidden=0")
                             if r["media_id"] in rows["media"]}
        rows["attachments"] = {}
        self.att_paths = {}
        for r in q("SELECT * FROM attachments WHERE kind='image'"):
            ot = OWNER_TABLE.get(r["owner_type"])
            if not ot or r["owner_id"] not in rows[ot]:
                continue
            a = pick("attachments", r)
            im = imgs.get(r["id"]) or {}
            a["key"], a["w"], a["h"] = im.get("remote_key"), im.get("img_w"), im.get("img_h")
            rows["attachments"][r["id"]] = a
            self.att_paths[r["id"]] = r["path"]
        for t in ("events", "entries", "characters", "factions", "places"):
            for r in rows[t].values():
                if r.get("body_html"):
                    r["body_html"] = self._body_out(r["body_html"], keys)
        # vazby
        links = {}
        lp = lambda t, r: {k: r.get(k) for k in LINK_COLS[t]}
        for r in q("SELECT * FROM faction_members"):
            links[self.link_src("faction_members", r["faction_id"], r["character_id"])] = (
                "faction_members", f"{r['faction_id'] + self.off}:{r['character_id'] + self.off}", lp("faction_members", r))
        for r in q("SELECT * FROM character_links WHERE source <> 'mention'"):
            tgt = CL_TARGET.get(r["target_type"])
            if tgt and r["target_id"] in rows[tgt[0]]:
                links[self.link_src("character_links", r["id"])] = ("character_links", r["id"] + self.off, lp("character_links", r))
        for r in q("SELECT * FROM character_relations"):
            links[self.link_src("character_relations", r["id"])] = ("character_relations", r["id"] + self.off, lp("character_relations", r))
        for r in q("SELECT * FROM event_links"):
            if r["media_id"] in rows["media"]:
                links[self.link_src("event_links", r["id"])] = ("event_links", r["id"] + self.off, lp("event_links", r))
        return rows, links

    def _shift(self, table, row):
        """Řádek pro /import s id posunutými o offset kopie (server páruje podle "<tabulka>:<id>")."""
        if not self.off:
            return row
        o, r = self.off, dict(row)
        sh = lambda v: v + o if isinstance(v, int) else v
        if "id" in r:
            r["id"] = sh(r["id"])
        for k in FK.get(table, {}):
            if k in r:
                r[k] = sh(r[k])
        if table in ("places", "attachments") and "owner_id" in r:
            r["owner_id"] = sh(r["owner_id"])
        if table == "letters" and r.get("recipient_ids"):
            try:
                r["recipient_ids"] = json.dumps([sh(i) for i in json.loads(r["recipient_ids"])])
            except (ValueError, TypeError):
                pass
        if r.get("body_html"):
            r["body_html"] = CHAR_ID_RE.sub(lambda m: f'data-char-id="{int(m.group(1)) + o}"', r["body_html"])
        for k in {"faction_members": ("faction_id", "character_id"), "character_links": ("character_id", "target_id"),
                  "character_relations": ("a_id", "b_id"), "event_links": ("event_id", "media_id"),
                  "event_tags": ("event_id",)}.get(table, ()):
            r[k] = sh(r[k])
        return r

    def _parent(self, table, row):
        """Nadřazený řádek (kvůli konfliktům: potomek konfliktního záznamu se neposílá)."""
        if table == "entries":
            return "events", row.get("event_id")
        if table == "events" and row.get("parent_id"):
            return "events", row["parent_id"]
        if table == "bookmarks":
            return "media", row.get("media_id")
        if table == "attachments":
            return OWNER_TABLE.get(row.get("owner_type")), row.get("owner_id")
        return None, None

    def _blocked(self, table, row, conflicts, rows):
        for _ in range(20):
            pt, pid = self._parent(table, row)
            if not pt or pid is None:
                return False
            if (pt, pid) in conflicts:
                return True
            table, row = pt, (rows.get(pt) or {}).get(pid) or {}
        return False

    def _clean(self, table, lid, local_rows):
        """Je řádek publikovaný a od poslední synchronizace nezměněný?"""
        p = self.pub(table, lid)
        lrow = local_rows.get(table, {}).get(lid)
        if not p or lrow is None or p.get("hash") is None:
            return False
        h = _hash(lrow)
        return h == p["hash"] or h == p.get("pending_hash")

    def _subtree(self, table, lid):
        """Co všechno by lokální smazání odneslo (kvůli kontrole před smazáním z webu)."""
        x = self.db.execute
        out = [(table, lid)]
        owners = []
        if table == "events":
            ids, frontier = [], [lid]
            while frontier:
                cur = frontier.pop()
                ids.append(cur)
                frontier += [r[0] for r in x("SELECT id FROM events WHERE parent_id=?", (cur,))]
            out = [("events", e) for e in ids]
            for e in ids:
                owners.append(("event", e))
                for (en,) in x("SELECT id FROM entries WHERE event_id=?", (e,)).fetchall():
                    out.append(("entries", en))
                    owners.append(("entry", en))
        elif table == "entries":
            owners.append(("entry", lid))
        elif table in OWNER_TYPE:
            owners.append((OWNER_TYPE[table], lid))
        elif table == "media":
            row = self.row("media", lid)
            if row and str(row["path"]).startswith("http"):
                out += [("bookmarks", b) for (b,) in x("SELECT id FROM bookmarks WHERE media_id=? AND hidden=0", (lid,))]
        for ot, oid in owners:
            out += [("attachments", a) for (a,) in x("SELECT id FROM attachments WHERE owner_type=? AND owner_id=?", (ot, oid))]
        return out

    # ---------- pull: změny z webu do SQLite
    def apply_remote(self, records, links, echo=frozenset(), force=False, adopt=False):
        """Promítne záznamy z webu. echo = src vlastních změn z tohoto běhu (jen se zapíše revize).
        adopt = spárovat záznamy se src i bez mapy (po volbě „Spárovat podle id“)."""
        local_rows, _ = self.collect()
        conflicts = set() if force else self.conflict_keys()
        creates, updates, meta = [], [], []
        gone = {r["id"] for r in records if r.get("deleted")}
        with self.tx():
            for r in records:
                table = TYPE_TABLE.get(r.get("type"))
                if not table:
                    continue
                p = self.pub_by_remote(r["id"])
                if p and p["local_type"] != table:
                    p = None
                stable, sid = self.unsrc(r.get("src"))
                if not p and stable == table:
                    p = self.pub(table, sid)
                    if not p:
                        if not r.get("deleted") and self.row(table, sid) is not None:
                            self._adopt(table, sid, r, local_rows)
                        continue
                if table == "letters" and not self.letters and not p:
                    continue
                if r.get("src") in echo:
                    if r.get("deleted"):
                        if p:
                            self.drop_pub(table, p["local_id"])
                    elif p:
                        self.set_pub(table, p["local_id"], remote_id=r["id"], rev=r.get("rev"),
                                     visibility=r.get("visibility"), pending_hash=None)
                    continue
                if not p:
                    if not r.get("deleted") and not r.get("src"):
                        creates.append((table, r))
                    continue
                lid = p["local_id"]
                local = self.row(table, lid)
                lrow = local_rows.get(table, {}).get(lid)
                local_changed = lrow is not None and not self._clean(table, lid, local_rows)
                if (table, lid) in conflicts:
                    self.add_conflict(table, lid, r, "deleted_remote" if r.get("deleted") else
                                      ("deleted_local" if local is None else "both"))
                    continue
                if r.get("deleted"):
                    if local is None:
                        self.drop_pub(table, lid)
                    elif table == "bookmarks" and (r.get("data") or {}).get("media_id") in gone:
                        self.drop_pub(table, lid)          # video zmizelo z webu, lokální záložky zůstávají
                    elif not force and not all(self._clean(t, i, local_rows) for t, i in self._subtree(table, lid)):
                        # lokálně změněné nebo nepublikované (nový zápis, podudálost, soubor…) → nic nemazat
                        self.add_conflict(table, lid, r, "deleted_remote", local)
                    else:
                        self.delete_local(table, lid)
                        self.drop_pub(table, lid)
                        self.stats["deleted_local"] += 1
                    continue
                if p.get("rev") is not None and p["rev"] == r.get("rev") and not force:
                    # obsah se nezměnil (jen viditelnost, src apod.)
                    self.set_pub(table, lid, remote_id=r["id"], visibility=r.get("visibility"))
                    continue
                if local is None:
                    if force:
                        creates.append((table, r))
                        self.drop_pub(table, lid)
                    else:
                        self.add_conflict(table, lid, r, "deleted_local")
                    continue
                if local_changed and not force:
                    self.add_conflict(table, lid, r, "both", local)
                    continue
                updates.append((table, lid, r))

        # 1) stáhnout obrázky – mimo transakci
        for table, r in creates:
            if table == "attachments":
                self._fetch(r)
        for table, lid, r in updates:
            if table == "attachments":
                p = self.pub(table, lid) or {}
                if r["data"].get("key") and p.get("remote_key") != r["data"]["key"]:
                    self._fetch(r)

        with self.tx():
            # 2) založit nové lokální řádky (s minimem údajů, kvůli cizím klíčům)
            creates.sort(key=lambda x: ORDER.index(x[0]))
            for table, r in creates:
                lid = self.create_local(table, r)
                if lid is None:
                    continue
                self.set_pub(table, lid, remote_id=r["id"], rev=r.get("rev"), visibility=r.get("visibility"))
                if table == "attachments":
                    self.db.execute("UPDATE published SET remote_key=?, file_sig=?, img_w=?, img_h=? WHERE local_type=? AND local_id=?",
                                    (r["data"].get("key"), _file_sig(self.row(table, lid)["path"]),
                                     r["data"].get("w"), r["data"].get("h"), table, lid))
                meta.append({"op": "meta", "id": r["id"], "src": self.src(table, lid)})
                updates.append((table, lid, r))
                self.stats["created_local"] += 1
            # 3) zapsat údaje (cizí klíče přes mapu)
            updates.sort(key=lambda x: ORDER.index(x[0]))
            done = []
            for table, lid, r in updates:
                if self.write_local(table, lid, r) is not False:
                    done.append((table, lid, r))
            # 4) otisky po zápisu, ať se změny z webu neposílají zpátky
            if done:
                fresh, _ = self.collect()
                for table, lid, r in done:
                    lrow = fresh.get(table, {}).get(lid)
                    self.set_pub(table, lid, remote_id=r["id"], rev=r.get("rev"), visibility=r.get("visibility"),
                                 hash=_hash(lrow) if lrow is not None else None, pending_hash=None)
                    self.db.execute("DELETE FROM sync_conflicts WHERE local_type=? AND local_id=?", (table, lid))
                self.stats["received"] += len(done)
            # 5) vazby
            unlink = self.apply_links(links, echo)
        ops = meta + [{"op": "unlink", "id": i} for i in unlink]
        for i in range(0, len(ops), 400):
            self.check_cancel()
            part = ops[i:i + 400]
            try:
                self.client.request("POST", "/ops", {"ops": part})
            except NetworkError:
                raise
            except SyncError:
                for op in part:      # po jedné, ať jedna chyba nezastaví ostatní
                    try:
                        self.client.request("POST", "/ops", {"ops": [op]})
                    except NetworkError:
                        raise
                    except SyncError as e:
                        self.warn(f"Záznam {op.get('src') or op.get('id')} se na webu nepodařilo označit: {e}")

    def _adopt(self, table, lid, r, local_rows):
        """Záznam se src, ke kterému tu chybí mapa (import catalog.db na webu, „Spárovat podle id“).
        Stejný obsah → spárovat a poslat (doplní obrázky apod.); jiný obsah → konflikt, nic se neposílá naslepo."""
        self.set_pub(table, lid, remote_id=r["id"], rev=r.get("rev"), visibility=r.get("visibility"))
        lrow = local_rows.get(table, {}).get(lid)
        if lrow is None or not self._same(table, lrow, r):
            self.add_conflict(table, lid, r, "both")

    def _same(self, table, lrow, r):
        d = r.get("data") or {}
        for k, v in d.items():
            if k not in lrow or k in ("id", "created_at", "updated_at", "tags", "owner_id", "recipient_ids", "kind") \
                    or k in FK.get(table, {}):
                continue
            if k == "body_html":
                if _text(lrow[k]) != _text(v):
                    return False
            elif not _same_value(lrow[k], v):
                return False
        return True

    def _fetch(self, r):
        key = r["data"].get("key")
        if not key or key in self.files:
            return
        self.check_cancel()
        try:
            self.files[key] = self.download(key)
        except NetworkError:
            raise
        except (SyncError, OSError) as e:
            self.files[key] = None
            self.warn(f"Obrázek „{r.get('title') or key}“ z webu se nepodařilo stáhnout: {e}")

    def create_local(self, table, r):
        d = r.get("data") or {}
        now = r.get("created_at") or time.time()
        f = {}
        if table == "servers":
            f = {"game": d.get("game") or "", "name": d.get("name") or "Server"}
        elif table in ("players", "factions", "characters", "places"):
            f = {"name": d.get("name") or r.get("title") or "Bez jména"}
        elif table == "events":
            f = {"title": d.get("title") or r.get("title") or "Událost"}
        elif table == "entries":
            ev = self.local_id("events", d.get("event_id"))
            if ev is None:
                return None
            f = {"event_id": ev}
        elif table == "media":
            yt = youtube_id(d.get("youtube"))
            if not yt:
                return None
            path = f"https://www.youtube.com/watch?v={yt}"
            ex = self.db.execute("SELECT id FROM media WHERE path=? OR youtube=?", (path, yt)).fetchone()
            if ex:
                if self.pub("media", ex[0]):
                    # stejné video už je na webu jako jiný záznam – nic nepřepisovat
                    self.warn(f"Video „{r.get('title') or yt}“ je na webu dvakrát (YouTube {yt}) – "
                              "nadbytečný záznam na webu smaž, tady jsem ho nepřevzal.")
                    return None
                return ex[0]
            f = {"path": path, "kind": "manual", "youtube": yt, "game": d.get("game") or "",
                 "start_time": d.get("start_time"), "duration": d.get("duration"), "added_at": now, "scanned_at": now}
            cur = self.db.execute(f"INSERT INTO media ({', '.join(f)}) VALUES ({', '.join('?' * len(f))})", list(f.values()))
            return cur.lastrowid
        elif table == "bookmarks":
            mid = self.local_id("media", d.get("media_id"))
            if mid is None:
                return None
            f = {"media_id": mid, "t": d.get("t") or 0, "source": "manual"}
        elif table == "letters":
            f = {}
        elif table == "attachments":
            ot = d.get("owner_type")
            oid = self.local_id(OWNER_TABLE.get(ot, ""), d.get("owner_id"))
            path = self.files.get(d.get("key"))
            if oid is None or not path:
                return None
            f = {"owner_type": ot, "owner_id": oid, "path": str(path), "orig_name": d.get("orig_name") or path.name,
                 "mime": d.get("mime") or mimetypes.guess_type(str(path))[0], "kind": "image",
                 "size": path.stat().st_size}
        if "created_at" in self.cols[table]:
            f["created_at"] = now
        if "updated_at" in self.cols[table]:
            f["updated_at"] = r.get("updated_at") or now
        cur = self.db.execute(f"INSERT INTO {table} ({', '.join(f)}) VALUES ({', '.join('?' * len(f))})"
                              if f else f"INSERT INTO {table} DEFAULT VALUES", list(f.values()))
        return cur.lastrowid

    def download(self, key):
        data, ctype = self.client.get_bytes(f"/img/{key}")
        ext = Path(key).suffix or mimetypes.guess_extension(ctype or "") or ".bin"
        dst = self.att_dir / time.strftime("%Y%m") / f"web-{uuid.uuid4().hex[:10]}{ext}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        return dst

    def _published_keys(self):
        return {r[0] for r in self.db.execute(
            "SELECT local_id FROM published WHERE local_type='attachments' AND remote_key IS NOT NULL")}

    def _body_in(self, html, old_html=None):
        """Text z webu: zmínky postav a obrázky zpátky na lokální id. Lokálně vložené obrázky,
        které na web (zatím) nešly, se zachovají."""
        if not html:
            html = html or ""

        def ch(m):
            lid = self.local_id("characters", int(m.group(1)))
            return f'data-char-id="{lid}"' if lid else ""
        html = CHAR_ID_RE.sub(ch, html)

        def img(m):
            tag = m.group(0)
            w = WEB_IMG_RE.search(tag)
            if not w:
                return tag
            r = self.db.execute("SELECT a.id, a.path FROM published p JOIN attachments a ON a.id=p.local_id "
                                "WHERE p.local_type='attachments' AND p.remote_key=?", (w.group(1),)).fetchone()
            if not r:
                return tag
            tag = WEB_IMG_RE.sub(f' src="{Path(r[1]).resolve().as_uri()}"', tag, count=1)
            return tag if "data-att=" in tag else tag[:4] + f' data-att="{r[0]}"' + tag[4:]
        html = IMG_TAG_RE.sub(img, html)
        if old_html and "<img" in old_html:
            pubs = self._published_keys()
            keep = [t for t in IMG_TAG_RE.findall(old_html)
                    if (a := ATT_ATTR_RE.search(t)) and int(a.group(1)) not in pubs and f'data-att="{a.group(1)}"' not in html]
            if keep:
                html += "".join(f"<p>{t}</p>" for t in keep)
        return html

    def _fk_keep_local(self, table, k, local_val):
        """Web posílá u cizího klíče null/neznámé id – lokální hodnota ukazuje na nepublikovaný cíl → ponechat."""
        return local_val not in (None, "") and self.pub(FK[table][k], local_val) is None

    def write_local(self, table, lid, r):
        d = dict(r.get("data") or {})
        cols = self.cols[table]
        local = self.row(table, lid) or {}
        web_only_media = table == "media" and str(local.get("path") or "").startswith("http")
        vals = {}
        for k, v in d.items():
            if k in ("id", "created_at", "updated_at", "contact", "tags", "path") or k not in cols:
                continue
            if table == "media" and not web_only_media and k not in MEDIA_PULL:
                continue
            if table == "attachments" and k in ("owner_id", "kind", "size"):
                continue
            if k in FK.get(table, {}):
                mapped = self.local_id(FK[table][k], v) if v not in (None, "") else None
                if mapped is None and self._fk_keep_local(table, k, local.get(k)):
                    continue
                v = mapped
            if k == "youtube":
                v = youtube_id(v)
            if v is None and k in NOT_NULL.get(table, ()):
                continue
            if isinstance(v, bool):
                v = int(v)
            elif isinstance(v, (list, dict)):
                v = json.dumps(v, ensure_ascii=False)
            vals[k] = v
        if table == "places" and "owner_id" in d:
            ot = d.get("owner_type") or ""
            vals["owner_id"] = self.local_id("factions" if ot == "faction" else "characters", d.get("owner_id")) \
                if ot in ("faction", "character") else None
        if table == "attachments":
            oid = self.local_id(OWNER_TABLE.get(d.get("owner_type"), ""), d.get("owner_id"))
            if oid is not None:
                vals["owner_id"] = oid
            else:
                vals.pop("owner_type", None)
            p = self.pub(table, lid)
            if d.get("key") and p and p.get("remote_key") != d["key"]:
                path = self.files.get(d["key"])        # obrázek se na webu vyměnil
                if not path:
                    return False                       # nepodařilo se stáhnout – zkusí se příště
                old = local.get("path")
                vals.update(path=str(path), size=path.stat().st_size)
                self.db.execute("UPDATE published SET remote_key=?, file_sig=? WHERE local_type=? AND local_id=?",
                                (d["key"], _file_sig(path), table, lid))
                self._remove_published_file(lid, old)
        if table == "letters" and "recipient_ids" in d:
            ids = d["recipient_ids"] if isinstance(d["recipient_ids"], list) else []
            vals["recipient_ids"] = json.dumps([x for x in (self.local_id("characters", i) for i in ids) if x])
        if "body_html" in vals:
            vals["body_html"] = self._body_in(vals["body_html"], local.get("body_html"))
        if "updated_at" in cols:
            vals["updated_at"] = r.get("updated_at") or time.time()
        if vals:
            self.db.execute(f"UPDATE {table} SET {', '.join(k + '=?' for k in vals)} WHERE id=?",
                            list(vals.values()) + [lid])
        if table == "events" and "tags" in d:
            self.db.execute("DELETE FROM event_tags WHERE event_id=?", (lid,))
            self.db.executemany("INSERT OR IGNORE INTO event_tags VALUES (?,?)", [(lid, t) for t in d["tags"] or []])
        if table == "media" and "tags" in d:
            self.db.execute("DELETE FROM media_tags WHERE media_id=?", (lid,))
            self.db.executemany("INSERT OR IGNORE INTO media_tags VALUES (?,?)", [(lid, t) for t in d["tags"] or []])
        if "body_html" in vals and table in MENTION_TYPE:
            tt = MENTION_TYPE[table]
            ids = {int(x) for x in CHAR_ID_RE.findall(vals["body_html"] or "")}
            if table == "characters":
                ids.discard(lid)
            self.db.execute("DELETE FROM character_links WHERE target_type=? AND target_id=? AND source='mention'", (tt, lid))
            valid = {x[0] for x in self.db.execute("SELECT id FROM characters")}
            self.db.executemany("INSERT OR IGNORE INTO character_links (character_id, target_type, target_id, role, source) "
                                "VALUES (?,?,?, '', 'mention')", [(c, tt, lid) for c in ids if c in valid])

    def _remove_published_file(self, aid, path):
        """Z disku mažeme jen soubory obrázků, které jsou publikované na webu (ostatní nikdy)."""
        p = self.pub("attachments", aid)
        if not p or not p.get("remote_key"):
            return
        try:
            f = Path(path).resolve()
            if self.att_dir.resolve() in f.parents and f.exists():
                f.unlink()
        except (OSError, TypeError):
            pass

    def _drop_attachment(self, aid):
        row = self.row("attachments", aid)
        if row:
            self._remove_published_file(aid, row["path"])
        self.db.execute("DELETE FROM attachments WHERE id=?", (aid,))

    def delete_local(self, table, lid):
        """Smazání na webu → smazat i tady (stejně jako to dělá aplikace). Volá se jen po kontrole podstromu
        (nebo po výslovné volbě „Vzít z webu“)."""
        x = self.db.execute
        if table == "events":
            ids, frontier = [], [lid]
            while frontier:
                cur = frontier.pop()
                ids.append(cur)
                frontier += [r[0] for r in x("SELECT id FROM events WHERE parent_id=?", (cur,))]
            for eid in ids:
                for (en,) in x("SELECT id FROM entries WHERE event_id=?", (eid,)).fetchall():
                    self._delete_owner_files("entry", en)
                    x("DELETE FROM character_links WHERE target_type='entry' AND target_id=?", (en,))
                self._delete_owner_files("event", eid)
                x("DELETE FROM character_links WHERE target_type='event' AND target_id=?", (eid,))
            x("DELETE FROM events WHERE id=?", (lid,))
        elif table == "entries":
            self._delete_owner_files("entry", lid)
            x("DELETE FROM character_links WHERE target_type='entry' AND target_id=?", (lid,))
            x("DELETE FROM entries WHERE id=?", (lid,))
        elif table in ("characters", "factions", "places", "players"):
            self._delete_owner_files(OWNER_TYPE[table], lid)
            if table == "places":
                x("UPDATE events SET place_id=NULL WHERE place_id=?", (lid,))
            if table == "players":
                x("UPDATE characters SET player_id=NULL WHERE player_id=?", (lid,))
            tt = {"characters": "character", "factions": "faction", "places": "place"}.get(table)
            if tt:
                x("DELETE FROM character_links WHERE target_type=? AND target_id=?", (tt, lid))
            x(f"DELETE FROM {table} WHERE id=?", (lid,))
        elif table == "servers":
            for t in ("media", "events", "characters", "factions", "places"):
                x(f"UPDATE {t} SET server_id=NULL WHERE server_id=?", (lid,))
            x("DELETE FROM servers WHERE id=?", (lid,))
        elif table == "media":
            row = self.row("media", lid)
            if row and str(row["path"]).startswith("http"):
                x("DELETE FROM media WHERE id=?", (lid,))      # video jen z webu
                x("DELETE FROM character_links WHERE target_type='bookmark' AND target_id NOT IN (SELECT id FROM bookmarks)")
            else:
                x("UPDATE media SET youtube=NULL WHERE id=?", (lid,))   # soubor zůstává, jen už není na webu
        elif table == "bookmarks":
            row = self.row("bookmarks", lid)
            x("DELETE FROM character_links WHERE target_type='bookmark' AND target_id=?", (lid,))
            if row and row.get("medal_key"):
                x("UPDATE bookmarks SET hidden=1, event_id=NULL WHERE id=?", (lid,))
            else:
                x("DELETE FROM bookmarks WHERE id=?", (lid,))
        elif table == "attachments":
            self._drop_attachment(lid)
        elif table == "letters":
            x("DELETE FROM letters WHERE id=?", (lid,))

    def _delete_owner_files(self, owner_type, owner_id):
        for (aid,) in self.db.execute("SELECT id FROM attachments WHERE owner_type=? AND owner_id=?",
                                      (owner_type, owner_id)).fetchall():
            self._drop_attachment(aid)

    def apply_links(self, links, echo=frozenset()):
        """Vazby z webu. Vrací id vazeb založených na webu, které se mají na webu smazat
        (desktop je hned pošle znovu se src, aby se párovaly)."""
        unlink = []
        _, local_links = self.collect()
        for l in links:
            d = l.get("data") or {}
            if l.get("kind") == "char_link" and d.get("source") == "mention":
                continue                          # zmínky si obě strany počítají z textu
            src = l.get("src")
            if src in echo:
                continue
            if src:
                if self._link_where(src) is None:
                    continue                      # vazba jiné desktopové databáze
                pl = self.db.execute("SELECT * FROM published_links WHERE src=?", (src,)).fetchone()
                cur = local_links.get(src)
                if l.get("deleted"):
                    if cur and pl and _hash(cur[2]) != pl["hash"]:
                        continue                  # lokálně změněná vazba vyhrává (pošle se znovu)
                    self._delete_link(src)
                    self.db.execute("DELETE FROM published_links WHERE src=?", (src,))
                    continue
                if not cur or (pl and _hash(cur[2]) != pl["hash"]):
                    continue                      # lokálně smazaná nebo změněná → vyhrává desktop
                self._update_link(src, l)
                _, fresh = self.collect()
                if src in fresh:
                    self.db.execute("INSERT INTO published_links (src, remote_id, hash, synced_at) VALUES (?,?,?,?) "
                                    "ON CONFLICT(src) DO UPDATE SET remote_id=excluded.remote_id, hash=excluded.hash, "
                                    "synced_at=excluded.synced_at", (src, l["id"], _hash(fresh[src][2]), time.time()))
                    local_links = fresh
                continue
            if l.get("deleted"):
                continue
            if self._create_link(l):
                unlink.append(l["id"])
        return unlink

    def _link_where(self, src):
        t, _, rest = src.partition(":")
        try:
            ids = [int(i) - self.off for i in rest.split(":")]
        except ValueError:
            return None
        if any(i <= 0 for i in ids):
            return None
        if t == "faction_members" and len(ids) == 2:
            return t, "faction_id=? AND character_id=?", tuple(ids)
        if t in ("character_links", "character_relations", "event_links") and len(ids) == 1:
            return t, "id=?", tuple(ids)
        return None

    def _delete_link(self, src):
        w = self._link_where(src)
        if w:
            self.db.execute(f"DELETE FROM {w[0]} WHERE {w[1]}", w[2])

    def _update_link(self, src, l):
        t, where, args = self._link_where(src)
        d = l.get("data") or {}
        if t == "faction_members":
            self.db.execute(f"UPDATE faction_members SET role=?, position=? WHERE {where}", (l.get("role") or "", l.get("pos") or 0, *args))
        elif t == "character_links":
            self.db.execute(f"UPDATE character_links SET role=? WHERE {where}", (l.get("role") or "", *args))
        elif t == "character_relations":
            self.db.execute(f"UPDATE character_relations SET label=?, kind=?, note=? WHERE {where}",
                            (d.get("label") or "", d.get("kind") or "", d.get("note") or "", *args))
        elif t == "event_links":
            self.db.execute(f"UPDATE event_links SET offset=?, note=? WHERE {where}", (d.get("offset"), d.get("note") or "", *args))

    def _create_link(self, l):
        kind, d = l.get("kind"), l.get("data") or {}
        x = self.db.execute
        if kind == "member":
            f, c = self.local_id("factions", l["a_id"]), self.local_id("characters", l["b_id"])
            if not (f and c):
                return False
            x("INSERT INTO faction_members (faction_id, character_id, role, position) VALUES (?,?,?,?) "
              "ON CONFLICT(faction_id, character_id) DO UPDATE SET role=excluded.role, position=excluded.position",
              (f, c, l.get("role") or "", l.get("pos") or 0))
        elif kind == "relation":
            a, b = self.local_id("characters", l["a_id"]), self.local_id("characters", l["b_id"])
            if not (a and b):
                return False
            x("INSERT INTO character_relations (a_id, b_id, label, kind, note) VALUES (?,?,?,?,?)",
              (a, b, d.get("label") or "", d.get("kind") or "", d.get("note") or ""))
        elif kind == "char_link":
            tt = CL_FROM_WEB.get(d.get("target_type"), d.get("target_type"))
            if tt not in CL_TARGET:
                return False
            c, t = self.local_id("characters", l["a_id"]), self.local_id(CL_TARGET[tt][0], l["b_id"])
            if not (c and t):
                return False
            x("INSERT INTO character_links (character_id, target_type, target_id, role, source) VALUES (?,?,?,?, 'manual') "
              "ON CONFLICT(character_id, target_type, target_id, source) DO UPDATE SET role=excluded.role",
              (c, tt, t, l.get("role") or ""))
        elif kind == "event_link":
            e, m = self.local_id("events", l["a_id"]), self.local_id("media", l["b_id"])
            if not (e and m):
                return False
            x("INSERT INTO event_links (event_id, media_id, offset, note, created_at) VALUES (?,?,?,?,?)",
              (e, m, d.get("offset"), d.get("note") or "", l.get("created_at") or time.time()))
        else:
            return False
        return True

    # ---------- upload obrázků
    def upload_images(self, rows, skip=frozenset()):
        uploaded = {}
        for aid, a in rows["attachments"].items():
            self.check_cancel()
            if ("attachments", aid) in skip or self._blocked("attachments", a, skip, rows):
                continue
            path = self.att_paths.get(aid)
            p = self.pub("attachments", aid) or {}
            sig = _file_sig(path)
            if sig is None:
                continue                                  # soubor chybí
            if p.get("remote_key") and p.get("file_sig") == sig:
                continue
            name0 = a.get("orig_name") or Path(path).name
            self.progress(f"Nahrávám obrázek {name0}…")
            try:
                data, mime, w, h = prepare_image(path, a.get("mime"))
                name = Path(name0).stem + {"image/webp": ".webp", "image/jpeg": ".jpg"}.get(mime, Path(path).suffix)
                res = self.client.request("POST", "/upload", data=data, ctype=mime, query={
                    "src": self.src("attachments", aid), "name": name, "caption": a.get("caption") or "",
                    "taken_at": a.get("taken_at") or "", "w": w or "", "h": h or ""})
                rec = res.get("record") or {}
                key = (rec.get("data") or {}).get("key")
                if not key:
                    raise SyncError("server po nahrání nevrátil klíč obrázku")
            except NetworkError:
                raise
            except SyncError as e:
                self.warn(f"Obrázek „{name0}“ se nepodařilo nahrát: {e}")
                continue
            self.set_pub("attachments", aid, remote_id=rec.get("id"), rev=rec.get("rev"),
                         visibility=rec.get("visibility"), file_sig=sig, remote_key=key, img_w=w, img_h=h)
            a["key"], a["w"], a["h"] = key, w, h
            a["updated_at"] = rec.get("updated_at")      # ať to server nebere jako konflikt s vlastním nahráním
            uploaded[self.src("attachments", aid)] = rec
            self.stats["uploaded"] += 1
        return uploaded

    # ---------- push
    def push(self, rows, links, base, only=None, force=False):
        """Pošle změněné řádky. only = {(tabulka, id)} pro vynucené odeslání vybraných řádků."""
        skip = set() if only else self.conflict_keys()
        tables, sent = {}, {}
        for table, rs in rows.items():
            for lid, r in rs.items():
                if only is not None and (table, lid) not in only:
                    continue
                if (table, lid) in skip or (only is None and self._blocked(table, r, skip, rows)):
                    continue
                p = self.pub(table, lid)
                h = _hash(r)
                if only is None and p and p.get("hash") == h:
                    continue
                if table == "attachments" and not r.get("key"):
                    continue                          # obrázek se nepodařilo nahrát
                tables.setdefault(table, []).append(self._shift(table, r))
                sent[self.src(table, lid)] = (table, lid, h)
        if "events" in tables:
            tables["event_tags"] = [{"event_id": e["id"], "tag": t} for e in tables["events"] for t in e.get("tags") or []]
        link_sent = {}
        if only is None:
            for src, (table, _, r) in links.items():
                h = _hash(r)
                pl = self.db.execute("SELECT hash FROM published_links WHERE src=?", (src,)).fetchone()
                if pl and pl[0] == h:
                    continue
                tables.setdefault(table, []).append(self._shift(table, r))
                link_sent[src] = h
        deleted, del_rows, del_links = [], [], []
        if only is None:
            for p in self.db.execute("SELECT local_type, local_id FROM published").fetchall():
                t, lid = p[0], p[1]
                if (t, lid) in skip or lid in rows.get(t, {}):
                    continue
                if t == "letters" and not self.letters:
                    continue
                deleted.append({"table": t, "id": lid + self.off})
                del_rows.append((t, lid))
            for (src,) in self.db.execute("SELECT src FROM published_links").fetchall():
                if src not in links:
                    t, _, rest = src.partition(":")
                    deleted.append({"table": t, "id": rest})
                    del_links.append(src)
        echo = set()
        if not tables and not deleted:
            return echo
        # co odchází, si poznamenat – kdyby se ztratila odpověď, nebude to příště vypadat jako lokální změna
        with self.tx():
            for src, (table, lid, h) in sent.items():
                if self.pub(table, lid):
                    self.db.execute("UPDATE published SET pending_hash=? WHERE local_type=? AND local_id=?", (h, table, lid))
        self.check_cancel()
        self.progress(f"Odesílám {sum(len(v) for v in tables.values())} řádků…")
        res = self.client.request("POST", "/import", {"tables": tables, "deleted": deleted, "base": base, "force": force})
        rmap = res.get("map") or {}
        conflicted = set()
        with self.tx():
            for c in res.get("conflicts") or []:
                t, lid = self.unsrc(c.get("src"))
                if t:
                    conflicted.add(c["src"])
                    self.add_conflict(t, lid, {"id": c.get("remote_id"), "updated_at": c.get("remote_updated_at")}, "both")
            for src, (table, lid, h) in sent.items():
                if src in conflicted or src not in rmap:
                    continue
                self.set_pub(table, lid, remote_id=rmap[src], hash=h, pending_hash=None)
                echo.add(src)
            for src, h in link_sent.items():
                rid = (res.get("links") or {}).get(src)
                if rid:
                    self.db.execute("INSERT INTO published_links (src, remote_id, hash, synced_at) VALUES (?,?,?,?) "
                                    "ON CONFLICT(src) DO UPDATE SET remote_id=excluded.remote_id, hash=excluded.hash, "
                                    "synced_at=excluded.synced_at", (src, rid, h, time.time()))
                    echo.add(src)
            for t, lid in del_rows:
                self.drop_pub(t, lid)
                echo.add(self.src(t, lid))
            for src in del_links:
                self.db.execute("DELETE FROM published_links WHERE src=?", (src,))
                echo.add(src)
        self.stats["sent"] += len([s for s in sent if s in rmap and s not in conflicted])
        self.stats["created_remote"] += res.get("created") or 0
        self.stats["deleted_remote"] += len(del_rows)
        return echo

    # ---------- celé kolo
    def run(self, pairing=None):
        """pairing: None | 'match' (spárovat podle id) | 'copy' (nahrát jako novou kopii)."""
        if not self.client.token:
            raise SyncError("Chybí osobní API token – vytvoř ho na webu v Nastavení a vlož ho sem.")
        self.progress("Ověřuji účet…")
        user = self.check_account()
        self.check_database(pairing)
        since = self.state("last_sync", 0) or 0
        self.check_cancel()
        self.progress("Stahuji změny z webu…")
        first = self.client.request("GET", "/sync", query={"since": since})
        n0 = first.get("now") or time.time()
        self.apply_remote(first.get("records") or [], first.get("links") or [])
        self.check_cancel()
        rows, links = self.collect()
        uploaded = self.upload_images(rows, self.conflict_keys())
        if uploaded:
            ups = dict(rows["attachments"])
            rows, links = self.collect()      # texty s vloženými obrázky už znají jejich adresu na webu
            for aid, a in ups.items():
                if aid in rows["attachments"] and a.get("updated_at"):
                    rows["attachments"][aid]["updated_at"] = a["updated_at"]
        self.check_cancel()
        echo = self.push(rows, links, base=n0)
        echo |= set(uploaded)
        self.progress("Kontroluji výsledek…")
        second = self.client.request("GET", "/sync", query={"since": n0})
        self.apply_remote(second.get("records") or [], second.get("links") or [], echo=frozenset(echo))
        self.set_state("last_sync", second.get("now") or n0)
        self.stats["conflicts"] = len(self.conflicts())
        result = dict(self.stats, at=time.time(), user=user.get("name"), warnings=self.warnings[:20])
        self.set_state("last_result", result)
        return result

    def resolve(self, items):
        """items: [{local_type, local_id, choice: 'mine'|'web'}] – vyřešení konfliktů."""
        base = self.state("last_sync", 0) or 0
        for it in items:
            self.check_cancel()
            table, lid, choice = it["local_type"], int(it["local_id"]), it["choice"]
            c = self.db.execute("SELECT * FROM sync_conflicts WHERE local_type=? AND local_id=?", (table, lid)).fetchone()
            if not c:
                continue
            c = dict(c)
            remote = None
            if c.get("remote_id"):
                try:
                    remote = self.client.request("GET", f"/records/{c['remote_id']}")
                except SyncError as e:
                    if getattr(e, "status", None) != 404:
                        raise
            self.db.execute("DELETE FROM sync_conflicts WHERE local_type=? AND local_id=?", (table, lid))
            if choice == "mine":
                rows, _ = self.collect()
                if lid in rows.get(table, {}):
                    if table == "attachments":
                        self.db.execute("UPDATE published SET file_sig=NULL WHERE local_type=? AND local_id=?", (table, lid))
                        self.upload_images({"attachments": {lid: rows[table][lid]}})
                    self.push(rows, {}, base=base, only={(table, lid)}, force=True)
                    p = self.pub(table, lid)
                    if p and p.get("remote_id"):
                        rec = self.client.request("GET", f"/records/{p['remote_id']}")
                        self.set_pub(table, lid, rev=rec.get("rev"), visibility=rec.get("visibility"))
                else:
                    self.client.request("POST", "/import", {"tables": {}, "deleted": [{"table": table, "id": lid + self.off}],
                                                            "base": base})
                    self.drop_pub(table, lid)
            else:
                if remote is None or remote.get("deleted"):
                    with self.tx():
                        if self.row(table, lid) is not None:
                            self.delete_local(table, lid)
                        self.drop_pub(table, lid)
                else:
                    self.apply_remote([remote], [], force=True)
        self.stats["conflicts"] = len(self.conflicts())
        return dict(self.stats, at=time.time(), warnings=self.warnings[:20])


def status(db_path, settings):
    """Stav pro UI (bez sítě)."""
    db = sqlite3.connect(str(db_path), timeout=30)
    db.row_factory = sqlite3.Row
    try:
        ensure_schema(db)
        db.commit()
        st = {r["key"]: json.loads(r["value"]) for r in db.execute("SELECT key, value FROM sync_state")}
        conflicts = [dict(r) for r in db.execute("SELECT * FROM sync_conflicts ORDER BY local_type, local_id")]
        n = db.execute("SELECT COUNT(*) FROM published").fetchone()[0]
    finally:
        db.close()
    return {
        "url": settings.get("sync_url") or DEFAULT_URL,
        "token": mask_token(settings.get("sync_token")), "has_token": bool(settings.get("sync_token")),
        "letters": bool(settings.get("sync_letters")), "auto": bool(settings.get("sync_auto")),
        "last_sync": st.get("last_sync") or None, "last_result": st.get("last_result"),
        "account": st.get("account_name"), "published": n, "conflicts": conflicts, "token_url": TOKEN_URL,
    }
