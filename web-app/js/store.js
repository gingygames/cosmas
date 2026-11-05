/* ============================================================
   The catalog database in the browser: SQLite (sql.js) with exactly the schema of
   rpcatalog/store.py, kept in IndexedDB. JS port of the Store class – the SQL is the same,
   so a desktop catalog.db can be opened here too.
   ============================================================ */
'use strict';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, game TEXT,
    kind TEXT NOT NULL DEFAULT 'clip', kind_override TEXT, start_time REAL, duration REAL, size INTEGER,
    medal_id TEXT, medal_title TEXT, title TEXT, description TEXT DEFAULT '', thumb TEXT,
    tracks TEXT DEFAULT '[]', bookmarks TEXT DEFAULT '[]', sidecars TEXT DEFAULT '[]', parent_path TEXT,
    favorite INTEGER DEFAULT 0, missing INTEGER DEFAULT 0, added_at REAL, scanned_at REAL);
CREATE TABLE IF NOT EXISTS media_tags (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (media_id, tag));
CREATE TABLE IF NOT EXISTS albums (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at REAL);
CREATE TABLE IF NOT EXISTS album_items (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0, PRIMARY KEY (album_id, media_id));
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES events(id) ON DELETE CASCADE, title TEXT NOT NULL,
    description TEXT DEFAULT '', start_time REAL, end_time REAL, color TEXT DEFAULT '#c9a227',
    position INTEGER DEFAULT 0, created_at REAL);
CREATE TABLE IF NOT EXISTS event_tags (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (event_id, tag));
CREATE TABLE IF NOT EXISTS event_links (
    id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE, offset REAL, note TEXT DEFAULT '', created_at REAL);
CREATE INDEX IF NOT EXISTS idx_media_start ON media(start_time);
CREATE INDEX IF NOT EXISTS idx_links_event ON event_links(event_id);
CREATE INDEX IF NOT EXISTS idx_links_media ON event_links(media_id);
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT DEFAULT '', body_html TEXT DEFAULT '', entry_time REAL, ingame_date TEXT DEFAULT '',
    created_at REAL, updated_at REAL);
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL, path TEXT NOT NULL,
    orig_name TEXT, mime TEXT, kind TEXT DEFAULT 'file', caption TEXT DEFAULT '', taken_at REAL,
    media_id INTEGER, media_offset REAL, size INTEGER, created_at REAL);
CREATE INDEX IF NOT EXISTS idx_att_owner ON attachments(owner_type, owner_id);
CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, aliases TEXT DEFAULT '', kind TEXT DEFAULT 'npc',
    faction TEXT DEFAULT '', player TEXT DEFAULT '', status TEXT DEFAULT 'alive', color TEXT DEFAULT '#e3b341',
    portrait_id INTEGER, summary TEXT DEFAULT '', body_html TEXT DEFAULT '', created_at REAL, updated_at REAL);
CREATE TABLE IF NOT EXISTS character_links (
    id INTEGER PRIMARY KEY, character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL, target_id INTEGER NOT NULL, role TEXT DEFAULT '', source TEXT DEFAULT 'manual',
    UNIQUE (character_id, target_type, target_id, source));
CREATE INDEX IF NOT EXISTS idx_cl_target ON character_links(target_type, target_id);
CREATE TABLE IF NOT EXISTS character_relations (
    id INTEGER PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    b_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE, label TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    t REAL NOT NULL, t_end REAL, title TEXT DEFAULT '', note TEXT DEFAULT '', color TEXT DEFAULT '',
    source TEXT DEFAULT 'manual', medal_key TEXT, event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    hidden INTEGER DEFAULT 0, created_at REAL, updated_at REAL);
CREATE INDEX IF NOT EXISTS idx_bm_media ON bookmarks(media_id);
CREATE INDEX IF NOT EXISTS idx_bm_event ON bookmarks(event_id);
CREATE TABLE IF NOT EXISTS factions (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT DEFAULT 'frakce', color TEXT DEFAULT '#9aa3b2',
    emblem_id INTEGER, summary TEXT DEFAULT '', body_html TEXT DEFAULT '',
    parent_id INTEGER REFERENCES factions(id) ON DELETE SET NULL, created_at REAL, updated_at REAL);
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT DEFAULT '', color TEXT DEFAULT '#5aa9e6',
    avatar_id INTEGER, summary TEXT DEFAULT '', body_html TEXT DEFAULT '', created_at REAL, updated_at REAL);
CREATE TABLE IF NOT EXISTS faction_members (
    faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    role TEXT DEFAULT '', position INTEGER DEFAULT 0, PRIMARY KEY (faction_id, character_id));
CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT DEFAULT 'jine', color TEXT DEFAULT '#9aa3b2',
    image_id INTEGER, summary TEXT DEFAULT '', body_html TEXT DEFAULT '',
    parent_id INTEGER REFERENCES places(id) ON DELETE SET NULL, owner_type TEXT DEFAULT '', owner_id INTEGER,
    ingame_location TEXT DEFAULT '', created_at REAL, updated_at REAL);
CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL, color TEXT DEFAULT '#5aa9e6',
    active_from REAL, active_to REAL, notes TEXT DEFAULT '', position INTEGER DEFAULT 0, created_at REAL, updated_at REAL);
CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY, sent_at REAL, ingame_date TEXT DEFAULT '', title TEXT DEFAULT '', body TEXT DEFAULT '',
    sender_id INTEGER REFERENCES characters(id) ON DELETE SET NULL, recipient_ids TEXT DEFAULT '[]',
    author TEXT DEFAULT '', author_discord_id TEXT DEFAULT '', channel TEXT DEFAULT '', source TEXT DEFAULT 'manual',
    source_ref TEXT UNIQUE, event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    place_id INTEGER REFERENCES places(id) ON DELETE SET NULL, created_at REAL, updated_at REAL);
`;

/* columns added later on the desktop (ALTER TABLE migrations in store.py) */
const ADDED_COLUMNS = {
  events: { body_html: "TEXT DEFAULT ''", location: "TEXT DEFAULT ''", ingame_date: "TEXT DEFAULT ''", cover_id: 'INTEGER',
    status: "TEXT DEFAULT ''", place_id: 'INTEGER', server_id: 'INTEGER' },
  characters: { gender: "TEXT DEFAULT ''", player_id: 'INTEGER', status_date: 'REAL', status_ingame: "TEXT DEFAULT ''",
    status_event_id: 'INTEGER', status_note: "TEXT DEFAULT ''", own_style: 'INTEGER DEFAULT 0', server_id: 'INTEGER' },
  character_relations: { kind: "TEXT DEFAULT ''", note: "TEXT DEFAULT ''" },
  players: { tags: "TEXT DEFAULT ''", discord_id: "TEXT DEFAULT ''", discord_name: "TEXT DEFAULT ''" },
  media: { server_id: 'INTEGER', custom_thumb: 'TEXT', resume_pos: 'REAL', watched_at: 'REAL' },
  factions: { server_id: 'INTEGER' },
  places: { server_id: 'INTEGER' },
};
const TABLES = ['media', 'media_tags', 'albums', 'album_items', 'events', 'event_tags', 'event_links', 'entries',
  'attachments', 'characters', 'character_links', 'character_relations', 'bookmarks', 'factions', 'players',
  'faction_members', 'places', 'servers', 'letters'];

const MEDIA_COLS = 'path game kind kind_override start_time duration size medal_id medal_title thumb tracks bookmarks sidecars parent_path'.split(' ');
const MENTION_RE = /data-char-id="(\d+)"/g;
const now = () => Date.now() / 1000;
const pick = (fields, allowed) => Object.fromEntries(Object.entries(fields).filter(([k, v]) => allowed.has(k) && v !== undefined));
const normalizeTag = t => String(t).trim().replace(/^#+/, '').trim().toLowerCase().replace(/ /g, '_');
const pad2 = n => String(n).padStart(2, '0');

/* ---- Media helpers (the Media class of store.py) ---- */
const M = {
  kind: m => m.kind_override || m.kind,
  end: m => m.start_time == null ? null : m.start_time + (m.duration || 0),
  defaultTitle(m) {
    let stamp = '';
    if (m.start_time) {
      const d = new Date(m.start_time * 1000);
      stamp = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    const label = { session: 'Záznam', manual: 'Nahrávka' }[M.kind(m)] || 'Klip';
    return `${label} ${stamp}`.trim();
  },
  title: m => m.title || m.medal_title || M.defaultTitle(m),
  json(v) { try { return JSON.parse(v || '[]'); } catch (e) { return []; } },
  tracks: m => M.json(m.tracks),
  sidecars: m => M.json(m.sidecars),
};

class Store {
  constructor(SQL, bytes) {
    this.SQL = SQL;
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.dirty = false;
    this._migrate();
  }

  /* ---------- low level ---------- */
  static clean(args) { return (args || []).map(v => v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : v)); }
  all(sql, args = []) {
    const st = this.db.prepare(sql);
    try {
      st.bind(Store.clean(args));
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  }
  one(sql, args = []) { return this.all(sql, args)[0] || null; }
  scalar(sql, args = []) { const r = this.one(sql, args); return r ? Object.values(r)[0] : null; }
  run(sql, args = []) {
    this.db.run(sql, Store.clean(args));
    this.dirty = true;
    return this.scalar('SELECT last_insert_rowid() AS id');
  }
  cols(table) { return new Set(this.all(`PRAGMA table_info(${table})`).map(r => r.name)); }
  /** Bytes for IndexedDB / download. sql.js reopens the file, so pragmas are set again. */
  export() {
    const bytes = this.db.export();
    this.db.run('PRAGMA foreign_keys=ON');
    this.dirty = false;
    return bytes;
  }

  _migrate() {
    this.db.run('PRAGMA foreign_keys=ON');
    const hadFactions = !!this.one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='factions'");
    const hadMedia = !!this.one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media'");
    this.db.exec(SCHEMA);
    for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
      const have = this.cols(table);
      for (const [c, decl] of Object.entries(cols)) if (!have.has(c)) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${c} ${decl}`);
    }
    if (hadMedia && !hadFactions) {   // very old desktop catalog: free-text faction -> real factions
      for (const { name } of this.all("SELECT DISTINCT TRIM(faction) AS name FROM characters WHERE TRIM(COALESCE(faction,'')) <> ''")) {
        const fid = this.run('INSERT INTO factions (name, created_at, updated_at) VALUES (?,?,?)', [name, now(), now()]);
        this.run('INSERT OR IGNORE INTO faction_members (faction_id, character_id) SELECT ?, id FROM characters WHERE TRIM(faction)=?', [fid, name]);
      }
    }
  }

  /* ---------- media ---------- */
  upsertMedia(rec) {
    const t = now();
    const row = this.one('SELECT id FROM media WHERE path=?', [rec.path]);
    const vals = MEDIA_COLS.map(c => rec[c] ?? null);
    let id;
    if (row) {
      this.run(`UPDATE media SET ${MEDIA_COLS.map(c => c + '=?').join(', ')}, missing=0, scanned_at=? WHERE id=?`, [...vals, t, row.id]);
      id = row.id;
    } else {
      id = this.run(`INSERT INTO media (${MEDIA_COLS.join(', ')}, added_at, scanned_at) VALUES (${MEDIA_COLS.map(() => '?').join(', ')}, ?, ?)`, [...vals, t, t]);
    }
    this.syncMedalBookmarks(id, M.json(rec.bookmarks));
    return id;
  }
  markMissingExcept(seen, rootPrefixes) {
    const gone = this.all('SELECT id, path FROM media WHERE missing=0')
      .filter(r => !seen.has(r.path) && rootPrefixes.some(p => r.path.toLowerCase().startsWith(p.toLowerCase())))
      .map(r => r.id);
    gone.forEach(id => this.run('UPDATE media SET missing=1 WHERE id=?', [id]));
    return gone.length;
  }
  _mediaRows(sql, args = []) {
    const rows = this.all(sql, args);
    const tags = new Map();
    for (const r of this.all('SELECT media_id, tag FROM media_tags ORDER BY tag')) {
      if (!tags.has(r.media_id)) tags.set(r.media_id, []);
      tags.get(r.media_id).push(r.tag);
    }
    rows.forEach(r => { r.tags = tags.get(r.id) || []; });
    return rows;
  }
  allMedia(includeMissing = false) {
    return this._mediaRows(`SELECT * FROM media ${includeMissing ? '' : 'WHERE missing=0'} ORDER BY start_time DESC`);
  }
  media(id) { return this._mediaRows('SELECT * FROM media WHERE id=?', [id])[0] || null; }
  updateMedia(id, fields) {
    const f = pick(fields, new Set(['title', 'description', 'favorite', 'kind_override', 'game', 'custom_thumb', 'server_id', 'path', 'thumb', 'duration']));
    if (!Object.keys(f).length) return;
    this.run(`UPDATE media SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
  }
  setResume(id, pos) { this.run('UPDATE media SET resume_pos=?, watched_at=? WHERE id=?', [pos, now(), id]); }
  setMediaTags(id, tags) {
    this.run('DELETE FROM media_tags WHERE media_id=?', [id]);
    tags.map(normalizeTag).filter(Boolean).forEach(t => this.run('INSERT OR IGNORE INTO media_tags VALUES (?,?)', [id, t]));
  }
  addMediaTags(ids, tags) {
    for (const m of ids) tags.map(normalizeTag).filter(Boolean).forEach(t => this.run('INSERT OR IGNORE INTO media_tags VALUES (?,?)', [m, t]));
  }
  deleteMediaRow(id) {
    this.run('DELETE FROM media WHERE id=?', [id]);
    this.run("DELETE FROM character_links WHERE target_type='bookmark' AND target_id NOT IN (SELECT id FROM bookmarks)");
  }
  allTags() {
    return this.all('SELECT tag, COUNT(*) n FROM media_tags t JOIN media m ON m.id=t.media_id WHERE m.missing=0 GROUP BY tag ORDER BY tag').map(r => [r.tag, r.n]);
  }
  games() { return this.all('SELECT game, COUNT(*) n FROM media WHERE missing=0 GROUP BY game ORDER BY game').map(r => [r.game, r.n]); }

  /* ---------- albums ---------- */
  albums() { return this.all('SELECT a.id, a.name, COUNT(i.media_id) n FROM albums a LEFT JOIN album_items i ON i.album_id=a.id GROUP BY a.id ORDER BY a.name'); }
  createAlbum(name) { return this.run('INSERT INTO albums (name, created_at) VALUES (?,?)', [name, now()]); }
  renameAlbum(id, name) { this.run('UPDATE albums SET name=? WHERE id=?', [name, id]); }
  deleteAlbum(id) { this.run('DELETE FROM albums WHERE id=?', [id]); }
  albumMediaIds(id) { return this.all('SELECT media_id FROM album_items WHERE album_id=? ORDER BY position', [id]).map(r => r.media_id); }
  mediaAlbumIds(mid) { return this.all('SELECT album_id FROM album_items WHERE media_id=?', [mid]).map(r => r.album_id); }
  addToAlbum(aid, ids) {
    const pos = this.scalar('SELECT COALESCE(MAX(position),0) FROM album_items WHERE album_id=?', [aid]);
    ids.forEach((m, i) => this.run('INSERT OR IGNORE INTO album_items VALUES (?,?,?)', [aid, m, pos + i + 1]));
  }
  removeFromAlbum(aid, ids) { ids.forEach(m => this.run('DELETE FROM album_items WHERE album_id=? AND media_id=?', [aid, m])); }

  /* ---------- events ---------- */
  events() {
    const rows = this.all('SELECT * FROM events ORDER BY position, start_time, id');
    const tags = new Map();
    for (const r of this.all('SELECT event_id, tag FROM event_tags ORDER BY tag')) {
      if (!tags.has(r.event_id)) tags.set(r.event_id, []);
      tags.get(r.event_id).push(r.tag);
    }
    const counts = new Map(this.all('SELECT event_id, COUNT(*) n FROM event_links GROUP BY event_id').map(r => [r.event_id, r.n]));
    rows.forEach(e => { e.tags = tags.get(e.id) || []; e.link_count = counts.get(e.id) || 0; });
    return rows;
  }
  event(id) { return this.events().find(e => e.id === id) || null; }
  createEvent(title, parentId = null, start = null, end = null) {
    const pos = this.scalar('SELECT COALESCE(MAX(position),0)+1 FROM events WHERE parent_id IS ?', [parentId]);
    return this.run('INSERT INTO events (parent_id, title, start_time, end_time, position, created_at) VALUES (?,?,?,?,?,?)',
      [parentId, title, start, end, pos, now()]);
  }
  updateEvent(id, fields) {
    if ('body_html' in fields) this.syncMentions('event', id, fields.body_html);
    const f = pick(fields, new Set(['title', 'description', 'start_time', 'end_time', 'color', 'parent_id', 'position',
      'body_html', 'location', 'ingame_date', 'cover_id', 'status', 'place_id', 'server_id']));
    if (!Object.keys(f).length) return;
    this.run(`UPDATE events SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
  }
  setEventTags(id, tags) {
    this.run('DELETE FROM event_tags WHERE event_id=?', [id]);
    tags.map(normalizeTag).filter(Boolean).forEach(t => this.run('INSERT OR IGNORE INTO event_tags VALUES (?,?)', [id, t]));
  }
  deleteEvent(id) { this.run('DELETE FROM events WHERE id=?', [id]); }
  eventDescendantIds(id) {
    const ids = [], frontier = [id];
    while (frontier.length) {
      const cur = frontier.pop(); ids.push(cur);
      frontier.push(...this.all('SELECT id FROM events WHERE parent_id=?', [cur]).map(r => r.id));
    }
    return ids;
  }
  links({ event_id = null, media_id = null } = {}) {
    let sql = 'SELECT l.*, e.title AS event_title FROM event_links l JOIN events e ON e.id=l.event_id WHERE 1=1';
    const args = [];
    if (event_id != null) { sql += ' AND l.event_id=?'; args.push(event_id); }
    if (media_id != null) { sql += ' AND l.media_id=?'; args.push(media_id); }
    return this.all(sql + ' ORDER BY l.created_at', args);
  }
  linkedMediaIds() { return new Set(this.all('SELECT DISTINCT media_id FROM event_links').map(r => r.media_id)); }
  addLink(eventId, mediaId, offset = null, note = '') {
    return this.run('INSERT INTO event_links (event_id, media_id, offset, note, created_at) VALUES (?,?,?,?,?)', [eventId, mediaId, offset, note, now()]);
  }
  updateLink(id, fields) {
    const f = pick(fields, new Set(['offset', 'note', 'event_id']));
    if (Object.keys(f).length) this.run(`UPDATE event_links SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
  }
  deleteLink(id) { this.run('DELETE FROM event_links WHERE id=?', [id]); }

  /* ---------- journal entries ---------- */
  entries(eventId = null) {
    if (eventId == null) return this.all('SELECT * FROM entries ORDER BY entry_time');
    return this.all('SELECT * FROM entries WHERE event_id=? ORDER BY COALESCE(entry_time, created_at), id', [eventId]);
  }
  entry(id) { return this.one('SELECT * FROM entries WHERE id=?', [id]); }
  createEntry(eventId, title = '', body = '', time = null, ingame = '') {
    const t = now();
    const id = this.run('INSERT INTO entries (event_id, title, body_html, entry_time, ingame_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [eventId, title, body, time || t, ingame, t, t]);
    this.syncMentions('entry', id, body);
    return id;
  }
  updateEntry(id, fields) {
    const f = pick(fields, new Set(['title', 'body_html', 'entry_time', 'ingame_date', 'event_id']));
    if (!Object.keys(f).length) return;
    f.updated_at = now();
    this.run(`UPDATE entries SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
    if ('body_html' in f) this.syncMentions('entry', id, f.body_html);
  }
  deleteEntry(id) {
    this.run('DELETE FROM entries WHERE id=?', [id]);
    this.run("DELETE FROM character_links WHERE target_type='entry' AND target_id=?", [id]);
  }

  /* ---------- attachments ---------- */
  attachments(ownerType = null, ownerId = null) {
    let sql = 'SELECT * FROM attachments WHERE 1=1'; const args = [];
    if (ownerType) { sql += ' AND owner_type=?'; args.push(ownerType); }
    if (ownerId != null) { sql += ' AND owner_id=?'; args.push(ownerId); }
    return this.all(sql + ' ORDER BY COALESCE(taken_at, created_at), id', args);
  }
  attachment(id) { return this.one('SELECT * FROM attachments WHERE id=?', [id]); }
  addAttachment(ownerType, ownerId, path, name, mime, kind, size, { caption = '', taken_at = null, media_id = null, media_offset = null } = {}) {
    return this.run('INSERT INTO attachments (owner_type, owner_id, path, orig_name, mime, kind, caption, taken_at, media_id, media_offset, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [ownerType, ownerId, path, name, mime, kind, caption, taken_at, media_id, media_offset, size, now()]);
  }
  updateAttachment(id, fields) {
    const f = pick(fields, new Set(['caption', 'taken_at', 'owner_type', 'owner_id']));
    if (Object.keys(f).length) this.run(`UPDATE attachments SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
  }
  deleteAttachment(id) { this.run('DELETE FROM attachments WHERE id=?', [id]); }

  /* ---------- characters ---------- */
  characters() {
    const rows = this.all('SELECT * FROM characters ORDER BY name COLLATE NOCASE');
    const counts = new Map();
    for (const r of this.all('SELECT character_id c, target_type t, COUNT(DISTINCT target_id) n FROM character_links GROUP BY character_id, target_type')) {
      if (!counts.has(r.c)) counts.set(r.c, {});
      counts.get(r.c)[r.t] = r.n;
    }
    rows.forEach(c => { c.counts = counts.get(c.id) || {}; });
    return rows;
  }
  character(id) { return this.one('SELECT * FROM characters WHERE id=?', [id]); }
  createCharacter(name, fields = {}) {
    const id = this.run('INSERT INTO characters (name, created_at, updated_at) VALUES (?,?,?)', [name, now(), now()]);
    if (Object.keys(fields).length) this.updateCharacter(id, fields);
    return id;
  }
  updateCharacter(id, fields) {
    const f = pick(fields, Store.CHAR_FIELDS);
    if (!Object.keys(f).length) return;
    f.updated_at = now();
    this.run(`UPDATE characters SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
    if ('body_html' in f) this.syncMentions('character', id, f.body_html);
  }
  deleteCharacter(id) {
    this.run("DELETE FROM character_links WHERE target_type='character' AND target_id=?", [id]);
    this.run('DELETE FROM characters WHERE id=?', [id]);
  }
  characterLinks({ character_id = null, target_type = null, target_id = null } = {}) {
    let sql = 'SELECT * FROM character_links WHERE 1=1'; const args = [];
    for (const [c, v] of [['character_id', character_id], ['target_type', target_type], ['target_id', target_id]]) {
      if (v != null) { sql += ` AND ${c}=?`; args.push(v); }
    }
    return this.all(sql + ' ORDER BY id', args);
  }
  linkCharacter(cid, type, tid, role = '') {
    this.run("INSERT INTO character_links (character_id, target_type, target_id, role, source) VALUES (?,?,?,?, 'manual') " +
      'ON CONFLICT(character_id, target_type, target_id, source) DO UPDATE SET role=excluded.role', [cid, type, tid, role || '']);
  }
  unlinkCharacter(cid, type, tid) {
    this.run("DELETE FROM character_links WHERE character_id=? AND target_type=? AND target_id=? AND source='manual'", [cid, type, tid]);
  }
  syncMentions(type, id, html) {
    const ids = new Set([...String(html || '').matchAll(MENTION_RE)].map(m => +m[1]));
    if (type === 'character') ids.delete(id);
    this.run("DELETE FROM character_links WHERE target_type=? AND target_id=? AND source='mention'", [type, id]);
    const valid = new Set(this.all('SELECT id FROM characters').map(r => r.id));
    for (const c of ids) if (valid.has(c)) {
      this.run("INSERT OR IGNORE INTO character_links (character_id, target_type, target_id, role, source) VALUES (?,?,?, '', 'mention')", [c, type, id]);
    }
  }
  relations(cid = null) {
    if (cid == null) return this.all('SELECT * FROM character_relations ORDER BY id');
    return this.all('SELECT * FROM character_relations WHERE a_id=? OR b_id=? ORDER BY id', [cid, cid]);
  }
  addRelation(a, b, label = '', kind = '', note = '') {
    return this.run('INSERT INTO character_relations (a_id, b_id, label, kind, note) VALUES (?,?,?,?,?)', [a, b, label, kind, note]);
  }
  updateRelation(id, fields) {
    const f = pick(fields, new Set(['a_id', 'b_id', 'label', 'kind', 'note']));
    if (Object.keys(f).length) this.run(`UPDATE character_relations SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
  }
  deleteRelation(id) { this.run('DELETE FROM character_relations WHERE id=?', [id]); }

  /* ---------- bookmarks ---------- */
  syncMedalBookmarks(mediaId, list) {
    const have = new Set(this.all('SELECT medal_key FROM bookmarks WHERE media_id=? AND medal_key IS NOT NULL', [mediaId]).map(r => r.medal_key));
    const t = now();
    for (const b of list) {
      const name = String(b.name || '').trim();
      const key = `${Number(b.time).toFixed(2)}|${name}`;
      if (have.has(key)) continue;
      have.add(key);
      this.run('INSERT INTO bookmarks (media_id, t, title, source, medal_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        [mediaId, Number(b.time), name, name ? 'auto' : 'medal', key, t, t]);
    }
  }
  bookmarks({ media_id = null, event_id = null, include_hidden = false, ids = null } = {}) {
    let sql = 'SELECT b.*, e.title AS event_title, e.color AS event_color FROM bookmarks b LEFT JOIN events e ON e.id=b.event_id WHERE 1=1';
    const args = [];
    if (!include_hidden) sql += ' AND b.hidden=0';
    if (media_id != null) { sql += ' AND b.media_id=?'; args.push(media_id); }
    if (event_id != null) { sql += ' AND b.event_id=?'; args.push(event_id); }
    if (ids != null) { sql += ` AND b.id IN (${ids.map(() => '?').join(',') || 'NULL'})`; args.push(...ids); }
    return this.all(sql + ' ORDER BY b.media_id, b.t', args);
  }
  bookmark(id) { return this.bookmarks({ ids: [id], include_hidden: true })[0] || null; }
  createBookmark(mediaId, t, tEnd = null, title = '', note = '', eventId = null, color = '') {
    const ts = now();
    return this.run("INSERT INTO bookmarks (media_id, t, t_end, title, note, color, event_id, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'manual', ?, ?)",
      [mediaId, t, tEnd, title, note, color, eventId, ts, ts]);
  }
  updateBookmark(id, fields) {
    const f = pick(fields, new Set(['t', 't_end', 'title', 'note', 'color', 'event_id', 'hidden']));
    if (!Object.keys(f).length) return;
    f.updated_at = now();
    this.run(`UPDATE bookmarks SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
  }
  deleteBookmark(id) {
    const b = this.bookmark(id);
    if (!b) return;
    this.run("DELETE FROM character_links WHERE target_type='bookmark' AND target_id=?", [id]);
    if (b.medal_key) this.run('UPDATE bookmarks SET hidden=1, event_id=NULL WHERE id=?', [id]);
    else this.run('DELETE FROM bookmarks WHERE id=?', [id]);
  }

  /* ---------- factions ---------- */
  factions() { return this.all('SELECT f.*, (SELECT COUNT(*) FROM faction_members m WHERE m.faction_id=f.id) AS n FROM factions f ORDER BY f.name COLLATE NOCASE'); }
  faction(id) { return this.one('SELECT * FROM factions WHERE id=?', [id]); }
  createFaction(name, fields = {}) {
    const id = this.run('INSERT INTO factions (name, created_at, updated_at) VALUES (?,?,?)', [name, now(), now()]);
    if (Object.keys(fields).length) this.updateFaction(id, fields);
    return id;
  }
  updateFaction(id, fields) {
    const f = pick(fields, new Set(['name', 'kind', 'color', 'emblem_id', 'summary', 'body_html', 'parent_id', 'server_id']));
    if (!Object.keys(f).length) return;
    f.updated_at = now();
    this.run(`UPDATE factions SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
    if ('body_html' in f) this.syncMentions('faction', id, f.body_html);
  }
  deleteFaction(id) {
    this.run("DELETE FROM character_links WHERE target_type='faction' AND target_id=?", [id]);
    this.run('DELETE FROM factions WHERE id=?', [id]);
  }
  factionMembers({ fid = null, char_id = null } = {}) {
    let sql = 'SELECT m.*, f.name AS faction_name, f.color AS faction_color, f.kind AS faction_kind FROM faction_members m JOIN factions f ON f.id=m.faction_id WHERE 1=1';
    const args = [];
    if (fid != null) { sql += ' AND m.faction_id=?'; args.push(fid); }
    if (char_id != null) { sql += ' AND m.character_id=?'; args.push(char_id); }
    return this.all(sql + ' ORDER BY m.position, m.rowid', args);
  }
  addMember(fid, cid, role = '') {
    this.run('INSERT INTO faction_members (faction_id, character_id, role) VALUES (?,?,?) ON CONFLICT(faction_id, character_id) DO UPDATE SET role=excluded.role', [fid, cid, role || '']);
  }
  removeMember(fid, cid) { this.run('DELETE FROM faction_members WHERE faction_id=? AND character_id=?', [fid, cid]); }

  /* ---------- players ---------- */
  players() { return this.all('SELECT p.*, (SELECT COUNT(*) FROM characters c WHERE c.player_id=p.id) AS n FROM players p ORDER BY p.name COLLATE NOCASE'); }
  player(id) { return this.one('SELECT * FROM players WHERE id=?', [id]); }
  createPlayer(name, fields = {}) {
    const id = this.run('INSERT INTO players (name, created_at, updated_at) VALUES (?,?,?)', [name, now(), now()]);
    if (Object.keys(fields).length) this.updatePlayer(id, fields);
    return id;
  }
  updatePlayer(id, fields) { this._update('players', id, fields, new Set(['name', 'contact', 'color', 'avatar_id', 'summary', 'body_html', 'tags', 'discord_id', 'discord_name'])); }
  deletePlayer(id) {
    this.run('UPDATE characters SET player_id=NULL WHERE player_id=?', [id]);
    this.run('DELETE FROM players WHERE id=?', [id]);
  }

  /* ---------- generic small tables ---------- */
  _insert(table, fields) {
    const f = { ...fields, created_at: now(), updated_at: now() };
    return this.run(`INSERT INTO ${table} (${Object.keys(f).join(', ')}) VALUES (${Object.keys(f).map(() => '?').join(', ')})`, Object.values(f));
  }
  _update(table, id, fields, allowed) {
    const f = pick(fields, allowed);
    if (!Object.keys(f).length) return;
    f.updated_at = now();
    this.run(`UPDATE ${table} SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`, [...Object.values(f), id]);
  }
  places() { return this.all('SELECT p.*, (SELECT COUNT(*) FROM events e WHERE e.place_id=p.id) AS n_events FROM places p ORDER BY p.name COLLATE NOCASE'); }
  place(id) { return this.one('SELECT * FROM places WHERE id=?', [id]); }
  createPlace(name, fields = {}) { return this._insert('places', { ...pick(fields, Store.PLACE_FIELDS), name }); }
  updatePlace(id, fields) {
    this._update('places', id, fields, Store.PLACE_FIELDS);
    if ('body_html' in fields) this.syncMentions('place', id, fields.body_html);
  }
  deletePlace(id) {
    this.run('UPDATE events SET place_id=NULL WHERE place_id=?', [id]);
    this.run('DELETE FROM places WHERE id=?', [id]);
  }
  letters() { return this.all('SELECT * FROM letters ORDER BY COALESCE(sent_at, created_at) DESC'); }
  createLetter(fields) {
    const f = pick(fields, Store.LETTER_FIELDS);
    if (f.source_ref && this.one('SELECT 1 FROM letters WHERE source_ref=?', [f.source_ref])) return null;
    return this._insert('letters', f);
  }
  updateLetter(id, fields) { this._update('letters', id, fields, Store.LETTER_FIELDS); }
  deleteLetter(id) { this.run('DELETE FROM letters WHERE id=?', [id]); }

  /* ---------- servers ---------- */
  servers() { return this.all('SELECT s.*, (SELECT COUNT(*) FROM media m WHERE m.server_id=s.id) AS n_media FROM servers s ORDER BY s.game, s.position, s.id'); }
  createServer(game, name, fields = {}) {
    const id = this._insert('servers', { ...pick(fields, Store.SERVER_FIELDS), game, name });
    this.autoAssignServers();
    return id;
  }
  updateServer(id, fields) { this._update('servers', id, fields, Store.SERVER_FIELDS); this.autoAssignServers(); }
  deleteServer(id) {
    for (const t of ['media', 'events', 'characters', 'factions', 'places']) this.run(`UPDATE ${t} SET server_id=NULL WHERE server_id=?`, [id]);
    this.run('DELETE FROM servers WHERE id=?', [id]);
  }
  autoAssignServers() {
    const byGame = new Map();
    for (const sv of this.servers()) { if (!byGame.has(sv.game)) byGame.set(sv.game, []); byGame.get(sv.game).push(sv); }
    let n = 0;
    for (const { id, game, start_time: start } of this.all('SELECT id, game, start_time FROM media WHERE server_id IS NULL')) {
      const cands = byGame.get(game) || [];
      let pickId = null;
      for (const sv of cands) {
        if ((sv.active_from || sv.active_to) && start && (!sv.active_from || start >= sv.active_from) && (!sv.active_to || start <= sv.active_to)) { pickId = sv.id; break; }
      }
      if (pickId == null) {
        const plain = cands.filter(sv => !sv.active_from && !sv.active_to);
        if (plain.length === 1) pickId = plain[0].id;
      }
      if (pickId) { this.run('UPDATE media SET server_id=? WHERE id=?', [pickId, id]); n++; }
    }
    return n;
  }

  /* ---------- whole-database JSON (backup / move between computers) ---------- */
  dumpTables() {
    const out = {};
    for (const t of TABLES) out[t] = this.all(`SELECT * FROM ${t}`);
    return out;
  }
  loadTables(tables) {
    this.db.run('PRAGMA foreign_keys=OFF');
    try {
      this.db.run('BEGIN');
      for (const t of TABLES) {
        this.db.run(`DELETE FROM ${t}`);
        const have = this.cols(t);
        for (const row of tables[t] || []) {
          const keys = Object.keys(row).filter(k => have.has(k));
          if (!keys.length) continue;
          this.db.run(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Store.clean(keys.map(k => row[k])));
        }
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    } finally {
      this.db.run('PRAGMA foreign_keys=ON');
    }
    this.dirty = true;
  }
}
Store.CHAR_FIELDS = new Set(['name', 'aliases', 'kind', 'faction', 'player', 'status', 'color', 'portrait_id', 'gender', 'player_id', 'status_date',
  'status_ingame', 'status_event_id', 'status_note', 'own_style', 'server_id', 'summary', 'body_html']);
Store.PLACE_FIELDS = new Set(['name', 'kind', 'color', 'image_id', 'summary', 'body_html', 'parent_id', 'owner_type', 'owner_id', 'ingame_location', 'server_id']);
Store.LETTER_FIELDS = new Set(['sent_at', 'ingame_date', 'title', 'body', 'sender_id', 'recipient_ids', 'author', 'author_discord_id', 'channel', 'source', 'source_ref', 'event_id', 'place_id']);
Store.SERVER_FIELDS = new Set(['game', 'name', 'color', 'active_from', 'active_to', 'notes', 'position']);
