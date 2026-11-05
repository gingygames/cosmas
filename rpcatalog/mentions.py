"""Finds known characters in transcripts: names said aloud (with Czech word endings) and name tags
seen above characters in the picture (also player names -> their only character)."""
import re
import unicodedata

STOP = {"pan", "pane", "pani", "pana", "panu", "buh", "boha", "kriste", "jezis", "jsem", "jsme", "neni", "tady", "taky", "jako", "vole", "kral"}


def fold(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def _stems(text):
    """'Michal z Kutné Hory' -> {'michal'}; Czech endings: 'Lukáš' matches Lukáši/Lukášem, 'Barbora' Barboro/Barboru."""
    out = set()
    for w in re.findall(r"\w+", text or ""):
        if len(w) < 3 or not w[0].isupper():
            continue
        f = fold(w)
        if f in STOP:
            continue
        out.add(f[:-1] if len(f) >= 4 and f[-1] in "aeiouy" else f)
    return out


class Matcher:
    def __init__(self, characters, players=()):
        """characters: dicts id, name, aliases, player_id; players: dicts id, name, discord_name."""
        self.by_stem = {}
        for c in characters:
            names = [c["name"]] + [a.strip() for a in (c.get("aliases") or "").split(",") if a.strip()]
            for n in names:
                for s in _stems(n):
                    self.by_stem.setdefault(s, set()).add(c["id"])
        self.full = {}       # folded full names -> character ids (for name tags)
        for c in characters:
            for n in [c["name"]] + [a.strip() for a in (c.get("aliases") or "").split(",") if a.strip()]:
                self.full.setdefault(fold(n), set()).add(c["id"])
        chars_of = {}
        for c in characters:
            if c.get("player_id"):
                chars_of.setdefault(c["player_id"], []).append(c["id"])
        for p in players:
            ids = chars_of.get(p["id"], [])
            if len(ids) == 1:          # a player tag only says who it is when they play one character
                for n in (p.get("name"), p.get("discord_name")):
                    if n:
                        self.full.setdefault(fold(n), set()).add(ids[0])
        # stems are ambiguous when two characters share them ("Jan" and "Jana") - drop those
        self.by_stem = {s: next(iter(ids)) for s, ids in self.by_stem.items() if len(ids) == 1}
        self.re = re.compile(r"\b(" + "|".join(sorted(map(re.escape, self.by_stem), key=len, reverse=True)) + r")\w{0,4}\b") \
            if self.by_stem else None

    def in_speech(self, text):
        """Character ids named in spoken text (capitalised words only, so 'pána' is not 'Pán')."""
        if not self.re or not text:
            return set()
        out = set()
        folded = fold(text)
        for m in self.re.finditer(folded):
            if text[m.start():m.start() + 1].isupper():     # fold() keeps positions for Czech letters
                out.add(self.by_stem[m.group(1)])
        return out

    def name_tag(self, tag):
        f = fold(tag).strip()
        if not f:
            return set()
        if f in self.full:
            return set(self.full[f])
        for name, ids in self.full.items():      # "Ginger [KC]" -> "ginger"
            if len(name) >= 4 and (f.startswith(name) or name.startswith(f) and len(f) >= 4):
                return set(ids)
        return set()


def find(rows, frames, matcher):
    """Mentions [{character_id, t, kind}] from transcript rows and frame info (names seen in the picture)."""
    out, seen = [], set()
    for r in rows:
        if r["speaker"] == "Obraz":
            continue
        for cid in matcher.in_speech(r["text"]):
            key = (cid, int(r["t"] // 60), "speech")
            if key not in seen:
                seen.add(key)
                out.append({"character_id": cid, "t": r["t"], "kind": "speech"})
    for f in frames:
        for tag in f.get("names") or []:
            for cid in matcher.name_tag(tag):
                key = (cid, int(f["t"] // 60), "seen")
                if key not in seen:
                    seen.add(key)
                    out.append({"character_id": cid, "t": f["t"], "kind": "seen"})
    return out
