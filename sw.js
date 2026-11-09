// Offline cache. Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'anes-tools-2026-11-09c';
const FILES = [
  './', './index.html', './shared.js', './manifest.json', './icon-192.png', './icon-512.png',
  './1neopad.html', './3vasoactive.html', './5BGA.html', './7resident.html', './8sanitizer.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (always fresh when online), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});