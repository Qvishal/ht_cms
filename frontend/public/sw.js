const CACHE = 'ht-cms-offline-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/', '/favicon.ico'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Always try network first for navigation, fallback to offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  // For other requests, try network then cache
  event.respondWith(
    fetch(req)
      .then((res) => res)
      .catch(() => caches.match(req)),
  );
});
