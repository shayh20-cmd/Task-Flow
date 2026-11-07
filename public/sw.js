// Minimal service worker: makes Recipin installable (needed for "Share → Recipin" on Android)
// and keeps the app shell available offline. API calls always go to the network.
const SHELL = 'recipin-shell-v1';
const FILES = ['/', '/index.html', '/app.js', '/styles.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/share-target')) return;
  // Network first, cache fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && FILES.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
