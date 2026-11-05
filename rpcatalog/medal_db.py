"""Read clip metadata from Medal's local database (read-only, via a snapshot copy)."""
import datetime as dt
import glob
import os
import re
import shutil
import sqlite3
import tempfile

from .medal_format import decode, MedalFormatError

PLACEHOLDER_TITLE = re.compile(r"^(untitled|requested trimmed clip \d+)$", re.I)

KNOWN_ROLES = {
    "all audio": "all",
    "microphone": "mic",
    "mic": "mic",
    "discord": "discord",
    "medalencoder": "system",
}


def track_role(title, process_name=None):
    t = (title or "").strip().lower()
    if t in KNOWN_ROLES:
        return KNOWN_ROLES[t]
    if process_name and t == process_name.lower():
        return "game"
    return "game" if t else "other"


def _iso_to_epoch(s):
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def find_databases(roots):
    found = []
    for root in roots:
        found += glob.glob(os.path.join(root, "Databases", "medal-*.db"))
    return sorted(set(found))


def _snapshot_rows(db_path):
    """Copy the db (+WAL) so a running Medal is never blocked or disturbed."""
    tmp = tempfile.mkdtemp(prefix="rpcatalog-")
    try:
        dst = os.path.join(tmp, "medal.db")
        shutil.copy2(db_path, dst)
        for ext in ("-wal", "-shm"):
            if os.path.exists(db_path + ext):
                shutil.copy2(db_path + ext, dst + ext)
        con = sqlite3.connect(dst)
        try:
            return con.execute(
                "SELECT created_at, video_path, thumbnail_path, metadata, local_content_id, parent_id "
                "FROM contents WHERE video_path IS NOT NULL").fetchall()
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def read_medal(roots):
    """Return {normcased video path: info dict} for every video Medal knows about."""
    raw = []
    for db in find_databases(roots):
        try:
            raw += _snapshot_rows(db)
        except (OSError, sqlite3.Error):
            continue

    by_local_id = {}
    parsed = []
    for created_at, video_path, thumb, blob, local_id, parent_id in raw:
        try:
            meta = decode(blob)
        except (MedalFormatError, ValueError):
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        item = (created_at, video_path, thumb, meta, local_id, parent_id)
        parsed.append(item)
        by_local_id[local_id] = item

    def is_trim(meta):
        return bool(meta.get("wasTrimmed")) or meta.get("trimStart") is not None

    def root_offset(item, depth=0):
        """Offset of a trimmed video inside the original full recording.

        trimStartTime is already absolute; otherwise trimStart is relative to the
        parent (which can itself be a trim)."""
        meta, parent_id = item[3], item[5]
        if meta.get("trimStartTime") is not None:
            return float(meta["trimStartTime"])
        own = float(meta.get("trimStart") or 0)
        parent = by_local_id.get(parent_id)
        if parent and depth < 10 and is_trim(parent[3]):
            return root_offset(parent, depth + 1) + own
        return own

    def root_item(item, depth=0):
        parent = by_local_id.get(item[5])
        if parent and depth < 10:
            return root_item(parent, depth + 1) if is_trim(parent[3]) else parent
        return None

    out = {}
    for item in parsed:
        created_at, video_path, thumb, meta, local_id, parent_id = item
        rec = meta.get("recorder") or {}
        vtype = rec.get("videoType")
        trim = root_offset(item) if is_trim(meta) else None
        duration = meta.get("clipDuration") or meta.get("trimDuration")

        if trim is not None:
            kind = "clip"
        elif vtype == "FullSession":
            kind = "session"
        elif vtype == "ManualRecording":
            kind = "manual"
        elif vtype == "Clip":
            kind = "clip"
        else:
            kind = None  # decided later by duration

        start = None
        parent_path = None
        if rec.get("clipStartTime"):
            start = _iso_to_epoch(rec["clipStartTime"])
        if start is None and trim is not None:
            root = root_item(item)
            if root is not None:
                start = float(root[0]) + trim
                parent_path = root[1]
            # else: filename timestamp (= start of the original recording) + trim,
            # resolved by the scanner
        if start is None and trim is None:
            start = float(created_at) if created_at else None

        proc = rec.get("processName")
        tracks = []
        for a in meta.get("audioStreams") or []:
            title = a.get("title") or ""
            tracks.append({"name": title, "role": track_role(title, proc)})

        bookmarks = []
        for b in meta.get("bookmarks") or []:
            if isinstance(b, dict) and b.get("time") is not None:
                bookmarks.append({"time": float(b["time"]), "name": str(b.get("name") or "")})

        title = meta.get("title") or None
        if isinstance(title, str):
            title = title.strip() or None
            if title and PLACEHOLDER_TITLE.match(title):
                title = None

        out[os.path.normcase(video_path)] = {
            "path": video_path,
            "kind": kind,
            "start_time": start,
            "trim_start": float(trim) if trim is not None else None,
            "duration": float(duration) if duration else None,
            "medal_id": local_id,
            "medal_title": title,
            "thumb": thumb if thumb and os.path.exists(thumb) else None,
            "tracks": tracks,
            "bookmarks": bookmarks,
            "parent_path": parent_path,
            "game_caption": (rec.get("captionName") or "").strip() or None,
        }
    return out
