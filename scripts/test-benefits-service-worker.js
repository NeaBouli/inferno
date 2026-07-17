#!/usr/bin/env node

const assert = require('assert');
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
