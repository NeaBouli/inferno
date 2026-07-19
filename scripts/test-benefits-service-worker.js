#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const listeners = new Map();
const cacheWrites = [];
let responseStatus = 200;

const cache = {
  addAll: async () => {},
  put: async (key) => cacheWrites.push(key),
};

const context = {
  URL,
  Response,
  Promise,
  caches: {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async () => ({ source: 'offline-root' }),
  },
  fetch: async () => ({
    ok: responseStatus >= 200 && responseStatus < 300,
    status: responseStatus,
    clone() { return this; },
  }),
  self: {
    location: { origin: 'https://shop.ifrunit.tech' },
    addEventListener: (name, handler) => listeners.set(name, handler),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  },
};

const source = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'benefits-network', 'frontend', 'public', 'sw.js'),
  'utf8'
);
const layoutSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'benefits-network', 'frontend', 'src', 'app', 'layout.tsx'),
  'utf8'
);
const repoRoot = path.join(__dirname, '..');
const publicIcons = path.join(repoRoot, 'apps', 'benefits-network', 'frontend', 'public', 'icons');
const publicRoot = path.join(repoRoot, 'apps', 'benefits-network', 'frontend', 'public');
const canonicalAssets = path.join(repoRoot, 'docs', 'assets');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

vm.runInNewContext(source, context, { filename: 'sw.js' });

async function navigate(url) {
  let responsePromise;
  listeners.get('fetch')({
    request: { mode: 'navigate', url },
    respondWith: (promise) => { responsePromise = promise; },
  });
  await responsePromise;
}

async function main() {
  assert(listeners.has('fetch'), 'service worker must register a fetch handler');
  assert(source.includes("const CACHE_NAME = 'ifr-benefits-v14'"), 'service worker cache version must be v14');
  assert(source.includes("'/icons/ifr-token-64-v11.png'"), 'service worker must precache the canonical PNG favicon');
  assert(source.includes("'/icons/ifr-token-180-v11.png'"), 'service worker must precache the canonical Apple touch icon');
  assert(source.includes("'/icons/ifr-token-192-v11.png'"), 'service worker must precache the canonical 192 icon');
  assert(source.includes("'/icons/ifr-token-256-v11.png'"), 'service worker must precache the canonical 256 icon');
  assert(source.includes("'/icons/ifr-token-512-v11.png'"), 'service worker must precache the canonical 512 icon');
  assert(source.includes("'/icons/favicon-v11.ico'"), 'service worker must precache the versioned browser favicon');
  assert(!source.includes("favicon-v4.ico"), 'service worker must not precache the competing ICO favicon');
  assert(layoutSource.includes("'/sw.js?v=14'"), 'layout must register the current service-worker release');
  assert(source.includes("'/copilot-avatar.jpg'"), 'service worker must precache the Copilot launcher asset');
  assert(layoutSource.includes("updateViaCache:'none'"), 'registration must bypass stale service-worker HTTP caches');
  assert(layoutSource.includes("'controllerchange'"), 'controlled clients must reload after a service-worker update');
  assert.strictEqual(
    sha256(path.join(publicIcons, 'ifr-token-64-v11.png')),
    sha256(path.join(canonicalAssets, 'ifr_icon_64.png')),
    'Shop favicon PNG must be byte-identical to the canonical IFR token-list asset'
  );
  assert.strictEqual(
    sha256(path.join(publicIcons, 'ifr-token-256-v11.png')),
    sha256(path.join(canonicalAssets, 'ifr_icon_256.png')),
    'Shop header PNG must be byte-identical to the canonical IFR token-list asset'
  );
  assert.strictEqual(
    sha256(path.join(publicRoot, 'favicon.ico')),
    sha256(path.join(publicIcons, 'favicon-v11.ico')),
    'root favicon and versioned favicon must remain byte-identical'
  );

  await navigate('https://shop.ifrunit.tech/guide');
  assert.deepStrictEqual(cacheWrites, [], 'a subpage must not replace the offline app shell');

  responseStatus = 404;
  await navigate('https://shop.ifrunit.tech/');
  assert.deepStrictEqual(cacheWrites, [], 'an unsuccessful root response must not replace the offline app shell');

  responseStatus = 200;
  await navigate('https://shop.ifrunit.tech/');
  assert.deepStrictEqual(cacheWrites, ['/'], 'a successful root response should refresh the offline app shell');

  console.log('[benefits-sw-test] PASS');
}

main().catch((error) => {
  console.error(`[benefits-sw-test] FAIL: ${error.message}`);
  process.exit(1);
});
