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
    # Transcripts of recordings (analysis.py, analysis_jobs.py) - edited on the Přepisy page
    "ai_whisper_model": "large-v3",
    "ai_language": "cs",
    "ai_batch_size": 16,
    "ai_beam_size": 5,
    "ai_vad_threshold": 0.5,
    "ai_junk_filter": True,
    "ai_tracks": ["Já", "Hra", "Discord", "Zvuk"],
    "ai_vision_model": "qwen3.8:27b",
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
    "ai_text_model": "qwen3.8:27b",
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
