"""Synchronizace s webovou Kronikou – testy proti lokálnímu backendu (kronikar-web: npm run dev).

Spuštění:  python -m unittest tests.test_sync -v
Adresa backendu: proměnná KRONIKA_URL (výchozí http://127.0.0.1:8790). Když backend neběží, testy se přeskočí.
Každý test má vlastního testovacího uživatele (X-Dev-User) a vlastní dočasnou databázi.
"""
import importlib.util
import json
import os
import shutil
import sqlite3
import struct
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
import zlib
from pathlib import Path

from rpcatalog import sync
from rpcatalog.store import Store

URL = os.environ.get("KRONIKA_URL", "http://127.0.0.1:8790")


def _backend_up():
    try:
        with urllib.request.urlopen(URL + "/kronika/api/me", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def _png(path, w=40, h=30, rgb=(200, 60, 30)):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


@unittest.skipUnless(_backend_up(), f"lokální backend {URL} neběží (npm run dev v kronikar-web)")
class SyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kronikar-sync-"))
        self.db_path = self.tmp / "catalog.db"
        self.att_dir = self.tmp / "attachments"
        self.att_dir.mkdir()
        self.store = Store(self.db_path)
        self.user = {"id": "t" + uuid.uuid4().hex[:12], "name": "Test sync"}
        self.token = self.web("POST", "/tokens", {"label": "test"})["token"]
        self.settings = {"sync_url": URL, "sync_token": self.token}

    def tearDown(self):
        self.store.db.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- pomocníci
    def web(self, method, path, body=None):
        """Volání API jako uživatel v prohlížeči (X-Dev-User + Origin)."""
        req = urllib.request.Request(URL + "/kronika/api" + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"X-Dev-User": json.dumps(self.user), "Origin": URL,
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())

    def data(self):
        return self.web("GET", "/data")

    def by_src(self):
        return {r["src"]: r for r in self.data()["records"] if r["src"]}

    def run_sync(self, pairing=None, client_hook=None, **settings):
        s = sync.Syncer(self.db_path, dict(self.settings, **settings), self.att_dir)
        if client_hook:
            orig = s.client.request
            s.client.request = lambda m, path, *a, **k: client_hook(orig, m, path, *a, **k)
        try:
            return s.run(pairing=pairing)
        finally:
            s.close()

    def resolve(self, items):
        s = sync.Syncer(self.db_path, self.settings, self.att_dir)
        try:
            return s.resolve(items)
        finally:
            s.close()

    def seed(self):
        st = self.store
        self.sv = st.create_server("KCD2", "Hlavní server")
        self.pl = st.create_player("Honza", contact="tajny@example.com")
        self.fa = st.create_faction("Rod Kuňků", server_id=self.sv)
        self.c1 = st.create_character("Jindřich", player_id=self.pl, server_id=self.sv)
        self.c2 = st.create_character("Hans", body_html=f'<p>Přítel <span data-char-id="{self.c1}">Jindřich</span></p>')
        st.add_member(self.fa, self.c1, role="rytíř")
        self.rel = st.add_relation(self.c1, self.c2, label="přátelé")
        self.ev = st.create_event("Bitva u Skalice", start=1700000000)
        st.update_event(self.ev, server_id=self.sv, body_html="<p>Bitva</p>")
        st.set_event_tags(self.ev, ["bitva", "skalice"])
        self.en = st.create_entry(self.ev, title="Den první", body_html=f'<p><span data-char-id="{self.c2}">Hans</span> utekl</p>')
        st.link_character(self.c1, "event", self.ev, role="hrdina")
        self.yt = st.upsert_media({"path": "C:/videa/a.mp4", "game": "KCD2", "start_time": 1700000000, "duration": 60, "kind": "clip"})
        st.update_media(self.yt, youtube="dQw4w9WgXcQ", title="Bitva – video")
        self.local_only = st.upsert_media({"path": "C:/videa/b.mp4", "game": "KCD2", "start_time": 1700000100, "duration": 30, "kind": "clip"})
        st.commit()
        self.bm = st.create_bookmark(self.yt, 12.5, title="Útok")
        self.bm2 = st.create_bookmark(self.local_only, 3, title="Lokální")
        self.link = st.add_link(self.ev, self.yt, offset=5)
        img = self.att_dir / "portret.png"
        _png(img)
        self.att = st.add_attachment("character", self.c1, str(img), "portret.png", "image/png", "image", img.stat().st_size)
        st.update_character(self.c1, portrait_id=self.att)
        st.update_event(self.ev, body_html=f'<p>Bitva</p><img src="{img.as_uri()}" data-att="{self.att}" alt="">')
        self.letter = st.create_letter(title="Dopis", body="tajné", sender_id=self.c1)

    # ---- testy
    def test_first_and_second_push(self):
        self.seed()
        res = self.run_sync()
        self.assertEqual(res["conflicts"], 0, res)
        self.assertEqual(res["uploaded"], 1)
        recs = self.by_src()
        self.assertIn(f"characters:{self.c1}", recs)
        self.assertIn(f"media:{self.yt}", recs)
        self.assertNotIn(f"media:{self.local_only}", recs)          # lokální video bez YouTube se neposílá
        self.assertNotIn(f"bookmarks:{self.bm2}", recs)
        self.assertNotIn(f"letters:{self.letter}", recs)            # holubí pošta jen po zapnutí
        self.assertNotIn("contact", recs[f"players:{self.pl}"]["data"])
        ch = recs[f"characters:{self.c1}"]
        img = recs[f"attachments:{self.att}"]
        self.assertTrue(img["data"]["key"])
        self.assertEqual(ch["data"]["portrait_id"], img["id"])
        self.assertEqual(ch["data"]["player_id"], recs[f"players:{self.pl}"]["id"])
        ev = recs[f"events:{self.ev}"]
        self.assertEqual(sorted(ev["data"]["tags"]), ["bitva", "skalice"])
        self.assertIn(f"/kronika/img/{img['data']['key']}", ev["data"]["body_html"])
        self.assertEqual(img["data"]["owner_id"], ch["id"])
        links = {l["src"]: l for l in self.data()["links"] if l["src"]}
        self.assertIn(f"faction_members:{self.fa}:{self.c1}", links)
        self.assertIn(f"character_relations:{self.rel}", links)
        self.assertIn(f"event_links:{self.link}", links)
        n_rec, n_links = len(self.data()["records"]), len(self.data()["links"])

        res2 = self.run_sync()
        self.assertEqual(res2["sent"], 0, res2)
        self.assertEqual(res2["uploaded"], 0)
        self.assertEqual(res2["received"], 0, res2)
        self.assertEqual(len(self.data()["records"]), n_rec)
        self.assertEqual(len(self.data()["links"]), n_links)

        # holubí pošta po zapnutí – soukromě
        res3 = self.run_sync(sync_letters=True)
        self.assertEqual(res3["sent"], 1)
        lt = self.by_src()[f"letters:{self.letter}"]
        self.assertEqual(lt["visibility"], "private")

    def test_web_changes_pull(self):
        self.seed()
        self.run_sync()
        recs = self.by_src()
        rid = recs[f"characters:{self.c1}"]["id"]
        fa_rid = recs[f"factions:{self.fa}"]["id"]
        self.web("POST", "/ops", {"ops": [
            {"op": "update", "id": rid, "data": {"name": "Jindřich ze Skalice", "summary": "Kovářův syn"}},
            {"op": "create", "type": "character", "ref": "n", "data": {"name": "Theresa", "player_id": recs[f"players:{self.pl}"]["id"]}},
            {"op": "link", "kind": "member", "a_id": fa_rid, "b_id": "$n", "role": "služebná"},
            {"op": "create", "type": "event", "ref": "e", "data": {"title": "Hostina", "tags": ["jidlo"]}},
            {"op": "create", "type": "entry", "data": {"event_id": "$e", "title": "Večer", "body_html": f'<p><span data-char-id="{rid}">J</span></p>'}},
        ]})
        res = self.run_sync()
        self.assertEqual(res["conflicts"], 0, res)
        c = self.store.character(self.c1)
        self.assertEqual(c["name"], "Jindřich ze Skalice")
        self.assertEqual(c["summary"], "Kovářův syn")
        th = self.store.db.execute("SELECT * FROM characters WHERE name='Theresa'").fetchone()
        self.assertIsNotNone(th)
        self.assertEqual(th["player_id"], self.pl)
        self.assertTrue(self.store.faction_members(fid=self.fa, char_id=th["id"]))
        ev = self.store.db.execute("SELECT * FROM events WHERE title='Hostina'").fetchone()
        self.assertIsNotNone(ev)
        self.assertEqual([r[0] for r in self.store.db.execute("SELECT tag FROM event_tags WHERE event_id=?", (ev["id"],))], ["jidlo"])
        en = self.store.db.execute("SELECT * FROM entries WHERE event_id=?", (ev["id"],)).fetchone()
        self.assertIn(f'data-char-id="{self.c1}"', en["body_html"])
        # záznamy založené na webu teď mají src a vazba se páruje
        recs = self.by_src()
        self.assertIn(f"characters:{th['id']}", recs)
        self.assertIn(f"entries:{en['id']}", recs)
        live = [l for l in self.data()["links"] if l["kind"] == "member" and l["b_id"] == recs[f"characters:{th['id']}"]["id"]]
        self.assertEqual(len(live), 1)
        self.assertEqual(live[0]["src"], f"faction_members:{self.fa}:{th['id']}")
        # další kolo nic nemění ani neduplikuje
        n = len(self.data()["records"])
        res2 = self.run_sync()
        self.assertEqual((res2["sent"], res2["received"], res2["created_local"]), (0, 0, 0), res2)
        self.assertEqual(len(self.data()["records"]), n)

    def test_deletions(self):
        self.seed()
        self.run_sync()
        recs = self.by_src()
        # smazání na desktopu
        self.store.delete_relation(self.rel)
        self.store.delete_character(self.c2)
        res = self.run_sync()
        self.assertGreaterEqual(res["deleted_remote"], 1)
        recs2 = self.by_src()
        self.assertNotIn(f"characters:{self.c2}", recs2)
        self.assertNotIn(f"character_relations:{self.rel}", {l["src"] for l in self.data()["links"]})
        # smazání na webu
        self.web("POST", "/ops", {"ops": [{"op": "delete", "id": recs[f"events:{self.ev}"]["id"]}]})
        res = self.run_sync()
        self.assertIsNone(self.store.event(self.ev))
        self.assertIsNone(self.store.entry(self.en))
        self.assertGreaterEqual(res["deleted_local"], 1)
        # video ztratí YouTube → na webu zmizí, soubor lokálně zůstane
        self.store.update_media(self.yt, youtube=None)
        self.run_sync()
        self.assertNotIn(f"media:{self.yt}", self.by_src())
        self.assertIsNotNone(self.store.media(self.yt))

    def test_conflict(self):
        self.seed()
        self.run_sync()
        recs = self.by_src()
        rid1, rid2 = recs[f"characters:{self.c1}"]["id"], recs[f"factions:{self.fa}"]["id"]
        time.sleep(0.05)
        self.web("POST", "/ops", {"ops": [{"op": "update", "id": rid1, "data": {"name": "Web Jindřich"}},
                                          {"op": "update", "id": rid2, "data": {"name": "Web rod"}}]})
        self.store.update_character(self.c1, name="Desktop Jindřich")
        self.store.update_faction(self.fa, name="Desktop rod")
        res = self.run_sync()
        self.assertEqual(res["conflicts"], 2, res)
        self.assertEqual(self.store.character(self.c1)["name"], "Desktop Jindřich")
        self.assertEqual(self.by_src()[f"characters:{self.c1}"]["title"], "Web Jindřich")
        st = sync.status(self.db_path, self.settings)
        self.assertEqual({(c["local_type"], c["local_id"]) for c in st["conflicts"]},
                         {("characters", self.c1), ("factions", self.fa)})
        # konflikt se při dalším kole nepřepíše
        self.run_sync()
        self.assertEqual(self.by_src()[f"characters:{self.c1}"]["title"], "Web Jindřich")
        # vyřešit: postava z desktopu, frakce z webu
        self.resolve([{"local_type": "characters", "local_id": self.c1, "choice": "mine"},
                      {"local_type": "factions", "local_id": self.fa, "choice": "web"}])
        self.assertEqual(self.by_src()[f"characters:{self.c1}"]["title"], "Desktop Jindřich")
        self.assertEqual(self.store.faction(self.fa)["name"], "Web rod")
        res = self.run_sync()
        self.assertEqual((res["conflicts"], res["sent"], res["received"]), (0, 0, 0), res)

    def upload_web(self, owner_id, png):
        req = urllib.request.Request(f"{URL}/kronika/api/upload?owner_type=character&owner_id={owner_id}&name=web.png&caption=Z+webu",
                                     method="POST", data=Path(png).read_bytes(),
                                     headers={"X-Dev-User": json.dumps(self.user), "Origin": URL, "Content-Type": "image/png"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())["record"]

    def test_web_media_images_links(self):
        self.seed()
        self.run_sync()
        recs = self.by_src()
        c1 = recs[f"characters:{self.c1}"]["id"]
        png = self.tmp / "web.png"
        _png(png, 30, 20, (10, 200, 10))
        img = self.upload_web(c1, png)
        self.web("POST", "/ops", {"ops": [
            {"op": "update", "id": c1, "data": {"portrait_id": img["id"]}},
            {"op": "create", "type": "video", "ref": "v", "data": {"youtube": "abcdefghijk", "title": "Z webu", "tags": ["web"]}},
            {"op": "create", "type": "moment", "data": {"media_id": "$v", "t": 42, "title": "Moment z webu"}},
            {"op": "link", "kind": "char_link", "a_id": c1, "b_id": "$v", "role": "hraje"},
            {"op": "update", "id": recs[f"bookmarks:{self.bm}"]["id"], "data": {"title": "Útok (upraveno)"}},
        ]})
        res = self.run_sync()
        self.assertEqual(res["conflicts"], 0, res)
        c = self.store.character(self.c1)
        att = self.store.attachment(c["portrait_id"])
        self.assertEqual(att["caption"], "Z webu")
        self.assertTrue(Path(att["path"]).exists())
        self.assertEqual(Path(att["path"]).read_bytes(), png.read_bytes())
        m = self.store.db.execute("SELECT * FROM media WHERE youtube='abcdefghijk'").fetchone()
        self.assertIsNotNone(m)
        self.assertEqual(m["title"], "Z webu")
        self.assertEqual(self.store.media(m["id"]).tags, ["web"])
        self.assertEqual([b["title"] for b in self.store.bookmarks(media_id=m["id"])], ["Moment z webu"])
        self.assertEqual(self.store.bookmark(self.bm)["title"], "Útok (upraveno)")
        self.assertTrue(self.store.character_links(character_id=self.c1, target_type="media", target_id=m["id"]))
        # nic se znovu nenahrává ani neduplikuje
        n = len(self.data()["records"])
        res2 = self.run_sync()
        self.assertEqual((res2["sent"], res2["uploaded"], res2["received"]), (0, 0, 0), res2)
        self.assertEqual(len(self.data()["records"]), n)
        # změna souboru obrázku → nahraje se znovu
        _png(att["path"], 50, 50, (0, 0, 255))
        os.utime(att["path"], (time.time() + 5, time.time() + 5))
        res3 = self.run_sync()
        self.assertEqual(res3["uploaded"], 1, res3)

    def test_deleted_on_web_conflict(self):
        self.seed()
        self.run_sync()
        rid = self.by_src()[f"characters:{self.c2}"]["id"]
        self.web("POST", "/ops", {"ops": [{"op": "delete", "id": rid}]})
        self.store.update_character(self.c2, summary="změna na desktopu")
        res = self.run_sync()
        self.assertEqual(res["conflicts"], 1, res)
        self.assertIsNotNone(self.store.character(self.c2))
        self.resolve([{"local_type": "characters", "local_id": self.c2, "choice": "mine"}])
        rec = self.by_src()[f"characters:{self.c2}"]
        self.assertEqual(rec["data"]["summary"], "změna na desktopu")
        res = self.run_sync()
        self.assertEqual((res["conflicts"], res["sent"]), (0, 0), res)

    def test_after_web_import(self):
        """catalog.db už byl jednou nahraný přes import na webu → první synchronizace jen spáruje, nic nezdvojí."""
        self.seed()
        rows = lambda t: [dict(r) for r in self.store.db.execute(f"SELECT * FROM {t}")]
        self.web("POST", "/import", {"tables": {t: rows(t) for t in ("servers", "players", "factions", "characters", "events", "faction_members")}})
        n = len(self.data()["records"])
        with self.assertRaises(sync.PairingNeeded):
            self.run_sync()                              # neznámá databáze proti webu se záznamy z desktopu
        res = self.run_sync(pairing="match")
        self.assertEqual(res["conflicts"], 0, res)
        self.assertEqual(res["created_local"], 0, res)
        recs = self.by_src()
        self.assertIn("/kronika/img/", recs[f"events:{self.ev}"]["data"]["body_html"])
        self.assertEqual(len([r for r in self.data()["records"] if r["type"] == "character"]), 2)
        self.assertGreater(len(self.data()["records"]), n)

    # ---- regresní testy z review PR #2
    def test_r1_remote_delete_keeps_unsynced_children_and_files(self):
        self.seed()
        doc = self.att_dir / "zapis.pdf"
        doc.write_bytes(b"%PDF-1.4 dulezite")
        self.store.add_attachment("character", self.c2, str(doc), "zapis.pdf", "application/pdf", "file", doc.stat().st_size)
        self.run_sync()
        recs = self.by_src()
        new_en = self.store.create_entry(self.ev, title="NOVÝ lokální zápis", body_html="<p>důležité</p>")
        self.web("POST", "/ops", {"ops": [{"op": "delete", "id": recs[f"events:{self.ev}"]["id"]},
                                          {"op": "delete", "id": recs[f"characters:{self.c2}"]["id"]}]})
        res = self.run_sync()
        self.assertIsNotNone(self.store.entry(new_en))           # nepublikovaný zápis nezmizel
        self.assertIsNotNone(self.store.event(self.ev))
        self.assertIsNotNone(self.store.character(self.c2))      # má nepublikovanou přílohu (soubor)
        self.assertTrue(doc.exists())
        kinds = {(c["local_type"], c["local_id"]): c["kind"] for c in sync.status(self.db_path, self.settings)["conflicts"]}
        self.assertEqual(kinds.get(("events", self.ev)), "deleted_remote", res)
        self.assertEqual(kinds.get(("characters", self.c2)), "deleted_remote", res)
        self.assertNotIn(f"entries:{new_en}", self.by_src())      # potomek konfliktního záznamu se neposílá
        # „Vzít z webu“ smaže záznam, ale soubor, který nebyl na webu, z disku nikdy
        self.resolve([{"local_type": "characters", "local_id": self.c2, "choice": "web"}])
        self.assertIsNone(self.store.character(self.c2))
        self.assertTrue(doc.exists())

    def test_r2_other_database_needs_pairing(self):
        self.seed()
        self.run_sync()
        before = self.by_src()[f"characters:{self.c1}"]["title"]
        p2 = self.tmp / "fresh.db"
        st2 = Store(p2)
        cid = st2.create_character("Úplně jiná postava")
        st2.db.close()
        self.db_path = p2
        with self.assertRaises(sync.PairingNeeded):
            self.run_sync()
        self.assertEqual(self.by_src()[f"characters:{cid}"]["title"], before)   # web nedotčený
        # spárovat podle id: jiný obsah → konflikt, nic se nepřepíše
        res = self.run_sync(pairing="match")
        self.assertGreaterEqual(res["conflicts"], 1, res)
        self.assertEqual(self.by_src()[f"characters:{cid}"]["title"], before)
        self.run_sync()                                  # podruhé se už neptá

    def test_r2_copy_database(self):
        self.seed()
        self.run_sync()
        before = self.by_src()[f"characters:{self.c1}"]["title"]
        n = len(self.data()["records"])
        p2 = self.tmp / "copy.db"
        st2 = Store(p2)
        st2.create_character("Postava z kopie")
        st2.db.close()
        self.db_path = p2
        res = self.run_sync(pairing="copy")
        self.assertEqual(res["conflicts"], 0, res)
        self.assertEqual(self.by_src()[f"characters:{self.c1}"]["title"], before)
        titles = [r["title"] for r in self.data()["records"] if r["type"] == "character"]
        self.assertIn("Postava z kopie", titles)
        self.assertEqual(len(self.data()["records"]), n + 1)
        res2 = self.run_sync()
        self.assertEqual((res2["sent"], res2["received"], res2["created_local"]), (0, 0, 0), res2)
        # původní databáze dál funguje a nic jí nepřibylo
        self.db_path = self.tmp / "catalog.db"
        res3 = self.run_sync()
        self.assertEqual((res3["created_local"], res3["conflicts"]), (0, 0), res3)

    def test_r3_lost_import_response(self):
        self.seed()
        self.run_sync()
        self.store.update_character(self.c1, summary="lokální změna")

        def hook(orig, m, path, *a, **k):
            r = orig(m, path, *a, **k)
            if path == "/import":
                raise sync.NetworkError("timeout (simulace)")
            return r
        with self.assertRaises(sync.SyncError):
            self.run_sync(client_hook=hook)
        res = self.run_sync()
        self.assertEqual(res["conflicts"], 0, res)
        self.assertEqual(self.by_src()[f"characters:{self.c1}"]["data"]["summary"], "lokální změna")
        self.assertEqual(self.store.character(self.c1)["summary"], "lokální změna")

    def test_r4_web_video_with_same_youtube(self):
        self.seed()
        self.run_sync()
        old_rid = self.by_src()[f"media:{self.yt}"]["id"]
        self.web("POST", "/ops", {"ops": [{"op": "create", "type": "video", "data": {"youtube": "dQw4w9WgXcQ", "title": "WEB titulek"}}]})
        res = self.run_sync()
        self.assertEqual(self.store.media(self.yt).title, "Bitva – video")
        pub = self.store.db.execute("SELECT remote_id FROM published WHERE local_type='media' AND local_id=?", (self.yt,)).fetchone()[0]
        self.assertEqual(pub, old_rid)
        self.assertTrue(any("YouTube" in w for w in res["warnings"]), res)
        self.assertEqual(len([r for r in self.data()["records"] if r["src"] == f"media:{self.yt}"]), 1)

    def test_no_db_lock_during_network(self):
        self.seed()
        locked = []

        def hook(orig, m, path, *a, **k):
            try:
                c = sqlite3.connect(str(self.db_path), timeout=0.2)
                c.execute("UPDATE players SET summary=summary WHERE id=?", (self.pl,))
                c.commit()
                c.close()
            except sqlite3.OperationalError as e:
                locked.append((path, str(e)))
            return orig(m, path, *a, **k)
        self.run_sync(client_hook=hook)
        rid = self.by_src()[f"characters:{self.c1}"]["id"]
        png = self.tmp / "w.png"
        _png(png)
        self.upload_web(rid, png)
        self.run_sync(client_hook=hook)
        self.assertEqual(locked, [])

    def test_bad_image_does_not_stop_sync(self):
        self.seed()
        bad = self.att_dir / "rozbity.png"
        bad.write_bytes(b"tohle neni obrazek")
        bad_att = self.store.add_attachment("character", self.c2, str(bad), "rozbity.png", "image/x-rozbity", "image", 18)
        self.store.update_character(self.c2, portrait_id=bad_att,
                                    body_html=f'<p>Hans</p><img src="{bad.as_uri()}" data-att="{bad_att}">')
        res = self.run_sync()
        self.assertEqual(res["uploaded"], 1, res)                 # dobrý obrázek prošel
        self.assertTrue(any("rozbity" in w for w in res["warnings"]), res)
        rec = self.by_src()[f"characters:{self.c2}"]
        self.assertIsNone(rec["data"].get("portrait_id"))
        # obrázek z webu, který nejde stáhnout (404)
        self.web("POST", "/ops", {"ops": [{"op": "create", "type": "image", "data": {
            "owner_type": "character", "owner_id": rec["id"], "key": "neexistujeXXXXXX.png", "kind": "image"}}]})
        # web upraví postavu s nenahranou přílohou: lokální portrét a obrázek v textu zůstanou
        self.web("POST", "/ops", {"ops": [{"op": "update", "id": rec["id"], "data": {"name": "Hans z webu", "body_html": "<p>Hans z webu</p>"}}]})
        res = self.run_sync()
        c = self.store.character(self.c2)
        self.assertEqual(c["name"], "Hans z webu")
        self.assertEqual(c["portrait_id"], bad_att)
        self.assertIn(f'data-att="{bad_att}"', c["body_html"])
        self.assertIn("Hans z webu", c["body_html"])
        self.assertTrue(any("stáhnout" in w for w in res["warnings"]), res)

    def test_whitelist_and_account_key(self):
        self.seed()
        self.store.db.execute("UPDATE bookmarks SET medal_key='tajne' WHERE id=?", (self.bm,))
        self.store.commit()
        self.run_sync()
        recs = self.by_src()
        self.assertNotIn("path", recs[f"attachments:{self.att}"]["data"])
        self.assertNotIn("medal_key", recs[f"bookmarks:{self.bm}"]["data"])
        # stará podoba klíče účtu (adresa|id) ani jiná adresa mapu nesmaže
        s = sync.Syncer(self.db_path, self.settings, self.att_dir)
        uid = s.state("account")
        s.set_state("account", f"https://www.example.com/kronika/api|{uid}")
        s.close()
        res = self.run_sync()
        self.assertEqual((res["sent"], res["created_remote"]), (0, 0), res)
        with self.assertRaises(sync.SyncError):
            sync.check_url("http://example.com")
        self.assertEqual(sync.check_url("http://127.0.0.1:8790/"), "http://127.0.0.1:8790")

    @unittest.skipUnless(importlib.util.find_spec("PySide6"), "bez PySide6")
    def test_media_update_rejects_bad_youtube(self):
        from rpcatalog import api as apimod
        apimod.ATT_DIR = self.att_dir

        class Host:
            def save_settings(self):
                pass
        self.seed()
        a = apimod.Api(self.store, {}, Host())
        with self.assertRaises(ValueError):
            a.m_media_update(self.yt, youtube="tohle neni odkaz")
        self.assertEqual(self.store.media(self.yt).youtube, "dQw4w9WgXcQ")
        a.m_media_update(self.yt, youtube="https://youtu.be/abcdefghijk")
        self.assertEqual(self.store.media(self.yt).youtube, "abcdefghijk")
        a.m_media_update(self.yt, youtube="")
        self.assertIsNone(self.store.media(self.yt).youtube)

    def test_bad_token(self):
        s = sync.Syncer(self.db_path, {"sync_url": URL, "sync_token": "krt_spatny"}, self.att_dir)
        try:
            with self.assertRaises(sync.SyncError) as cm:
                s.run()
            self.assertIn("token", str(cm.exception).lower())
        finally:
            s.close()


class HelpersTest(unittest.TestCase):
    def test_youtube_id(self):
        self.assertEqual(sync.youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), "dQw4w9WgXcQ")
        self.assertEqual(sync.youtube_id("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
        self.assertEqual(sync.youtube_id("dQw4w9WgXcQ"), "dQw4w9WgXcQ")
        self.assertIsNone(sync.youtube_id("nic"))
        self.assertEqual(sync.mask_token("krt_abcdefghijklmnop"), "krt_ab…mnop")


if __name__ == "__main__":
    unittest.main()
