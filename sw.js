
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Always go to network (fresh reports). No caching to avoid stale content.
  event.respondWith(fetch(event.request));
});
