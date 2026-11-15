"""Recording folders of common capture programs on this PC (Medal, OBS, NVIDIA, Xbox Game Bar, AMD, Outplayed).

Only Medal folders are added by themselves (default_roots); everything else is *offered* on the overview and in
Settings → Library, because a folder like Videos can hold films and other videos the user doesn't want catalogued.
Detection only reads: the Windows Videos folder, OBS's profile files and NVIDIA's registry value."""
import configparser
import os
import string
from pathlib import Path

from .i18n import tr

LABELS = {"medal": "Medal", "obs": "OBS Studio", "nvidia": "NVIDIA (ShadowPlay / NVIDIA App)", "xbox": "Xbox Game Bar",
          "amd": "AMD Radeon ReLive", "outplayed": "Outplayed (Overwolf)", "insights": "Insights Capture (Overwolf)"}
COUNT_CAP = 200          # stop counting recordings here (the number is only a hint)


def videos_dir():
    """The Windows Videos folder – the user may have moved it (e.g. to another drive); ~/Videos elsewhere."""
    if os.name == "nt":
        try:
            import ctypes
            import uuid
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [("d1", wintypes.DWORD), ("d2", wintypes.WORD), ("d3", wintypes.WORD), ("d4", ctypes.c_ubyte * 8)]
            u = uuid.UUID("18989B1D-99B5-455B-841C-AB7C74E4DDFC")      # FOLDERID_Videos
            g = GUID(u.fields[0], u.fields[1], u.fields[2], (ctypes.c_ubyte * 8)(*u.bytes[8:]))
            out = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(out)) == 0:
                path = out.value
                ctypes.windll.ole32.CoTaskMemFree(out)
                if path:
                    return Path(path)
        except Exception:
            pass
    return Path.home() / "Videos"


def _drives():
    if os.name != "nt":
        return []
    try:
        import ctypes
        mask = ctypes.windll.kernel32.GetLogicalDrives()
    except Exception:
        return [f"{d}:/" for d in "CDEFGH"]
    return [f"{d}:/" for i, d in enumerate(string.ascii_uppercase) if mask >> i & 1 and d not in "AB"]


def medal_folders(videos=None):
    """Medal's default places: Videos\\Medal and X:\\Medal on every drive."""
    out = [(videos or videos_dir()) / "Medal"]
    out += [Path(d) / "Medal" for d in _drives()]
    return [p for p in out if p.is_dir()]


def obs_folders(appdata=None, videos=None):
    """Recording paths from OBS's profiles (simple and advanced output); OBS's own default is the Videos folder."""
    base = Path(appdata or os.environ.get("APPDATA", "")) / "obs-studio" / "basic" / "profiles"
    if not base.is_dir():
        return []
    paths = []
    for ini in sorted(base.glob("*/basic.ini")):
        cp = configparser.ConfigParser(interpolation=None, strict=False)
        try:
            cp.read(ini, encoding="utf-8-sig")
        except (configparser.Error, OSError, UnicodeDecodeError):
            continue
        mode = cp.get("Output", "Mode", fallback="Simple").lower()
        keys = [("AdvOut", "RecFilePath"), ("AdvOut", "FFFilePath")] if mode == "advanced" else [("SimpleOutput", "FilePath")]
        for sec, key in keys:
            v = cp.get(sec, key, fallback="").strip()
            if v:
                paths.append(Path(v.replace("/", os.sep)))
    return paths or [videos or videos_dir()]


def nvidia_folders():
    """ShadowPlay / NVIDIA App: the save folder from the registry (DefaultPathW, UTF-16)."""
    if os.name != "nt":
        return []
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\NVIDIA Corporation\Global\ShadowPlay\NVSPCAPS") as k:
            raw, _ = winreg.QueryValueEx(k, "DefaultPathW")
        path = raw.decode("utf-16-le").split("\x00")[0] if isinstance(raw, (bytes, bytearray)) else str(raw)
        return [Path(path)] if path else []
    except (OSError, ImportError, UnicodeDecodeError):
        return []


def _count(folder, exts, cap=COUNT_CAP, max_dirs=1500):
    n = dirs = 0
    try:
        for dirpath, dirnames, filenames in os.walk(folder):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            n += sum(1 for f in filenames if os.path.splitext(f)[1].lower() in exts)
            dirs += 1
            if n >= cap or dirs >= max_dirs:      # a hint is enough; don't crawl a whole drive
                return min(n, cap)
    except OSError:
        return 0
    return n


def _norm(p):
    return os.path.normcase(os.path.normpath(str(p)))


def _covered(path, roots):
    """True when the folder is one of the roots or inside one (its recordings are scanned already)."""
    p = _norm(path)
    for r in roots:
        r = _norm(r)
        if p == r or p.startswith(r.rstrip(os.sep) + os.sep):
            return True
    return False


def detect(roots=(), dismissed=(), exts=None, videos=None, appdata=None):
    """[{id, label, path, count, added, dismissed, whole_videos}] for folders that exist, most likely first.
    count is capped at COUNT_CAP; whole_videos warns that the folder is the entire Videos folder."""
    from .scanner import VIDEO_EXT
    exts = exts or VIDEO_EXT
    vids = Path(videos) if videos else videos_dir()
    cands = [("medal", p) for p in medal_folders(vids)]
    cands += [("obs", p) for p in obs_folders(appdata, vids)]
    cands += [("nvidia", p) for p in nvidia_folders()]
    cands += [("xbox", vids / "Captures"), ("amd", vids / "Radeon ReLive"),
              ("outplayed", vids / "Overwolf" / "Outplayed"), ("insights", vids / "Overwolf" / "Insights Capture")]
    seen, out = set(), []
    dis = {_norm(d) for d in dismissed or ()}
    for kind, path in cands:
        key = _norm(path)
        if key in seen or not Path(path).is_dir():
            continue
        seen.add(key)
        whole = key == _norm(vids)
        out.append({"id": kind, "label": LABELS[kind], "path": str(path), "count": _count(path, exts),
                    "added": _covered(path, roots), "dismissed": key in dis, "whole_videos": whole,
                    "note": tr("The whole Videos folder – films and other videos in it would be catalogued too.") if whole else ""})
    return out
