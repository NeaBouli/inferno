const CACHE_NAME = "ifr-web3-v14";
const NAVIGATION_TIMEOUT_MS = 5000;
const PRECACHE_URLS = [
  "/",
  "/web3/",
  "/web3/index.html",
  "/web3-manifest.webmanifest",
  "/assets/ifr_icon_64.png",
  "/assets/ifr_icon_256.png",
  "/assets/ifr_icon_4096_v2.png",
  "/assets/inferno-redesign-masthead-opaque.jpg",
  "/assets/inferno-redesign-masthead-opaque@2x.jpg",
  "/web3-wallet-core.js",
  "/assets/vendor/ethers-6.17.0.umd.min.js",
  "/assets/ifr-state.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function fetchNavigation(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  return fetch(request, { cache: "no-store", signal: controller.signal })
    .finally(() => clearTimeout(timeout));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    let cacheWrite = Promise.resolve();
    const navigationResponse = fetchNavigation(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          cacheWrite = caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
        }
        return response;
      });
    event.waitUntil(navigationResponse.then(() => cacheWrite).catch(() => undefined));
    event.respondWith(
      navigationResponse
        .catch(async () => (await caches.match("/")) || caches.match("/web3/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
