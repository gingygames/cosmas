"""Cosmas AI results -> the catalog: mentions of known characters / places / factions are stored
right away, new events and new characters / places / factions become proposals the user accepts or rejects."""
import html
import json
import time

from .analysis import analysis_dir, _read_json
from .i18n import tr
from .mentions import fold

TYPES = {"postava": "character", "misto": "place", "frakce": "faction"}


class Resolver:
    """Name as the model wrote it -> id of a known character / place / faction."""

    def __init__(self, store):
        self.idx = {"character": {}, "place": {}, "faction": {}}
        for c in store.characters():
            for n in [c["name"]] + [a.strip() for a in (c.get("aliases") or "").split(",") if a.strip()]:
                self.idx["character"].setdefault(fold(n), c["id"])
        for p in store.places():
            self.idx["place"].setdefault(fold(p["name"]), p["id"])
        for f in store.factions():
            self.idx["faction"].setdefault(fold(f["name"]), f["id"])

    def find(self, etype, name):
        f = fold(name).strip()
        if not f:
            return None
        idx = self.idx.get(etype, {})
        if f in idx:
            return idx[f]
        first = f.split()[0]
        for n, i in idx.items():       # "Lukáš" -> "Lukáš z Ratají", "Rataje" -> "Ratajích"
            if len(first) >= 4 and (n.split()[0] == first or n.startswith(f) or f.startswith(n)):
                return i
        return None


def import_chronicle(store, media_id):
    """Store mentions and proposals from data/analysis/<id>/chronicle.json. Returns the number of new proposals."""
    ch = _read_json(analysis_dir(media_id) / "chronicle.json")
    if not ch:
        return 0
    res = Resolver(store)
    mentions, props = [], {}
    for b in ch.get("blocks", []):
        for x in b.get("mentions", []) + b.get("new", []):
            etype = TYPES.get(x.get("type"))
            if not etype:
                continue
            eid = res.find(etype, x["name"])
            if eid:
                mentions.append((etype, eid, x["t"], x.get("text", "")))
            elif x in b.get("new", []):
                key = (etype, fold(x["name"]))
                p = props.setdefault(key, {"kind": etype, "key": key[1], "data": {
                    "name": x["name"], "text": x.get("text", ""), "t": x["t"], "times": []}})
                p["data"]["times"].append(x["t"])
                if len(x.get("text", "")) > len(p["data"]["text"]):
                    p["data"]["text"] = x["text"]
        for e in b.get("events", []):
            chars = sorted({c for c in (res.find("character", w) for w in e.get("who", [])) if c})
            place_id = res.find("place", e["place"]) if e.get("place") else None
            key = ("event", f"{int(e['t'])}:{fold(e['title'])[:40]}")
            props[key] = {"kind": "event", "key": key[1], "data": dict(e, chars=chars, place_id=place_id)}
    store.set_entity_mentions(media_id, mentions)
    return store.set_proposals(media_id, list(props.values()))


def accept(store, api, proposal_id, edits=None):
    """Create the event / character / place / faction from a proposal (with the user's edits)."""
    p = store.proposal(proposal_id)
    if not p or p["status"] != "new":
        return None
    d = dict(p["data"], **(edits or {}))
    m = store.media(p["media_id"])
    server = m.get("server_id") if m else None
    if p["kind"] == "event":
        base = m.start_time if m and m.start_time else None
        eid = api.m_event_create(d.get("title") or tr("Event"), start=base + d["t"] if base else None,
                                 end=base + d["t_end"] if base and d.get("t_end") else None, server_id=server)
        store.add_link(eid, p["media_id"], offset=d["t"], note=tr("from transcript"))
        body = f"<p>{html.escape(d.get('text', ''))}</p>" if d.get("text") else ""
        fields = {"body_html": body}
        if d.get("place_id"):
            fields["place_id"] = d["place_id"]
        elif d.get("place"):
            fields["location"] = d["place"]
        api.m_event_update(eid, **fields)
        for cid in d.get("chars") or []:
            store.link_character(cid, "event", eid)
        target = eid
    elif p["kind"] == "character":
        target = store.create_character(d["name"], summary=d.get("text", ""), server_id=server)
    elif p["kind"] == "place":
        target = store.create_place(d["name"], summary=d.get("text", ""), server_id=server)
    elif p["kind"] == "faction":
        target = store.create_faction(d["name"])
        store.update_faction(target, summary=d.get("text", ""), server_id=server)
    else:
        return None
    store.set_proposal_status(proposal_id, "accepted", target)
    if p["kind"] != "event":     # the new name now resolves: mentions in every video can find it
        for mid in store.proposal_media_ids():
            import_chronicle(store, mid)
    return {"kind": p["kind"], "id": target}


def proposal_json(p):
    return dict(p, data=json.loads(p["data"]) if isinstance(p["data"], str) else p["data"])


def now():
    return time.time()
