"""Scan recording folders and merge in Medal metadata, ffprobe data and thumbnails."""
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

from . import config
from .i18n import tr
from .medal_db import read_medal
from .store import MEDIA_COLS

VIDEO_EXT = {".mp4", ".mkv", ".mov", ".webm"}
SKIP_DIRS = {"temp", "editor", "video-editor", "thumbnails", ".thumbnails", "databases", "screenshots"}
SIDECAR_RE = re.compile(r"^(?P<stem>.+)_(?P<role>game|mic|microphone|discord|system|desktop)$", re.I)
NAME_RE = re.compile(r"^MedalTV(?P<game>.*?)(?P<ts>\d{14,17})")
SIDECAR_ROLE = {"game": "game", "mic": "mic", "microphone": "mic", "discord": "discord",
                "system": "system", "desktop": "system"}
NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def game_key(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def filename_time(name):
    m = NAME_RE.match(name)
    if not m:
        return None, None
    game, ts = m.group("game"), m.group("ts")
    # a game name ending in a digit ("RedDeadRedemption2") runs into the timestamp: move digits back to the
    # name until the rest parses as a date
    while len(ts) >= 14:
        try:
            t = dt.datetime.strptime(ts[:14], "%Y%m%d%H%M%S")
            if not 2000 <= t.year <= 2100:
                raise ValueError(ts)
            if len(ts) > 14:
                t += dt.timedelta(milliseconds=int(ts[14:].ljust(3, "0")[:3]))
            return t.timestamp(), game or None
        except ValueError:
            game, ts = game + ts[0], ts[1:]
    return None, m.group("game") or None


def ffprobe(path):
    tool = config.find_tool("ffprobe")
    if not tool:
        return None
    try:
        out = subprocess.run(
            [tool, "-v", "error", "-show_entries",
             "format=duration:stream=index,codec_type:stream_tags=title,handler_name",
             "-of", "json", path],
            capture_output=True, timeout=30, creationflags=NO_WINDOW)
        data = json.loads(out.stdout or b"{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    dur = data.get("format", {}).get("duration")
    tracks = []
    for s in data.get("streams", []):
        if s.get("codec_type") == "audio":
            title = (s.get("tags") or {}).get("title") or ""
            tracks.append({"name": title, "role": "all" if not tracks else "other"})
    return {"duration": float(dur) if dur else None, "tracks": tracks}


def make_thumb(video, duration):
    tool = config.find_tool("ffmpeg")
    if not tool:
        return None
    name = hashlib.sha1(video.lower().encode("utf-8")).hexdigest()[:16] + ".jpg"
    dst = config.THUMB_DIR / name
    if dst.exists() and dst.stat().st_size > 0:
        return str(dst)
    seek = min(180.0, max(1.0, (duration or 3) * 0.1))
    try:
        subprocess.run([tool, "-v", "error", "-y", "-ss", f"{seek:.2f}", "-i", video,
                        "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(dst)],
                       capture_output=True, timeout=60, creationflags=NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        return None
    return str(dst) if dst.exists() and dst.stat().st_size > 0 else None


# ffprobe results and failed thumbnails by file signature (size, mtime): a rescan (every few minutes) doesn't run
# ffprobe / ffmpeg again on files that haven't changed (OBS recordings Medal doesn't know, broken files)
CACHE_NAME = "scan_cache.json"


def _sig(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    return [st.st_size, st.st_mtime_ns]


def _load_cache(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            c = json.load(f)
        if isinstance(c, dict) and c.get("v") == 1:
            return {"v": 1, "probe": dict(c.get("probe") or {}), "thumb_failed": dict(c.get("thumb_failed") or {})}
    except (OSError, ValueError, TypeError):
        pass
    return {"v": 1, "probe": {}, "thumb_failed": {}}


def _save_cache(path, cache):
    try:
        tmp = str(path) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass


def _same(a, b):
    """Stored value vs scanned one (SQLite gives TEXT columns back as str, e.g. a numeric Medal id)."""
    return a == b or (a is not None and b is not None and str(a) == str(b))


def _walk_videos(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS]
        for f in filenames:
            if os.path.splitext(f)[1].lower() in VIDEO_EXT:
                yield os.path.join(dirpath, f)


def _game_from_path(path, root):
    rel = os.path.relpath(path, root).split(os.sep)
    if len(rel) >= 3 and rel[0].lower() == "clips":
        return rel[1]
    if len(rel) >= 2 and rel[0].lower() == "edits":
        return None
    if len(rel) >= 2 and rel[0].lower() != "clips":
        return rel[0]
    return None


def scan(store, settings, progress=None, cache_path=None):
    """Scan all roots and update the store. Returns a summary dict; `changed` = rows added, updated or gone
    (0 = the catalogue is exactly as before and the UI needs no reload)."""
    roots = [r for r in settings["roots"] if os.path.isdir(r)]
    cache_path = cache_path or (config.DATA_DIR / CACHE_NAME)
    cache = _load_cache(cache_path)
    medal = read_medal(roots)
    aliases = settings.get("game_aliases", {})
    clip_max = settings.get("clip_max_seconds", 300)

    files = {}
    for root in roots:
        for p in _walk_videos(root):
            files[os.path.normcase(p)] = (p, root)
    # Videos Medal knows about outside the configured roots
    for key, info in medal.items():
        if key not in files and os.path.exists(info["path"]):
            files[key] = (info["path"], os.path.dirname(os.path.dirname(info["path"])))

    # Separate per-source audio files (e.g. X_Game.mp4, X_Mic.mp4) attach to X.mp4
    sidecars = {}
    for key, (p, root) in list(files.items()):
        stem, ext = os.path.splitext(os.path.basename(p))
        m = SIDECAR_RE.match(stem)
        if not m:
            continue
        main_key = os.path.normcase(os.path.join(os.path.dirname(p), m.group("stem") + ext))
        if main_key in files:
            sidecars.setdefault(main_key, []).append(
                {"path": p, "role": SIDECAR_ROLE[m.group("role").lower()], "name": m.group("role")})
            del files[key]

    need_probe = [k for k in files if k not in medal or not medal[k].get("duration")]
    sigs = {k: _sig(files[k][0]) for k in need_probe}
    probes, old_probe, new_probe = {}, cache["probe"], {}
    for k in need_probe:
        c = old_probe.get(k)
        if sigs[k] is not None and isinstance(c, dict) and c.get("sig") == sigs[k]:
            probes[k] = c.get("res") or {}
    todo_probe = [k for k in need_probe if k not in probes]
    if todo_probe and config.find_tool("ffprobe"):
        with ThreadPoolExecutor(max_workers=6) as ex:
            for k, res in zip(todo_probe, ex.map(lambda k: ffprobe(files[k][0]), todo_probe)):
                probes[k] = res or {}
    for k in need_probe:
        if k in probes and sigs[k] is not None:
            new_probe[k] = {"sig": sigs[k], "res": probes[k]}
    cache["probe"] = new_probe          # only files that still exist

    records = []
    for i, (key, (path, root)) in enumerate(sorted(files.items())):
        info = medal.get(key, {})
        probe = probes.get(key, {})
        base = os.path.basename(path)
        f_time, f_game = filename_time(base)

        game = _game_from_path(path, root) or f_game or info.get("game_caption") or "Ostatní"
        game = aliases.get(game, game)
        duration = info.get("duration") or probe.get("duration")
        start = info.get("start_time")
        if start is None and info.get("trim_start") is not None and f_time:
            start = f_time + info["trim_start"]
        if start is None:
            start = f_time
        if start is None:
            try:
                start = os.path.getctime(path)
            except OSError:
                start = None
        kind = info.get("kind")
        if kind == "clip" and info.get("trim_start") is not None and duration and duration > clip_max:
            kind = "session"  # long cut-out of a full recording
        if not kind:
            kind = "clip" if duration is not None and duration <= clip_max else (
                "session" if duration is not None else "clip")
        tracks = info.get("tracks") or probe.get("tracks") or []
        try:
            size = os.path.getsize(path)
        except OSError:
            size = None
        records.append({
            "path": path, "game": game, "kind": kind, "kind_override": None,
            "start_time": start, "duration": duration, "size": size,
            "medal_id": info.get("medal_id"), "medal_title": info.get("medal_title"),
            "thumb": info.get("thumb"),
            "tracks": json.dumps(tracks, ensure_ascii=False),
            "bookmarks": json.dumps(info.get("bookmarks") or [], ensure_ascii=False),
            "sidecars": json.dumps(sidecars.get(key, []), ensure_ascii=False),
            "parent_path": info.get("parent_path"),
        })

    # Medal names the same game differently ("Kingdoms Connected" folder vs
    # "KingdomsConnected" in trimmed files): merge variants, prefer the spaced one.
    variants = {}
    for r in records:
        variants.setdefault(game_key(r["game"]), []).append(r["game"])
    canonical = {}
    for key, names in variants.items():
        best = max(set(names), key=lambda n: (" " in n, names.count(n)))
        canonical[key] = aliases.get(best, best)
    for r in records:
        r["game"] = canonical[game_key(r["game"])]

    # Thumbnails for anything Medal didn't make one for. Medal's thumbnails of full
    # recordings are often the black first frame (tiny files) - replace those too.
    for r in records:
        try:
            if r["thumb"] and os.path.getsize(r["thumb"]) < 6000:
                r["thumb"] = None
        except OSError:
            r["thumb"] = None
    failed_old, failed = cache["thumb_failed"], {}
    todo = []
    for r in records:
        if r["thumb"]:
            continue
        k, sig = os.path.normcase(r["path"]), _sig(r["path"])
        if sig is not None and failed_old.get(k) == sig:
            failed[k] = sig                 # ffmpeg couldn't make one last time and the file is the same
        else:
            todo.append((r, k, sig))
    if todo and config.find_tool("ffmpeg"):
        with ThreadPoolExecutor(max_workers=4) as ex:
            for n, ((r, k, sig), t) in enumerate(zip(todo, ex.map(lambda x: make_thumb(x[0]["path"], x[0]["duration"]), todo))):
                r["thumb"] = t
                if not t and sig is not None:
                    failed[k] = sig
                if progress:
                    progress(tr("Thumbnails {n}/{total}", n=n + 1, total=len(todo)))
    cache["thumb_failed"] = failed
    _save_cache(cache_path, cache)

    cols = ", ".join(c for c in MEDIA_COLS if c != "path")
    by_path = {r["path"]: r for r in store.db.execute(f"SELECT id, path, missing, game_user, {cols} FROM media")}
    seen = set()
    added = updated = 0
    for r in records:
        old = by_path.get(r["path"])
        seen.add(r["path"])
        if old is not None:
            r["kind_override"] = old["kind_override"]
            same = not old["missing"] and all(
                _same(old[c], r.get(c)) or (c == "game" and old["game_user"] and old["game"]) for c in MEDIA_COLS if c != "path")
            if same:
                continue                    # nothing new: no write, and the UI isn't told to reload
            updated += 1
        else:
            added += 1
        store.upsert_media(r)
    missing = store.mark_missing_except(seen, roots)
    store.commit()
    return {"files": len(records), "medal": sum(1 for r in records if r["medal_id"]),
            "missing": missing, "roots": roots, "added": added, "updated": updated,
            "changed": added + updated + missing}
