/* ============================================================
   Local folders (File System Access API), blob storage and the library scan.
   JS port of rpcatalog/scanner.py. Videos never leave the computer: they are read
   straight from the picked folder, only small thumbnails are cached in IndexedDB.
   ============================================================ */
'use strict';

/* ---------- picked folders ----------
   media.path in the browser = "<folder name>/<path inside the folder>" */
const Folders = {
  roots: [],   // [{name, handle}]
  async load() { this.roots = (await IDB.get('kv', 'roots')) || []; },
  save() { return IDB.set('kv', 'roots', this.roots); },
  names() { return this.roots.map(r => r.name); },
  supported() { return 'showDirectoryPicker' in window; },
  async add() {
    if (!this.supported()) throw new Error('Tento prohlížeč neumí otevřít složku – použij Chrome nebo Edge.');
    let handle;
    try { handle = await showDirectoryPicker({ id: 'kronikar-medal', mode: 'read' }); } catch (e) { return null; }   // cancelled
    for (const r of this.roots) if (await r.handle.isSameEntry(handle)) return r.name;
    let name = handle.name, i = 2;
    while (this.roots.some(r => r.name === name)) name = `${handle.name} (${i++})`;
    this.roots.push({ name, handle });
    await this.save();
    return name;
  },
  async setNames(names) {   // settings → remove folders that were taken out of the list
    this.roots = this.roots.filter(r => names.includes(r.name));
    await this.save();
  },
  async granted(root, ask = false) {
    const opts = { mode: 'read' };
    try {
      if (await root.handle.queryPermission(opts) === 'granted') return true;
      return ask ? (await root.handle.requestPermission(opts)) === 'granted' : false;
    } catch (e) { return false; }
  },
  async locked() {
    const out = [];
    for (const r of this.roots) if (!(await this.granted(r))) out.push(r);
    return out;
  },
  /** Ask for access to every folder (must run from a click). */
  async unlockAll() {
    let ok = true;
    for (const r of this.roots) ok = (await this.granted(r, true)) && ok;
    return ok;
  },
  async fileHandle(path, ask = true) {
    if (/^[a-z]:[\\/]/i.test(path)) throw new Error('Video je z desktopového katalogu a jeho složka tu ještě není připojená – přidej ji v Nastavení → Složky se záznamy.');
    const [name, ...parts] = path.split('/');
    const root = this.roots.find(r => r.name === name);
    if (!root) throw new Error(`Složka „${name}“ není připojená – přidej ji v Nastavení.`);
    if (!(await this.granted(root, ask))) throw new Error(`Prohlížeč nemá přístup ke složce „${name}“ – klikni na „Připojit složky“.`);
    let dir = root.handle;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    return dir.getFileHandle(parts[parts.length - 1]);
  },
  async file(path, ask = true) { return (await this.fileHandle(path, ask)).getFile(); },
};

/* ---------- blobs in IndexedDB (thumbnails, attachments) ---------- */
const Files = {
  urls: new Map(),   // key -> object URL
  sizes: new Map(),  // key -> bytes
  async load() {
    for (const [k, blob] of await IDB.entries('files')) { this.urls.set(k, URL.createObjectURL(blob)); this.sizes.set(k, blob.size); }
  },
  key: k => String(k || '').replace(/^idb:/, ''),
  url(key) { return key ? this.urls.get(this.key(key)) || null : null; },
  size(key) { return key ? this.sizes.get(this.key(key)) || 0 : 0; },
  async put(key, blob) {
    await IDB.set('files', key, blob);
    const old = this.urls.get(key);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(key, URL.createObjectURL(blob));
    this.sizes.set(key, blob.size);
    return 'idb:' + key;
  },
  async get(key) { return IDB.get('files', String(key).replace(/^idb:/, '')); },
  async del(key) {
    if (!key) return;
    key = String(key).replace(/^idb:/, '');
    await IDB.del('files', key);
    const u = this.urls.get(key);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(key); this.sizes.delete(key);
  },
  async clear() { await IDB.clear('files'); this.urls.forEach(u => URL.revokeObjectURL(u)); this.urls.clear(); this.sizes.clear(); },
};

/* ---------- reading a video in the browser: duration + one frame ---------- */
function probeVideo(file, { frameAt = null, width = 480 } = {}) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = res => {
      if (done) return; done = true;
      clearTimeout(timer);
      v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url);
      resolve(res);
    };
    const timer = setTimeout(() => finish({ error: 'timeout' }), 20000);
    v.muted = true; v.preload = 'auto'; v.playsInline = true;
    v.onerror = () => finish({ error: (v.error && v.error.code === 4) ? 'codec' : 'read' });
    v.onloadedmetadata = () => {
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      if (frameAt == null) return finish({ duration });
      if (!v.videoWidth) return finish({ duration, error: 'codec' });   // audio decoded, video codec not supported
      v.onseeked = () => {
        try {
          const c = document.createElement('canvas');
          c.width = width; c.height = Math.round(width * v.videoHeight / v.videoWidth / 2) * 2;
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(blob => finish({ duration, blob }), 'image/jpeg', 0.8);
        } catch (e) { finish({ duration, error: 'draw' }); }
      };
      v.currentTime = Math.min(frameAt(duration), Math.max(0, (duration || 1) - 0.2));
    };
    v.src = url;
  });
}
const thumbTime = d => Math.min(180, Math.max(1, (d || 3) * 0.1));

/* ---------- scanning ---------- */
const Scanner = (() => {
  const VIDEO_EXT = /\.(mp4|mkv|mov|webm)$/i;
  const SKIP_DIRS = new Set(['temp', 'editor', 'video-editor', 'thumbnails', '.thumbnails', 'databases', 'screenshots']);
  const SIDECAR_RE = /^(.+)_(game|mic|microphone|discord|system|desktop)$/i;
  const SIDECAR_ROLE = { game: 'game', mic: 'mic', microphone: 'mic', discord: 'discord', system: 'system', desktop: 'system' };
  const NAME_RE = /^MedalTV(.*?)(\d{14,17})/;
  const gameKey = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function filenameTime(name) {
    const m = NAME_RE.exec(name);
    if (!m) return [null, null];
    const ts = m[2];
    const d = new Date(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14),
      ts.length > 14 ? +ts.slice(14).padEnd(3, '0').slice(0, 3) : 0);
    return [Number.isNaN(d.getTime()) ? null : d.getTime() / 1000, m[1] || null];
  }
  function gameFromRel(rel) {
    const p = rel.split('/');
    if (p.length >= 3 && p[0].toLowerCase() === 'clips') return p[1];
    if (p.length >= 2 && p[0].toLowerCase() === 'edits') return null;
    if (p.length >= 2 && p[0].toLowerCase() !== 'clips') return p[0];
    return null;
  }

  async function walk(dir, prefix, out, skip = true) {
    for await (const [name, h] of dir.entries()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (h.kind === 'directory') {
        if (skip && SKIP_DIRS.has(name.toLowerCase())) continue;
        await walk(h, rel, out, skip);
      } else out.push({ rel, handle: h });
    }
  }
  async function sub(dir, name) {
    for await (const [n, h] of dir.entries()) if (h.kind === 'directory' && n.toLowerCase() === name) return h;
    return null;
  }
  async function readAll(handle) { return new Uint8Array(await (await handle.getFile()).arrayBuffer()); }

  /** Map an absolute Windows path from Medal's DB to "<root>/<rel>" by matching the longest known suffix. */
  function resolver(indexes) {
    return abs => {
      const segs = Medal.pathKey(abs).split('/');
      for (let i = 1; i < segs.length; i++) {
        const cand = segs.slice(i).join('/');
        for (const [rootName, idx] of indexes) if (idx.has(cand)) return { path: `${rootName}/${idx.get(cand).rel}`, entry: idx.get(cand) };
      }
      return null;
    };
  }

  async function scan(store, settings, SQL, progress = () => {}) {
    const roots = [];
    for (const r of Folders.roots) if (await Folders.granted(r)) roots.push(r);
    const aliases = settings.game_aliases || {};
    const clipMax = settings.clip_max_seconds || 300;

    // 1) files on disk
    const files = new Map();      // web path -> {path, rel, root, handle}
    const indexes = new Map();    // root name -> Map(lower rel -> {rel, handle})
    const dbs = [];
    for (const r of roots) {
      progress(`Procházím složku ${r.name}…`);
      const vids = [];
      await walk(r.handle, '', vids);
      const idx = new Map();
      for (const v of vids) if (VIDEO_EXT.test(v.rel)) {
        idx.set(v.rel.toLowerCase(), v);
        files.set(`${r.name}/${v.rel}`, { path: `${r.name}/${v.rel}`, rel: v.rel, root: r, handle: v.handle });
      }
      const thumbs = await sub(r.handle, 'thumbnails');
      if (thumbs) {
        const list = []; await walk(thumbs, 'Thumbnails', list, false);
        list.forEach(t => idx.set(t.rel.toLowerCase(), t));
      }
      const dbDir = await sub(r.handle, 'databases');
      if (dbDir) {
        const found = new Map();
        for await (const [n, h] of dbDir.entries()) if (h.kind === 'file') found.set(n.toLowerCase(), h);
        for (const [n, h] of found) {
          if (!/^medal-.*\.db$/.test(n)) continue;
          try {
            dbs.push({ db: await readAll(h), wal: found.has(n + '-wal') ? await readAll(found.get(n + '-wal')) : null });
          } catch (e) { console.warn('Medal DB:', e); }
        }
      }
      indexes.set(r.name, idx);
    }

    // 2) Medal metadata, re-keyed to web paths
    progress('Čtu databázi Medalu…');
    const resolve = resolver(indexes);
    const medal = new Map();
    for (const info of Medal.readMedal(SQL, dbs).values()) {
      const hit = resolve(info.path);
      if (!hit) continue;   // video outside the picked folders
      const th = info.thumb ? resolve(info.thumb) : null;
      medal.set(hit.path, { ...info, thumbHandle: th ? th.entry.handle : null });
    }

    // 3) sidecar audio files (X_Mic.mp4 next to X.mp4)
    const sidecars = new Map();
    for (const [key, f] of [...files]) {
      const base = f.rel.split('/').pop();
      const dot = base.lastIndexOf('.');
      const stem = base.slice(0, dot), ext = base.slice(dot);
      const m = SIDECAR_RE.exec(stem);
      if (!m) continue;
      const mainKey = key.slice(0, key.length - base.length) + m[1] + ext;
      if (files.has(mainKey)) {
        if (!sidecars.has(mainKey)) sidecars.set(mainKey, []);
        sidecars.get(mainKey).push({ path: key, role: SIDECAR_ROLE[m[2].toLowerCase()], name: m[2] });
        files.delete(key);
      }
    }

    // 4) records
    const records = [];
    const keys = [...files.keys()].sort();
    let n = 0;
    for (const key of keys) {
      const f = files.get(key);
      if (++n % 10 === 0) progress(`Čtu videa ${n}/${keys.length}…`);
      const info = medal.get(key) || {};
      const base = f.rel.split('/').pop();
      const [fTime, fGame] = filenameTime(base);
      let file = null;
      try { file = await f.handle.getFile(); } catch (e) { /* locked or gone */ }
      let duration = info.duration || null;
      if (!duration && file) duration = (await probeVideo(file)).duration || null;   // instead of ffprobe
      let game = gameFromRel(f.rel) || fGame || info.game_caption || 'Ostatní';
      game = aliases[game] || game;
      let start = info.start_time ?? null;
      if (start == null && info.trim_start != null && fTime) start = fTime + info.trim_start;
      if (start == null) start = fTime;
      if (start == null && file) start = file.lastModified / 1000;
      let kind = info.kind || null;
      if (kind === 'clip' && info.trim_start != null && duration && duration > clipMax) kind = 'session';
      if (!kind) kind = duration != null && duration <= clipMax ? 'clip' : (duration != null ? 'session' : 'clip');
      records.push({
        path: key, game, kind, kind_override: null, start_time: start, duration, size: file ? file.size : null,
        medal_id: info.medal_id || null, medal_title: info.medal_title || null, thumb: null,
        tracks: JSON.stringify(info.tracks || []), bookmarks: JSON.stringify(info.bookmarks || []),
        sidecars: JSON.stringify(sidecars.get(key) || []), parent_path: info.parent_path || null,
        _medalThumb: info.thumbHandle || null, _rel: f.rel,
      });
    }

    // 5) one name per game ("Kingdoms Connected" vs "KingdomsConnected")
    const variants = new Map();
    records.forEach(r => { const k = gameKey(r.game); if (!variants.has(k)) variants.set(k, []); variants.get(k).push(r.game); });
    const canonical = new Map();
    for (const [k, names] of variants) {
      const count = x => names.filter(y => y === x).length;
      const best = [...new Set(names)].sort((a, b) => (b.includes(' ') - a.includes(' ')) || (count(b) - count(a)))[0];
      canonical.set(k, aliases[best] || best);
    }
    records.forEach(r => { r.game = canonical.get(gameKey(r.game)); });

    // 6) store: keep user overrides and cached thumbnails; adopt rows of an imported desktop catalog
    progress('Ukládám do katalogu…');
    const old = new Map(store.all('SELECT id, path, kind_override, thumb FROM media').map(r => [r.path, r]));
    const legacy = new Map();   // last 3 path segments -> row with a desktop (absolute Windows) path
    for (const r of old.values()) if (/^[a-z]:[\\/]/i.test(r.path)) legacy.set(Medal.pathKey(r.path).split('/').slice(-3).join('/'), r);
    const seen = new Set(), thumbJobs = [];
    store.db.run('BEGIN');
    try {
      for (const r of records) {
        let prev = old.get(r.path);
        if (!prev) {
          const tail = r.path.toLowerCase().split('/').slice(-3).join('/');
          const lg = legacy.get(tail);
          if (lg) {   // same video, keeps its id → bookmarks, events and characters stay attached
            store.run('UPDATE media SET path=?, thumb=NULL WHERE id=?', [r.path, lg.id]);
            prev = { ...lg, thumb: null };
            legacy.delete(tail);
          }
        }
        if (prev) { r.kind_override = prev.kind_override; if (Files.url(prev.thumb)) r.thumb = prev.thumb; }   // cached and still there
        const id = store.upsertMedia(r);
        seen.add(r.path);
        if (!r.thumb) thumbJobs.push({ id, path: r.path, duration: r.duration, medalThumb: r._medalThumb });
      }
      store.db.run('COMMIT');
    } catch (e) { store.db.run('ROLLBACK'); throw e; }
    const missing = store.markMissingExcept(seen, roots.map(r => r.name + '/'));
    store.autoAssignServers();
    return { files: records.length, medal: records.filter(r => r.medal_id).length, missing, roots: roots.map(r => r.name), thumbJobs };
  }

  /** Thumbnails: Medal's own (unless it is a tiny black frame), else a frame grabbed by the browser. */
  async function makeThumbs(store, jobs, { onProgress = () => {}, onBatch = () => {} } = {}) {
    let done = 0, lastBatch = Date.now(), failedCodec = 0;
    const one = async job => {
      let blob = null, small = null;
      if (job.medalThumb) {
        try {
          const f = await job.medalThumb.getFile();
          if (f.size >= 6000) blob = f; else small = f;
        } catch (e) { /* ignore */ }
      }
      if (!blob) {
        try {
          const res = await probeVideo(await Folders.file(job.path, false), { frameAt: thumbTime });
          if (res.blob) blob = res.blob;
          if (res.error === 'codec') failedCodec++;
          if (res.duration && !job.duration) store.updateMedia(job.id, { duration: res.duration });
        } catch (e) { /* no access */ }
      }
      blob = blob || small;
      if (blob) store.updateMedia(job.id, { thumb: await Files.put(`thumb/${job.id}.jpg`, new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' })) });
      done++;
      onProgress(done, jobs.length);
      if (Date.now() - lastBatch > 2500) { lastBatch = Date.now(); onBatch(); }
    };
    const queue = [...jobs];
    await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift()); }));
    onBatch();
    return { done, failedCodec };
  }

  return { scan, makeThumbs, filenameTime };
})();
