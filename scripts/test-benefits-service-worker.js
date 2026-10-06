#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const listeners = new Map();
const cacheWrites = [];
const precacheAdds = [];
const deletedCaches = [];
let responseStatus = 200;
let networkOnline = true;
let networkHangs = false;

function cacheKey(key) {
  return typeof key === 'string' ? key : key.url;
}

const cache = {
  addAll: async (urls) => precacheAdds.push(...urls),
  put: async (key) => cacheWrites.push(cacheKey(key)),
};

const context = {
  URL,
  Response,
  Promise,
  AbortController,
  clearTimeout,
  setTimeout,
  caches: {
    open: async () => cache,
    keys: async () => ['ifr-benefits-v21', 'ifr-benefits-v22', 'ifr-benefits-v23', 'ifr-benefits-v24', 'unrelated-cache'],
    delete: async (name) => {
      deletedCaches.push(name);
      return true;
    },
    match: async () => ({ source: 'offline-root' }),
  },
  fetch: async (request, options = {}) => {
    if (networkHangs) {
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (!networkOnline) throw new Error('offline');
    const url = typeof request === 'string' ? request : request.url;
    if (url === '/' || url === 'https://shop.ifrunit.tech/') {
      return new Response(
        '<html><head><link rel="stylesheet" href="/_next/static/css/app.css"></head>' +
        "<body><script src='/_next/static/chunks/app.js'></script>" +
        '<script src="https://third-party.example/tracker.js"></script></body></html>',
        { status: responseStatus, headers: { 'content-type': 'text/html' } }
      );
    }
    return new Response('asset', { status: responseStatus });
  },
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

function extractRegistrationScript() {
  const match = layoutSource.match(/__html:\s*`([^`]*)`/);
  assert(match, 'layout must contain an inline service-worker registration script');
  assert(match[1].includes('serviceWorker'), 'inline registration script must target service workers');
  return match[1];
}

function createSessionStorage({ fail = false } = {}) {
  const entries = new Map();
  const ensureAvailable = () => {
    if (fail) throw new Error('session storage unavailable');
  };

  return {
    getItem(key) {
      ensureAvailable();
      return entries.has(key) ? entries.get(key) : null;
    },
    removeItem(key) {
      ensureAvailable();
      entries.delete(key);
    },
    setItem(key, value) {
      ensureAvailable();
      entries.set(key, String(value));
    },
  };
}

function createRegistrationHarness(registrationScript, { controller = null, storage = createSessionStorage() } = {}) {
  const controllerChangeHandlers = [];
  const loadHandlers = [];
  const registrations = [];
  let registrationUpdateCalls = 0;
  let reloads = 0;

  const serviceWorker = {
    controller,
    addEventListener(name, handler) {
      if (name === 'controllerchange') controllerChangeHandlers.push(handler);
    },
    register(scriptUrl, options) {
      registrations.push({ options, scriptUrl });
      return Promise.resolve({
        update() {
          registrationUpdateCalls += 1;
          return Promise.resolve();
        },
      });
    },
  };

  vm.runInNewContext(registrationScript, {
    navigator: { serviceWorker },
    window: {
      addEventListener(name, handler) {
        if (name === 'load') loadHandlers.push(handler);
      },
      location: {
        reload() {
          reloads += 1;
        },
      },
      sessionStorage: storage,
    },
  }, { filename: 'benefits-sw-registration.js' });

  return {
    fireControllerChange(nextController) {
      serviceWorker.controller = nextController;
      controllerChangeHandlers.forEach((handler) => handler());
    },
    fireLoad() {
      loadHandlers.forEach((handler) => handler());
    },
    get registrationUpdateCalls() {
      return registrationUpdateCalls;
    },
    get registrations() {
      return registrations;
    },
    get reloads() {
      return reloads;
    },
  };
}

vm.runInNewContext(source, context, { filename: 'sw.js' });

async function install() {
  let installPromise;
  listeners.get('install')({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;
}

async function activate() {
  let activatePromise;
  listeners.get('activate')({ waitUntil: (promise) => { activatePromise = promise; } });
  await activatePromise;
}

async function navigate(url) {
  let responsePromise;
  listeners.get('fetch')({
    request: { mode: 'navigate', url },
    respondWith: (promise) => { responsePromise = promise; },
  });
  await responsePromise;
}

// T-284: the precached offline fallback follows the light shop design (manifest theme #F5F1E8 and the
// .shop-shell tokens in globals.css) and stays static and self-contained: no scripts, stylesheets, fonts or
// any other request may leave the page while the device is offline.
function assertOfflineFallbackDesign() {
  const offline = fs.readFileSync(path.join(publicRoot, 'offline.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'manifest.json'), 'utf8'));
  const globals = fs.readFileSync(path.join(publicRoot, '..', 'src', 'app', 'globals.css'), 'utf8');
  const themeMeta = offline.match(/<meta name="theme-color" content="([^"]+)"/);
  assert(themeMeta, 'offline fallback must declare a theme-color');
  assert.strictEqual(themeMeta[1].toLowerCase(), manifest.theme_color.toLowerCase(), 'offline theme-color must match the manifest theme');
  assert.strictEqual(manifest.theme_color.toUpperCase(), '#F5F1E8', 'manifest theme must stay the light paper colour');
  assert(/color-scheme:\s*light/.test(offline), 'offline fallback must use the light colour scheme');
  assert(!/color-scheme:\s*dark/.test(offline), 'offline fallback must not keep the retired dark scheme');
  const shopShell = globals.match(/\.shop-shell\s*\{([^}]*)\}/);
  assert(shopShell, 'globals.css must define the .shop-shell design tokens');
  const tokens = [...shopShell[1].matchAll(/(--shop-[a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)];
  for (const name of ['--shop-paper', '--shop-panel', '--shop-ink', '--shop-muted', '--shop-border', '--shop-ember']) {
    const token = tokens.find(([, tokenName]) => tokenName === name);
    assert(token, `globals.css must define ${name}`);
    const local = offline.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`));
    assert(local, `offline fallback must define ${name}`);
    assert.strictEqual(local[1].toLowerCase(), token[2].toLowerCase(), `offline ${name} must match globals.css`);
  }
  assert(/background:[^;]*var\(--shop-paper\)/.test(offline), 'offline page background must use --shop-paper');
  for (const retired of ['#17130f', '#241b15', '#f7f1e8']) {
    assert(!offline.toLowerCase().includes(retired), `offline fallback must not keep the dark colour ${retired}`);
  }
  assert(!/<script\b/i.test(offline), 'offline fallback must not load or inline scripts');
  assert(!/<link\b/i.test(offline), 'offline fallback must not load stylesheets, fonts or icons via <link>');
  assert(!/@import|url\(/i.test(offline), 'offline fallback CSS must not fetch resources');
  assert(!/(?:src|href)=["'](?:https?:)?\/\//i.test(offline), 'offline fallback must not reference another origin');
  for (const [, ref] of offline.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
    if (ref === '/' || ref === '/support') continue;
    assert(source.includes(`'${ref}'`), `offline fallback asset ${ref} must be precached by the service worker`);
  }
  assertOfflineFallbackTypography(offline);
}

// T-284 review: text on the offline fallback uses fixed font sizes (px/rem, never scaled with the viewport) and
// zero tracking. Every font-size and letter-spacing declaration in the page's single <style> block is checked, and
// the root must set letter-spacing: 0 so that no element falls back to a non-zero inherited value.
function assertOfflineFallbackTypography(offline) {
  const styles = [...offline.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(([, css]) => css);
  assert.strictEqual(styles.length, 1, 'offline fallback must keep its CSS in a single inline <style> block');
  assert(!/\sstyle=/i.test(offline), 'offline fallback must not use inline style attributes');
  const css = styles[0].replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const declarations = rules.flatMap(({ selector, body }) => body.split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      return { selector, property: declaration.slice(0, colon).trim().toLowerCase(), value: declaration.slice(colon + 1).trim().toLowerCase() };
    }));
  const fontSizes = declarations.filter(({ property }) => property === 'font-size');
  assert(fontSizes.length > 0, 'offline fallback must declare its font sizes');
  for (const { selector, value } of fontSizes) {
    assert(/^\d+(?:\.\d+)?(?:px|rem)$/.test(value), `offline ${selector} font-size must be a fixed px/rem value, got ${value}`);
  }
  for (const { selector, value } of declarations.filter(({ property }) => property === 'font')) {
    assert(!/vw|vh|vmin|vmax|clamp\(|min\(|max\(|calc\(/.test(value), `offline ${selector} font shorthand must not scale with the viewport, got ${value}`);
  }
  for (const { selector, value } of declarations.filter(({ property }) => property === 'letter-spacing')) {
    assert(/^0(?:px|em|rem)?$/.test(value), `offline ${selector} letter-spacing must be 0, got ${value}`);
  }
  const rootSpacing = declarations.find(({ selector, property }) => (selector === ':root' || selector === 'html') && property === 'letter-spacing');
  assert(rootSpacing, 'offline fallback root must set letter-spacing: 0 for all text');
}

async function main() {
  const registrationScript = extractRegistrationScript();

  assert(listeners.has('fetch'), 'service worker must register a fetch handler');
  assert(source.includes("const CACHE_NAME = 'ifr-benefits-v25'"), 'service worker cache version must be v25');
  assert(source.includes('const NAVIGATION_TIMEOUT_MS = 5000'), 'navigation requests must have a bounded network timeout');
  assertOfflineFallbackDesign();
  assert(source.includes("'/offline.html'"), 'service worker must precache the branded deep-link fallback');
  assert(source.includes("'/icons/ifr-token-64-v11.png'"), 'service worker must precache the canonical PNG favicon');
  assert(source.includes("'/icons/ifr-token-180-v11.png'"), 'service worker must precache the canonical Apple touch icon');
  assert(source.includes("'/icons/ifr-token-192-v11.png'"), 'service worker must precache the canonical 192 icon');
  assert(source.includes("'/icons/ifr-token-256-v11.png'"), 'service worker must precache the canonical 256 icon');
  assert(source.includes("'/icons/ifr-token-512-v11.png'"), 'service worker must precache the canonical 512 icon');
  assert(source.includes("'/icons/favicon-v11.ico'"), 'service worker must precache the versioned browser favicon');
  assert(!source.includes("favicon-v4.ico"), 'service worker must not precache the competing ICO favicon');
  assert(layoutSource.includes("'/sw.js?v=25'"), 'layout must register the current service-worker release');
  assert(source.includes("'/copilot-avatar.jpg'"), 'service worker must precache the Copilot launcher asset');
  assert(layoutSource.includes("updateViaCache:'none'"), 'registration must bypass stale service-worker HTTP caches');
  assert(layoutSource.includes("'controllerchange'"), 'controlled clients must reload after a service-worker update');
  assert(!registrationScript.includes('.update('), 'registration must not force a service-worker update on every page load');
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

  const firstInstall = createRegistrationHarness(registrationScript);
  firstInstall.fireLoad();
  firstInstall.fireControllerChange({ scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' });
  assert.strictEqual(firstInstall.registrations.length, 1, 'first install must register the service worker once');
  assert.strictEqual(firstInstall.registrations[0].scriptUrl, '/sw.js?v=25', 'registration must use the current release');
  assert.strictEqual(
    firstInstall.registrations[0].options.updateViaCache,
    'none',
    'registration must bypass stale service-worker HTTP caches'
  );
  assert.strictEqual(firstInstall.registrationUpdateCalls, 0, 'registration must rely on normal browser update checks');
  assert.strictEqual(firstInstall.reloads, 0, 'first install must not reload when the service worker claims the page');

  const sharedStorage = createSessionStorage();
  const controlledPage = createRegistrationHarness(registrationScript, {
    controller: { scriptURL: 'https://shop.ifrunit.tech/sw.js?v=22' },
    storage: sharedStorage,
  });
  controlledPage.fireControllerChange({ scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' });
  controlledPage.fireControllerChange({ scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' });
  controlledPage.fireControllerChange(null);
  assert.strictEqual(controlledPage.reloads, 1, 'one service-worker release may trigger at most one reload per session');

  const reloadedPage = createRegistrationHarness(registrationScript, {
    controller: { scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' },
    storage: sharedStorage,
  });
  reloadedPage.fireControllerChange({ scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' });
  assert.strictEqual(reloadedPage.reloads, 0, 'the same service-worker release must not reload again after page re-execution');

  const nextReleasePage = createRegistrationHarness(registrationScript, {
    controller: { scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' },
    storage: sharedStorage,
  });
  nextReleasePage.fireControllerChange({ scriptURL: 'https://shop.ifrunit.tech/sw.js?v=26' });
  assert.strictEqual(nextReleasePage.reloads, 1, 'a different service-worker URL must receive its own single reload allowance');

  const storageFailure = createRegistrationHarness(registrationScript, {
    controller: { scriptURL: 'https://shop.ifrunit.tech/sw.js?v=22' },
    storage: createSessionStorage({ fail: true }),
  });
  storageFailure.fireLoad();
  storageFailure.fireControllerChange({ scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' });
  storageFailure.fireControllerChange({ scriptURL: 'https://shop.ifrunit.tech/sw.js?v=25' });
  assert.strictEqual(storageFailure.registrations.length, 1, 'storage failure must not prevent service-worker registration');
  assert.strictEqual(storageFailure.reloads, 0, 'storage failure must fail safe without automatic reloads');

  await install();
  assert(!precacheAdds.includes('/'), 'root document must be fetched explicitly to discover its build assets');
  assert(precacheAdds.includes('/manifest.json'), 'manifest must remain in the fixed precache');
  assert(precacheAdds.includes('/offline.html'), 'offline fallback must be available before the first deep link');
  assert(cacheWrites.includes('/'), 'install must cache the current root document');
  assert(cacheWrites.includes('https://shop.ifrunit.tech/_next/static/css/app.css'), 'install must cache current Next.js CSS');
  assert(cacheWrites.includes('https://shop.ifrunit.tech/_next/static/chunks/app.js'), 'install must cache current Next.js JavaScript');
  assert(!cacheWrites.includes('https://third-party.example/tracker.js'), 'install must not cache third-party assets');
  cacheWrites.length = 0;

  await activate();
  assert.deepStrictEqual(
    deletedCaches,
    ['ifr-benefits-v21', 'ifr-benefits-v22', 'ifr-benefits-v23', 'ifr-benefits-v24'],
    'activation must delete only stale IFR Benefits caches and preserve unrelated origin caches'
  );

  await navigate('https://shop.ifrunit.tech/guide');
  assert.deepStrictEqual(cacheWrites, [], 'a subpage must not replace the offline app shell');

  responseStatus = 404;
  await navigate('https://shop.ifrunit.tech/');
  assert.deepStrictEqual(cacheWrites, [], 'an unsuccessful root response must not replace the offline app shell');

  responseStatus = 200;
  await navigate('https://shop.ifrunit.tech/');
  assert.deepStrictEqual(cacheWrites, ['/'], 'a successful root response should refresh the offline app shell');

  networkHangs = true;
  const timeoutStartedAt = Date.now();
  await navigate('https://shop.ifrunit.tech/guide');
  const timeoutElapsedMs = Date.now() - timeoutStartedAt;
  assert(timeoutElapsedMs >= 4500 && timeoutElapsedMs < 7000, `hanging navigation must fall back after the bounded timeout, got ${timeoutElapsedMs}ms`);
  networkHangs = false;

  let apiResponsePromise;
  networkOnline = false;
  listeners.get('fetch')({
    request: { method: 'GET', mode: 'cors', destination: '', url: 'https://shop.ifrunit.tech/api/health' },
    respondWith: (promise) => { apiResponsePromise = promise; },
  });
  const apiResponse = await apiResponsePromise;
  assert.strictEqual(apiResponse.status, 503, 'offline API requests must fail explicitly');
  assert.deepStrictEqual(cacheWrites, ['/'], 'offline API responses must never be cached');

  console.log('[benefits-sw-test] PASS');
}

main().catch((error) => {
  console.error(`[benefits-sw-test] FAIL: ${error.message}`);
  process.exit(1);
});
