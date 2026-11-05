"""The catalog database: media, tags, albums, events and event references.

Medal's own database is never written; everything the user edits lives here.
All times are Unix seconds (UTC).
"""
import json
import re
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    game TEXT,
    kind TEXT NOT NULL DEFAULT 'clip',          -- clip | session | manual
    kind_override TEXT,
    start_time REAL,                            -- real-world start of the footage
    duration REAL,
    size INTEGER,
    medal_id TEXT,
    medal_title TEXT,
    title TEXT,                                 -- user title (overrides medal_title)
    description TEXT DEFAULT '',
    thumb TEXT,
    tracks TEXT DEFAULT '[]',                   -- JSON list of audio track names
    bookmarks TEXT DEFAULT '[]',                -- JSON list of {time, name}
    sidecars TEXT DEFAULT '[]',                 -- JSON list of extra audio files
    parent_path TEXT,
    favorite INTEGER DEFAULT 0,
    missing INTEGER DEFAULT 0,
    added_at REAL,
    scanned_at REAL
);
CREATE TABLE IF NOT EXISTS media_tags (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (media_id, tag)
);
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS album_items (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    PRIMARY KEY (album_id, media_id)
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    start_time REAL,
    end_time REAL,
    color TEXT DEFAULT '#c9a227',
    position INTEGER DEFAULT 0,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS event_tags (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (event_id, tag)
);
CREATE TABLE IF NOT EXISTS event_links (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    offset REAL,                                -- seconds into the video, optional
    note TEXT DEFAULT '',
    created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_media_start ON media(start_time);
CREATE INDEX IF NOT EXISTS idx_links_event ON event_links(event_id);
CREATE INDEX IF NOT EXISTS idx_links_media ON event_links(media_id);
"""

SCHEMA_V2 = """
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    entry_time REAL,                            -- real-world date of the note
    ingame_date TEXT DEFAULT '',
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY,
    owner_type TEXT NOT NULL,                   -- event | entry | character
    owner_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    orig_name TEXT,
    mime TEXT,
    kind TEXT DEFAULT 'file',                   -- image | file
    caption TEXT DEFAULT '',
    taken_at REAL,
    media_id INTEGER,
    media_offset REAL,
    size INTEGER,
    created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_att_owner ON attachments(owner_type, owner_id);
CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    aliases TEXT DEFAULT '',
    kind TEXT DEFAULT 'npc',                    -- mine | player | npc
    faction TEXT DEFAULT '',
    player TEXT DEFAULT '',                     -- who plays them (OOC)
    status TEXT DEFAULT 'alive',                -- alive | dead | missing | unknown
    color TEXT DEFAULT '#e3b341',
    portrait_id INTEGER,
    summary TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS character_links (
    id INTEGER PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,                  -- event | media | entry
    target_id INTEGER NOT NULL,
    role TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',               -- manual | mention
    UNIQUE (character_id, target_type, target_id, source)
);
CREATE INDEX IF NOT EXISTS idx_cl_target ON character_links(target_type, target_id);
CREATE TABLE IF NOT EXISTS character_relations (
    id INTEGER PRIMARY KEY,
    a_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    b_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    label TEXT DEFAULT ''
);
"""

SCHEMA_V3 = """
CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    t REAL NOT NULL,                            -- seconds into the video
    t_end REAL,                                 -- optional end -> a "virtual clip"
    title TEXT DEFAULT '',
    note TEXT DEFAULT '',
    color TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',               -- manual | medal (hotkey) | auto (game moment)
    medal_key TEXT,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    hidden INTEGER DEFAULT 0,                   -- deleted Medal bookmarks stay hidden on rescan
    created_at REAL,
    updated_at REAL
);
CREATE INDEX IF NOT EXISTS idx_bm_media ON bookmarks(media_id);
CREATE INDEX IF NOT EXISTS idx_bm_event ON bookmarks(event_id);
"""

SCHEMA_V4 = """
CREATE TABLE IF NOT EXISTS factions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT DEFAULT 'frakce',                 -- rod | frakce | cech | rad | mesto | jine
    color TEXT DEFAULT '#9aa3b2',
    emblem_id INTEGER,
    summary TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    parent_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT DEFAULT '',                    -- Discord, Steam, ...
    color TEXT DEFAULT '#5aa9e6',
    avatar_id INTEGER,
    summary TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS faction_members (
    faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    role TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    PRIMARY KEY (faction_id, character_id)
);
"""

SCHEMA_V5 = """
CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT DEFAULT 'jine',                   -- hrad | mesto | vesnice | krcma | cirkev | priroda | budova | jine
    color TEXT DEFAULT '#9aa3b2',
    image_id INTEGER,
    summary TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    parent_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
    owner_type TEXT DEFAULT '',                 -- character | faction | ''
    owner_id INTEGER,
    ingame_location TEXT DEFAULT '',
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY,
    game TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#5aa9e6',
    active_from REAL,                           -- videos of the game recorded in this period belong here
    active_to REAL,
    notes TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY,
    sent_at REAL,
    ingame_date TEXT DEFAULT '',
    title TEXT DEFAULT '',
    body TEXT DEFAULT '',
    sender_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    recipient_ids TEXT DEFAULT '[]',
    author TEXT DEFAULT '',                     -- raw Discord author name
    author_discord_id TEXT DEFAULT '',
    channel TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',               -- manual | discord-export | discord-channel
    source_ref TEXT UNIQUE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
    created_at REAL,
    updated_at REAL
);
"""

EVENT_V2_COLUMNS = {
    "body_html": "TEXT DEFAULT ''",
    "location": "TEXT DEFAULT ''",
    "ingame_date": "TEXT DEFAULT ''",
    "cover_id": "INTEGER",
    "status": "TEXT DEFAULT ''",
    "place_id": "INTEGER",
}

MENTION_RE = re.compile(r'data-char-id="(\d+)"')

MEDIA_COLS = ("path game kind kind_override start_time duration size medal_id medal_title "
              "thumb tracks bookmarks sidecars parent_path").split()


def normalize_tag(tag):
    tag = tag.strip().lstrip("#").strip()
    return tag.lower().replace(" ", "_")


def parse_tags(text):
    parts = text.replace(",", " ").split()
    seen, out = set(), []
    for p in parts:
        t = normalize_tag(p)
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


class Media(dict):
    """A row from the media table plus tags; attribute access for convenience."""
    __getattr__ = dict.get

    @property
    def display_title(self):
        return self["title"] or self["medal_title"] or self.default_title

    @property
    def default_title(self):
        import datetime as dt
        if self["start_time"]:
            stamp = dt.datetime.fromtimestamp(self["start_time"]).strftime("%d.%m.%Y %H:%M")
        else:
            stamp = ""
        label = {"session": "Záznam", "manual": "Nahrávka"}.get(self.effective_kind, "Klip")
        return f"{label} {stamp}".strip()

    @property
    def effective_kind(self):
        return self["kind_override"] or self["kind"]

    @property
    def end_time(self):
        if self["start_time"] is None:
            return None
        return self["start_time"] + (self["duration"] or 0)

    def track_names(self):
        return json.loads(self["tracks"] or "[]")

    def bookmark_list(self):
        return json.loads(self["bookmarks"] or "[]")

    def sidecar_list(self):
        return json.loads(self["sidecars"] or "[]")


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(str(path))
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.db.executescript(SCHEMA_V2)
        fresh_bm = not self.db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='bookmarks'").fetchone()
        self.db.executescript(SCHEMA_V3)
        fresh_fac = not self.db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='factions'").fetchone()
        self.db.executescript(SCHEMA_V4)
        self.db.executescript(SCHEMA_V5)
        if fresh_fac:   # turn the old free-text "faction" of characters into real factions
            now = time.time()
            for (name,) in self.db.execute("SELECT DISTINCT TRIM(faction) FROM characters "
                                           "WHERE TRIM(COALESCE(faction,'')) <> ''").fetchall():
                fid = self.db.execute("INSERT INTO factions (name, created_at, updated_at) VALUES (?,?,?)",
                                      (name, now, now)).lastrowid
                self.db.execute("INSERT OR IGNORE INTO faction_members (faction_id, character_id) "
                                "SELECT ?, id FROM characters WHERE TRIM(faction)=?", (fid, name))
        have = {r[1] for r in self.db.execute("PRAGMA table_info(events)")}
        for col, decl in EVENT_V2_COLUMNS.items():
            if col not in have:
                self.db.execute(f"ALTER TABLE events ADD COLUMN {col} {decl}")
        ccols = {r[1] for r in self.db.execute("PRAGMA table_info(characters)")}
        if "gender" not in ccols:
            self.db.execute("ALTER TABLE characters ADD COLUMN gender TEXT DEFAULT ''")
        for col, decl in (("player_id", "INTEGER"), ("status_date", "REAL"), ("status_ingame", "TEXT DEFAULT ''"),
                          ("status_event_id", "INTEGER"), ("status_note", "TEXT DEFAULT ''")):
            if col not in ccols:
                self.db.execute(f"ALTER TABLE characters ADD COLUMN {col} {decl}")
        rcols = {r[1] for r in self.db.execute("PRAGMA table_info(character_relations)")}
        if "kind" not in rcols:
            self.db.execute("ALTER TABLE character_relations ADD COLUMN kind TEXT DEFAULT ''")
            self.db.execute("ALTER TABLE character_relations ADD COLUMN note TEXT DEFAULT ''")
        pcols = {r[1] for r in self.db.execute("PRAGMA table_info(players)")}
        if "tags" not in pcols:
            self.db.execute("ALTER TABLE players ADD COLUMN tags TEXT DEFAULT ''")
        for col in ("discord_id", "discord_name"):
            if col not in pcols:
                self.db.execute(f"ALTER TABLE players ADD COLUMN {col} TEXT DEFAULT ''")
        if "own_style" not in {r[1] for r in self.db.execute("PRAGMA table_info(characters)")}:
            # 0 = look (colour, background) comes from the character's first faction
            self.db.execute("ALTER TABLE characters ADD COLUMN own_style INTEGER DEFAULT 0")
        # players from the old free-text "player" field of characters (once)
        now = time.time()
        for (name,) in self.db.execute("SELECT DISTINCT TRIM(player) FROM characters "
                                       "WHERE TRIM(COALESCE(player,'')) <> '' AND player_id IS NULL").fetchall():
            row = self.db.execute("SELECT id FROM players WHERE name=?", (name,)).fetchone()
            pid = row[0] if row else self.db.execute(
                "INSERT INTO players (name, created_at, updated_at) VALUES (?,?,?)", (name, now, now)).lastrowid
            self.db.execute("UPDATE characters SET player_id=? WHERE TRIM(player)=? AND player_id IS NULL", (pid, name))
        for table in ("media", "events", "characters", "factions", "places"):
            if "server_id" not in {r[1] for r in self.db.execute(f"PRAGMA table_info({table})")}:
                self.db.execute(f"ALTER TABLE {table} ADD COLUMN server_id INTEGER")
        mcols = {r[1] for r in self.db.execute("PRAGMA table_info(media)")}
        if "custom_thumb" not in mcols:
            self.db.execute("ALTER TABLE media ADD COLUMN custom_thumb TEXT")
        if "resume_pos" not in mcols:
            self.db.execute("ALTER TABLE media ADD COLUMN resume_pos REAL")
            self.db.execute("ALTER TABLE media ADD COLUMN watched_at REAL")
        if fresh_bm:
            for mid, raw in self.db.execute("SELECT id, bookmarks FROM media").fetchall():
                self.sync_medal_bookmarks(mid, json.loads(raw or "[]"), commit=False)
        self.db.commit()

    # ---------- media ----------
    def upsert_media(self, rec):
        """Insert or refresh scanned data; user edits (title, tags, ...) are kept."""
        now = time.time()
        row = self.db.execute("SELECT id FROM media WHERE path=?", (rec["path"],)).fetchone()
        vals = [rec.get(c) for c in MEDIA_COLS]
        if row:
            sets = ", ".join(f"{c}=?" for c in MEDIA_COLS)
            self.db.execute(f"UPDATE media SET {sets}, missing=0, scanned_at=? WHERE id=?",
                            vals + [now, row["id"]])
            self.sync_medal_bookmarks(row["id"], json.loads(rec.get("bookmarks") or "[]"), commit=False)
            return row["id"]
        cols = ", ".join(MEDIA_COLS)
        qs = ", ".join("?" for _ in MEDIA_COLS)
        cur = self.db.execute(
            f"INSERT INTO media ({cols}, added_at, scanned_at) VALUES ({qs}, ?, ?)",
            vals + [now, now])
        self.sync_medal_bookmarks(cur.lastrowid, json.loads(rec.get("bookmarks") or "[]"), commit=False)
        return cur.lastrowid

    def mark_missing_except(self, seen_paths, roots):
        """Flag rows under the scanned roots whose files are gone."""
        rows = self.db.execute("SELECT id, path FROM media WHERE missing=0").fetchall()
        roots_l = [r.lower().rstrip("\\/") for r in roots]
        gone = [r["id"] for r in rows
                if r["path"] not in seen_paths
                and any(r["path"].lower().startswith(x) for x in roots_l)]
        self.db.executemany("UPDATE media SET missing=1 WHERE id=?", [(i,) for i in gone])
        return len(gone)

    def commit(self):
        self.db.commit()

    def _media_rows(self, sql, args=()):
        rows = self.db.execute(sql, args).fetchall()
        out = []
        tags = {}
        for r in self.db.execute("SELECT media_id, tag FROM media_tags ORDER BY tag"):
            tags.setdefault(r["media_id"], []).append(r["tag"])
        for r in rows:
            m = Media(dict(r))
            m["tags"] = tags.get(r["id"], [])
            out.append(m)
        return out

    def all_media(self, include_missing=False):
        where = "" if include_missing else "WHERE missing=0"
        return self._media_rows(f"SELECT * FROM media {where} ORDER BY start_time DESC")

    def media(self, media_id):
        rows = self._media_rows("SELECT * FROM media WHERE id=?", (media_id,))
        return rows[0] if rows else None

    def media_in_range(self, t0, t1):
        return self._media_rows(
            "SELECT * FROM media WHERE missing=0 AND start_time IS NOT NULL "
            "AND start_time <= ? AND start_time + COALESCE(duration,0) >= ? "
            "ORDER BY start_time", (t1, t0))

    def update_media(self, media_id, **fields):
        allowed = {"title", "description", "favorite", "kind_override", "game", "custom_thumb", "server_id"}
        fields = {k: v for k, v in fields.items() if k in allowed}
        if not fields:
            return
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE media SET {sets} WHERE id=?", list(fields.values()) + [media_id])
        self.db.commit()

    def set_resume(self, media_id, pos):
        self.db.execute("UPDATE media SET resume_pos=?, watched_at=? WHERE id=?", (pos, time.time(), media_id))
        self.db.commit()

    def set_media_tags(self, media_id, tags):
        self.db.execute("DELETE FROM media_tags WHERE media_id=?", (media_id,))
        self.db.executemany("INSERT OR IGNORE INTO media_tags VALUES (?,?)",
                            [(media_id, normalize_tag(t)) for t in tags if normalize_tag(t)])
        self.db.commit()

    def add_media_tags(self, media_ids, tags):
        self.db.executemany("INSERT OR IGNORE INTO media_tags VALUES (?,?)",
                            [(m, normalize_tag(t)) for m in media_ids for t in tags if normalize_tag(t)])
        self.db.commit()

    def delete_media_row(self, media_id):
        self.db.execute("DELETE FROM media WHERE id=?", (media_id,))
        self.db.execute("DELETE FROM character_links WHERE target_type='bookmark' "
                        "AND target_id NOT IN (SELECT id FROM bookmarks)")
        self.db.commit()

    def all_tags(self):
        rows = self.db.execute(
            "SELECT tag, COUNT(*) n FROM media_tags t JOIN media m ON m.id=t.media_id "
            "WHERE m.missing=0 GROUP BY tag ORDER BY tag").fetchall()
        return [(r["tag"], r["n"]) for r in rows]

    def games(self):
        rows = self.db.execute(
            "SELECT game, COUNT(*) n FROM media WHERE missing=0 GROUP BY game ORDER BY game").fetchall()
        return [(r["game"], r["n"]) for r in rows]

    # ---------- albums ----------
    def albums(self):
        rows = self.db.execute(
            "SELECT a.id, a.name, COUNT(i.media_id) n FROM albums a "
            "LEFT JOIN album_items i ON i.album_id=a.id GROUP BY a.id ORDER BY a.name").fetchall()
        return [dict(r) for r in rows]

    def create_album(self, name):
        cur = self.db.execute("INSERT INTO albums (name, created_at) VALUES (?,?)", (name, time.time()))
        self.db.commit()
        return cur.lastrowid

    def rename_album(self, album_id, name):
        self.db.execute("UPDATE albums SET name=? WHERE id=?", (name, album_id))
        self.db.commit()

    def delete_album(self, album_id):
        self.db.execute("DELETE FROM albums WHERE id=?", (album_id,))
        self.db.commit()

    def album_media_ids(self, album_id):
        return [r[0] for r in self.db.execute(
            "SELECT media_id FROM album_items WHERE album_id=? ORDER BY position", (album_id,))]

    def media_album_ids(self, media_id):
        return {r[0] for r in self.db.execute(
            "SELECT album_id FROM album_items WHERE media_id=?", (media_id,))}

    def add_to_album(self, album_id, media_ids):
        pos = self.db.execute("SELECT COALESCE(MAX(position),0) FROM album_items WHERE album_id=?",
                              (album_id,)).fetchone()[0]
        for i, m in enumerate(media_ids, 1):
            self.db.execute("INSERT OR IGNORE INTO album_items VALUES (?,?,?)", (album_id, m, pos + i))
        self.db.commit()

    def remove_from_album(self, album_id, media_ids):
        self.db.executemany("DELETE FROM album_items WHERE album_id=? AND media_id=?",
                            [(album_id, m) for m in media_ids])
        self.db.commit()

    # ---------- events ----------
    def events(self):
        rows = self.db.execute("SELECT * FROM events ORDER BY position, start_time, id").fetchall()
        tags = {}
        for r in self.db.execute("SELECT event_id, tag FROM event_tags ORDER BY tag"):
            tags.setdefault(r["event_id"], []).append(r["tag"])
        counts = dict(self.db.execute(
            "SELECT event_id, COUNT(*) FROM event_links GROUP BY event_id").fetchall())
        out = []
        for r in rows:
            e = dict(r)
            e["tags"] = tags.get(r["id"], [])
            e["link_count"] = counts.get(r["id"], 0)
            out.append(e)
        return out

    def event(self, event_id):
        for e in self.events():
            if e["id"] == event_id:
                return e
        return None

    def create_event(self, title, parent_id=None, start=None, end=None):
        pos = self.db.execute("SELECT COALESCE(MAX(position),0)+1 FROM events WHERE parent_id IS ?",
                              (parent_id,)).fetchone()[0]
        cur = self.db.execute(
            "INSERT INTO events (parent_id, title, start_time, end_time, position, created_at) "
            "VALUES (?,?,?,?,?,?)", (parent_id, title, start, end, pos, time.time()))
        self.db.commit()
        return cur.lastrowid

    def update_event(self, event_id, **fields):
        allowed = {"title", "description", "start_time", "end_time", "color", "parent_id", "position",
                   "body_html", "location", "ingame_date", "cover_id", "status", "place_id", "server_id"}
        if "body_html" in fields:
            self.sync_mentions("event", event_id, fields["body_html"])
        fields = {k: v for k, v in fields.items() if k in allowed}
        if not fields:
            return
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE events SET {sets} WHERE id=?", list(fields.values()) + [event_id])
        self.db.commit()

    def set_event_tags(self, event_id, tags):
        self.db.execute("DELETE FROM event_tags WHERE event_id=?", (event_id,))
        self.db.executemany("INSERT OR IGNORE INTO event_tags VALUES (?,?)",
                            [(event_id, normalize_tag(t)) for t in tags if normalize_tag(t)])
        self.db.commit()

    def delete_event(self, event_id):
        self.db.execute("DELETE FROM events WHERE id=?", (event_id,))
        self.db.commit()

    def event_descendant_ids(self, event_id):
        ids, frontier = [], [event_id]
        while frontier:
            cur = frontier.pop()
            ids.append(cur)
            frontier += [r[0] for r in self.db.execute("SELECT id FROM events WHERE parent_id=?", (cur,))]
        return ids

    def links(self, event_id=None, media_id=None):
        sql = ("SELECT l.*, e.title AS event_title FROM event_links l "
               "JOIN events e ON e.id=l.event_id WHERE 1=1")
        args = []
        if event_id is not None:
            sql += " AND l.event_id=?"
            args.append(event_id)
        if media_id is not None:
            sql += " AND l.media_id=?"
            args.append(media_id)
        sql += " ORDER BY l.created_at"
        return [dict(r) for r in self.db.execute(sql, args)]

    def linked_media_ids(self):
        return {r[0] for r in self.db.execute("SELECT DISTINCT media_id FROM event_links")}

    def add_link(self, event_id, media_id, offset=None, note=""):
        cur = self.db.execute(
            "INSERT INTO event_links (event_id, media_id, offset, note, created_at) VALUES (?,?,?,?,?)",
            (event_id, media_id, offset, note, time.time()))
        self.db.commit()
        return cur.lastrowid

    def update_link(self, link_id, **fields):
        fields = {k: v for k, v in fields.items() if k in {"offset", "note", "event_id"}}
        if not fields:
            return
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE event_links SET {sets} WHERE id=?", list(fields.values()) + [link_id])
        self.db.commit()

    def delete_link(self, link_id):
        self.db.execute("DELETE FROM event_links WHERE id=?", (link_id,))
        self.db.commit()

    # ---------- journal entries ----------
    def entries(self, event_id=None):
        if event_id is None:
            return [dict(r) for r in self.db.execute("SELECT * FROM entries ORDER BY entry_time")]
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM entries WHERE event_id=? ORDER BY COALESCE(entry_time, created_at), id",
            (event_id,))]

    def entry(self, entry_id):
        r = self.db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        return dict(r) if r else None

    def create_entry(self, event_id, title="", body_html="", entry_time=None, ingame_date=""):
        now = time.time()
        cur = self.db.execute(
            "INSERT INTO entries (event_id, title, body_html, entry_time, ingame_date, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)", (event_id, title, body_html, entry_time or now, ingame_date, now, now))
        self.db.commit()
        self.sync_mentions("entry", cur.lastrowid, body_html)
        return cur.lastrowid

    def update_entry(self, entry_id, **fields):
        fields = {k: v for k, v in fields.items()
                  if k in {"title", "body_html", "entry_time", "ingame_date", "event_id"}}
        if not fields:
            return
        fields["updated_at"] = time.time()
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE entries SET {sets} WHERE id=?", list(fields.values()) + [entry_id])
        self.db.commit()
        if "body_html" in fields:
            self.sync_mentions("entry", entry_id, fields["body_html"])

    def delete_entry(self, entry_id):
        self.db.execute("DELETE FROM entries WHERE id=?", (entry_id,))
        self.db.execute("DELETE FROM character_links WHERE target_type='entry' AND target_id=?", (entry_id,))
        self.db.commit()

    # ---------- attachments ----------
    def attachments(self, owner_type=None, owner_id=None, ids=None):
        sql, args = "SELECT * FROM attachments WHERE 1=1", []
        if owner_type:
            sql += " AND owner_type=?"
            args.append(owner_type)
        if owner_id is not None:
            sql += " AND owner_id=?"
            args.append(owner_id)
        if ids is not None:
            ids = list(ids) or [-1]
            sql += f" AND id IN ({','.join('?' * len(ids))})"
            args += ids
        sql += " ORDER BY COALESCE(taken_at, created_at), id"
        return [dict(r) for r in self.db.execute(sql, args)]

    def attachment(self, att_id):
        r = self.db.execute("SELECT * FROM attachments WHERE id=?", (att_id,)).fetchone()
        return dict(r) if r else None

    def add_attachment(self, owner_type, owner_id, path, orig_name, mime, kind, size,
                       caption="", taken_at=None, media_id=None, media_offset=None):
        cur = self.db.execute(
            "INSERT INTO attachments (owner_type, owner_id, path, orig_name, mime, kind, caption, taken_at, "
            "media_id, media_offset, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (owner_type, owner_id, path, orig_name, mime, kind, caption, taken_at, media_id, media_offset,
             size, time.time()))
        self.db.commit()
        return cur.lastrowid

    def update_attachment(self, att_id, **fields):
        fields = {k: v for k, v in fields.items() if k in {"caption", "taken_at", "owner_type", "owner_id"}}
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            self.db.execute(f"UPDATE attachments SET {sets} WHERE id=?", list(fields.values()) + [att_id])
            self.db.commit()

    def delete_attachment(self, att_id):
        self.db.execute("DELETE FROM attachments WHERE id=?", (att_id,))
        self.db.commit()

    # ---------- characters ----------
    CHAR_FIELDS = {"name", "aliases", "kind", "faction", "player", "status", "color", "portrait_id", "gender", "player_id", "status_date",
                   "status_ingame", "status_event_id", "status_note", "own_style", "server_id",
                   "summary", "body_html"}

    def characters(self):
        rows = [dict(r) for r in self.db.execute("SELECT * FROM characters ORDER BY name COLLATE NOCASE")]
        counts = {}
        for r in self.db.execute("SELECT character_id, target_type, COUNT(DISTINCT target_id) n "
                                 "FROM character_links GROUP BY character_id, target_type"):
            counts.setdefault(r[0], {})[r[1]] = r[2]
        for c in rows:
            c["counts"] = counts.get(c["id"], {})
        return rows

    def character(self, char_id):
        r = self.db.execute("SELECT * FROM characters WHERE id=?", (char_id,)).fetchone()
        return dict(r) if r else None

    def create_character(self, name, **fields):
        now = time.time()
        cur = self.db.execute("INSERT INTO characters (name, created_at, updated_at) VALUES (?,?,?)",
                              (name, now, now))
        self.db.commit()
        if fields:
            self.update_character(cur.lastrowid, **fields)
        return cur.lastrowid

    def update_character(self, char_id, **fields):
        fields = {k: v for k, v in fields.items() if k in self.CHAR_FIELDS}
        if not fields:
            return
        fields["updated_at"] = time.time()
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE characters SET {sets} WHERE id=?", list(fields.values()) + [char_id])
        self.db.commit()
        if "body_html" in fields:
            self.sync_mentions("character", char_id, fields["body_html"])

    def delete_character(self, char_id):
        self.db.execute("DELETE FROM character_links WHERE target_type='character' AND target_id=?", (char_id,))
        self.db.execute("DELETE FROM characters WHERE id=?", (char_id,))
        self.db.commit()

    def character_links(self, character_id=None, target_type=None, target_id=None):
        sql, args = "SELECT * FROM character_links WHERE 1=1", []
        for col, val in (("character_id", character_id), ("target_type", target_type), ("target_id", target_id)):
            if val is not None:
                sql += f" AND {col}=?"
                args.append(val)
        return [dict(r) for r in self.db.execute(sql + " ORDER BY id", args)]

    def link_character(self, character_id, target_type, target_id, role=""):
        self.db.execute(
            "INSERT INTO character_links (character_id, target_type, target_id, role, source) "
            "VALUES (?,?,?,?, 'manual') ON CONFLICT(character_id, target_type, target_id, source) "
            "DO UPDATE SET role=excluded.role", (character_id, target_type, target_id, role))
        self.db.commit()

    def unlink_character(self, character_id, target_type, target_id):
        self.db.execute("DELETE FROM character_links WHERE character_id=? AND target_type=? AND target_id=? "
                        "AND source='manual'", (character_id, target_type, target_id))
        self.db.commit()

    def sync_mentions(self, target_type, target_id, html):
        """@mentions in rich text (<span data-char-id="..">) become character links."""
        ids = {int(x) for x in MENTION_RE.findall(html or "")}
        if target_type == "character":
            ids.discard(target_id)
        self.db.execute("DELETE FROM character_links WHERE target_type=? AND target_id=? AND source='mention'",
                        (target_type, target_id))
        valid = {r[0] for r in self.db.execute("SELECT id FROM characters")}
        self.db.executemany(
            "INSERT OR IGNORE INTO character_links (character_id, target_type, target_id, role, source) "
            "VALUES (?,?,?, '', 'mention')", [(c, target_type, target_id) for c in ids if c in valid])
        self.db.commit()

    def relations(self, char_id=None):
        sql, args = "SELECT * FROM character_relations", ()
        if char_id is not None:
            sql += " WHERE a_id=? OR b_id=?"
            args = (char_id, char_id)
        return [dict(r) for r in self.db.execute(sql + " ORDER BY id", args)]

    def add_relation(self, a_id, b_id, label="", kind="", note=""):
        cur = self.db.execute("INSERT INTO character_relations (a_id, b_id, label, kind, note) VALUES (?,?,?,?,?)",
                              (a_id, b_id, label, kind, note))
        self.db.commit()
        return cur.lastrowid

    def update_relation(self, rel_id, **fields):
        fields = {k: v for k, v in fields.items() if k in {"a_id", "b_id", "label", "kind", "note"}}
        if not fields:
            return
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE character_relations SET {sets} WHERE id=?", list(fields.values()) + [rel_id])
        self.db.commit()

    def delete_relation(self, rel_id):
        self.db.execute("DELETE FROM character_relations WHERE id=?", (rel_id,))
        self.db.commit()

    # ---------- bookmarks (moments / virtual clips inside a video) ----------
    BM_FIELDS = {"t", "t_end", "title", "note", "color", "event_id", "hidden"}

    def sync_medal_bookmarks(self, media_id, medal_bms, commit=True):
        """Import Medal's bookmarks once; later edits/deletes in the catalog win."""
        have = {r[0] for r in self.db.execute(
            "SELECT medal_key FROM bookmarks WHERE media_id=? AND medal_key IS NOT NULL", (media_id,))}
        now = time.time()
        for b in medal_bms:
            name = (b.get("name") or "").strip()
            key = f"{float(b['time']):.2f}|{name}"
            if key in have:
                continue
            have.add(key)
            self.db.execute(
                "INSERT INTO bookmarks (media_id, t, title, source, medal_key, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (media_id, float(b["time"]), name, "auto" if name else "medal", key, now, now))
        if commit:
            self.db.commit()

    def bookmarks(self, media_id=None, event_id=None, include_hidden=False, ids=None):
        sql = ("SELECT b.*, e.title AS event_title, e.color AS event_color FROM bookmarks b "
               "LEFT JOIN events e ON e.id=b.event_id WHERE 1=1")
        args = []
        if not include_hidden:
            sql += " AND b.hidden=0"
        if media_id is not None:
            sql += " AND b.media_id=?"
            args.append(media_id)
        if event_id is not None:
            sql += " AND b.event_id=?"
            args.append(event_id)
        if ids is not None:
            sql += f" AND b.id IN ({','.join('?' * len(ids)) or 'NULL'})"
            args += list(ids)
        return [dict(r) for r in self.db.execute(sql + " ORDER BY b.media_id, b.t", args)]

    def bookmark(self, bm_id):
        r = self.bookmarks(ids=[bm_id], include_hidden=True)
        return r[0] if r else None

    def create_bookmark(self, media_id, t, t_end=None, title="", note="", event_id=None, color=""):
        now = time.time()
        cur = self.db.execute(
            "INSERT INTO bookmarks (media_id, t, t_end, title, note, color, event_id, source, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?, 'manual', ?, ?)",
            (media_id, t, t_end, title, note, color, event_id, now, now))
        self.db.commit()
        return cur.lastrowid

    def update_bookmark(self, bm_id, **fields):
        fields = {k: v for k, v in fields.items() if k in self.BM_FIELDS}
        if not fields:
            return
        fields["updated_at"] = time.time()
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE bookmarks SET {sets} WHERE id=?", list(fields.values()) + [bm_id])
        self.db.commit()

    def delete_bookmark(self, bm_id):
        b = self.bookmark(bm_id)
        if not b:
            return
        self.db.execute("DELETE FROM character_links WHERE target_type='bookmark' AND target_id=?", (bm_id,))
        if b["medal_key"]:
            self.db.execute("UPDATE bookmarks SET hidden=1, event_id=NULL WHERE id=?", (bm_id,))
        else:
            self.db.execute("DELETE FROM bookmarks WHERE id=?", (bm_id,))
        self.db.commit()

    # ---------- factions / houses ----------
    FACTION_FIELDS = {"name", "kind", "color", "emblem_id", "summary", "body_html", "parent_id", "server_id"}

    def factions(self):
        return [dict(r) for r in self.db.execute(
            "SELECT f.*, (SELECT COUNT(*) FROM faction_members m WHERE m.faction_id=f.id) AS n "
            "FROM factions f ORDER BY f.name COLLATE NOCASE")]

    def faction(self, fid):
        r = self.db.execute("SELECT * FROM factions WHERE id=?", (fid,)).fetchone()
        return dict(r) if r else None

    def create_faction(self, name, **fields):
        now = time.time()
        fid = self.db.execute("INSERT INTO factions (name, created_at, updated_at) VALUES (?,?,?)",
                              (name, now, now)).lastrowid
        self.db.commit()
        if fields:
            self.update_faction(fid, **fields)
        return fid

    def update_faction(self, fid, **fields):
        fields = {k: v for k, v in fields.items() if k in self.FACTION_FIELDS}
        if not fields:
            return
        fields["updated_at"] = time.time()
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE factions SET {sets} WHERE id=?", list(fields.values()) + [fid])
        self.db.commit()
        if "body_html" in fields:
            self.sync_mentions("faction", fid, fields["body_html"])

    def delete_faction(self, fid):
        self.db.execute("DELETE FROM character_links WHERE target_type='faction' AND target_id=?", (fid,))
        self.db.execute("DELETE FROM factions WHERE id=?", (fid,))
        self.db.commit()

    def faction_members(self, fid=None, char_id=None):
        sql, args = ("SELECT m.*, f.name AS faction_name, f.color AS faction_color, f.kind AS faction_kind "
                     "FROM faction_members m JOIN factions f ON f.id=m.faction_id WHERE 1=1"), []
        if fid is not None:
            sql += " AND m.faction_id=?"
            args.append(fid)
        if char_id is not None:
            sql += " AND m.character_id=?"
            args.append(char_id)
        return [dict(r) for r in self.db.execute(sql + " ORDER BY m.position, m.rowid", args)]

    def add_member(self, fid, char_id, role=""):
        self.db.execute("INSERT INTO faction_members (faction_id, character_id, role) VALUES (?,?,?) "
                        "ON CONFLICT(faction_id, character_id) DO UPDATE SET role=excluded.role", (fid, char_id, role))
        self.db.commit()

    def remove_member(self, fid, char_id):
        self.db.execute("DELETE FROM faction_members WHERE faction_id=? AND character_id=?", (fid, char_id))
        self.db.commit()

    # ---------- players (people behind the characters) ----------
    PLAYER_FIELDS = {"name", "contact", "color", "avatar_id", "summary", "body_html", "tags", "discord_id", "discord_name"}

    def players(self):
        return [dict(r) for r in self.db.execute(
            "SELECT p.*, (SELECT COUNT(*) FROM characters c WHERE c.player_id=p.id) AS n "
            "FROM players p ORDER BY p.name COLLATE NOCASE")]

    def player(self, pid):
        r = self.db.execute("SELECT * FROM players WHERE id=?", (pid,)).fetchone()
        return dict(r) if r else None

    def create_player(self, name, **fields):
        now = time.time()
        pid = self.db.execute("INSERT INTO players (name, created_at, updated_at) VALUES (?,?,?)",
                              (name, now, now)).lastrowid
        self.db.commit()
        if fields:
            self.update_player(pid, **fields)
        return pid

    def update_player(self, pid, **fields):
        fields = {k: v for k, v in fields.items() if k in self.PLAYER_FIELDS}
        if not fields:
            return
        fields["updated_at"] = time.time()
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE players SET {sets} WHERE id=?", list(fields.values()) + [pid])
        self.db.commit()

    def delete_player(self, pid):
        self.db.execute("UPDATE characters SET player_id=NULL WHERE player_id=?", (pid,))
        self.db.execute("DELETE FROM players WHERE id=?", (pid,))
        self.db.commit()

    # ---------- generic small tables (places, letters) ----------
    def _rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args)]

    def _insert(self, table, fields):
        now = time.time()
        fields = dict(fields, created_at=now, updated_at=now)
        cols = ", ".join(fields)
        cur = self.db.execute(f"INSERT INTO {table} ({cols}) VALUES ({', '.join('?' * len(fields))})", list(fields.values()))
        self.db.commit()
        return cur.lastrowid

    def _update(self, table, rid, fields, allowed):
        fields = {k: v for k, v in fields.items() if k in allowed}
        if not fields:
            return
        fields["updated_at"] = time.time()
        self.db.execute(f"UPDATE {table} SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", list(fields.values()) + [rid])
        self.db.commit()

    PLACE_FIELDS = {"name", "kind", "color", "image_id", "summary", "body_html", "parent_id", "owner_type", "owner_id",
                    "ingame_location", "server_id"}

    def places(self):
        return self._rows("SELECT p.*, (SELECT COUNT(*) FROM events e WHERE e.place_id=p.id) AS n_events "
                          "FROM places p ORDER BY p.name COLLATE NOCASE")

    def place(self, pid):
        r = self._rows("SELECT * FROM places WHERE id=?", (pid,))
        return r[0] if r else None

    def create_place(self, name, **fields):
        return self._insert("places", dict({k: v for k, v in fields.items() if k in self.PLACE_FIELDS}, name=name))

    def update_place(self, pid, **fields):
        self._update("places", pid, fields, self.PLACE_FIELDS)
        if "body_html" in fields:
            self.sync_mentions("place", pid, fields["body_html"])

    def delete_place(self, pid):
        self.db.execute("UPDATE events SET place_id=NULL WHERE place_id=?", (pid,))
        self.db.execute("DELETE FROM places WHERE id=?", (pid,))
        self.db.commit()

    LETTER_FIELDS = {"sent_at", "ingame_date", "title", "body", "sender_id", "recipient_ids", "author",
                     "author_discord_id", "channel", "source", "source_ref", "event_id", "place_id"}

    def letters(self):
        return self._rows("SELECT * FROM letters ORDER BY COALESCE(sent_at, created_at) DESC")

    def letter(self, lid):
        r = self._rows("SELECT * FROM letters WHERE id=?", (lid,))
        return r[0] if r else None

    def create_letter(self, **fields):
        fields = {k: v for k, v in fields.items() if k in self.LETTER_FIELDS}
        if fields.get("source_ref") and self.db.execute("SELECT 1 FROM letters WHERE source_ref=?",
                                                        (fields["source_ref"],)).fetchone():
            return None   # already imported
        return self._insert("letters", fields)

    def update_letter(self, lid, **fields):
        self._update("letters", lid, fields, self.LETTER_FIELDS)

    def delete_letter(self, lid):
        self.db.execute("DELETE FROM letters WHERE id=?", (lid,))
        self.db.commit()

    # ---------- servers (sub-level of a game) ----------
    SERVER_FIELDS = {"game", "name", "color", "active_from", "active_to", "notes", "position"}

    def servers(self):
        return self._rows("SELECT s.*, (SELECT COUNT(*) FROM media m WHERE m.server_id=s.id) AS n_media "
                          "FROM servers s ORDER BY s.game, s.position, s.id")

    def create_server(self, game, name, **fields):
        sid = self._insert("servers", dict({k: v for k, v in fields.items() if k in self.SERVER_FIELDS}, game=game, name=name))
        self.auto_assign_servers()
        return sid

    def update_server(self, sid, **fields):
        self._update("servers", sid, fields, self.SERVER_FIELDS)
        self.auto_assign_servers()

    def delete_server(self, sid):
        for t in ("media", "events", "characters", "factions", "places"):
            self.db.execute(f"UPDATE {t} SET server_id=NULL WHERE server_id=?", (sid,))
        self.db.execute("DELETE FROM servers WHERE id=?", (sid,))
        self.db.commit()

    def auto_assign_servers(self):
        """Videos without a server get one: the server whose period contains the recording,
        or the only server of that game when it has no period set."""
        by_game = {}
        for sv in self.servers():
            by_game.setdefault(sv["game"], []).append(sv)
        n = 0
        for mid, game, start in self.db.execute(
                "SELECT id, game, start_time FROM media WHERE server_id IS NULL").fetchall():
            cands = by_game.get(game) or []
            pick = None
            for sv in cands:
                if sv["active_from"] or sv["active_to"]:
                    if start and (not sv["active_from"] or start >= sv["active_from"]) and \
                            (not sv["active_to"] or start <= sv["active_to"]):
                        pick = sv["id"]
                        break
            if pick is None:
                plain = [sv for sv in cands if not sv["active_from"] and not sv["active_to"]]
                if len(plain) == 1:
                    pick = plain[0]["id"]
            if pick:
                self.db.execute("UPDATE media SET server_id=? WHERE id=?", (pick, mid))
                n += 1
        self.db.commit()
        return n
