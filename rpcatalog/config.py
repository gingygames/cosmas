"""Paths and user settings (stored as JSON next to the catalog database)."""
import json
import os
import shutil
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
# Per-user folder of an installed copy (the install folder itself may not be writable)
USER_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "Kronikar"
_DEV_DATA = APP_DIR / "data"
# A source checkout keeps its data next to the code (as it always did); an installed copy uses USER_DIR.
IS_DEV = _DEV_DATA.exists() or (APP_DIR / ".git").exists()
DATA_DIR = Path(os.environ["KRONIKAR_DATA"]) if os.environ.get("KRONIKAR_DATA") else (_DEV_DATA if IS_DEV else USER_DIR)
THUMB_DIR = DATA_DIR / "thumbs"
DB_PATH = DATA_DIR / "catalog.db"
SETTINGS_PATH = DATA_DIR / "settings.json"
VENDOR_DIR = APP_DIR / "vendor"
# Optional Python packages downloaded later (e.g. CUDA libraries for speech on NVIDIA); see rpcatalog/__init__.py
PYLIBS_DIR = DATA_DIR / "pylibs"
DEV_POINTER = USER_DIR / "last_dev_data.txt"
# What moves from a source checkout's data folder into a fresh install (temporary files stay behind)
_MIGRATE_SKIP = {"tmp", "pylibs", "catalog.db", "catalog.db-wal", "catalog.db-shm", "catalog.db.tmp"}
_MIGRATE_SKIP_FILES = {"pause.flag", "skip.flag", "queue.json", "queue.tmp", "worker.json"}


def prepare_data_dir():
    """Called once at app start. A source checkout remembers where its data is; an installed copy that has
    no catalog yet takes that data over once (database, settings, thumbnails, transcripts, models)."""
    try:
        if DATA_DIR == _DEV_DATA:
            USER_DIR.mkdir(parents=True, exist_ok=True)
            DEV_POINTER.write_text(str(DATA_DIR), "utf-8")
        elif DATA_DIR == USER_DIR and not DB_PATH.exists() and DEV_POINTER.exists():
            src = Path(DEV_POINTER.read_text("utf-8").strip())
            if (src / "catalog.db").exists() and src != DATA_DIR:
                _import_data(src)
    except Exception:          # never block the start; worst case the catalog starts empty
        import traceback
        traceback.print_exc()


def _import_data(src):
    import sqlite3
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name in _MIGRATE_SKIP:
            continue
        if item.is_dir():
            shutil.copytree(item, DATA_DIR / item.name, dirs_exist_ok=True,
                            ignore=lambda d, names: [n for n in names if n in _MIGRATE_SKIP_FILES])
        else:
            shutil.copy2(item, DATA_DIR / item.name)
    tmp = DATA_DIR / "catalog.db.tmp"
    a, db = sqlite3.connect(src / "catalog.db"), sqlite3.connect(tmp)
    a.backup(db)                          # consistent copy even while the other copy has the database open
    a.close()
    pairs = [(str(src), str(DATA_DIR)), (src.as_posix(), DATA_DIR.as_posix()), (src.as_uri(), DATA_DIR.as_uri())]
    with db:                              # stored file paths point into the old folder
        for (table, sql) in db.execute("SELECT name, sql FROM sqlite_master WHERE type='table'").fetchall():
            if (sql or "").upper().startswith("CREATE VIRTUAL") or table.startswith("transcript_"):
                continue
            for col in db.execute(f'PRAGMA table_info("{table}")').fetchall():
                if col[2].upper() not in ("", "TEXT"):
                    continue
                for old, new in pairs:
                    db.execute(f'UPDATE "{table}" SET "{col[1]}" = REPLACE("{col[1]}", ?, ?) WHERE "{col[1]}" LIKE ?',
                               (old, new, f"%{old}%"))
    db.execute("PRAGMA journal_mode=DELETE")    # one file to move; the app switches WAL on again
    db.close()
    os.replace(tmp, DB_PATH)
    if SETTINGS_PATH.exists():
        txt = SETTINGS_PATH.read_text("utf-8")
        for old, new in pairs:
            txt = txt.replace(json.dumps(old)[1:-1], json.dumps(new)[1:-1])
        SETTINGS_PATH.write_text(txt, "utf-8")

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
    # Transcripts of recordings (analysis.py, analysis_jobs.py) - edited on the Přepisy page
    # Where each part of the AI runs (ai_providers.py): "local"/"ollama" on this PC, or a paid service.
    # Empty model = what the hardware check recommends for this PC (hardware.recommend).
    "ai_setup_done": False,
    "ai_speech_provider": "local",
    "ai_speech_model": "",           # model at the paid service
    "ai_vision_provider": "ollama",
    "ai_text_provider": "ollama",
    "ai_whisper_device": "auto",     # auto | cpu
    "ai_whisper_model": "",
    "ai_language": "cs",
    "ai_batch_size": 16,
    "ai_beam_size": 5,
    "ai_vad_threshold": 0.5,
    "ai_junk_filter": True,
    "ai_tracks": ["Já", "Hra", "Discord", "Zvuk"],
    "ai_vision_model": "",
    "ai_vision_width": 768,
    "ai_vision_dialog": True,        # look at the picture during conversations
    "ai_dialog_every": 8,            # ... every N s while the scene changes (people walk around)
    "ai_static_every": 45,           # ... and only every N s while it stays the same (people sit and talk)
    "ai_motion_threshold": 0.06,     # how much the picture must change to count as a new scene (0-1)
    "ai_conv_gap": 20,               # speech pauses shorter than this are one conversation
    "ai_base_every": 120,            # outside conversations (0 = never)
    "ai_detect_names": True,         # read name tags above characters
    "ai_detect_faces": True,         # cut out faces during conversations
    "ai_appearance": True,           # recognise characters by clothing, hair and face
    "ai_look_threshold": 0.60,       # how similar a figure must be to a character's references
    "ai_look_margin": 0.04,          # ... and how much more than to the second most similar character
    "ai_look_half_life": 30,         # days after which an older reference (other clothes?) counts less
    "ai_context": "",                # a few words about the game / server for the models
    "ai_chapters": True,
    "ai_text_model": "",
    "ai_chapter_minutes": 15,
    "ai_chapter_bookmarks": False,   # chapters also as bookmarks (seek bar, Momenty)
    "ai_autolink": True,             # characters found in a transcript are added to the video
    "ai_subtitles": True,            # transcript as subtitles in the player
    "ai_pause_gaming": True,
    "ai_pause_any_game": True,       # also any game from Steam, Epic, Xbox, GOG… folders
    "ai_pause_processes": [],        # empty = the games found in recordings
    "ai_priority": "below",          # idle | below | normal
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
    """Locate ffmpeg/ffprobe: the copy bundled in vendor/ (installed app), then PATH, then next to ffmpeg."""
    cand = VENDOR_DIR / (name + ".exe")
    if cand.exists():
        return str(cand)
    p = shutil.which(name)
    if p:
        return p
    ff = shutil.which("ffmpeg")
    if ff:
        cand = Path(ff).with_name(name + ".exe")
        if cand.exists():
            return str(cand)
    return None
