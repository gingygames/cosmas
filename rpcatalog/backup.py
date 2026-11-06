"""Backups of the catalogue (catalog.db) in <data>/backups.

catalog-YYYYMMDD-HHMMSS-<reason>.db – made with SQLite's online backup (safe while the app has the database open).
  auto    – automatic, at most once per `backup_every_hours` (default 24); only the newest `backup_keep` (7) are kept
  manual  – "Back up now"; never deleted automatically (like the before-… backups made before risky operations)
Restoring needs a restart: restore() checks the file and leaves a note, apply_pending_restore() swaps the database at
the next start before anything opens it (the current one is backed up first as …-before-restore.db).
"""
import json
import os
import re
import shutil
import sqlite3
import time
from pathlib import Path

from . import config

NAME_RE = re.compile(r"^catalog-(\d{8}-\d{6})-([\w-]+)\.db$")


def backup_dir():
    return config.DATA_DIR / "backups"


def _pending():
    return config.DATA_DIR / "restore-pending.json"


def make(reason="manual", db_path=None, dest=None):
    """Copies the catalogue into the backups folder; returns the new file."""
    src = Path(db_path or config.DB_PATH)
    if not src.exists():
        raise FileNotFoundError(src)
    dest = Path(dest or backup_dir())
    dest.mkdir(parents=True, exist_ok=True)
    reason = re.sub(r"[^\w-]+", "-", reason).strip("-") or "manual"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = dest / f"catalog-{stamp}-{reason}.db"
    n = 1
    while out.exists():
        n += 1
        out = dest / f"catalog-{stamp}-{reason}-{n}.db"
    tmp = out.with_suffix(".tmp")
    a = sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True)
    b = sqlite3.connect(tmp)
    try:
        a.backup(b)
        b.execute("PRAGMA journal_mode=DELETE")     # one self-contained file (reading it creates no -wal/-shm)
    finally:
        b.close()
        a.close()
    os.replace(tmp, out)
    return out


def list_backups(dest=None):
    dest = Path(dest or backup_dir())
    out = []
    if not dest.is_dir():
        return out
    for p in dest.glob("catalog-*.db"):
        m = NAME_RE.match(p.name)
        try:
            st = p.stat()
        except OSError:
            continue
        if m:
            t = time.mktime(time.strptime(m.group(1), "%Y%m%d-%H%M%S"))
            reason = m.group(2)
        else:
            t, reason = st.st_mtime, "other"
        kind = "auto" if reason.startswith("auto") else "manual" if reason.startswith("manual") else "safety"
        out.append({"name": p.name, "path": str(p), "time": t, "size": st.st_size, "reason": reason, "kind": kind})
    out.sort(key=lambda b: b["time"], reverse=True)
    return out


def prune(keep=7, dest=None):
    """Deletes the oldest automatic backups beyond `keep`. Returns the deleted names."""
    autos = [b for b in list_backups(dest) if b["kind"] == "auto"]
    gone = []
    for b in autos[max(0, int(keep)):]:
        try:
            os.remove(b["path"])
            gone.append(b["name"])
        except OSError:
            pass
    return gone


def auto_due(settings, dest=None, now=None):
    if not settings.get("backup_auto", True) or not config.DB_PATH.exists():
        return False
    now = time.time() if now is None else now
    autos = [b for b in list_backups(dest) if b["kind"] == "auto"]
    last = autos[0]["time"] if autos else 0
    return now - last >= max(1, float(settings.get("backup_every_hours") or 24)) * 3600 - 60


def auto(settings, db_path=None, dest=None):
    """The automatic backup when it is due (then prunes). Returns the new file or None."""
    if not auto_due(settings, dest):
        return None
    out = make("auto", db_path, dest)
    prune(settings.get("backup_keep", 7), dest)
    return out


def check(path):
    """Is it a readable Cosmas catalogue? Returns the number of videos, raises ValueError otherwise."""
    try:
        db = sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True)
        try:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("the backup is damaged")
            return db.execute("SELECT COUNT(*) FROM media").fetchone()[0]
        finally:
            db.close()
    except sqlite3.DatabaseError as e:
        raise ValueError(f"not a catalogue: {e}") from None


def restore(name, dest=None):
    """Schedules the restore of backup `name` for the next start (the caller restarts the app)."""
    dest = Path(dest or backup_dir())
    p = dest / Path(name).name
    if not p.is_file():
        raise FileNotFoundError(p)
    n = check(p)
    _pending().write_text(json.dumps({"backup": str(p), "at": time.time()}), "utf-8")
    return {"backup": str(p), "videos": n}


def cancel_restore():
    try:
        _pending().unlink()
    except OSError:
        pass


def apply_pending_restore():
    """At start, before the database is opened: replace catalog.db with the chosen backup.
    Returns {"restored": name, "saved": before-restore backup} or None."""
    pf = _pending()
    if not pf.exists():
        return None
    try:
        src = Path(json.loads(pf.read_text("utf-8"))["backup"])
        check(src)
        saved = None
        if config.DB_PATH.exists():
            db = sqlite3.connect(config.DB_PATH)
            try:
                db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                db.close()
            saved = make("before-restore")
        for suffix in ("-wal", "-shm"):
            try:
                os.remove(str(config.DB_PATH) + suffix)
            except OSError:
                pass
        tmp = config.DB_PATH.with_suffix(".restore.tmp")
        shutil.copy2(src, tmp)
        os.replace(tmp, config.DB_PATH)
        return {"restored": src.name, "saved": saved.name if saved else None}
    finally:
        try:
            pf.unlink()
        except OSError:
            pass


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total
