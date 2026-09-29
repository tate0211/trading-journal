// Cloud sync with your own Supabase project, so the Mac and iPhone share one journal.
// Local first: every change is saved in this browser, queued, then pushed. Other devices pull changes
// every minute and when the app comes back into view. Conflicts: the most recent change (record._ts) wins.
// GoodNotes files go to Supabase Storage; their note records only keep the file's path.
const Sync = (() => {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
  const TABLE = 'journal_records';
  const BUCKET = 'notes';
  const PULL_EVERY = 60 * 1000;
  const OVERLAP = 10 * 1000; // re-read the last few seconds on each pull in case of late commits
  const BATCH_BYTES = 3 * 1024 * 1024;

  let client = null, user = null, cfg = null;
  let queue = {}; // 'store|id' -> { ts, deleted }
  let pushTimer = null, pullTimer = null, running = null;
  let status = { state: 'off', at: null, error: null };
  const listeners = new Set();

  const setStatus = (s) => { status = { ...status, ...s }; listeners.forEach((fn) => fn(status)); };
  const keyOf = (store, id) => `${store}|${id}`;
  const splitKey = (k) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };
  const saveQueue = () => DB.setMeta('syncQueue', queue);
  const iso = (ms) => new Date(ms).toISOString();

  async function loadClient() {
    const { createClient } = await import(SDK_URL);
    return createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tj-supabase-auth' } });
  }

  // ---------- setup & auth ----------
  async function init() {
    DB.setOnChange(onLocalChange);
    queue = (await DB.getMeta('syncQueue', {})) || {};
    cfg = await DB.getMeta('syncConfig', null);
    if (!cfg) return setStatus({ state: 'off' });
    try {
      client = await loadClient();
      const { data } = await client.auth.getSession();
      user = data.session?.user || null;
      client.auth.onAuthStateChange((_e, session) => { user = session?.user || null; if (!user) stopLoop(); });
      if (!user) return setStatus({ state: 'signed-out' });
      startLoop();
    } catch (e) {
      setStatus({ state: 'error', error: 'Could not load the sync library. Check your internet connection.' });
    }
  }
  async function configure(url, key) {
    url = url.trim().replace(/\/+$/, ''); key = key.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error('The Project URL should look like https://abcd1234.supabase.co');
    if (key.length < 20) throw new Error('That key looks too short. Copy the "anon public" (or "publishable") key.');
    cfg = { url, key };
    await DB.setMeta('syncConfig', cfg);
    client = await loadClient();
    setStatus({ state: 'signed-out', error: null });
  }
  async function forget() {
    await signOut();
    cfg = null; client = null;
    await DB.del('meta', 'syncConfig');
    setStatus({ state: 'off' });
  }
  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    user = data.user;
    startLoop();
  }
  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.session) return 'confirm'; // email confirmation is switched on in Supabase
    user = data.user;
    startLoop();
    return 'ok';
  }
  async function signOut() {
    stopLoop();
    if (client) await client.auth.signOut().catch(() => {});
    user = null;
    await DB.del('meta', 'syncState');
    setStatus({ state: cfg ? 'signed-out' : 'off' });
  }

  // ---------- local changes ----------
  function onLocalChange(store, id, deleted) {
    queue[keyOf(store, id)] = { ts: Date.now(), deleted };
    saveQueue();
    if (user) { clearTimeout(pushTimer); pushTimer = setTimeout(() => syncNow(), 1500); }
  }
  // First sign-in on this device: send everything already here (starter defaults excluded).
  async function queueEverything() {
    for (const store of DB.STORES) {
      for (const rec of await DB.all(store)) {
        if (!DB.syncable(store, rec.id) || rec._ts === 0) continue;
        const k = keyOf(store, rec.id);
        if (!queue[k]) queue[k] = { ts: rec._ts ?? 1, deleted: false };
      }
    }
    await saveQueue();
  }

  // ---------- push ----------
  async function dataUrlToBlob(url) { return (await fetch(url)).blob(); }
  async function toRow(store, id, entry) {
    const base = { user_id: user.id, store, id };
    if (entry.deleted) return { ...base, data: null, deleted: true, updated_at: iso(entry.ts) };
    const rec = await DB.get(store, id);
    if (!rec) return { ...base, data: null, deleted: true, updated_at: iso(entry.ts) };
    const data = { ...rec };
    if (store === 'notes' && data.data) {
      const path = `${user.id}/${id}`;
      if (rec._uploaded !== path) {
        const blob = await dataUrlToBlob(data.data);
        const { error } = await client.storage.from(BUCKET).upload(path, await blob.arrayBuffer(), { upsert: true, contentType: blob.type });
        if (error) throw error;
        await DB.put(store, { ...rec, _uploaded: path }, { remote: true });
      }
      data.file = path; data.mime = data.data.slice(5, data.data.indexOf(';'));
      delete data.data; delete data._uploaded;
    }
    return { ...base, data, deleted: false, updated_at: iso(rec._ts ?? entry.ts) };
  }
  async function push() {
    const entries = Object.entries(queue);
    if (!entries.length) return;
    let batch = [], bytes = 0, done = [];
    const flush = async () => {
      if (!batch.length) return;
      const { error } = await client.from(TABLE).upsert(batch, { onConflict: 'user_id,store,id' });
      if (error) throw error;
      for (const [k, entry] of done) if (queue[k] && queue[k].ts === entry.ts) delete queue[k];
      await saveQueue();
      batch = []; bytes = 0; done = [];
    };
    for (const [k, entry] of entries) {
      const [store, id] = splitKey(k);
      const row = await toRow(store, id, entry);
      const size = JSON.stringify(row).length;
      if (batch.length && bytes + size > BATCH_BYTES) await flush();
      batch.push(row); bytes += size; done.push([k, entry]);
    }
    await flush();
  }

  // ---------- pull ----------
  async function apply(row) {
    if (!DB.STORES.includes(row.store) || !DB.syncable(row.store, row.id)) return false;
    const k = keyOf(row.store, row.id);
    const remoteTs = Date.parse(row.updated_at);
    if (queue[k]) { if (queue[k].ts > remoteTs) return false; delete queue[k]; } // a newer local edit is waiting to go up
    const local = await DB.get(row.store, row.id);
    const localTs = local ? (local._ts ?? 1) : -1;
    if (row.deleted) {
      if (!local || localTs > remoteTs) return false;
      await DB.del(row.store, row.id, { remote: true });
      return true;
    }
    if (local && localTs >= remoteTs) return false;
    const data = { ...row.data, _ts: remoteTs };
    if (row.store === 'notes' && data.file) {
      if (local?.data && local._uploaded === data.file) data.data = local.data; // file already here
      data._uploaded = data.file;
    }
    await DB.put(row.store, data, { remote: true });
    return true;
  }
  async function pull() {
    const state = (await DB.getMeta('syncState', null)) || {};
    const firstTime = state.userId !== user.id;
    if (firstTime) await queueEverything();
    let cursor = !firstTime && state.lastPull ? iso(Date.parse(state.lastPull) - OVERLAP) : null;
    let newest = state.lastPull && !firstTime ? state.lastPull : null, changed = 0;
    for (;;) {
      let q = client.from(TABLE).select('store,id,data,deleted,updated_at,synced_at').order('synced_at').limit(500);
      if (cursor) q = q.gt('synced_at', cursor);
      const { data, error } = await q;
      if (error) throw error;
      for (const row of data) { if (await apply(row)) changed++; }
      if (data.length) { cursor = data.at(-1).synced_at; if (!newest || cursor > newest) newest = cursor; }
      if (data.length < 500) break;
    }
    await saveQueue();
    await DB.setMeta('syncState', { userId: user.id, lastPull: newest });
    return changed;
  }

  // ---------- loop ----------
  async function syncNow() {
    if (!user) return;
    if (running) return running;
    running = (async () => {
      setStatus({ state: 'syncing', error: null });
      try {
        const changed = await pull();
        await push();
        setStatus({ state: 'synced', at: new Date(), error: null });
        if (changed) onRemoteChanges(changed);
      } catch (e) {
        setStatus({ state: navigator.onLine === false ? 'offline' : 'error', error: e.message || String(e) });
      } finally { running = null; }
    })();
    return running;
  }
  function startLoop() {
    stopLoop();
    syncNow();
    pullTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, PULL_EVERY);
  }
  function stopLoop() { clearInterval(pullTimer); clearTimeout(pushTimer); pullTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());

  // Refresh the screen with new data, unless you're in the middle of typing.
  async function onRemoteChanges(n) {
    await load();
    const typing = document.activeElement?.matches?.('input, textarea, select');
    if (location.hash.startsWith('#trade/') || typing) toast(`${n} update${n > 1 ? 's' : ''} synced from your other device`);
    else route();
  }

  // ---------- notes files & cloud deletion ----------
  async function noteData(note) {
    if (note.data) return note.data;
    if (!note.file || !client || !user) throw new Error('This note\'s file is in the cloud. Sign in to cloud sync to open it.');
    const { data, error } = await client.storage.from(BUCKET).download(note.file);
    if (error) throw error;
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(data); });
    const withType = note.mime && url.startsWith('data:application/octet-stream') ? url.replace('application/octet-stream', note.mime) : url;
    await DB.put('notes', { ...note, data: withType, _uploaded: note.file }, { remote: true });
    note.data = withType;
    return withType;
  }
  async function deleteCloudData() {
    if (!user) return;
    const { error } = await client.from(TABLE).delete().eq('user_id', user.id);
    if (error) throw error;
    const { data: files } = await client.storage.from(BUCKET).list(user.id, { limit: 1000 });
    if (files?.length) await client.storage.from(BUCKET).remove(files.map((f) => `${user.id}/${f.name}`));
    queue = {}; await saveQueue(); await DB.del('meta', 'syncState');
  }

  return {
    init, configure, forget, signIn, signUp, signOut, syncNow, noteData, deleteCloudData,
    status: () => status, onStatus: (fn) => { listeners.add(fn); fn(status); },
    user: () => user, config: () => cfg, pending: () => Object.keys(queue).length,
  };
})();
