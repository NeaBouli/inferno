const CACHE_NAME = 'ifr-benefits-v9';
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/ifr-official-64-v7.png',
  '/icons/ifr-official-180-v7.png',
  '/icons/ifr-official-192-v7.png',
  '/icons/ifr-official-256-v7.png',
  '/icons/ifr-official-512-v7.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // API responses and page navigations must not be pinned to an old app release.
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          const requestUrl = new URL(event.request.url);
          if (response.ok && requestUrl.origin === self.location.origin && requestUrl.pathname === '/') {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('/', response.clone());
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Versioned static assets can remain cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
