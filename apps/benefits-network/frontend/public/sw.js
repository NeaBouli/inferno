const CACHE_NAME = 'ifr-benefits-v16';
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/ifr-token-64-v11.png',
  '/icons/ifr-token-180-v11.png',
  '/icons/ifr-token-192-v11.png',
  '/icons/ifr-token-256-v11.png',
  '/icons/ifr-token-512-v11.png',
  '/icons/favicon-v11.ico',
  '/copilot-avatar.jpg',
];

function isCacheableAppAsset(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin && (
    url.pathname.startsWith('/_next/static/') ||
    (url.pathname !== '/' && PRECACHE_URLS.includes(url.pathname))
  );
}

async function cacheCurrentAppShell(cache) {
  const response = await fetch('/', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not fetch the IFR Benefits app shell');

  await cache.put('/', response.clone());
  const html = await response.text();
  const assetUrls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'));

  await Promise.all([...new Set(assetUrls.map((url) => url.href))].map(async (url) => {
    const asset = await fetch(url, { cache: 'no-store' });
    if (!asset.ok) throw new Error(`Could not cache app asset: ${url}`);
    await cache.put(url, asset);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE_URLS.filter((url) => url !== '/'));
      await cacheCurrentAppShell(cache);
    })
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
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith('/api/')) {
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

  if (!isCacheableAppAsset(event.request)) return;

  // Same-origin app assets are cache-first and populate the current release cache at runtime.
  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    })
  );
});
