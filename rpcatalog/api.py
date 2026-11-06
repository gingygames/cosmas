"""JSON API exposed to the web UI over QWebChannel.

JS calls  api.call(method, argsJson) -> resultJson  ({"ok": ..} or {"error": ..}).
Python pushes notifications with the `notify(kind, payloadJson)` signal.
"""
import base64
import json
import mimetypes
import os
import re
import shutil
import subprocess
import time
import traceback
import uuid
from pathlib import Path

from PySide6.QtCore import QObject, Signal, Slot, QUrl
from PySide6.QtWidgets import QFileDialog

from . import config, suggest
from . import discord_link
from . import gameart
from .analysis import analysis_dir, coverage, load_frames
from .analysis_jobs import speech_tracks

ATT_DIR = config.DATA_DIR / "attachments"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def file_url(path):
    return QUrl.fromLocalFile(str(path)).toString() if path else None


class Api(QObject):
    notify = Signal(str, str)

    def __init__(self, store, settings, host):
        """host: object with play(media, offset), player_snapshot(path) -> (media, pos) | None,
        rescan(), save_settings(), confirm(title, text) -> bool, window (QWidget)."""
        super().__init__()
        self.store = store
        self.settings = settings
        self.host = host
        ATT_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ dispatch
    READ_ONLY = {"bootstrap", "media.list", "media.get", "media.reveal", "media.play", "player.action",
                 "album.items", "events.list", "event.get", "event.suggest", "event.propose", "events.at",
                 "att.open", "att.reveal", "att.play_source", "gallery", "chars.list", "char.get", "timeline.data",
                 "settings.get", "pick_folder", "open_data_dir", "rescan", "bm.list", "bm.get", "snap.grab",
                 "layout.set", "window.bg", "window.zoom", "pane.toggle", "places.list", "place.get",
                 "letters.list", "discord.members", "game.art_sources", "game.art_search", "game.image_data",
                 "game.art_pick_file", "game.art_installed", "factions.list", "faction.get", "players.list", "player.get",
                 "analysis.get", "analysis.queue", "analysis.stats", "analysis.models", "analysis.overview",
                 "analysis.char_mentions", "analysis.search", "analysis.open_timeline", "analysis.skip",
                 "analysis.pause", "analysis.move", "analysis.remove", "analysis.proposals", "analysis.entity_mentions",
                 "analysis.char_looks", "ai.info", "ai.open"}

    @Slot(str, str, result=str)
    def call(self, method, args_json):
        try:
            args = json.loads(args_json or "{}")
            src = args.pop("_src", None)
            fn = getattr(self, "m_" + method.replace(".", "_"), None)
            if fn is None:
                raise ValueError(f"unknown method {method}")
            out = json.dumps({"ok": fn(**args)}, ensure_ascii=False, default=str)
            if method not in self.READ_ONLY:
                self.emit("sync", {"method": method, "src": src})   # lets the other page refresh
            return out
        except Exception as e:  # report to JS instead of crashing the bridge
            traceback.print_exc()
            return json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False)

    def emit(self, kind, payload=None):
        self.notify.emit(kind, json.dumps(payload or {}, ensure_ascii=False, default=str))

    # ------------------------------------------------------------ serializers
    def _media(self, m, linked=None, chars=None, bms=None):
        if m is None:
            return None
        return {
            "id": m.id, "title": m.title, "medal_title": m.medal_title, "name": m.display_title,
            "game": m.game, "kind": m.kind, "kind_override": m.kind_override, "type": m.effective_kind,
            "start": m.start_time, "end": m.end_time, "duration": m.duration, "size": m.size,
            "thumb": file_url(m.get("custom_thumb") or m.thumb), "thumb_size": _fsize(m.get("custom_thumb") or m.thumb),
            "custom_thumb": bool(m.get("custom_thumb")), "server_id": m.get("server_id"), "tags": m.tags, "favorite": bool(m.favorite),
            "missing": bool(m.missing), "description": m.description or "", "path": m.path,
            "linked": (m.id in linked) if linked is not None else None,
            "tracks": m.track_names(), "bookmarks": bms.get(m.id, []) if bms is not None else self._bm_marks(m.id),
            "sidecars": len(m.sidecar_list()),
            "resume": m.get("resume_pos"), "watched_at": m.get("watched_at"),
            "chars": chars.get(m.id, []) if chars is not None else None,
        }

    @staticmethod
    def _bm_mark(b):
        return {"id": b["id"], "t": b["t"], "t_end": b["t_end"], "title": b["title"], "source": b["source"],
                "event_id": b["event_id"], "color": b["color"] or b["event_color"] or ""}

    def _bm_marks(self, media_id):
        return [self._bm_mark(b) for b in self.store.bookmarks(media_id=media_id)]

    def _bm_map(self):
        out = {}
        for b in self.store.bookmarks():
            out.setdefault(b["media_id"], []).append(self._bm_mark(b))
        return out

    def _bm(self, b, chars=None, media=None):
        b = dict(b)
        m = media if media is not None else self.store.media(b["media_id"])
        b["abs"] = (m.start_time + b["t"]) if m and m.start_time else None
        b["media"] = {"id": m.id, "name": m.display_title, "game": m.game, "thumb": file_url(m.thumb),
                      "duration": m.duration, "start": m.start_time, "type": m.effective_kind} if m else None
        b["chars"] = (chars if chars is not None else self._char_map("bookmark")).get(b["id"], [])
        b.pop("medal_key", None)
        return b

    def _player_tag_map(self):
        tags = {p["id"]: _split_tags(p.get("tags")) for p in self.store.players()}
        return {c["id"]: tags.get(c["player_id"], []) for c in self.store.characters() if c["player_id"]}

    def _bms(self, rows):
        chars = self._char_map("bookmark")
        ptags = self._player_tag_map()
        cache = {}
        out = []
        for b in rows:
            if b["media_id"] not in cache:
                cache[b["media_id"]] = self.store.media(b["media_id"])
            if cache[b["media_id"]]:
                d = self._bm(b, chars, cache[b["media_id"]])
                d["tags"] = sorted({t for cid in d["chars"] for t in ptags.get(cid, [])})
                out.append(d)
        return out

    def _att(self, a):
        a = dict(a)
        a["url"] = file_url(a["path"])
        return a

    def _char_map(self, target_type):
        out = {}
        for l in self.store.character_links(target_type=target_type):
            out.setdefault(l["target_id"], [])
            if l["character_id"] not in out[l["target_id"]]:
                out[l["target_id"]].append(l["character_id"])
        return out

    def _char(self, c, members=None):
        c = dict(c)
        mem = members.get(c["id"], []) if members is not None else self.store.faction_members(char_id=c["id"])
        c["factions"] = [{"id": m["faction_id"], "name": m["faction_name"], "color": m["faction_color"],
                          "kind": m["faction_kind"], "role": m["role"]} for m in mem]
        if c["factions"]:
            c["faction"] = ", ".join(f["name"] for f in c["factions"])
        c["player_tags"] = []
        if c.get("player_id"):
            pl = self.store.player(c["player_id"])
            if pl:
                c["player"] = pl["name"]
                c["player_tags"] = _split_tags(pl.get("tags"))
        att = self.store.attachment(c["portrait_id"]) if c.get("portrait_id") else None
        c["portrait"] = file_url(att["path"]) if att else None
        # look: own colour, or colour + emblem of the first faction when the character has no own style
        c["own_color"] = c.get("color")
        c["banner"] = None
        c["style_from"] = None
        if c["factions"] and not c.get("own_style"):
            f = self.store.faction(c["factions"][0]["id"])
            if f:
                c["color"] = f["color"] or c["color"]
                emb = self.store.attachment(f["emblem_id"]) if f.get("emblem_id") else None
                c["banner"] = file_url(emb["path"]) if emb else None
                c["style_from"] = f["name"]
        return c

    # ------------------------------------------------------------ bootstrap
    def m_bootstrap(self):
        return {
            "settings": {k: self.settings.get(k) for k in
                         ("clip_max_seconds", "short_session_seconds", "hide_short_sessions",
                          "event_gap_minutes", "roots", "ui", "player_layout", "discord_guild", "holub_marker")},
            "albums": self.store.albums(),
            "tags": self.store.all_tags(),
            "games": self.store.games(),
            "characters": self._chars(),
            "factions": self.m_factions_list(),
            "places": self.m_places_list(),
            "servers": self.store.servers(),
            "game_art": self.m_games_art(),
            "players": self.m_players_list(),
        }

    def m_layout_set(self, mode):
        fn = getattr(self.host, "apply_layout", None)
        if fn:
            fn(mode)
        return True

    def m_window_bg(self, color, fg="#eceef1", accent="#e3b341"):
        fn = getattr(self.host, "set_window_bg", None)
        ok = lambda c: isinstance(c, str) and c.startswith("#") and len(c) in (4, 7)
        if fn and ok(color):
            fn(color, fg if ok(fg) else "#eceef1", accent if ok(accent) else "#e3b341")
        return True

    def m_window_zoom(self, factor, pane=None):
        fn = getattr(self.host, "set_zoom", None)
        if fn:
            fn(max(0.6, min(1.6, float(factor))), pane)
        return True

    def m_pane_toggle(self):
        fn = getattr(self.host, "toggle_detail", None)
        if fn:
            fn()
        return True

    def m_ui_save(self, ui):
        self.settings["ui"] = ui
        self.host.save_settings()
        return True

    # ------------------------------------------------------------ media
    def m_media_list(self):
        linked = self.store.linked_media_ids()
        chars = self._char_map("media")
        bms = self._bm_map()
        tr = self.store.transcript_status()
        return [dict(self._media(m, linked, chars, bms), tr=tr.get(m.id), transcribed=bool(tr.get(m.id)))
                for m in self.store.all_media()]

    def m_media_get(self, id):
        m = self.store.media(id)
        if not m:
            return None
        d = self._media(m, self.store.linked_media_ids(), self._char_map("media"))
        d["albums"] = sorted(self.store.media_album_ids(id))
        d["links"] = self.store.links(media_id=id)
        d["bm_full"] = self._bms(self.store.bookmarks(media_id=id))
        return d

    # ------------------------------------------------------------ transcript / analysis
    WHISPER_MODELS = [
        ("large-v3", "Large v3 – nejpřesnější (doporučeno)"), ("large-v3-turbo", "Large v3 Turbo – asi 2× rychlejší, o chlup horší"),
        ("medium", "Medium – rychlý, horší čeština"), ("small", "Small – jen na zkoušku")]

    def m_analysis_get(self, id):
        jobs = self.host.analysis
        d = analysis_dir(id)
        rows = self.store.transcript(id)
        if not rows and (d / "done.json").exists():    # finished while the app was closed, or run by hand
            self.host.import_analysis(id)
            rows = self.store.transcript(id)

        def url(sub, f):
            return file_url(d / sub / f) if f else None
        hits = self.store.appearance_hits(id)
        frames = [{"t": f["t"], "kind": f.get("kind", "base"), "skip": bool(f.get("skip")), "names": f.get("names") or [],
                   "people": f.get("people"), "place": f.get("place", ""), "thumb": url("frames", f.get("thumb")),
                   "faces": [{"url": url("faces", x["file"]), "file": x["file"]} for x in f.get("faces") or []],
                   "persons": [{"idx": p["idx"], "url": url("people", p.get("file")), "name": p.get("name", ""),
                                "look": p.get("look", ""), "face": bool(p.get("face_emb")),
                                "hit": hits.get((round(f["t"], 1), p["idx"]))} for p in f.get("persons") or []]}
                  for f in load_frames(id)]
        m = self.store.media(id)
        from .appearance import unknown_groups
        groups = [dict(g, urls=[url("people", f) for f in g["files"][:8]], files=None)
                  for g in unknown_groups(load_frames(id), hits)[:12]]
        return {"available": jobs.available(), "state": jobs.state.get(id), "rows": rows, "frames": frames, "groups": groups,
                "coverage": coverage(id), "mentions": self.store.mentions(media_id=id), "duration": m.duration if m else 0,
                "speakers": [s["speaker"] for s in speech_tracks(m)] if m else [],
                "timeline": (d / "timeline.md").exists(), "vision_model": self.settings.get("ai_vision_model"),
                "proposals": len(self.store.proposals("new", id)),
                "memory": ((json.loads((d / "chronicle.json").read_text(encoding="utf-8")) or {}).get("memory", "")
                           if (d / "chronicle.json").exists() else "")}

    def m_analysis_start(self, ids, speech=True, vision=False, chapters=None, ranges=None):
        if not self.host.analysis.available():
            raise RuntimeError("Chybí knihovny pro přepis: .venv\\Scripts\\pip install -r requirements-ai.txt")
        media = [m for m in (self.store.media(i) for i in ids) if m]
        self.host.analysis.request(media, speech=speech, vision=vision, chapters=chapters, vision_ranges=ranges,
                                   prev={m.id: self._prev_summary(m) for m in media})
        return self.host.analysis.snapshot()

    def _prev_summary(self, m):
        """Summary of the previous transcribed evening of the same game: memory across videos."""
        if not m.start_time:
            return ""
        best = None
        for o in self.store.all_media():
            if o.game == m.game and o.start_time and o.start_time < m.start_time and \
                    (analysis_dir(o.id) / "summary.json").exists() and (best is None or o.start_time > best.start_time):
                best = o
        if not best:
            return ""
        d = json.loads((analysis_dir(best.id) / "summary.json").read_text(encoding="utf-8"))
        return f"({fmt_date(best.start_time)}) {d.get('text', '')}"[:1500]

    # ---- Kronikář AI proposals and mentions
    def m_analysis_proposals(self, media_id=None, status="new"):
        props = self.store.proposals(status, media_id)
        media = {}
        for p in props:
            if p["media_id"] not in media:
                m = self.store.media(p["media_id"])
                media[p["media_id"]] = {"id": m.id, "name": m.display_title, "start": m.start_time,
                                        "thumb": file_url(m.get("custom_thumb") or m.thumb)} if m else None
            p["media"] = media[p["media_id"]]
        return props

    def m_analysis_proposal_accept(self, id, edits=None):
        from . import chronicle
        out = chronicle.accept(self.store, self, id, edits)
        self.host.import_analysis(self.store.proposal(id)["media_id"], True)
        return out

    def m_analysis_proposal_reject(self, id):
        self.store.set_proposal_status(id, "rejected")
        return True

    def m_analysis_entity_mentions(self, type, id):
        """Where a character / place / faction appears in transcripts, grouped by video."""
        rows = self.store.entity_mentions(type, id)
        if type == "character":
            seen = {(r["media_id"], int(r["t"])) for r in rows}
            for x in self.store.mentions(character_id=id):
                if (x["media_id"], int(x["t"])) not in seen:
                    rows.append({"media_id": x["media_id"], "t": x["t"], "kind": x["kind"],
                                 "text": self.store.transcript_near(x["media_id"], x["t"]) if x["kind"] == "speech" else ""})
        out = {}
        for r in rows:
            out.setdefault(r["media_id"], []).append(r)
        res = []
        for mid, hits in out.items():
            m = self.store.media(mid)
            if m:
                res.append({"media": self._media(m), "hits": sorted(hits, key=lambda h: h["t"])})
        return sorted(res, key=lambda r: -(r["media"]["start"] or 0))

    def m_analysis_queue(self):
        return self.host.analysis.snapshot()

    def m_analysis_remove(self, key):
        self.host.analysis.remove(key)
        return True

    def m_analysis_move(self, key, index):
        self.host.analysis.move(key, index)
        return True

    def m_analysis_skip(self):
        self.host.analysis.skip_current()
        return True

    def m_analysis_pause(self, paused):
        self.host.analysis.set_paused(paused)
        return self.host.analysis.snapshot()

    def m_analysis_stats(self):
        return {"system": self.host.analysis.system_stats(), "queue": self.host.analysis.snapshot()}

    def m_analysis_models(self):
        try:
            import urllib.request
            with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2) as r:
                tags = json.loads(r.read()).get("models", [])
            ollama = [{"name": t["name"], "size": t.get("size"), "family": t.get("details", {}).get("family", "")} for t in tags]
        except OSError:
            ollama = None
        return {"whisper": self.WHISPER_MODELS, "ollama": ollama, "available": self.host.analysis.available(),
                "games": self.host.analysis.detected_games}

    # ------------------------------------------------------------ AI setup (ai_setup.py)
    def m_ai_info(self):
        from . import ai_setup
        return ai_setup.info(self)

    def m_ai_set_key(self, provider, key):
        from . import ai_setup
        return ai_setup.set_key(provider, key)

    def m_ai_login(self, provider="openrouter"):
        from . import ai_setup
        return ai_setup.login_openrouter(self)

    def m_ai_install_ollama(self):
        from . import ai_setup
        return ai_setup.install_ollama(self)

    def m_ai_pull(self, model):
        from . import ai_setup
        return ai_setup.pull_model(self, model)

    def m_ai_install_cuda(self):
        from . import ai_setup
        return ai_setup.install_cuda(self)

    def m_ai_open(self, url):
        if url.startswith("https://"):
            import webbrowser
            webbrowser.open(url)
        return True

    def m_analysis_overview(self):
        """Per-video status for the library and the Přepisy page: what is transcribed / seen / missing."""
        st = self.store.transcript_status()
        media = [m for m in self.store.all_media() if m.duration]
        missing = [m for m in media if not st.get(m.id, {}).get("speech")]
        return {"status": st, "missing_ids": [m.id for m in missing], "missing_s": sum(m.duration for m in missing),
                "total_s": sum(m.duration for m in media), "count": len(media),
                "proposals": sum(self.store.proposal_counts().values())}

    def m_analysis_delete(self, id, what="all"):
        """Throw away results so they can be made again with other settings: speech | vision | chapters | all."""
        d = analysis_dir(id)
        pats = {"speech": ["speech_*.json"], "vision": ["captions.jsonl", "frames/*", "faces/*"],
                "chapters": ["chapters.json", "summary.json"]}
        for key in (pats if what == "all" else [what]):
            for pat in pats[key]:
                for f in d.glob(pat):
                    f.unlink(missing_ok=True)
        (d / "done.json").unlink(missing_ok=True)
        self.host.import_analysis(id)
        return True

    def m_analysis_char_mentions(self, id):
        return self.m_analysis_entity_mentions("character", id)

    def m_analysis_face_portrait(self, media_id, t, file, character_id):
        """A face found in a video becomes the character's portrait, cut again from the full-size frame."""
        m = self.store.media(media_id)
        rec = next((f for f in load_frames(media_id) if abs(f["t"] - t) < 0.05), None)
        face = next((x for x in (rec or {}).get("faces") or [] if x["file"] == file), None)
        data = None
        ffmpeg = config.find_tool("ffmpeg")
        if m and face and ffmpeg:
            x, y, w, h = face["box"]
            r = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", m.path, "-frames:v", "1",
                                "-vf", f"crop=iw*{w:.4f}:ih*{h:.4f}:iw*{x:.4f}:ih*{y:.4f}", "-q:v", "2", "-f", "image2", "-"],
                               capture_output=True, creationflags=0x08000000 if os.name == "nt" else 0)
            data = r.stdout or None
        if data is None:
            data = (analysis_dir(media_id) / "faces" / file).read_bytes()
        dst, mime, kind = self._store_file(data=data, name="portret.jpg")
        att = self._add("character", character_id, dst, f"Portrét z videa {m.display_title if m else ''}", mime, kind)
        self.m_char_portrait(character_id, att["id"])
        return True

    # ---- appearance: who is who on the frames
    def m_analysis_person_label(self, media_id, t, idx, character_id, verdict="yes"):
        """The user says who a person on a frame is (yes) or is not (no); it becomes a reference."""
        self.store.label_person(media_id, t, idx, character_id, verdict)
        self.host.import_analysis(media_id, False)
        return self.store.appearance_hits(media_id).get((round(t, 1), idx))

    def m_analysis_group_label(self, media_id, members, character_id):
        """One answer for a whole group of similar-looking people: all of them are this character."""
        for t, idx in members:
            self.store.label_person(media_id, t, idx, character_id, "yes")
        self.host.import_analysis(media_id, False)
        return len(members)

    def m_analysis_char_looks(self, id):
        """How a character looked in recordings: the reference crops, oldest first."""
        out = []
        names = {}
        for r in self.store.appearance_refs(id):
            if r["media_id"] not in names:
                m = self.store.media(r["media_id"])
                names[r["media_id"]] = m.display_title if m else ""
            out.append({"id": r["id"], "media_id": r["media_id"], "t": r["t"], "source": r["source"], "look": r["look"],
                        "abs_time": r["abs_time"], "media": names[r["media_id"]], "face": bool(r["face"]),
                        "url": file_url(analysis_dir(r["media_id"]) / "people" / r["file"]) if r["file"] else None})
        return out

    def m_analysis_ref_delete(self, id):
        r = next((x for x in self.store.appearance_refs() if x["id"] == id), None)
        self.store.delete_appearance_ref(id)
        if r:
            self.host.import_analysis(r["media_id"], False)
        return True

    def m_analysis_rematch_all(self):
        """Compare every analysed video again with the current references (after confirming or correcting)."""
        n = 0
        for d in sorted((config.DATA_DIR / "analysis").glob("*/captions.jsonl")):
            mid = int(d.parent.name) if d.parent.name.isdigit() else None
            if mid and self.store.media(mid):
                self.host.import_analysis(mid, False)
                n += 1
        return n

    def m_analysis_search(self, q, limit=200):
        return self.store.transcript_search(q, limit)

    def m_analysis_open_timeline(self, id):
        p = analysis_dir(id) / "timeline.md"
        if p.exists():
            os.startfile(str(p))
        return True

    def m_media_update(self, id, **fields):
        if "tags" in fields:
            self.store.set_media_tags(id, fields.pop("tags"))
        if "chars" in fields:
            want = set(fields.pop("chars"))
            have = {l["character_id"] for l in self.store.character_links(target_type="media", target_id=id)
                    if l["source"] in ("manual", "transcript")}
            for c in want - have:
                self.store.link_character(c, "media", id)
            for c in have - want:
                self.store.unlink_character(c, "media", id)
        if "favorite" in fields:
            fields["favorite"] = 1 if fields["favorite"] else 0
        self.store.update_media(id, **fields)
        return self.m_media_get(id)

    def m_media_bulk(self, ids, op, value=None):
        if op == "add_tags":
            self.store.add_media_tags(ids, value)
        elif op == "remove_tag":
            for mid in ids:
                m = self.store.media(mid)
                self.store.set_media_tags(mid, [t for t in m.tags if t != value])
        elif op == "kind":
            for mid in ids:
                self.store.update_media(mid, kind_override=value)
        elif op == "favorite":
            for mid in ids:
                self.store.update_media(mid, favorite=1 if value else 0)
        elif op == "game":
            for mid in ids:
                self.store.update_media(mid, game=value)
        elif op == "album_add":
            self.store.add_to_album(value, ids)
        elif op == "album_remove":
            self.store.remove_from_album(value, ids)
        elif op == "char_add":
            for mid in ids:
                self.store.link_character(value, "media", mid)
        return True

    def m_media_delete(self, ids):
        from send2trash import send2trash
        failed = []
        for mid in ids:
            m = self.store.media(mid)
            if not m:
                continue
            self.host.release_media(mid)
            try:
                for p in [m.path] + [s["path"] for s in m.sidecar_list()]:
                    if os.path.exists(p):
                        send2trash(os.path.normpath(p))
                if m.thumb and str(config.THUMB_DIR) in m.thumb and os.path.exists(m.thumb):
                    os.remove(m.thumb)
                self.store.db.execute("DELETE FROM character_links WHERE target_type='media' AND target_id=?",
                                      (mid,))
                self.store.delete_media_row(mid)
            except Exception as e:
                failed.append(f"{m.display_title}: {e}")
        return {"failed": failed}

    def m_media_reveal(self, id):
        m = self.store.media(id)
        if m and os.path.exists(m.path):
            subprocess.Popen(["explorer", "/select,", os.path.normpath(m.path)])
        return True

    def m_media_play(self, id, offset=None, popout=False, end=None):
        m = self.store.media(id)
        if not m:
            return False
        return self.host.play(m, offset, popout=popout, end=end)

    # ------------------------------------------------------------ bookmarks
    def _bm_changed(self, media_id):
        fn = getattr(self.host, "refresh_marks", None)
        if fn:
            fn(media_id)

    def _ensure_link(self, event_id, media_id):
        if event_id and not any(l["media_id"] == media_id for l in self.store.links(event_id=event_id)):
            self.store.add_link(event_id, media_id)

    def m_bm_list(self, media_id=None, event_id=None, include_auto=True):
        rows = self.store.bookmarks(media_id=media_id, event_id=event_id)
        if not include_auto:
            rows = [b for b in rows if b["source"] != "auto" or b["event_id"] or b["note"]]
        return self._bms(rows)

    def m_bm_get(self, id):
        b = self.store.bookmark(id)
        return self._bm(b) if b else None

    def _set_bm_chars(self, id, chars):
        have = {l["character_id"] for l in self.store.character_links(target_type="bookmark", target_id=id)
                if l["source"] == "manual"}
        for c in set(chars) - have:
            self.store.link_character(c, "bookmark", id)
        for c in have - set(chars):
            self.store.unlink_character(c, "bookmark", id)

    def m_bm_create(self, media_id, t, t_end=None, title="", note="", event_id=None, chars=None, color=""):
        if t_end is not None and t_end < t:
            t, t_end = t_end, t
        bid = self.store.create_bookmark(media_id, t, t_end, title, note, event_id, color)
        if chars:
            self._set_bm_chars(bid, chars)
        self._ensure_link(event_id, media_id)
        self._bm_changed(media_id)
        return bid

    def m_bm_update(self, id, chars=None, **fields):
        b = self.store.bookmark(id)
        if not b:
            return False
        t = fields.get("t", b["t"])
        if fields.get("t_end") is not None and fields["t_end"] <= t:
            fields["t_end"] = None
        self.store.update_bookmark(id, **fields)
        if chars is not None:
            self._set_bm_chars(id, chars)
        if fields.get("event_id"):
            self._ensure_link(fields["event_id"], b["media_id"])
        self._bm_changed(b["media_id"])
        return True

    def m_bm_delete(self, id):
        b = self.store.bookmark(id)
        if b:
            self.store.delete_bookmark(id)
            self._bm_changed(b["media_id"])
        return True

    def m_media_thumb_pick(self, id):
        path, _ = QFileDialog.getOpenFileName(self.host.dialog_parent, "Vlastní náhled videa", "",
                                              "Obrázky (*.png *.jpg *.jpeg *.webp *.bmp)")
        if not path:
            return False
        dst = config.THUMB_DIR / "custom" / f"{id}-{uuid.uuid4().hex[:6]}{Path(path).suffix.lower()}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dst)
        self._set_custom_thumb(id, dst)
        return True

    def m_media_thumb_data(self, id, data_b64):
        dst = config.THUMB_DIR / "custom" / f"{id}-{uuid.uuid4().hex[:6]}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(base64.b64decode(data_b64.split(",", 1)[-1]))
        self._set_custom_thumb(id, dst)
        return True

    def m_media_thumb_reset(self, id):
        self._set_custom_thumb(id, None)
        return True

    def _set_custom_thumb(self, id, path):
        m = self.store.media(id)
        old = m.get("custom_thumb") if m else None
        self.store.update_media(id, custom_thumb=str(path) if path else None)
        if old and os.path.exists(old) and str(config.THUMB_DIR) in old:
            try:
                os.remove(old)
            except OSError:
                pass

    def m_media_resume_clear(self, id):
        self.store.set_resume(id, None)
        self.emit("resume", {"media_id": id, "pos": None, "at": time.time(), "final": True})
        return True

    def m_player_action(self, act):
        self.host.player_action(act)
        return True

    def m_album_create(self, name, ids=None):
        aid = self.store.create_album(name)
        if ids:
            self.store.add_to_album(aid, ids)
        return aid

    def m_album_rename(self, id, name):
        self.store.rename_album(id, name)
        return True

    def m_album_delete(self, id):
        self.store.delete_album(id)
        return True

    def m_album_items(self, id):
        return self.store.album_media_ids(id)

    # ------------------------------------------------------------ events
    def m_events_list(self):
        chars = self._char_map("event")
        n_entries = dict(self.store.db.execute("SELECT event_id, COUNT(*) FROM entries GROUP BY event_id"))
        n_bm = dict(self.store.db.execute(
            "SELECT event_id, COUNT(*) FROM bookmarks WHERE hidden=0 AND event_id IS NOT NULL GROUP BY event_id"))
        n_att = dict(self.store.db.execute(
            "SELECT owner_id, COUNT(*) FROM attachments WHERE owner_type='event' GROUP BY owner_id"))
        out = []
        for e in self.store.events():
            e = dict(e)
            e["chars"] = chars.get(e["id"], [])
            e["entry_count"] = n_entries.get(e["id"], 0)
            e["att_count"] = n_att.get(e["id"], 0)
            e["bm_count"] = n_bm.get(e["id"], 0)
            e["excerpt"] = _excerpt(e.get("body_html") or e.get("description") or "")
            e.pop("body_html", None)
            cover = self.store.attachment(e["cover_id"]) if e.get("cover_id") else None
            e["cover"] = file_url(cover["path"]) if cover else None
            out.append(e)
        return out

    def m_event_get(self, id):
        e = self.store.event(id)
        if not e:
            return None
        e = dict(e)
        linked = self.store.linked_media_ids()
        media_chars = self._char_map("media")
        links = []
        for l in self.store.links(event_id=id):
            m = self.store.media(l["media_id"])
            if m:
                l["media"] = self._media(m, linked, media_chars)
                links.append(l)
        e["links"] = links
        e["entries"] = self.store.entries(id)
        for en in e["entries"]:
            en["attachments"] = [self._att(a) for a in self.store.attachments("entry", en["id"])]
            en["chars"] = [l["character_id"] for l in self.store.character_links(target_type="entry",
                                                                                  target_id=en["id"])]
        e["attachments"] = [self._att(a) for a in self.store.attachments("event", id)]
        e["char_links"] = self.store.character_links(target_type="event", target_id=id)
        e["children"] = [c["id"] for c in self.store.events() if c["parent_id"] == id]
        e["bookmarks"] = self._bms(self.store.bookmarks(event_id=id))
        return e

    def m_event_create(self, title, parent_id=None, start=None, end=None, media_ids=None, color=None, server_id=None):
        eid = self.store.create_event(title, parent_id=parent_id, start=start, end=end)
        palette = ["#e3b341", "#5aa9e6", "#e5646e", "#5cc98a", "#a77be8", "#ef9a4b", "#40c4c4", "#e06aa8"]
        self.store.update_event(eid, color=color or palette[eid % len(palette)], server_id=server_id)
        for mid in media_ids or []:
            self.store.add_link(eid, mid)
        return eid

    def m_event_update(self, id, **fields):
        if "tags" in fields:
            self.store.set_event_tags(id, fields.pop("tags"))
        self.store.update_event(id, **fields)
        return True

    def m_event_delete(self, id):
        ids = self.store.event_descendant_ids(id)
        for eid in ids:
            for en in self.store.entries(eid):
                self._delete_owner_files("entry", en["id"])
                self.store.delete_entry(en["id"])
            self._delete_owner_files("event", eid)
            self.store.db.execute("DELETE FROM character_links WHERE target_type='event' AND target_id=?", (eid,))
        self.store.delete_event(id)
        return True

    def m_event_move(self, id, parent_id, position=None):
        if parent_id is not None and parent_id in self.store.event_descendant_ids(id):
            raise ValueError("Událost nejde vložit sama do sebe")
        siblings = [e for e in self.store.events() if e["parent_id"] == parent_id and e["id"] != id]
        pos = len(siblings) if position is None else max(0, min(position, len(siblings)))
        siblings.insert(pos, {"id": id})
        for i, s in enumerate(siblings):
            self.store.update_event(s["id"], position=i, **({"parent_id": parent_id} if s["id"] == id else {}))
        return True

    def m_event_range_from_links(self, id):
        media = []
        for eid in self.store.event_descendant_ids(id):
            media += [self.store.media(l["media_id"]) for l in self.store.links(event_id=eid)]
        media = [m for m in media if m and m.start_time]
        if not media:
            return None
        s, e = min(m.start_time for m in media), max(m.end_time for m in media)
        self.store.update_event(id, start_time=s, end_time=e)
        return {"start": s, "end": e}

    def m_event_suggest(self, id):
        e = self.store.event(id)
        media = self.store.all_media()
        limit = self.settings.get("short_session_seconds", 60)
        media = [m for m in media if not (m.effective_kind == "session" and (m.duration or 0) < limit)]
        linked = {l["media_id"] for l in self.store.links(event_id=id)}
        other = {}
        for l in self.store.links():
            if l["event_id"] != id:
                other.setdefault(l["media_id"], []).append(l["event_title"])
        out = []
        lk = self.store.linked_media_ids()
        for s in suggest.suggest_for_event(e, media, linked, other):
            out.append({"media": self._media(s["media"], lk), "score": min(100, round(s["score"])),
                        "reasons": s["reasons"], "offset": s["offset"]})
        return out

    def m_event_propose(self, gap=None, game=None, only_sessions=True):
        media = self.store.all_media()
        if game:
            media = [m for m in media if m.game == game]
        limit = self.settings.get("short_session_seconds", 60)
        media = [m for m in media if not (m.effective_kind == "session" and (m.duration or 0) < limit)]
        props = suggest.cluster_sessions(media, gap or self.settings.get("event_gap_minutes", 45),
                                         self.store.linked_media_ids())
        if only_sessions:
            props = [p for p in props if any(m.effective_kind != "clip" for m in p["media"])]
        return [{"title": p["title"], "start": p["start"], "end": p["end"], "game": p["game"],
                 "media": [self._media(m) for m in p["media"]]} for p in props]

    def m_event_create_many(self, items, parent_id=None):
        ids = []
        for it in items:
            ids.append(self.m_event_create(it["title"], parent_id=parent_id, start=it["start"],
                                           end=it["end"], media_ids=it.get("media_ids")))
        return ids

    def m_events_at(self, t):
        return [e["id"] for e in suggest.events_at(self.store.events(), t)]

    # ------------------------------------------------------------ event links
    def m_link_add(self, event_id, media_ids, offset=None, note=""):
        existing = {(l["media_id"], l["offset"]) for l in self.store.links(event_id=event_id)}
        n = 0
        for mid in media_ids:
            if (mid, offset) not in existing:
                self.store.add_link(event_id, mid, offset, note)
                n += 1
        return n

    def m_link_update(self, id, **fields):
        self.store.update_link(id, **fields)
        return True

    def m_link_delete(self, id):
        self.store.delete_link(id)
        return True

    # ------------------------------------------------------------ journal entries
    def m_entry_create(self, event_id, title="", body_html="", entry_time=None, ingame_date=""):
        return self.store.create_entry(event_id, title, body_html, entry_time, ingame_date)

    def m_entry_update(self, id, **fields):
        self.store.update_entry(id, **fields)
        return True

    def m_entry_delete(self, id):
        self._delete_owner_files("entry", id)
        self.store.delete_entry(id)
        return True

    # ------------------------------------------------------------ attachments
    def _store_file(self, src_path=None, data=None, name="soubor"):
        ext = Path(name).suffix.lower() or (Path(src_path).suffix.lower() if src_path else ".bin")
        dst = ATT_DIR / f"{time.strftime('%Y%m')}" / f"{uuid.uuid4().hex[:12]}{ext}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src_path:
            shutil.copy2(src_path, dst)
        else:
            dst.write_bytes(data)
        mime = mimetypes.guess_type(str(dst))[0] or "application/octet-stream"
        kind = "image" if ext in IMAGE_EXT else "file"
        return dst, mime, kind

    def _add(self, owner_type, owner_id, dst, name, mime, kind, **kw):
        aid = self.store.add_attachment(owner_type, owner_id, str(dst), name, mime, kind,
                                        dst.stat().st_size, **kw)
        return self._att(self.store.attachment(aid))

    def m_att_pick(self, owner_type, owner_id, images_only=False):
        flt = "Obrázky (*.png *.jpg *.jpeg *.gif *.webp *.bmp)" if images_only else "Všechny soubory (*.*)"
        paths, _ = QFileDialog.getOpenFileNames(self.host.dialog_parent, "Přidat přílohy", "", flt)
        out = []
        for p in paths:
            dst, mime, kind = self._store_file(src_path=p, name=os.path.basename(p))
            taken = os.path.getmtime(p)
            out.append(self._add(owner_type, owner_id, dst, os.path.basename(p), mime, kind, taken_at=taken))
        return out

    def m_att_add_data(self, owner_type, owner_id, name, data_b64, taken_at=None, caption="",
                       media_id=None, media_offset=None):
        raw = base64.b64decode(data_b64.split(",", 1)[-1])
        dst, mime, kind = self._store_file(data=raw, name=name or "vlozeny.png")
        extra = {"caption": caption} if caption else {}
        if media_id:
            extra.update(media_id=media_id, media_offset=media_offset)
        return self._add(owner_type, owner_id, dst, name, mime, kind, taken_at=taken_at or time.time(), **extra)

    def m_att_snapshot(self, owner_type, owner_id):
        """Grab the current video frame from the player."""
        dst = ATT_DIR / time.strftime("%Y%m") / f"snap-{uuid.uuid4().hex[:10]}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        res = self.host.player_snapshot(str(dst))
        if not res:
            raise ValueError("Nic se nepřehrává – pusť video, ze kterého chceš snímek.")
        media, pos = res
        moment = (media.start_time or time.time()) + pos
        caption = f"{media.display_title} @ {suggest.fmt_clock(pos)}"
        return self._add(owner_type, owner_id, dst, dst.name, "image/jpeg", "image",
                         caption=caption, taken_at=moment, media_id=media.id, media_offset=pos)

    def m_snap_grab(self):
        """Current video frame as a data URL (for cropping in the UI before saving)."""
        tmp = config.DATA_DIR / "tmp"
        tmp.mkdir(parents=True, exist_ok=True)
        dst = tmp / f"grab-{uuid.uuid4().hex[:8]}.jpg"
        res = self.host.player_snapshot(str(dst))
        if not res:
            raise ValueError("Nic se nepřehrává – pusť video, ze kterého chceš snímek.")
        media, pos = res
        try:
            data = "data:image/jpeg;base64," + base64.b64encode(dst.read_bytes()).decode()
        finally:
            dst.unlink(missing_ok=True)
        return {"data": data, "media_id": media.id, "pos": pos,
                "moment": (media.start_time or time.time()) + pos,
                "caption": f"{media.display_title} @ {suggest.fmt_clock(pos)}"}

    def m_att_update(self, id, **fields):
        self.store.update_attachment(id, **fields)
        return True

    def m_att_delete(self, id):
        a = self.store.attachment(id)
        if a:
            self._remove_file(a["path"])
            self.store.delete_attachment(id)
        return True

    def m_att_open(self, id):
        a = self.store.attachment(id)
        if a and os.path.exists(a["path"]):
            os.startfile(a["path"])
        return True

    def m_att_reveal(self, id):
        a = self.store.attachment(id)
        if a and os.path.exists(a["path"]):
            subprocess.Popen(["explorer", "/select,", os.path.normpath(a["path"])])
        return True

    def m_att_play_source(self, id):
        a = self.store.attachment(id)
        if a and a.get("media_id"):
            return self.m_media_play(a["media_id"], a.get("media_offset"))
        return False

    def m_gallery(self):
        """All image attachments with their owner (for the screenshot gallery)."""
        events = {e["id"]: e for e in self.store.events()}
        entries = {en["id"]: en for en in self.store.entries()}
        chars = {c["id"]: c for c in self.store.characters()}
        out = []
        for a in self.store.attachments():
            if a["kind"] != "image":
                continue
            a = self._att(a)
            if a["owner_type"] == "event" and a["owner_id"] in events:
                a["owner_title"], a["event_id"] = events[a["owner_id"]]["title"], a["owner_id"]
            elif a["owner_type"] == "entry" and a["owner_id"] in entries:
                ev = entries[a["owner_id"]]["event_id"]
                a["owner_title"], a["event_id"] = events.get(ev, {}).get("title", ""), ev
            elif a["owner_type"] == "character" and a["owner_id"] in chars:
                a["owner_title"], a["char_id"] = chars[a["owner_id"]]["name"], a["owner_id"]
            out.append(a)
        return out

    def _delete_owner_files(self, owner_type, owner_id):
        for a in self.store.attachments(owner_type, owner_id):
            self._remove_file(a["path"])
            self.store.delete_attachment(a["id"])

    def _remove_file(self, path):
        try:
            p = Path(path).resolve()
            if ATT_DIR.resolve() in p.parents and p.exists():
                p.unlink()
        except OSError:
            pass

    # ------------------------------------------------------------ characters
    def _chars(self):
        members = {}
        for m in self.store.faction_members():
            members.setdefault(m["character_id"], []).append(m)
        return [self._char(c, members) for c in self.store.characters()]

    # ------------------------------------------------------------ factions
    def _faction(self, f):
        f = dict(f)
        att = self.store.attachment(f["emblem_id"]) if f.get("emblem_id") else None
        f["emblem"] = file_url(att["path"]) if att else None
        return f

    def m_factions_list(self):
        out = []
        for f in self.store.factions():
            f = self._faction(f)
            f.pop("body_html", None)
            out.append(f)
        return out

    def m_faction_get(self, id):
        f = self.store.faction(id)
        if not f:
            return None
        f = self._faction(f)
        f["members"] = self.store.faction_members(fid=id)
        ids = [m["character_id"] for m in f["members"]]
        evs = {e["id"]: e for e in self.store.events()}
        seen = {}
        for cid in ids:
            for l in self.store.character_links(character_id=cid, target_type="event"):
                e = evs.get(l["target_id"])
                if e:
                    d = seen.setdefault(e["id"], {"id": e["id"], "title": e["title"], "color": e["color"],
                                                  "start_time": e["start_time"], "chars": []})
                    if cid not in d["chars"]:
                        d["chars"].append(cid)
        f["events"] = sorted(seen.values(), key=lambda e: e["start_time"] or 0, reverse=True)
        f["attachments"] = [self._att(a) for a in self.store.attachments("faction", id)]
        f["holdings"] = [self._place(p) for p in self.store.places() if p["owner_type"] == "faction" and p["owner_id"] == id]
        return f

    def m_faction_create(self, name, **fields):
        return self.store.create_faction(name, **fields)

    def m_faction_update(self, id, **fields):
        self.store.update_faction(id, **fields)
        return True

    def m_faction_delete(self, id):
        self._delete_owner_files("faction", id)
        self.store.delete_faction(id)
        return True

    def m_faction_emblem(self, id, att_id=None):
        if att_id is None:
            got = self.m_att_pick("faction", id, images_only=True)
            if not got:
                return None
            att_id = got[0]["id"]
        self.store.update_faction(id, emblem_id=att_id)
        return file_url(self.store.attachment(att_id)["path"])

    def m_faction_members_add(self, id, character_ids, role=""):
        for cid in character_ids:
            self.store.add_member(id, cid, role)
        return True

    def m_faction_member_remove(self, id, character_id):
        self.store.remove_member(id, character_id)
        return True

    def m_chars_list(self):
        return self._chars()

    # ------------------------------------------------------------ game artwork

    def _gdir(self):
        d = config.DATA_DIR / "games"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def m_games_art(self):
        out = {}
        for g, a in self.store.game_art().items():
            out[g] = {"icon": file_url(a["icon_path"]) if a.get("icon_path") and os.path.exists(a["icon_path"]) else None,
                      "banner": file_url(a["banner_path"]) if a.get("banner_path") and os.path.exists(a["banner_path"]) else None,
                      "appid": a.get("steam_appid")}
        return out

    @staticmethod
    def _data_url(raw, path_or_url=""):
        ext = os.path.splitext(urllib_path(path_or_url))[1].lower()
        mime = "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "image/jpeg"
        return f"data:{mime};base64," + base64.b64encode(raw).decode()

    def m_game_art_sources(self, game):
        installed = []
        for g in gameart.match_installed(game)[:4]:
            imgs = gameart.local_images(g["appid"])
            installed.append({"appid": g["appid"], "name": g["name"],
                              "images": [{"src": file_url(i["path"]), "path": i["path"], "kind": i["kind"]} for i in imgs]})
        medal = [{"src": file_url(i["path"]), "path": i["path"], "kind": i["kind"], "name": i["name"]} for i in gameart.medal_icons()]
        return {"installed": installed, "medal": medal,
                "all_installed": sorted((g["name"] for g in gameart.installed_games()), key=str.lower)}

    def m_game_art_installed(self, name):
        hits = [g for g in gameart.installed_games() if g["name"] == name]
        if not hits:
            return None
        g = hits[0]
        return {"appid": g["appid"], "name": g["name"], "images": [{"src": file_url(i["path"]), "path": i["path"], "kind": i["kind"]}
                                                                for i in gameart.local_images(g["appid"])]}

    def m_game_art_search(self, term):
        try:
            return gameart.store_search(term)
        except Exception as e:
            raise ValueError(f"Obchod Steamu teď nejde načíst: {e}")

    def m_game_image_data(self, path=None, url=None):
        """Image as a data URL (lets the UI crop it on a canvas)."""
        if url:
            return self._data_url(gameart.fetch(url), url)
        if path and os.path.exists(path) and os.path.splitext(path)[1].lower() in IMAGE_EXT | {".ico"}:
            return self._data_url(Path(path).read_bytes(), path)
        return None

    def m_game_art_pick_file(self):
        path, _ = QFileDialog.getOpenFileName(self.host.dialog_parent, "Obrázek hry", "", "Obrázky (*.png *.jpg *.jpeg *.webp *.bmp)")
        return self.m_game_image_data(path=path) if path else None

    def _save_art(self, game, kind, raw, ext=".jpg", appid=None):
        key = re.sub(r"[^a-z0-9]+", "-", game.lower()).strip("-") or "hra"
        dst = self._gdir() / f"{key}-{kind}-{uuid.uuid4().hex[:6]}{ext}"
        dst.write_bytes(raw)
        old = self.store.game_art().get(game, {}).get(f"{kind}_path")
        self.store.set_game_art(game, **{f"{kind}_path": str(dst)}, **({"steam_appid": appid} if appid else {}))
        if old and os.path.exists(old) and str(self._gdir()) in old:
            try:
                os.remove(old)
            except OSError:
                pass

    def m_game_art_set(self, game, kind, data_b64, appid=None):
        if kind not in ("icon", "banner"):
            raise ValueError("kind")
        head, _, b64 = data_b64.partition(",")
        self._save_art(game, kind, base64.b64decode(b64 or head), ".png" if "png" in head else ".jpg", appid)
        return self.m_games_art()

    def m_game_art_reset(self, game, kind):
        a = self.store.game_art().get(game, {})
        p = a.get(f"{kind}_path")
        self.store.set_game_art(game, **{f"{kind}_path": None})
        if p and os.path.exists(p) and str(self._gdir()) in p:
            os.remove(p)
        return self.m_games_art()

    def m_game_art_auto(self, games, overwrite=False):
        """Icons/banners for games that have an obvious match among installed Steam games."""
        from PySide6.QtGui import QImage
        from PySide6.QtCore import QBuffer, QByteArray, QIODevice

        def encode(img, fmt="JPG"):
            ba = QByteArray()
            buf = QBuffer(ba)
            buf.open(QIODevice.WriteOnly)
            img.save(buf, fmt, 90)
            return bytes(ba)
        have = self.store.game_art()
        done = []
        for game in games:
            cur = have.get(game, {})
            if not overwrite and cur.get("icon_path") and cur.get("banner_path"):
                continue
            m = [g for g in gameart.match_installed(game) if g["score"] >= 2]
            if not m:
                continue
            imgs = gameart.local_images(m[0]["appid"])
            by = {}
            for i in sorted(imgs, key=lambda i: -i["size"]):
                by.setdefault(i["kind"], i["path"])
            src = by.get("cover") or by.get("header") or by.get("jiný")
            if src and (overwrite or not cur.get("icon_path")):
                img = QImage(src)
                if not img.isNull():
                    side = min(img.width(), img.height())
                    x = (img.width() - side) // 2
                    y = 0 if img.height() > img.width() else (img.height() - side) // 2
                    sq = img.copy(x, y, side, side).scaled(256, 256)
                    self._save_art(game, "icon", encode(sq), ".jpg", m[0]["appid"])
            hero = by.get("hero") or by.get("header")
            if hero and (overwrite or not cur.get("banner_path")):
                self._save_art(game, "banner", Path(hero).read_bytes(), os.path.splitext(hero)[1].lower(), m[0]["appid"])
            done.append(game)
        return {"done": done, "art": self.m_games_art()}

    # ------------------------------------------------------------ servers
    def m_servers_list(self):
        return self.store.servers()

    def m_server_create(self, game, name, **fields):
        return self.store.create_server(game, name, **fields)

    def m_server_update(self, id, **fields):
        self.store.update_server(id, **fields)
        return True

    def m_server_default(self, id):
        self.store.set_default_server(id)
        return True

    def m_server_delete(self, id):
        self.store.delete_server(id)
        return True

    def m_server_assign(self, type, ids, server_id):
        """Bulk: put media / events / characters / factions / places on a server."""
        table = {"media": "media", "event": "events", "char": "characters", "faction": "factions", "place": "places"}[type]
        self.store.db.executemany(f"UPDATE {table} SET server_id=? WHERE id=?", [(server_id, i) for i in ids])
        self.store.db.commit()
        return True

    # ------------------------------------------------------------ places
    def _owner_name(self, otype, oid):
        if otype == "faction":
            f = self.store.faction(oid) if oid else None
            return f["name"] if f else ""
        if otype == "character":
            c = self.store.character(oid) if oid else None
            return c["name"] if c else ""
        return ""

    def _place(self, p):
        p = dict(p)
        att = self.store.attachment(p["image_id"]) if p.get("image_id") else None
        p["image"] = file_url(att["path"]) if att else None
        p["owner_name"] = self._owner_name(p.get("owner_type"), p.get("owner_id"))
        p.pop("body_html", None) if "n_events" in p else None
        return p

    def m_places_list(self):
        return [self._place(p) for p in self.store.places()]

    def m_place_get(self, id):
        p = self.store.place(id)
        if not p:
            return None
        p = self._place(p)
        p["events"] = [{"id": e["id"], "title": e["title"], "color": e["color"], "start_time": e["start_time"]}
                       for e in self.store.events() if e["place_id"] == id]
        p["children"] = [self._place(x) for x in self.store.places() if x["parent_id"] == id]
        p["attachments"] = [self._att(a) for a in self.store.attachments("place", id)]
        p["letters"] = [l["id"] for l in self.store.letters() if l["place_id"] == id]
        return p

    def m_place_create(self, name, **fields):
        return self.store.create_place(name, **fields)

    def m_place_update(self, id, **fields):
        self.store.update_place(id, **fields)
        return True

    def m_place_delete(self, id):
        self._delete_owner_files("place", id)
        self.store.delete_place(id)
        return True

    def m_place_image(self, id, att_id=None):
        if att_id is None:
            got = self.m_att_pick("place", id, images_only=True)
            if not got:
                return None
            att_id = got[0]["id"]
        self.store.update_place(id, image_id=att_id)
        return file_url(self.store.attachment(att_id)["path"])

    # ------------------------------------------------------------ letters (Holubí pošta)
    def _letter(self, l):
        l = dict(l)
        try:
            l["recipient_ids"] = json.loads(l.get("recipient_ids") or "[]")
        except ValueError:
            l["recipient_ids"] = []
        if l.get("author_discord_id"):
            pl = [p for p in self.store.players() if p.get("discord_id") == l["author_discord_id"]]
            l["author_player_id"] = pl[0]["id"] if pl else None
        return l

    def m_letters_list(self):
        return [self._letter(l) for l in self.store.letters()]

    def m_letter_create(self, **fields):
        if "recipient_ids" in fields:
            fields["recipient_ids"] = json.dumps(fields["recipient_ids"])
        fields.setdefault("sent_at", time.time())
        return self.store.create_letter(**fields)

    def m_letter_update(self, id, **fields):
        if "recipient_ids" in fields:
            fields["recipient_ids"] = json.dumps(fields["recipient_ids"])
        self.store.update_letter(id, **fields)
        return True

    def m_letter_delete(self, id):
        self.store.delete_letter(id)
        return True

    def _save_letters(self, items):
        by_discord = {}
        for pl in self.store.players():
            if pl.get("discord_id"):
                chars = [c["id"] for c in self.store.characters() if c["player_id"] == pl["id"]]
                by_discord[pl["discord_id"]] = chars[0] if len(chars) == 1 else None
        n = 0
        for it in items:
            if it.get("author_discord_id") in by_discord and by_discord[it["author_discord_id"]]:
                it["sender_id"] = by_discord[it["author_discord_id"]]
            if self.store.create_letter(**it):
                n += 1
        return {"found": len(items), "new": n}

    def m_letters_import_export(self):
        path, _ = QFileDialog.getOpenFileName(self.host.dialog_parent, "Export dat z Discordu (package.zip)", "",
                                              "Discord export (*.zip);;Všechny soubory (*.*)")
        if not path:
            return None
        items = discord_link.export_letters(path, self.settings.get("holub_marker") or "holub")
        return self._save_letters(items)

    def m_letters_import_folder(self):
        path = QFileDialog.getExistingDirectory(self.host.dialog_parent, "Rozbalený export dat z Discordu")
        if not path:
            return None
        items = discord_link.export_letters(path, self.settings.get("holub_marker") or "holub")
        return self._save_letters(items)

    def m_letters_import_channel(self):
        tok, ch = self.settings.get("discord_token"), self.settings.get("discord_channel")
        if not tok or not ch:
            raise ValueError("V Nastavení → Discord vyplň token bota a ID kanálu s dopisy.")
        items = discord_link.channel_letters(tok, ch, self.settings.get("holub_marker") or "holub")
        return self._save_letters(items)

    # ------------------------------------------------------------ Discord: players
    def m_discord_members(self):
        tok, gid = self.settings.get("discord_token"), self.settings.get("discord_guild")
        if not tok or not gid:
            raise ValueError("V Nastavení → Discord vyplň token bota a ID serveru.")
        return discord_link.members(tok, gid)

    def _player_avatar_from(self, pid, url):
        try:
            raw = discord_link.download(url)
        except Exception:
            return
        dst, mime, kind = self._store_file(data=raw, name="discord.png")
        a = self._add("player", pid, dst, "discord.png", mime, kind, caption="Discord avatar")
        old = self.store.player(pid).get("avatar_id")
        self.store.update_player(pid, avatar_id=a["id"])
        if old:
            oa = self.store.attachment(old)
            if oa and (oa.get("caption") == "Discord avatar"):
                self._remove_file(oa["path"])
                self.store.delete_attachment(old)

    def _token(self):
        tok = self.settings.get("discord_token")
        if not tok:
            raise ValueError("V Nastavení → Discord vyplň token bota (bot nemusí být na žádném serveru).")
        return tok

    def m_discord_user(self, user_id):
        return discord_link.user(self._token(), user_id)

    def m_discord_link_by_id(self, player_id, user_id):
        m = discord_link.user(self._token(), user_id)
        self.m_discord_link_player(player_id, m)
        return m

    def m_discord_link_player(self, player_id, member):
        self.store.update_player(player_id, discord_id=member["id"], discord_name=member["display"],
                                 contact=member.get("username") or "")
        if member.get("avatar"):
            self._player_avatar_from(player_id, member["avatar"])
        return True

    def m_discord_import_players(self, members):
        """Create players for chosen Discord members (skips ones already linked)."""
        have = {p.get("discord_id") for p in self.store.players()}
        n = 0
        for m in members:
            if m["id"] in have:
                continue
            pid = self.store.create_player(m["display"], discord_id=m["id"], discord_name=m["display"],
                                           contact=m.get("username") or "")
            if m.get("avatar"):
                self._player_avatar_from(pid, m["avatar"])
            n += 1
        return n

    def m_discord_sync(self):
        """Refresh names + avatars of all linked players: from the server member list when a server is set
        (gives server nicknames), otherwise / for the rest from the public profile by ID."""
        tok = self._token()
        by_id = {}
        if self.settings.get("discord_guild"):
            try:
                by_id = {m["id"]: m for m in discord_link.members(tok, self.settings["discord_guild"])}
            except discord_link.DiscordError:
                by_id = {}
        n = 0
        for pl in self.store.players():
            if not pl.get("discord_id"):
                continue
            m = by_id.get(pl.get("discord_id"))
            if not m:
                try:
                    m = discord_link.user(tok, pl["discord_id"])
                except discord_link.DiscordError:
                    m = None
            if m:
                self.store.update_player(pl["id"], discord_name=m["display"], contact=m.get("username") or pl["contact"])
                if m.get("avatar"):
                    self._player_avatar_from(pl["id"], m["avatar"])
                n += 1
        return n

    # ------------------------------------------------------------ players
    def _player(self, pl):
        pl = dict(pl)
        att = self.store.attachment(pl["avatar_id"]) if pl.get("avatar_id") else None
        pl["avatar"] = file_url(att["path"]) if att else None
        return pl

    def m_players_list(self):
        out = []
        for pl in self.store.players():
            pl = self._player(pl)
            pl.pop("body_html", None)
            out.append(pl)
        return out

    def m_player_get(self, id):
        pl = self.store.player(id)
        if not pl:
            return None
        pl = self._player(pl)
        pl["characters"] = [c["id"] for c in self.store.characters() if c["player_id"] == id]
        pl["attachments"] = [self._att(a) for a in self.store.attachments("player", id)]
        return pl

    def m_player_create(self, name, **fields):
        return self.store.create_player(name, **fields)

    def m_player_update(self, id, **fields):
        self.store.update_player(id, **fields)
        return True

    def m_player_delete(self, id):
        self._delete_owner_files("player", id)
        self.store.delete_player(id)
        return True

    def m_player_avatar(self, id, att_id=None):
        if att_id is None:
            got = self.m_att_pick("player", id, images_only=True)
            if not got:
                return None
            att_id = got[0]["id"]
        self.store.update_player(id, avatar_id=att_id)
        return file_url(self.store.attachment(att_id)["path"])

    def m_char_get(self, id):
        c = self.store.character(id)
        if not c:
            return None
        c = self._char(c)
        events = {e["id"]: e for e in self.store.events()}
        linked = self.store.linked_media_ids()
        ev_out, media_out, entry_out = {}, {}, {}
        for l in self.store.character_links(character_id=id):
            if l["target_type"] == "event" and l["target_id"] in events:
                e = ev_out.setdefault(l["target_id"], dict(events[l["target_id"]], roles=[], via=[]))
                if l["role"]:
                    e["roles"].append(l["role"])
                e["via"].append(l["source"])
            elif l["target_type"] == "media":
                m = self.store.media(l["target_id"])
                if m:
                    media_out[m.id] = self._media(m, linked)
            elif l["target_type"] == "entry":
                en = self.store.entry(l["target_id"])
                if en:
                    en["event_title"] = events.get(en["event_id"], {}).get("title", "")
                    en["excerpt"] = _excerpt(en["body_html"], 220)
                    en.pop("body_html", None)
                    entry_out[en["id"]] = en
                    if en["event_id"] in events:
                        e = ev_out.setdefault(en["event_id"], dict(events[en["event_id"]], roles=[], via=[]))
                        e["via"].append("entry")
        for e in ev_out.values():
            e.pop("body_html", None)
        c["events"] = sorted(ev_out.values(), key=lambda e: e.get("start_time") or 0)
        c["media"] = sorted(media_out.values(), key=lambda m: m["start"] or 0)
        c["entries"] = sorted(entry_out.values(), key=lambda en: en.get("entry_time") or 0)
        c["attachments"] = [self._att(a) for a in self.store.attachments("character", id)]
        c["relations"] = self.store.relations(id)
        c["places"] = [self._place(p) for p in self.store.places() if p["owner_type"] == "character" and p["owner_id"] == id]
        bm_ids = [l["target_id"] for l in self.store.character_links(character_id=id, target_type="bookmark")]
        c["bookmarks"] = self._bms(self.store.bookmarks(ids=bm_ids)) if bm_ids else []
        return c

    def m_char_create(self, name, **fields):
        return self.store.create_character(name, **fields)

    def m_char_update(self, id, **fields):
        self.store.update_character(id, **fields)
        return True

    def m_char_delete(self, id):
        self._delete_owner_files("character", id)
        self.store.delete_character(id)
        return True

    def m_char_portrait(self, id, att_id=None):
        """Set portrait from an existing attachment, or pick a new image."""
        if att_id is None:
            got = self.m_att_pick("character", id, images_only=True)
            if not got:
                return None
            att_id = got[0]["id"]
        self.store.update_character(id, portrait_id=att_id)
        return file_url(self.store.attachment(att_id)["path"])

    def m_char_link(self, character_id, target_type, target_id, role=""):
        self.store.link_character(character_id, target_type, target_id, role)
        return True

    def m_char_unlink(self, character_id, target_type, target_id):
        self.store.unlink_character(character_id, target_type, target_id)
        return True

    def m_rel_add(self, a_id, b_id, label="", kind="", note=""):
        return self.store.add_relation(a_id, b_id, label, kind, note)

    def m_rel_update(self, id, **fields):
        self.store.update_relation(id, **fields)
        return True

    def m_rel_delete(self, id):
        self.store.delete_relation(id)
        return True

    # ------------------------------------------------------------ timeline / misc
    def m_timeline_data(self):
        """Everything the timeline views need, in one go."""
        return {
            "events": self.m_events_list(),
            "entries": [{"id": en["id"], "event_id": en["event_id"], "title": en["title"],
                         "time": en["entry_time"], "ingame_date": en["ingame_date"],
                         "excerpt": _excerpt(en["body_html"], 160)} for en in self.store.entries()],
            "links": [{"event_id": l["event_id"], "media_id": l["media_id"], "offset": l["offset"],
                       "note": l["note"]} for l in self.store.links()],
            "bookmarks": [dict(self._bm_mark(b), media_id=b["media_id"])
                          for b in self.store.bookmarks() if b["source"] != "auto" or b["event_id"]],
            "event_chars": [{"event_id": l["target_id"], "char_id": l["character_id"], "role": l["role"]}
                            for l in self.store.character_links(target_type="event")],
        }

    def m_settings_get(self):
        return {k: v for k, v in self.settings.items() if k not in ("geometry",)}

    def m_settings_set(self, values):
        for k in ("roots", "clip_max_seconds", "short_session_seconds", "hide_short_sessions",
                  "event_gap_minutes", "remember_last_mix", "default_mix", "game_aliases",
                  "discord_token", "discord_guild", "discord_channel", "holub_marker"):
            if k in values:
                self.settings[k] = values[k]
        for k in values:           # transcript settings (Přepisy page)
            if k.startswith("ai_") and k in config.DEFAULTS:
                self.settings[k] = values[k]
        if not self.settings.get("remember_last_mix"):
            self.settings.pop("last_mix", None)
        self.host.save_settings()
        if values.get("_rescan", True):
            self.host.rescan()
        return True

    def m_pick_folder(self):
        return QFileDialog.getExistingDirectory(self.host.dialog_parent, "Složka se záznamy") or None

    def m_rescan(self):
        self.host.rescan()
        return True

    def m_open_data_dir(self):
        os.startfile(str(config.DATA_DIR))
        return True


def fmt_date(t):
    return time.strftime("%d. %m. %Y", time.localtime(t))


def urllib_path(p):
    return (p or "").split("?", 1)[0]


def _split_tags(text):
    return [t.strip().lstrip("#") for t in (text or "").split(",") if t.strip()]


def _fsize(path):
    try:
        return os.path.getsize(path) if path else 0
    except OSError:
        return 0


def _excerpt(html, n=180):
    import re
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
            .replace("&gt;", ">").replace("&quot;", '"'))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:n] + ("…" if len(text) > n else "")
