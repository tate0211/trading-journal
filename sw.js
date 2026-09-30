// Service worker: keeps the app's own files available offline.
// Network first, so a new version on GitHub Pages shows up on the next open; the cache is only a fallback.
const CACHE = 'trading-journal-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'db.js', 'charts.js', 'coach.js', 'notes.js', 'calendar.js', 'news.js', 'todo.js', 'sync.js', 'app.js',
  'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-rounded.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only the app's own files. API calls (Supabase, Anthropic, WSJ, TradingView…) go straight to the network.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
