"""Paths and user settings (stored as JSON next to the catalog database)."""
import json
import os
import shutil
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = APP_DIR / "data"
THUMB_DIR = DATA_DIR / "thumbs"
DB_PATH = DATA_DIR / "catalog.db"
SETTINGS_PATH = DATA_DIR / "settings.json"
VENDOR_DIR = APP_DIR / "vendor"

DEFAULTS = {
    # Folders that contain Medal recordings (each may have Clips/, Databases/, Thumbnails/)
    "roots": [],
    # Recordings without Medal metadata: anything up to this length counts as a clip
    "clip_max_seconds": 300,
    # Full recordings shorter than this are hidden unless "show short" is on
    "short_session_seconds": 60,
    "hide_short_sessions": True,
    # Audio tracks (by role) that start enabled when a video opens; empty = player default
    "default_mix": [],
    "remember_last_mix": True,
    # Gap that splits recordings into separate suggested events
    "event_gap_minutes": 45,
    "game_aliases": {},
    "volume": 100,
}


def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)


def default_roots():
    roots = []
    home_medal = Path.home() / "Videos" / "Medal"
    if home_medal.exists():
        roots.append(str(home_medal))
    for drive in "CDEFGH":
        p = Path(f"{drive}:/Medal")
        if p.exists():
            roots.append(str(p))
    return roots


def load_settings():
    ensure_dirs()
    s = dict(DEFAULTS)
    if SETTINGS_PATH.exists():
        try:
            s.update(json.loads(SETTINGS_PATH.read_text("utf-8")))
        except (OSError, ValueError):
            pass
    if not s["roots"]:
        s["roots"] = default_roots()
    return s


def save_settings(s):
    ensure_dirs()
    tmp = SETTINGS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=2), "utf-8")
    os.replace(tmp, SETTINGS_PATH)


def find_tool(name):
    """Locate ffmpeg/ffprobe: PATH first, then next to ffmpeg, then vendor/."""
    p = shutil.which(name)
    if p:
        return p
    ff = shutil.which("ffmpeg")
    if ff:
        cand = Path(ff).with_name(name + ".exe")
        if cand.exists():
            return str(cand)
    cand = VENDOR_DIR / (name + ".exe")
    return str(cand) if cand.exists() else None
