/* ============================================================
   Browser backend for the shared Kronikář UI.
   The desktop UI talks to Python (rpcatalog/api.py) through QWebChannel:
       bridge.call(method, argsJson, callback)   bridge.notify.connect(fn(kind, payloadJson))
   This file is a JS port of api.py that exposes the same bridge object, so core.js and all
   views run unchanged. Data: SQLite (sql.js) + blobs in IndexedDB, videos read in place.
   ============================================================ */
'use strict';

window.KronikarWeb = (() => {
  const DEFAULTS = {
    clip_max_seconds: 300, short_session_seconds: 60, hide_short_sessions: true, default_mix: [],
    remember_last_mix: true, event_gap_minutes: 45, game_aliases: {}, volume: 100, ui: {}, player_layout: 'stack',
  };
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
  const PALETTE = ['#e3b341', '#5aa9e6', '#e5646e', '#5cc98a', '#a77be8', '#ef9a4b', '#40c4c4', '#e06aa8'];
  const READ_ONLY = new Set(['bootstrap', 'media.list', 'media.get', 'media.reveal', 'media.play', 'player.action',
    'album.items', 'events.list', 'event.get', 'event.suggest', 'event.propose', 'events.at', 'att.open', 'att.reveal',
    'att.play_source', 'gallery', 'chars.list', 'char.get', 'timeline.data', 'settings.get', 'pick_folder', 'open_data_dir',
    'rescan', 'bm.list', 'bm.get', 'snap.grab', 'layout.set', 'window.bg', 'window.zoom', 'pane.toggle', 'places.list',
    'place.get', 'letters.list', 'discord.members', 'factions.list', 'faction.get', 'players.list', 'player.get']);
  const DESKTOP_ONLY = 'Tohle umí jen desktopová verze Kronikáře.';

  let SQL = null, store = null, settings = { ...DEFAULTS };
  const listeners = [];
  const emit = (kind, payload = {}) => listeners.forEach(fn => { try { fn(kind, JSON.stringify(payload)); } catch (e) { console.error(e); } });
  const S = () => store;
  const url = Files.url.bind(Files);

  /* ---------------- persistence ---------------- */
  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (store && store.dirty) await IDB.set('kv', 'catalog', store.export());
  }
  const saveSettings = () => IDB.set('kv', 'settings', settings);

  /* ---------------- helpers ---------------- */
  const splitTags = t => String(t || '').split(',').map(x => x.trim().replace(/^#+/, '')).filter(Boolean);
  function excerpt(html, n = 180) {
    let t = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    return t.slice(0, n) + (t.length > n ? '…' : '');
  }
  function pickFiles({ accept = '', multiple = false } = {}) {
    return new Promise(resolve => {
      const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
      inp.multiple = multiple;
      inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
      inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function dataUrlToBlob(d) {
    const [head, b64] = String(d).split(',');
    const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(b64 || head);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  const extOf = name => ((/\.[a-z0-9]{1,5}$/i.exec(name || '') || [''])[0]).toLowerCase();
  const mimeOf = ext => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain' }[ext] || 'application/octet-stream');
  function attKey(name) {
    const d = new Date();
    return `att/${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}${extOf(name) || '.bin'}`;
  }
  async function storeAttachment(ownerType, ownerId, blob, name, extra = {}) {
    const key = attKey(name);
    const path = await Files.put(key, blob);
    const ext = extOf(name) || extOf(key);
    const id = S().addAttachment(ownerType, ownerId, path, name, blob.type || mimeOf(ext), IMAGE_EXT.test(ext) ? 'image' : 'file', blob.size, extra);
    return att(S().attachment(id));
  }
  async function removeFile(path) { if (String(path || '').startsWith('idb:')) await Files.del(path); }
  async function deleteOwnerFiles(type, id) {
    for (const a of S().attachments(type, id)) { await removeFile(a.path); S().deleteAttachment(a.id); }
  }

  /* ---------------- serializers (api.py) ---------------- */
  function bmMark(b) {
    return { id: b.id, t: b.t, t_end: b.t_end, title: b.title, source: b.source, event_id: b.event_id, color: b.color || b.event_color || '' };
  }
  const bmMarks = mid => S().bookmarks({ media_id: mid }).map(bmMark);
  function bmMap() {
    const out = new Map();
    for (const b of S().bookmarks()) { if (!out.has(b.media_id)) out.set(b.media_id, []); out.get(b.media_id).push(bmMark(b)); }
    return out;
  }
  function charMap(type) {
    const out = new Map();
    for (const l of S().characterLinks({ target_type: type })) {
      if (!out.has(l.target_id)) out.set(l.target_id, []);
      const arr = out.get(l.target_id);
      if (!arr.includes(l.character_id)) arr.push(l.character_id);
    }
    return out;
  }
  function media(m, linked = null, chars = null, bms = null) {
    if (!m) return null;
    const thumbKey = (String(m.custom_thumb || '').startsWith('idb:') && m.custom_thumb) || m.thumb;
    return {
      id: m.id, title: m.title, medal_title: m.medal_title, name: M.title(m), game: m.game, kind: m.kind, kind_override: m.kind_override,
      type: M.kind(m), start: m.start_time, end: M.end(m), duration: m.duration, size: m.size,
      thumb: url(thumbKey), thumb_size: Files.size(thumbKey), custom_thumb: String(m.custom_thumb || '').startsWith('idb:'),
      server_id: m.server_id, tags: m.tags, favorite: !!m.favorite, missing: !!m.missing, description: m.description || '', path: m.path,
      linked: linked ? linked.has(m.id) : null, tracks: M.tracks(m), bookmarks: bms ? (bms.get(m.id) || []) : bmMarks(m.id),
      sidecars: M.sidecars(m).length, resume: m.resume_pos, watched_at: m.watched_at,
      chars: chars ? (chars.get(m.id) || []) : null,
    };
  }
  function bm(b, chars = null, m = null) {
    b = { ...b };
    m = m || S().media(b.media_id);
    b.abs = m && m.start_time ? m.start_time + b.t : null;
    b.media = m ? { id: m.id, name: M.title(m), game: m.game, thumb: url(m.thumb), duration: m.duration, start: m.start_time, type: M.kind(m) } : null;
    b.chars = (chars || charMap('bookmark')).get(b.id) || [];
    delete b.medal_key;
    return b;
  }
  function playerTagMap() {
    const tags = new Map(S().players().map(p => [p.id, splitTags(p.tags)]));
    return new Map(S().characters().filter(c => c.player_id).map(c => [c.id, tags.get(c.player_id) || []]));
  }
  function bms(rows) {
    const chars = charMap('bookmark'), ptags = playerTagMap(), cache = new Map(), out = [];
    for (const b of rows) {
      if (!cache.has(b.media_id)) cache.set(b.media_id, S().media(b.media_id));
      const m = cache.get(b.media_id);
      if (!m) continue;
      const d = bm(b, chars, m);
      d.tags = [...new Set(d.chars.flatMap(cid => ptags.get(cid) || []))].sort();
      out.push(d);
    }
    return out;
  }
  const att = a => ({ ...a, url: url(a.path) });
  function char(c, members = null) {
    c = { ...c };
    const mem = members ? (members.get(c.id) || []) : S().factionMembers({ char_id: c.id });
    c.factions = mem.map(m => ({ id: m.faction_id, name: m.faction_name, color: m.faction_color, kind: m.faction_kind, role: m.role }));
    if (c.factions.length) c.faction = c.factions.map(f => f.name).join(', ');
    c.player_tags = [];
    if (c.player_id) {
      const pl = S().player(c.player_id);
      if (pl) { c.player = pl.name; c.player_tags = splitTags(pl.tags); }
    }
    const a = c.portrait_id ? S().attachment(c.portrait_id) : null;
    c.portrait = a ? url(a.path) : null;
    c.own_color = c.color; c.banner = null; c.style_from = null;
    if (c.factions.length && !c.own_style) {
      const f = S().faction(c.factions[0].id);
      if (f) {
        c.color = f.color || c.color;
        const emb = f.emblem_id ? S().attachment(f.emblem_id) : null;
        c.banner = emb ? url(emb.path) : null;
        c.style_from = f.name;
      }
    }
    return c;
  }
  function chars() {
    const members = new Map();
    for (const m of S().factionMembers()) { if (!members.has(m.character_id)) members.set(m.character_id, []); members.get(m.character_id).push(m); }
    return S().characters().map(c => char(c, members));
  }
  function faction(f) { f = { ...f }; const a = f.emblem_id ? S().attachment(f.emblem_id) : null; f.emblem = a ? url(a.path) : null; return f; }
  function ownerName(type, id) {
    if (type === 'faction') { const f = id ? S().faction(id) : null; return f ? f.name : ''; }
    if (type === 'character') { const c = id ? S().character(id) : null; return c ? c.name : ''; }
    return '';
  }
  function place(p) {
    p = { ...p };
    const a = p.image_id ? S().attachment(p.image_id) : null;
    p.image = a ? url(a.path) : null;
    p.owner_name = ownerName(p.owner_type, p.owner_id);
    if ('n_events' in p) delete p.body_html;
    return p;
  }
  function letter(l) {
    l = { ...l };
    try { l.recipient_ids = JSON.parse(l.recipient_ids || '[]'); } catch (e) { l.recipient_ids = []; }
    if (l.author_discord_id) { const pl = S().players().find(p => p.discord_id === l.author_discord_id); l.author_player_id = pl ? pl.id : null; }
    return l;
  }
  function playerRow(pl) { pl = { ...pl }; const a = pl.avatar_id ? S().attachment(pl.avatar_id) : null; pl.avatar = a ? url(a.path) : null; return pl; }
  function marksFor(m) {
    const marks = S().bookmarks({ media_id: m.id }).map(b => ({
      t: b.t, t_end: b.t_end, label: (b.title || (b.t_end ? 'úsek' : 'záložka')) + (b.event_title ? ` → ${b.event_title}` : ''),
      color: b.color || b.event_color || '', kind: b.source === 'auto' && !b.event_id ? 'auto' : 'bm' }));
    for (const l of S().links({ media_id: m.id })) if (l.offset != null) marks.push({ t: l.offset, t_end: null, label: l.event_title, color: '', kind: 'ref' });
    return marks;
  }
  function refreshMarks(mid) { if (WebPlayer.media && WebPlayer.media.id === mid) WebPlayer.setMarks(marksFor(WebPlayer.media)); }
  function ensureLink(eid, mid) { if (eid && !S().links({ event_id: eid }).some(l => l.media_id === mid)) S().addLink(eid, mid); }
  function setBmChars(id, list) {
    const have = new Set(S().characterLinks({ target_type: 'bookmark', target_id: id }).filter(l => l.source === 'manual').map(l => l.character_id));
    const want = new Set(list);
    want.forEach(c => { if (!have.has(c)) S().linkCharacter(c, 'bookmark', id); });
    have.forEach(c => { if (!want.has(c)) S().unlinkCharacter(c, 'bookmark', id); });
  }
  function notPlaying() { throw new Error('Nic se nepřehrává – pusť video, ze kterého chceš snímek.'); }
  async function setCustomThumb(id, blob) {
    const m = S().media(id);
    const old = m && m.custom_thumb;
    const path = blob ? await Files.put(`cthumb/${id}-${crypto.randomUUID().slice(0, 6)}.jpg`, blob) : null;
    S().updateMedia(id, { custom_thumb: path });
    if (old) await removeFile(old);
  }

  /* ---------------- methods (same names as api.py) ---------------- */
  const api = {
    bootstrap: () => ({
      settings: { clip_max_seconds: settings.clip_max_seconds, short_session_seconds: settings.short_session_seconds,
        hide_short_sessions: settings.hide_short_sessions, event_gap_minutes: settings.event_gap_minutes,
        roots: Folders.names(), ui: settings.ui || {}, player_layout: settings.player_layout },
      albums: S().albums(), tags: S().allTags(), games: S().games(), characters: chars(),
      factions: api['factions.list'](), places: api['places.list'](), servers: S().servers(), players: api['players.list'](),
    }),
    'layout.set': ({ mode }) => { settings.player_layout = mode === 'row' ? 'row' : 'stack'; saveSettings(); return true; },
    'window.bg': () => true,
    'window.zoom': ({ factor }) => { document.documentElement.style.zoom = Math.max(0.6, Math.min(1.6, +factor || 1)); return true; },
    'pane.toggle': () => true,
    'ui.save': ({ ui }) => { settings.ui = ui; saveSettings(); return true; },

    /* media */
    'media.list': () => {
      const linked = S().linkedMediaIds(), ch = charMap('media'), b = bmMap();
      return S().allMedia().map(m => media(m, linked, ch, b));
    },
    'media.get': ({ id }) => {
      const m = S().media(id);
      if (!m) return null;
      const d = media(m, S().linkedMediaIds(), charMap('media'));
      d.albums = S().mediaAlbumIds(id).sort((a, b) => a - b);
      d.links = S().links({ media_id: id });
      d.bm_full = bms(S().bookmarks({ media_id: id }));
      return d;
    },
    'media.update': ({ id, ...f }) => {
      if ('tags' in f) { S().setMediaTags(id, f.tags); delete f.tags; }
      if ('chars' in f) {
        const want = new Set(f.chars); delete f.chars;
        const have = new Set(S().characterLinks({ target_type: 'media', target_id: id }).filter(l => l.source === 'manual').map(l => l.character_id));
        want.forEach(c => { if (!have.has(c)) S().linkCharacter(c, 'media', id); });
        have.forEach(c => { if (!want.has(c)) S().unlinkCharacter(c, 'media', id); });
      }
      if ('favorite' in f) f.favorite = f.favorite ? 1 : 0;
      ['path', 'thumb', 'duration', 'custom_thumb'].forEach(k => delete f[k]);
      S().updateMedia(id, f);
      return api['media.get']({ id });
    },
    'media.bulk': ({ ids, op, value = null }) => {
      if (op === 'add_tags') S().addMediaTags(ids, value);
      else if (op === 'remove_tag') ids.forEach(mid => { const m = S().media(mid); S().setMediaTags(mid, m.tags.filter(t => t !== value)); });
      else if (op === 'kind') ids.forEach(mid => S().updateMedia(mid, { kind_override: value }));
      else if (op === 'favorite') ids.forEach(mid => S().updateMedia(mid, { favorite: value ? 1 : 0 }));
      else if (op === 'game') ids.forEach(mid => S().updateMedia(mid, { game: value }));
      else if (op === 'album_add') S().addToAlbum(value, ids);
      else if (op === 'album_remove') S().removeFromAlbum(value, ids);
      else if (op === 'char_add') ids.forEach(mid => S().linkCharacter(value, 'media', mid));
      return true;
    },
    'media.delete': () => { throw new Error('Mazání videí z disku umí jen desktopová verze – webová složky Medalu jen čte.'); },
    'media.reveal': ({ id }) => { const m = S().media(id); toast(`Soubor: ${m ? m.path : '?'} (otevřít složku z prohlížeče nejde)`); return true; },
    'media.play': async ({ id, offset = null, popout = false, end = null }) => {
      const m = S().media(id);
      if (!m) return false;
      let file;
      try { file = await Folders.file(m.path); } catch (e) { banner(); throw e; }
      let resumed = null;
      const rp = m.resume_pos;
      if (offset == null && end == null && rp && (!m.duration || rp < m.duration - 20)) offset = resumed = rp;
      await WebPlayer.load(m, { offset, end, file });
      WebPlayer.setMarks(marksFor(m));
      if (popout) WebPlayer.handle('popout');
      if (resumed) emit('resumed', { media_id: m.id, pos: resumed });
      return true;
    },
    'player.action': ({ act }) => { WebPlayer.handle(act); return true; },

    /* bookmarks */
    'bm.list': ({ media_id = null, event_id = null, include_auto = true } = {}) => {
      let rows = S().bookmarks({ media_id, event_id });
      if (!include_auto) rows = rows.filter(b => b.source !== 'auto' || b.event_id || b.note);
      return bms(rows);
    },
    'bm.get': ({ id }) => { const b = S().bookmark(id); return b ? bm(b) : null; },
    'bm.create': ({ media_id, t, t_end = null, title = '', note = '', event_id = null, chars: cs = null, color = '' }) => {
      if (t_end != null && t_end < t) [t, t_end] = [t_end, t];
      const id = S().createBookmark(media_id, t, t_end, title, note, event_id, color);
      if (cs && cs.length) setBmChars(id, cs);
      ensureLink(event_id, media_id);
      refreshMarks(media_id);
      return id;
    },
    'bm.update': ({ id, chars: cs = null, ...f }) => {
      const b = S().bookmark(id);
      if (!b) return false;
      const t = f.t ?? b.t;
      if (f.t_end != null && f.t_end <= t) f.t_end = null;
      S().updateBookmark(id, f);
      if (cs != null) setBmChars(id, cs);
      if (f.event_id) ensureLink(f.event_id, b.media_id);
      refreshMarks(b.media_id);
      return true;
    },
    'bm.delete': ({ id }) => { const b = S().bookmark(id); if (b) { S().deleteBookmark(id); refreshMarks(b.media_id); } return true; },
    'media.thumb_pick': async ({ id }) => {
      const [f] = await pickFiles({ accept: 'image/*' });
      if (!f) return false;
      await setCustomThumb(id, f);
      return true;
    },
    'media.thumb_data': async ({ id, data_b64 }) => { await setCustomThumb(id, dataUrlToBlob(data_b64)); return true; },
    'media.thumb_reset': async ({ id }) => { await setCustomThumb(id, null); return true; },
    'media.resume_clear': ({ id }) => { S().setResume(id, null); return true; },

    /* albums */
    'album.create': ({ name, ids = null }) => { const aid = S().createAlbum(name); if (ids) S().addToAlbum(aid, ids); return aid; },
    'album.rename': ({ id, name }) => { S().renameAlbum(id, name); return true; },
    'album.delete': ({ id }) => { S().deleteAlbum(id); return true; },
    'album.items': ({ id }) => S().albumMediaIds(id),

    /* events */
    'events.list': () => {
      const ch = charMap('event');
      const count = sql => new Map(S().all(sql).map(r => [r.k, r.n]));
      const nEntries = count('SELECT event_id k, COUNT(*) n FROM entries GROUP BY event_id');
      const nBm = count('SELECT event_id k, COUNT(*) n FROM bookmarks WHERE hidden=0 AND event_id IS NOT NULL GROUP BY event_id');
      const nAtt = count("SELECT owner_id k, COUNT(*) n FROM attachments WHERE owner_type='event' GROUP BY owner_id");
      return S().events().map(e => {
        e = { ...e, chars: ch.get(e.id) || [], entry_count: nEntries.get(e.id) || 0, att_count: nAtt.get(e.id) || 0, bm_count: nBm.get(e.id) || 0 };
        e.excerpt = excerpt(e.body_html || e.description || '');
        delete e.body_html;
        const cover = e.cover_id ? S().attachment(e.cover_id) : null;
        e.cover = cover ? url(cover.path) : null;
        return e;
      });
    },
    'event.get': ({ id }) => {
      const ev = S().event(id);
      if (!ev) return null;
      const e = { ...ev };
      const linked = S().linkedMediaIds(), mc = charMap('media');
      e.links = [];
      for (const l of S().links({ event_id: id })) { const m = S().media(l.media_id); if (m) { l.media = media(m, linked, mc); e.links.push(l); } }
      e.entries = S().entries(id).map(en => ({ ...en, attachments: S().attachments('entry', en.id).map(att),
        chars: S().characterLinks({ target_type: 'entry', target_id: en.id }).map(l => l.character_id) }));
      e.attachments = S().attachments('event', id).map(att);
      e.char_links = S().characterLinks({ target_type: 'event', target_id: id });
      e.children = S().events().filter(c => c.parent_id === id).map(c => c.id);
      e.bookmarks = bms(S().bookmarks({ event_id: id }));
      return e;
    },
    'event.create': ({ title, parent_id = null, start = null, end = null, media_ids = null, color = null, server_id = null }) => {
      const eid = S().createEvent(title, parent_id, start, end);
      S().updateEvent(eid, { color: color || PALETTE[eid % PALETTE.length], server_id });
      (media_ids || []).forEach(mid => S().addLink(eid, mid));
      return eid;
    },
    'event.update': ({ id, ...f }) => {
      if ('tags' in f) { S().setEventTags(id, f.tags); delete f.tags; }
      S().updateEvent(id, f);
      return true;
    },
    'event.delete': async ({ id }) => {
      for (const eid of S().eventDescendantIds(id)) {
        for (const en of S().entries(eid)) { await deleteOwnerFiles('entry', en.id); S().deleteEntry(en.id); }
        await deleteOwnerFiles('event', eid);
        S().run("DELETE FROM character_links WHERE target_type='event' AND target_id=?", [eid]);
      }
      S().deleteEvent(id);
      return true;
    },
    'event.move': ({ id, parent_id, position = null }) => {
      if (parent_id != null && S().eventDescendantIds(id).includes(parent_id)) throw new Error('Událost nejde vložit sama do sebe');
      const sib = S().events().filter(e => e.parent_id === parent_id && e.id !== id);
      const pos = position == null ? sib.length : Math.max(0, Math.min(position, sib.length));
      sib.splice(pos, 0, { id });
      sib.forEach((s, i) => S().updateEvent(s.id, s.id === id ? { position: i, parent_id } : { position: i }));
      return true;
    },
    'event.range_from_links': ({ id }) => {
      let ms = [];
      for (const eid of S().eventDescendantIds(id)) ms = ms.concat(S().links({ event_id: eid }).map(l => S().media(l.media_id)));
      ms = ms.filter(m => m && m.start_time);
      if (!ms.length) return null;
      const s = Math.min(...ms.map(m => m.start_time)), e = Math.max(...ms.map(m => M.end(m)));
      S().updateEvent(id, { start_time: s, end_time: e });
      return { start: s, end: e };
    },
    'event.suggest': ({ id }) => {
      const e = S().event(id);
      const limit = settings.short_session_seconds ?? 60;
      const all = S().allMedia().filter(m => !(M.kind(m) === 'session' && (m.duration || 0) < limit));
      const linked = new Set(S().links({ event_id: id }).map(l => l.media_id));
      const other = new Map();
      for (const l of S().links()) if (l.event_id !== id) { if (!other.has(l.media_id)) other.set(l.media_id, []); other.get(l.media_id).push(l.event_title); }
      const lk = S().linkedMediaIds();
      return Suggest.suggestForEvent(e, all, linked, other).map(s => ({ media: media(s.media, lk), score: Math.min(100, Math.round(s.score)), reasons: s.reasons, offset: s.offset }));
    },
    'event.propose': ({ gap = null, game = null, only_sessions = true } = {}) => {
      let all = S().allMedia();
      if (game) all = all.filter(m => m.game === game);
      const limit = settings.short_session_seconds ?? 60;
      all = all.filter(m => !(M.kind(m) === 'session' && (m.duration || 0) < limit));
      let props = Suggest.clusterSessions(all, gap || settings.event_gap_minutes || 45, S().linkedMediaIds());
      if (only_sessions) props = props.filter(p => p.media.some(m => M.kind(m) !== 'clip'));
      return props.map(p => ({ title: p.title, start: p.start, end: p.end, game: p.game, media: p.media.map(m => media(m)) }));
    },
    'event.create_many': ({ items, parent_id = null }) => items.map(it => api['event.create']({ title: it.title, parent_id, start: it.start, end: it.end, media_ids: it.media_ids })),
    'events.at': ({ t }) => Suggest.eventsAt(S().events(), t).map(e => e.id),

    /* links / entries */
    'link.add': ({ event_id, media_ids, offset = null, note = '' }) => {
      const existing = new Set(S().links({ event_id }).map(l => `${l.media_id}|${l.offset}`));
      let n = 0;
      for (const mid of media_ids) if (!existing.has(`${mid}|${offset}`)) { S().addLink(event_id, mid, offset, note); n++; }
      return n;
    },
    'link.update': ({ id, ...f }) => { S().updateLink(id, f); return true; },
    'link.delete': ({ id }) => { S().deleteLink(id); return true; },
    'entry.create': ({ event_id, title = '', body_html = '', entry_time = null, ingame_date = '' }) => S().createEntry(event_id, title, body_html, entry_time, ingame_date),
    'entry.update': ({ id, ...f }) => { S().updateEntry(id, f); return true; },
    'entry.delete': async ({ id }) => { await deleteOwnerFiles('entry', id); S().deleteEntry(id); return true; },

    /* attachments */
    'att.pick': async ({ owner_type, owner_id, images_only = false }) => {
      const files = await pickFiles({ accept: images_only ? 'image/*' : '', multiple: true });
      const out = [];
      for (const f of files) out.push(await storeAttachment(owner_type, owner_id, f, f.name, { taken_at: f.lastModified / 1000 }));
      return out;
    },
    'att.add_data': async ({ owner_type, owner_id, name, data_b64, taken_at = null, caption = '', media_id = null, media_offset = null }) => {
      const extra = { taken_at: taken_at || Date.now() / 1000 };
      if (caption) extra.caption = caption;
      if (media_id) Object.assign(extra, { media_id, media_offset });
      return storeAttachment(owner_type, owner_id, dataUrlToBlob(data_b64), name || 'vlozeny.png', extra);
    },
    'att.snapshot': async ({ owner_type, owner_id }) => {
      const g = WebPlayer.grab() || notPlaying();
      return storeAttachment(owner_type, owner_id, dataUrlToBlob(g.data), `snap-${crypto.randomUUID().slice(0, 10)}.jpg`, {
        caption: `${M.title(g.media)} @ ${Suggest.fmtClock(g.pos)}`, taken_at: (g.media.start_time || Date.now() / 1000) + g.pos,
        media_id: g.media.id, media_offset: g.pos });
    },
    'snap.grab': () => {
      const g = WebPlayer.grab() || notPlaying();
      return { data: g.data, media_id: g.media.id, pos: g.pos, moment: (g.media.start_time || Date.now() / 1000) + g.pos,
        caption: `${M.title(g.media)} @ ${Suggest.fmtClock(g.pos)}` };
    },
    'att.update': ({ id, ...f }) => { S().updateAttachment(id, f); return true; },
    'att.delete': async ({ id }) => { const a = S().attachment(id); if (a) { await removeFile(a.path); S().deleteAttachment(id); } return true; },
    'att.open': ({ id }) => { const a = S().attachment(id); const u = a && url(a.path); if (u) window.open(u, '_blank'); return true; },
    'att.reveal': ({ id }) => api['att.open']({ id }),
    'att.play_source': ({ id }) => { const a = S().attachment(id); return a && a.media_id ? api['media.play']({ id: a.media_id, offset: a.media_offset }) : false; },
    gallery: () => {
      const events = new Map(S().events().map(e => [e.id, e])), entries = new Map(S().entries().map(e => [e.id, e]));
      const cs = new Map(S().characters().map(c => [c.id, c]));
      const out = [];
      for (let a of S().attachments()) {
        if (a.kind !== 'image') continue;
        a = att(a);
        if (a.owner_type === 'event' && events.has(a.owner_id)) { a.owner_title = events.get(a.owner_id).title; a.event_id = a.owner_id; }
        else if (a.owner_type === 'entry' && entries.has(a.owner_id)) { const ev = entries.get(a.owner_id).event_id; a.owner_title = (events.get(ev) || {}).title || ''; a.event_id = ev; }
        else if (a.owner_type === 'character' && cs.has(a.owner_id)) { a.owner_title = cs.get(a.owner_id).name; a.char_id = a.owner_id; }
        out.push(a);
      }
      return out;
    },

    /* factions */
    'factions.list': () => S().factions().map(f => { f = faction(f); delete f.body_html; return f; }),
    'faction.get': ({ id }) => {
      const f0 = S().faction(id);
      if (!f0) return null;
      const f = faction(f0);
      f.members = S().factionMembers({ fid: id });
      const evs = new Map(S().events().map(e => [e.id, e])), seen = new Map();
      for (const { character_id: cid } of f.members) {
        for (const l of S().characterLinks({ character_id: cid, target_type: 'event' })) {
          const e = evs.get(l.target_id);
          if (!e) continue;
          if (!seen.has(e.id)) seen.set(e.id, { id: e.id, title: e.title, color: e.color, start_time: e.start_time, chars: [] });
          const d = seen.get(e.id);
          if (!d.chars.includes(cid)) d.chars.push(cid);
        }
      }
      f.events = [...seen.values()].sort((a, b) => (b.start_time || 0) - (a.start_time || 0));
      f.attachments = S().attachments('faction', id).map(att);
      f.holdings = S().places().filter(p => p.owner_type === 'faction' && p.owner_id === id).map(place);
      return f;
    },
    'faction.create': ({ name, ...f }) => S().createFaction(name, f),
    'faction.update': ({ id, ...f }) => { S().updateFaction(id, f); return true; },
    'faction.delete': async ({ id }) => { await deleteOwnerFiles('faction', id); S().deleteFaction(id); return true; },
    'faction.emblem': async ({ id, att_id = null }) => {
      if (att_id == null) { const got = await api['att.pick']({ owner_type: 'faction', owner_id: id, images_only: true }); if (!got.length) return null; att_id = got[0].id; }
      S().updateFaction(id, { emblem_id: att_id });
      return url(S().attachment(att_id).path);
    },
    'faction.members_add': ({ id, character_ids, role = '' }) => { character_ids.forEach(c => S().addMember(id, c, role)); return true; },
    'faction.member_remove': ({ id, character_id }) => { S().removeMember(id, character_id); return true; },
    'chars.list': () => chars(),

    /* servers */
    'servers.list': () => S().servers(),
    'server.create': ({ game, name, ...f }) => S().createServer(game, name, f),
    'server.update': ({ id, ...f }) => { S().updateServer(id, f); return true; },
    'server.delete': ({ id }) => { S().deleteServer(id); return true; },
    'server.assign': ({ type, ids, server_id }) => {
      const table = { media: 'media', event: 'events', char: 'characters', faction: 'factions', place: 'places' }[type];
      ids.forEach(i => S().run(`UPDATE ${table} SET server_id=? WHERE id=?`, [server_id, i]));
      return true;
    },

    /* places */
    'places.list': () => S().places().map(place),
    'place.get': ({ id }) => {
      const p0 = S().place(id);
      if (!p0) return null;
      const p = place(p0);
      p.events = S().events().filter(e => e.place_id === id).map(e => ({ id: e.id, title: e.title, color: e.color, start_time: e.start_time }));
      p.children = S().places().filter(x => x.parent_id === id).map(place);
      p.attachments = S().attachments('place', id).map(att);
      p.letters = S().letters().filter(l => l.place_id === id).map(l => l.id);
      return p;
    },
    'place.create': ({ name, ...f }) => S().createPlace(name, f),
    'place.update': ({ id, ...f }) => { S().updatePlace(id, f); return true; },
    'place.delete': async ({ id }) => { await deleteOwnerFiles('place', id); S().deletePlace(id); return true; },
    'place.image': async ({ id, att_id = null }) => {
      if (att_id == null) { const got = await api['att.pick']({ owner_type: 'place', owner_id: id, images_only: true }); if (!got.length) return null; att_id = got[0].id; }
      S().updatePlace(id, { image_id: att_id });
      return url(S().attachment(att_id).path);
    },

    /* letters (Discord import is desktop-only: the Discord API does not allow browser pages) */
    'letters.list': () => S().letters().map(letter),
    'letter.create': ({ ...f }) => {
      if ('recipient_ids' in f) f.recipient_ids = JSON.stringify(f.recipient_ids);
      if (f.sent_at == null) f.sent_at = Date.now() / 1000;
      return S().createLetter(f);
    },
    'letter.update': ({ id, ...f }) => { if ('recipient_ids' in f) f.recipient_ids = JSON.stringify(f.recipient_ids); S().updateLetter(id, f); return true; },
    'letter.delete': ({ id }) => { S().deleteLetter(id); return true; },
    'letters.import_export': () => { throw new Error(DESKTOP_ONLY); },
    'letters.import_folder': () => { throw new Error(DESKTOP_ONLY); },
    'letters.import_channel': () => { throw new Error(DESKTOP_ONLY); },
    'discord.members': () => { throw new Error('Discord bot ' + DESKTOP_ONLY.toLowerCase()); },
    'discord.link_player': () => { throw new Error(DESKTOP_ONLY); },
    'discord.import_players': () => { throw new Error(DESKTOP_ONLY); },
    'discord.sync': () => { throw new Error(DESKTOP_ONLY); },

    /* players */
    'players.list': () => S().players().map(p => { p = playerRow(p); delete p.body_html; return p; }),
    'player.get': ({ id }) => {
      const p0 = S().player(id);
      if (!p0) return null;
      const p = playerRow(p0);
      p.characters = S().characters().filter(c => c.player_id === id).map(c => c.id);
      p.attachments = S().attachments('player', id).map(att);
      return p;
    },
    'player.create': ({ name, ...f }) => S().createPlayer(name, f),
    'player.update': ({ id, ...f }) => { S().updatePlayer(id, f); return true; },
    'player.delete': async ({ id }) => { await deleteOwnerFiles('player', id); S().deletePlayer(id); return true; },
    'player.avatar': async ({ id, att_id = null }) => {
      if (att_id == null) { const got = await api['att.pick']({ owner_type: 'player', owner_id: id, images_only: true }); if (!got.length) return null; att_id = got[0].id; }
      S().updatePlayer(id, { avatar_id: att_id });
      return url(S().attachment(att_id).path);
    },

    /* characters */
    'char.get': ({ id }) => {
      const c0 = S().character(id);
      if (!c0) return null;
      const c = char(c0);
      const events = new Map(S().events().map(e => [e.id, e])), linked = S().linkedMediaIds();
      const evOut = new Map(), mOut = new Map(), enOut = new Map();
      const evRow = eid => { if (!evOut.has(eid)) evOut.set(eid, { ...events.get(eid), roles: [], via: [] }); return evOut.get(eid); };
      for (const l of S().characterLinks({ character_id: id })) {
        if (l.target_type === 'event' && events.has(l.target_id)) { const e = evRow(l.target_id); if (l.role) e.roles.push(l.role); e.via.push(l.source); }
        else if (l.target_type === 'media') { const m = S().media(l.target_id); if (m) mOut.set(m.id, media(m, linked)); }
        else if (l.target_type === 'entry') {
          const en = S().entry(l.target_id);
          if (en) {
            en.event_title = (events.get(en.event_id) || {}).title || '';
            en.excerpt = excerpt(en.body_html, 220); delete en.body_html;
            enOut.set(en.id, en);
            if (events.has(en.event_id)) evRow(en.event_id).via.push('entry');
          }
        }
      }
      evOut.forEach(e => delete e.body_html);
      c.events = [...evOut.values()].sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
      c.media = [...mOut.values()].sort((a, b) => (a.start || 0) - (b.start || 0));
      c.entries = [...enOut.values()].sort((a, b) => (a.entry_time || 0) - (b.entry_time || 0));
      c.attachments = S().attachments('character', id).map(att);
      c.relations = S().relations(id);
      c.places = S().places().filter(p => p.owner_type === 'character' && p.owner_id === id).map(place);
      const bmIds = S().characterLinks({ character_id: id, target_type: 'bookmark' }).map(l => l.target_id);
      c.bookmarks = bmIds.length ? bms(S().bookmarks({ ids: bmIds })) : [];
      return c;
    },
    'char.create': ({ name, ...f }) => S().createCharacter(name, f),
    'char.update': ({ id, ...f }) => { S().updateCharacter(id, f); return true; },
    'char.delete': async ({ id }) => { await deleteOwnerFiles('character', id); S().deleteCharacter(id); return true; },
    'char.portrait': async ({ id, att_id = null }) => {
      if (att_id == null) { const got = await api['att.pick']({ owner_type: 'character', owner_id: id, images_only: true }); if (!got.length) return null; att_id = got[0].id; }
      S().updateCharacter(id, { portrait_id: att_id });
      return url(S().attachment(att_id).path);
    },
    'char.link': ({ character_id, target_type, target_id, role = '' }) => { S().linkCharacter(character_id, target_type, target_id, role); return true; },
    'char.unlink': ({ character_id, target_type, target_id }) => { S().unlinkCharacter(character_id, target_type, target_id); return true; },
    'rel.add': ({ a_id, b_id, label = '', kind = '', note = '' }) => S().addRelation(a_id, b_id, label, kind, note),
    'rel.update': ({ id, ...f }) => { S().updateRelation(id, f); return true; },
    'rel.delete': ({ id }) => { S().deleteRelation(id); return true; },

    /* timeline / misc */
    'timeline.data': () => ({
      events: api['events.list'](),
      entries: S().entries().map(en => ({ id: en.id, event_id: en.event_id, title: en.title, time: en.entry_time, ingame_date: en.ingame_date, excerpt: excerpt(en.body_html, 160) })),
      links: S().links().map(l => ({ event_id: l.event_id, media_id: l.media_id, offset: l.offset, note: l.note })),
      bookmarks: S().bookmarks().filter(b => b.source !== 'auto' || b.event_id).map(b => ({ ...bmMark(b), media_id: b.media_id })),
      event_chars: S().characterLinks({ target_type: 'event' }).map(l => ({ event_id: l.target_id, char_id: l.character_id, role: l.role })),
    }),
    'settings.get': () => ({ ...settings, roots: Folders.names() }),
    'settings.set': async ({ values }) => {
      if (values.roots) await Folders.setNames(values.roots);
      for (const k of ['clip_max_seconds', 'short_session_seconds', 'hide_short_sessions', 'event_gap_minutes', 'remember_last_mix', 'default_mix', 'game_aliases']) {
        if (k in values) settings[k] = values[k];
      }
      await saveSettings();
      if (values._rescan !== false) rescan();
      return true;
    },
    pick_folder: async () => { const name = await Folders.add(); if (name) rescan(); return name; },
    rescan: () => { rescan(); return true; },
    open_data_dir: () => { dataDialog(); return true; },
  };

  /* ---------------- library scan ---------------- */
  let scanning = null;
  function status(text) {
    let el = document.getElementById('web-status');
    if (!el) { el = h('.hidden#web-status'); document.body.appendChild(el); }
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }
  function rescan() {
    if (scanning) return scanning;
    scanning = (async () => {
      if (!Folders.roots.length) { welcome(); return; }
      if ((await Folders.locked()).length === Folders.roots.length) { banner(); return; }
      const res = await Scanner.scan(store, settings, SQL, status);
      await saveNow();
      emit('media-changed', res);
      if (res.thumbJobs.length) {
        const r = await Scanner.makeThumbs(store, res.thumbJobs, {
          onProgress: (d, n) => status(`Náhledy ${d}/${n}`),
          onBatch: async () => { await saveNow(); emit('media-changed', {}); },
        });
        if (r.failedCodec) toast(`${r.failedCodec} videí má kodek, který tento prohlížeč neumí (nejspíš HEVC) – náhled je z Medalu nebo chybí.`, 'err');
      }
      status(null);
    })().catch(e => { console.error(e); status(null); toast('Načtení knihovny selhalo: ' + (e.message || e), 'err'); })
      .finally(() => { scanning = null; });
    return scanning;
  }

  /* ---------------- banners and dialogs ---------------- */
  async function banner() {
    const locked = await Folders.locked();
    let el = document.getElementById('web-banner');
    if (!locked.length) { if (el) el.remove(); return; }
    if (!el) { el = h('#web-banner'); document.body.appendChild(el); }
    clear(el).append(icon('folder-lock'),
      h('span', `Prohlížeč potřebuje znovu povolit přístup ke složce ${locked.map(r => '„' + r.name + '“').join(', ')} (videa se nikam nenahrávají).`),
      h('button.btn.sm.primary', { onclick: async () => { if (await Folders.unlockAll()) { el.remove(); rescan(); } } }, icon('folder-open'), 'Připojit složky'));
  }
  function welcome() {
    if (document.getElementById('web-welcome')) return;
    const box = h('.backdrop#web-welcome', h('.modal',
      h('header', icon('folder-open'), h('h2', 'Kronikář v prohlížeči')),
      h('.body',
        h('p.muted', 'Vyber složku Medalu (obsahuje Clips/, Databases/, Thumbnails/…). Videa zůstanou na disku – prohlížeč je jen čte. Katalog, události a postavy se ukládají jen v tomto prohlížeči; zálohu stáhneš v Nastavení → Data.'),
        Folders.supported() ? null : h('p', { style: { color: 'var(--danger, #ef6b73)' } }, 'Tenhle prohlížeč neumí otevřít složku. Použij Chrome nebo Edge.')),
      h('footer',
        h('button.btn', { onclick: () => { box.remove(); dataDialog(); } }, icon('upload'), 'Obnovit zálohu…'),
        h('button.btn', { onclick: () => box.remove() }, 'Později'),
        h('button.btn.primary', { onclick: async () => { const n = await Folders.add(); if (n) { box.remove(); rescan(); } } }, icon('folder-plus'), 'Vybrat složku Medalu'))));
    document.getElementById('overlays').appendChild(box);
  }

  /* backup: everything except videos and auto thumbnails (those come back with a rescan) */
  async function buildBackup() {
    await saveNow();
    const files = {};
    for (const [k, blob] of await IDB.entries('files')) if (!k.startsWith('thumb/')) files[k] = await blobToDataUrl(blob);
    return { app: 'kronikar-web', format: 1, exported_at: new Date().toISOString(), folders: Folders.names(),
      settings: { ...settings }, tables: store.dumpTables(), files };
  }
  async function exportJson() {
    const blob = new Blob([JSON.stringify(await buildBackup())], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `kronikar-zaloha-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  /** Replace the catalog with a backup. Folder access stays as it is (handles cannot be exported). */
  async function restoreBackup(data) {
    if (!data || data.app !== 'kronikar-web' || !data.tables) throw new Error('Tohle není záloha Kronikáře.');
    store.loadTables(data.tables);
    await Files.clear();
    for (const [k, d] of Object.entries(data.files || {})) await Files.put(k, dataUrlToBlob(d));
    settings = { ...DEFAULTS, ...(data.settings || {}) };
    await saveSettings();
    await saveNow();
  }
  async function importJson() {
    const [f] = await pickFiles({ accept: '.json,application/json' });
    if (!f) return;
    const data = JSON.parse(await f.text());
    if (data.app !== 'kronikar-web' || !data.tables) throw new Error('Tohle není záloha Kronikáře.');
    const n = (data.tables.media || []).length, ev = (data.tables.events || []).length, ch = (data.tables.characters || []).length;
    if (!(await confirmDialog('Obnovit zálohu?', `Záloha z ${data.exported_at || '?'}: ${n} videí, ${ev} událostí, ${ch} postav.\nSoučasná data v tomto prohlížeči se nahradí.`, { danger: true, okLabel: 'Nahradit' }))) return;
    await restoreBackup(data);
    location.reload();
  }
  /* desktop → web: open the desktop data/ folder, take catalog.db + attachments + custom thumbnails */
  async function importDesktop(dir = null, ask = true) {
    if (!dir) try { dir = await showDirectoryPicker({ id: 'kronikar-data', mode: 'read' }); } catch (e) { return; }
    let dbH = null, walH = null;
    for await (const [n, hd] of dir.entries()) { if (n === 'catalog.db') dbH = hd; if (n === 'catalog.db-wal') walH = hd; }
    if (!dbH) throw new Error('Ve složce není catalog.db – vyber složku data/ vedle desktopového Kronikáře.');
    const bytes = Medal.applyWal(new Uint8Array(await (await dbH.getFile()).arrayBuffer()), walH ? new Uint8Array(await (await walH.getFile()).arrayBuffer()) : null);
    if (ask && !(await confirmDialog('Převzít data z desktopu?', 'Katalog v prohlížeči se nahradí desktopovým (události, postavy, záložky, přílohy). Videa se pak spárují podle cesty při načtení složky Medalu.', { danger: true, okLabel: 'Převzít' }))) return;
    const next = new Store(SQL, bytes);
    // copy files that live inside data/ (attachments/…, thumbs/custom/…)
    const fileAt = async rel => { let d = dir; const parts = rel.split('/'); for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p); return (await d.getFileHandle(parts.at(-1))).getFile(); };
    const rel = p => { const k = String(p || '').replace(/\\/g, '/'); const i = k.toLowerCase().lastIndexOf('/data/'); return i >= 0 ? k.slice(i + 6) : null; };
    let ok = 0, miss = 0;
    status('Kopíruji přílohy z desktopu…');
    await Files.clear();
    for (const a of next.all('SELECT id, path FROM attachments')) {
      const r = rel(a.path);
      try { const f = await fileAt(r); next.run('UPDATE attachments SET path=? WHERE id=?', [await Files.put('att/' + r.replace(/^attachments\//, ''), f), a.id]); ok++; } catch (e) { miss++; }
    }
    for (const m of next.all('SELECT id, custom_thumb FROM media WHERE custom_thumb IS NOT NULL')) {
      try { const f = await fileAt(rel(m.custom_thumb)); next.run('UPDATE media SET custom_thumb=? WHERE id=?', [await Files.put(`cthumb/${m.id}.jpg`, f), m.id]); } catch (e) { next.run('UPDATE media SET custom_thumb=NULL WHERE id=?', [m.id]); }
    }
    next.run("UPDATE media SET thumb=NULL WHERE thumb NOT LIKE 'idb:%'");
    store = next; store.dirty = true;
    await saveNow();
    status(null);
    toast(`Převzato. Přílohy: ${ok}${miss ? `, chybí ${miss}` : ''}.`);
    if (ask) setTimeout(() => location.reload(), 900);
    return { ok, miss };
  }
  function dataDialog() {
    const run = fn => async () => { try { await fn(); } catch (e) { toast(String(e.message || e), 'err'); } };
    modal({ title: 'Data v prohlížeči', icon: 'database', body: h('div',
      h('p.muted.small', 'Katalog, události, postavy, deníky a přílohy jsou uložené jen v tomto prohlížeči (IndexedDB). Videa zůstávají ve složce Medalu. Zálohu si stáhni do JSON – přeneseš ji i na jiný počítač.'),
      h('.col', { style: { gap: '8px', marginTop: '12px' } },
        h('button.btn', { onclick: run(exportJson) }, icon('download'), 'Stáhnout zálohu (JSON)'),
        h('button.btn', { onclick: run(importJson) }, icon('upload'), 'Obnovit ze zálohy (JSON)…'),
        h('button.btn', { onclick: run(importDesktop) }, icon('monitor-down'), 'Převzít data z desktopové verze (složka data/)…'),
        h('button.btn.danger', { onclick: run(async () => {
          if (!(await confirmDialog('Smazat vše?', 'Smaže katalog, přílohy i připojené složky z tohoto prohlížeče. Videa na disku zůstanou.', { danger: true, okLabel: 'Smazat' }))) return;
          await IDB.clear('kv'); await Files.clear(); location.reload();
        }) }, icon('trash-2'), 'Smazat data z prohlížeče')),
      h('p.faint.small', { style: { marginTop: '12px' } }, `Uloženo: ${(navigator.storage && navigator.storage.estimate) ? '…' : '?'}`)),
      actions: [{ label: 'Zavřít' }] });
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => {
      const el = $$('.modal p.faint.small').pop();
      if (el) el.textContent = `Využito ${fmt.size(e.usage)} z ${fmt.size(e.quota)} dostupných v prohlížeči.`;
    });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    document.documentElement.classList.add('web-mode');
    if (navigator.locks) {   // one tab at a time – two tabs would overwrite each other's catalog
      const got = await new Promise(res => navigator.locks.request('kronikar-db', { ifAvailable: true }, lock => {
        res(!!lock);
        return lock ? new Promise(() => {}) : null;
      }));
      if (!got) {
        document.body.innerHTML = '<div style="padding:40px;font:16px system-ui;color:#ddd;background:#1e1f22;height:100vh">Kronikář je už otevřený v jiné záložce. Zavři ji a tuhle obnov.</div>';
        throw new Error('already open');
      }
    }
    SQL = await initSqlJs({ locateFile: f => `vendor/${f}` });
    await Promise.all([Folders.load(), Files.load()]);
    settings = { ...DEFAULTS, ...((await IDB.get('kv', 'settings')) || {}) };
    store = new Store(SQL, await IDB.get('kv', 'catalog'));
    if (store.dirty) await saveNow();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    WebPlayer.init({
      emit,
      setResume: (id, pos) => { store.setResume(id, pos); scheduleSave(); },
      bookmark: (m, t, tEnd) => { const id = api['bm.create']({ media_id: m.id, t, t_end: tEnd }); scheduleSave(); emit('bookmark', { id, media_id: m.id, t, t_end: tEnd }); },
      thumbFromFrame: async m => {
        const g = WebPlayer.grab(480);
        if (!g) return;
        await setCustomThumb(m.id, dataUrlToBlob(g.data));
        await saveNow();
        emit('media-changed', {}); emit('toast', { msg: 'Náhled videa nastaven' });
      },
    });
    addEventListener('pagehide', () => { saveNow(); });
    setTimeout(async () => {
      if (!Folders.roots.length) { if (!store.scalar('SELECT COUNT(*) FROM media')) welcome(); return; }
      if ((await Folders.locked()).length) banner(); else rescan();
    }, 300);
  }
  const booted = boot();

  const bridge = {
    call(method, argsJson, cb) {
      (async () => {
        await booted;
        const fn = api[method];
        if (!fn) throw new Error(`unknown method ${method}`);
        const args = JSON.parse(argsJson || '{}');
        delete args._src;
        const out = await fn(args);
        if (!READ_ONLY.has(method)) scheduleSave();
        return out === undefined ? null : out;
      })().then(ok => cb(JSON.stringify({ ok })), e => { console.error(method, e); cb(JSON.stringify({ error: String(e && e.message || e) })); });
    },
    notify: { connect(fn) { listeners.push(fn); } },
  };

  return { bridge: () => booted.then(() => bridge), api, exportJson, buildBackup, restoreBackup, importDesktop, saveNow, get store() { return store; } };
})();
