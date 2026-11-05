/* ============================================================
   Tiny IndexedDB wrapper.
     kv    – small values: catalog database bytes, settings, folder handles
     files – blobs: thumbnails, attachments, custom thumbnails (key = "path")
   ============================================================ */
'use strict';

const IDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('kronikar', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async _tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const st = tx.objectStore(store);
      const r = fn(st);
      tx.oncomplete = () => resolve(r instanceof IDBRequest ? r.result : r);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  get(store, key) { return this._tx(store, 'readonly', st => st.get(key)); },
  set(store, key, val) { return this._tx(store, 'readwrite', st => { st.put(val, key); }); },
  del(store, key) { return this._tx(store, 'readwrite', st => { st.delete(key); }); },
  clear(store) { return this._tx(store, 'readwrite', st => { st.clear(); }); },
  /** All entries of a store as [[key, value], ...]. */
  async entries(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const out = [];
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  },
};
