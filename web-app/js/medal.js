/* ============================================================
   Medal's local database (Databases/medal-*.db), read-only.
   JS port of rpcatalog/medal_format.py + rpcatalog/medal_db.py.
   ============================================================ */
'use strict';

const Medal = (() => {
  /* ---------- binary metadata blobs (see medal_format.py) ---------- */
  const EXTRA = { 12: 1, 13: 2, 14: 4, 15: 8 };
  const utf8 = new TextDecoder('utf-8');

  function read(buf, pos) {
    if (pos >= buf.length) throw new Error('unexpected end of data');
    const head = buf[pos];
    const typ = head & 0x0f;
    let size = head >> 4;
    pos += 1;
    if (EXTRA[size]) {
      const n = EXTRA[size];
      size = 0;
      for (let i = 0; i < n; i++) size = size * 256 + buf[pos + i];
      pos += n;
    }
    const end = pos + size;
    if (end > buf.length) throw new Error('length past end of data');
    const body = () => utf8.decode(buf.subarray(pos, end));
    switch (typ) {
      case 0: return [null, end];
      case 1: return [true, end];
      case 2: return [false, end];
      case 3: return [parseInt(body(), 10), end];
      case 5: return [parseFloat(body()), end];
      case 7: return [body(), end];
      case 8: {   // string with JSON-style escapes (e.g. Windows paths)
        const text = body();
        try { return [JSON.parse('"' + text + '"'), end]; } catch (e) { return [text, end]; }
      }
      case 11: {
        const items = []; let p = pos;
        while (p < end) { const [v, q] = read(buf, p); items.push(v); p = q; }
        return [items, end];
      }
      case 12: {
        const obj = {}; let p = pos;
        while (p < end) {
          const [k, q] = read(buf, p); const [v, r] = read(buf, q);
          obj[String(k)] = v; p = r;
        }
        return [obj, end];
      }
    }
    throw new Error(`unknown type ${typ} at byte ${pos - 1}`);
  }
  function decode(blob) { return read(blob instanceof Uint8Array ? blob : new Uint8Array(blob), 0)[0]; }

  /* ---------- WAL ----------
     sql.js has no shared-memory WAL support, so committed frames of the -wal file are
     copied into the database image by hand and the header is switched to rollback mode. */
  function applyWal(db, wal) {
    let out = db;
    if (wal && wal.length >= 32) {
      const dv = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
      const magic = dv.getUint32(0);
      if (magic === 0x377f0682 || magic === 0x377f0683) {
        const pageSize = dv.getUint32(8) === 1 ? 65536 : dv.getUint32(8);
        const s1 = dv.getUint32(16), s2 = dv.getUint32(20);
        const pending = new Map(), done = new Map();
        let dbPages = 0;
        for (let off = 32; off + 24 + pageSize <= wal.length; off += 24 + pageSize) {
          if (dv.getUint32(off + 8) !== s1 || dv.getUint32(off + 12) !== s2) break;
          pending.set(dv.getUint32(off), off + 24);
          const commit = dv.getUint32(off + 4);
          if (commit) { for (const [p, o] of pending) done.set(p, o); pending.clear(); dbPages = commit; }
        }
        if (done.size) {
          out = new Uint8Array(dbPages * pageSize);
          out.set(db.subarray(0, Math.min(db.length, out.length)));
          for (const [p, o] of done) if ((p - 1) * pageSize < out.length) out.set(wal.subarray(o, o + pageSize), (p - 1) * pageSize);
        }
      }
    }
    if (out === db) out = db.slice();
    if (out.length > 19) { out[18] = 1; out[19] = 1; }   // WAL -> legacy journal, readable without -shm
    return out;
  }

  /* ---------- reading ---------- */
  const PLACEHOLDER_TITLE = /^(untitled|requested trimmed clip \d+)$/i;
  const KNOWN_ROLES = { 'all audio': 'all', microphone: 'mic', mic: 'mic', discord: 'discord', medalencoder: 'system' };

  function trackRole(title, proc) {
    const t = (title || '').trim().toLowerCase();
    if (KNOWN_ROLES[t]) return KNOWN_ROLES[t];
    if (proc && t === proc.toLowerCase()) return 'game';
    return t ? 'game' : 'other';
  }
  function isoToEpoch(s) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t / 1000 : null;
  }
  /** Normalised key of a Windows/POSIX path: lower case, forward slashes. */
  const pathKey = p => String(p || '').replace(/\\/g, '/').toLowerCase();

  function rowsOf(SQL, dbBytes, walBytes) {
    const db = new SQL.Database(applyWal(dbBytes, walBytes));
    try {
      const st = db.prepare('SELECT created_at, video_path, thumbnail_path, metadata, local_content_id, parent_id ' +
        'FROM contents WHERE video_path IS NOT NULL');
      const out = [];
      while (st.step()) out.push(st.get());
      st.free();
      return out;
    } finally { db.close(); }
  }

  /** dbs: [{db: Uint8Array, wal: Uint8Array|null}] -> Map(pathKey(video) -> info) */
  function readMedal(SQL, dbs) {
    let raw = [];
    for (const d of dbs) {
      try { raw = raw.concat(rowsOf(SQL, d.db, d.wal)); } catch (e) { console.warn('Medal DB nejde přečíst', e); }
    }
    const byLocal = new Map(), parsed = [];
    for (const [created, video, thumb, blob, localId, parentId] of raw) {
      let meta = {};
      try { meta = blob ? decode(blob) : {}; } catch (e) { meta = {}; }
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
      const item = { created, video, thumb, meta, localId, parentId };
      parsed.push(item); byLocal.set(localId, item);
    }
    const isTrim = meta => !!meta.wasTrimmed || (meta.trimStart != null);
    const rootOffset = (item, depth = 0) => {
      if (item.meta.trimStartTime != null) return Number(item.meta.trimStartTime);
      const own = Number(item.meta.trimStart || 0);
      const parent = byLocal.get(item.parentId);
      if (parent && depth < 10 && isTrim(parent.meta)) return rootOffset(parent, depth + 1) + own;
      return own;
    };
    const rootItem = (item, depth = 0) => {
      const parent = byLocal.get(item.parentId);
      if (parent && depth < 10) return isTrim(parent.meta) ? rootItem(parent, depth + 1) : parent;
      return null;
    };

    const out = new Map();
    for (const item of parsed) {
      const { meta } = item;
      const rec = meta.recorder || {};
      const vtype = rec.videoType;
      const trim = isTrim(meta) ? rootOffset(item) : null;
      const duration = meta.clipDuration || meta.trimDuration;
      let kind = null;
      if (trim != null) kind = 'clip';
      else if (vtype === 'FullSession') kind = 'session';
      else if (vtype === 'ManualRecording') kind = 'manual';
      else if (vtype === 'Clip') kind = 'clip';

      let start = null, parentPath = null;
      if (rec.clipStartTime) start = isoToEpoch(rec.clipStartTime);
      if (start == null && trim != null) {
        const root = rootItem(item);
        if (root) { start = Number(root.created) + trim; parentPath = root.video; }
      }
      if (start == null && trim == null) start = item.created ? Number(item.created) : null;

      const proc = rec.processName;
      const tracks = (meta.audioStreams || []).map(a => ({ name: (a && a.title) || '', role: trackRole(a && a.title, proc) }));
      const bookmarks = (meta.bookmarks || []).filter(b => b && typeof b === 'object' && b.time != null)
        .map(b => ({ time: Number(b.time), name: String(b.name || '') }));
      let title = typeof meta.title === 'string' ? meta.title.trim() || null : null;
      if (title && PLACEHOLDER_TITLE.test(title)) title = null;

      out.set(pathKey(item.video), {
        path: item.video, kind, start_time: start,
        trim_start: trim != null ? Number(trim) : null,
        duration: duration ? Number(duration) : null,
        medal_id: item.localId, medal_title: title,
        thumb: item.thumb || null, tracks, bookmarks, parent_path: parentPath,
        game_caption: (rec.captionName || '').trim() || null,
      });
    }
    return out;
  }

  return { decode, applyWal, readMedal, pathKey, trackRole };
})();
