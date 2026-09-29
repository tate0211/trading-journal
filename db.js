// Tiny IndexedDB wrapper. Data lives in this browser; when cloud sync is on, sync.js mirrors changes to Supabase.
// Every record carries _ts (ms, last local change) so two devices can settle on the newest version.
const DB = (() => {
  const NAME = 'trading-journal';
  const VERSION = 2; // v2 adds the 'notes' store (GoodNotes exports)
  const STORES = ['trades', 'journal', 'weekly', 'rules', 'coach', 'notes', 'meta'];
  // Meta keys that belong to this device only (never synced). NOT_IN_BACKUP: also left out of backup files.
  const LOCAL_ONLY = ['apiKey', 'avKey', 'earnings', 'syncQueue', 'syncState', 'syncConfig', 'account', 'marketGroup', 'inputMode', 'rulesSeeded'];
  const NOT_IN_BACKUP = ['apiKey', 'avKey', 'earnings', 'syncQueue', 'syncState', 'syncConfig'];
  let dbPromise;
  let onChange = null; // set by Sync: (store, id, deleted) => void

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const result = fn(s);
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      t.onerror = () => reject(t.error);
    });
  }
  const syncable = (store, id) => !(store === 'meta' && LOCAL_ONLY.includes(id));

  return {
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
    // opts.remote: the change came from the cloud, so keep its _ts and don't send it back.
    async put(store, obj, opts = {}) {
      if (!opts.remote) obj._ts = Date.now();
      await tx(store, 'readwrite', (s) => s.put(obj));
      if (!opts.remote && onChange && syncable(store, obj.id)) onChange(store, obj.id, false);
    },
    async del(store, id, opts = {}) {
      await tx(store, 'readwrite', (s) => s.delete(id));
      if (!opts.remote && onChange && syncable(store, id)) onChange(store, id, true);
    },
    // Defaults created on first run: stamped as the oldest possible version and not uploaded,
    // so they never overwrite what another device already has.
    seed: (store, obj) => tx(store, 'readwrite', (s) => s.put({ ...obj, _ts: 0 })),
    clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
    async getMeta(key, fallback) {
      const row = await this.get('meta', key);
      return row ? row.value : fallback;
    },
    setMeta(key, value) { return this.put('meta', { id: key, value }); },
    seedMeta(key, value) { return this.seed('meta', { id: key, value }); },
    async listMeta(prefix) { return (await this.all('meta')).filter((m) => m.id.startsWith(prefix)); },
    async exportAll() {
      const out = { app: 'trading-journal', version: VERSION, exportedAt: new Date().toISOString() };
      for (const s of STORES) out[s] = await this.all(s);
      // Never put API keys or sync bookkeeping in a backup file (and skip the re-downloadable earnings cache).
      out.meta = out.meta.filter((m) => !NOT_IN_BACKUP.includes(m.id));
      return out;
    },
    async importAll(data) {
      if (!data || data.app !== 'trading-journal') throw new Error('Not a trading-journal backup file.');
      for (const s of STORES) {
        if (!Array.isArray(data[s])) continue;
        for (const row of data[s]) if (!(s === 'meta' && NOT_IN_BACKUP.includes(row.id))) await this.put(s, row);
      }
    },
    setOnChange(fn) { onChange = fn; },
    syncable,
    STORES,
  };
})();
