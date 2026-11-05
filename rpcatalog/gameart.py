"""Artwork for games (icon in the left rail, banner in the library): Steam library on this PC,
Steam store search, Medal's own game icons, or anything the user picks."""
import json
import os
import re
import urllib.parse
import urllib.request

UA = "Kronikar (local catalog app)"
CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/{file}"


def _key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def steam_root():
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
                p = winreg.QueryValueEx(k, "SteamPath")[0]
                if os.path.isdir(p):
                    return os.path.normpath(p)
        except OSError:
            pass
    for p in (r"C:\Program Files (x86)\Steam", r"C:\Program Files\Steam"):
        if os.path.isdir(p):
            return p
    return None


def _libraries(root):
    libs = [root]
    vdf = os.path.join(root, "steamapps", "libraryfolders.vdf")
    try:
        for m in re.finditer(r'"path"\s+"([^"]+)"', open(vdf, encoding="utf-8", errors="ignore").read()):
            p = m.group(1).replace("\\\\", "\\")
            if os.path.isdir(p) and p not in libs:
                libs.append(p)
    except OSError:
        pass
    return libs


def installed_games():
    """[{appid, name}] from appmanifest files of all Steam libraries."""
    root = steam_root()
    if not root:
        return []
    out = {}
    for lib in _libraries(root):
        d = os.path.join(lib, "steamapps")
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            if n.startswith("appmanifest_") and n.endswith(".acf"):
                try:
                    t = open(os.path.join(d, n), encoding="utf-8", errors="ignore").read()
                except OSError:
                    continue
                a, nm = re.search(r'"appid"\s+"(\d+)"', t), re.search(r'"name"\s+"([^"]+)"', t)
                if a and nm:
                    out[a.group(1)] = nm.group(1)
    return [{"appid": k, "name": v} for k, v in out.items()]


def local_images(appid):
    """Images Steam already has on disk for an app (cover, hero, logo, header)."""
    root = steam_root()
    if not root:
        return []
    cache = os.path.join(root, "appcache", "librarycache")
    found = []
    sub = os.path.join(cache, str(appid))
    if os.path.isdir(sub):                       # newer Steam: librarycache/<appid>/...
        for dirpath, _, files in os.walk(sub):
            for f in files:
                if f.lower().endswith((".jpg", ".png")):
                    found.append(os.path.join(dirpath, f))
    for f in ("library_600x900", "library_hero", "logo", "header", "icon"):  # older layout
        for ext in (".jpg", ".png"):
            p = os.path.join(cache, f"{appid}_{f}{ext}")
            if os.path.exists(p):
                found.append(p)

    def kind(p):
        n = os.path.basename(p).lower()
        return ("cover" if "600x900" in n else "hero" if "hero" in n else "logo" if "logo" in n
                else "header" if "header" in n else "jiný")
    return [{"path": p, "kind": kind(p), "size": os.path.getsize(p)} for p in found if os.path.getsize(p) > 2000]


def match_installed(game):
    """Installed Steam apps whose name fits the game name (Medal names, e.g. 'KingdomCome' or 'Kingdoms Connected')."""
    k = _key(game)
    if not k:
        return []
    res = []
    for g in installed_games():
        gk = _key(g["name"])
        score = 3 if gk == k else 2 if (k in gk or gk in k) else 1 if (len(k) > 5 and k[:6] == gk[:6]) else 0
        if score:
            res.append(dict(g, score=score))
    return sorted(res, key=lambda g: -g["score"])


def store_search(term):
    url = "https://store.steampowered.com/api/storesearch/?" + urllib.parse.urlencode({"term": term, "l": "czech", "cc": "CZ"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = []
    for it in data.get("items", [])[:12]:
        i = it.get("id")
        out.append({"appid": str(i), "name": it.get("name", ""),
                    "images": [{"url": CDN.format(id=i, file=f), "kind": k} for f, k in
                               (("library_600x900.jpg", "cover"), ("library_hero.jpg", "hero"),
                                ("header.jpg", "header"), ("logo.png", "logo"))]})
    return out


def medal_icons():
    d = os.path.join(os.environ.get("APPDATA", ""), "Medal", "GameIcons")
    try:
        return [{"path": os.path.join(d, f), "kind": "ikona z Medalu", "name": os.path.splitext(f)[0]}
                for f in os.listdir(d) if f.lower().endswith((".png", ".jpg", ".ico"))]
    except OSError:
        return []


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()
