#!/usr/bin/env node
// T-280: privacy gate for the Benefits frontend.
// Loads the built app (BENEFITS_BASE_URL, default http://127.0.0.1:3000) in
// fresh browser contexts with full network logging. Wallet telemetry requests
// are aborted (never sent upstream) and only recorded. The test never connects
// or signs with a wallet.
//
// A page only counts when it is proven to work: HTTP 2xx/3xx, no page error,
// no error boundary, React hydrated, network idle reached, and the
// route-specific headings visible (synthetic slugs must show their explicit
// "unavailable" state). Only then is "0 telemetry" meaningful.
//
// Part 1, fresh visitor: every route x viewport.
// Part 2, returning visitor (Wagmi storage seeded the way the app leaves it):
//   - disconnected after using Coinbase Wallet / WalletConnect: no SDK load;
//   - still connected with Coinbase Wallet: the session restore still runs.
// scripts/test-benefits-wallet-telemetry-gate.js proves the gate itself fails
// on late telemetry, broken/unhydrated pages and invalid durations.

const { chromium } = require('playwright');

// AppKit flushes its analytics queue on a 10 s interval, so every page is
// observed for at least 15 s after the network went idle.
const MIN_OBSERVE_MS = 15_000;

/**
 * @param {string | undefined} raw BENEFITS_TELEMETRY_SETTLE_MS
 * @returns {number} observation window in ms (finite integer >= 15000)
 */
function parseObserveMs(raw) {
  if (raw === undefined || raw === '') return MIN_OBSERVE_MS;
  const value = Number(raw);
  if (!/^\d+$/.test(String(raw).trim()) || !Number.isFinite(value) || value < MIN_OBSERVE_MS) {
    throw new Error(`BENEFITS_TELEMETRY_SETTLE_MS must be a finite integer >= ${MIN_OBSERVE_MS}, got "${raw}"`);
  }
  return value;
}

// Route expectations for the Benefits app. Synthetic slugs have no backing
// record, so the working app shows its explicit unavailable state there.
const BENEFITS_ROUTES = [
  { path: '/', headings: [/Locked IFR\. Benefits at checkout\./, /Access status/], walletControl: true },
  { path: '/?mode=seller', headings: [/Locked IFR\. Benefits at checkout\./, /Benefit rule manager/] },
  { path: '/guide', headings: [/Customer proof and seller checkout/] },
  { path: '/b/telemetry-check', headings: [/Business console/, /Seller profile unavailable|not found/i] },
  { path: '/r/telemetry-check', headings: [/Sign to verify IFR access/, /Verification unavailable|not found/i], walletControl: true },
];
const VIEWPORTS = [
  { name: 'mobile 375x812', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: 'desktop 1440x1000', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false },
];

// Hosts that only exist for wallet SDK telemetry/analytics.
const TELEMETRY_HOSTS = [
  'cca-lite.coinbase.com', // Coinbase Wallet SDK client analytics (Amplitude via CCA)
  'cca.coinbase.com',
  'as.coinbase.com',
  'api.amplitude.com',
  'api2.amplitude.com',
  'pulse.walletconnect.org', // WalletConnect core event client + AppKit analytics
  'pulse.walletconnect.com',
];
// Wallet SDK vendor hosts (incl. AppKit's api.web3modal.org): none may be
// contacted before a wallet is chosen.
const WALLET_SDK_DOMAINS = ['coinbase.com', 'walletconnect.org', 'walletconnect.com', 'web3modal.org', 'web3modal.com', 'reown.com'];
// Intended third-party traffic of the app: public chain RPC and IFR services.
const ALLOWED_THIRD_PARTY = ['ethereum-rpc.publicnode.com', 'ethereum-sepolia-rpc.publicnode.com', 'ifrunit.tech'];
const ERROR_BOUNDARY_SELECTOR = '#root-error-title, #global-error-title, [data-testid="shop-global-error"], [data-testid="shop-not-found"]';

function hostMatches(url, list) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

async function observe(browser, vp, options, { route, seed }) {
  const { baseUrl, observeMs, expectWalletConnect } = options;
  const failures = [];
  const result = { telemetry: [], sdkInit: [], failures, observedMs: 0 };
  const context = await browser.newContext({
    viewport: vp.viewport,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    serviceWorkers: 'block',
  });
  let recording = !seed;
  await context.route('**/*', (r) => {
    const req = r.request();
    const url = req.url();
    const telemetry = hostMatches(url, TELEMETRY_HOSTS);
    if (recording) {
      if (telemetry) result.telemetry.push(`${req.method()} ${url}`);
      else if (hostMatches(url, WALLET_SDK_DOMAINS)) failures.push(`wallet SDK host ${req.method()} ${url}`);
      else if (/^https?:/.test(url) && !url.startsWith(baseUrl) && !hostMatches(url, ALLOWED_THIRD_PARTY)) {
        failures.push(`unexpected third-party request ${req.method()} ${url}`);
      }
      // Coinbase Wallet SDK runs a HEAD request against the current page
      // (Cross-Origin-Opener-Policy check) as soon as it is created.
      if (req.method() === 'HEAD' && url.startsWith(baseUrl)) result.sdkInit.push(`HEAD ${url}`);
    }
    if (telemetry) return r.abort();
    return r.continue();
  });
  // WebSockets are Page events in Playwright (BrowserContext has none), so the
  // listener is attached to every page of the context, including later ones.
  const sockets = new Set();
  const baseOrigin = new URL(baseUrl);
  const onSocket = (url) => {
    if (!recording || sockets.has(url)) return;
    sockets.add(url);
    if (hostMatches(url, WALLET_SDK_DOMAINS)) failures.push(`wallet SDK socket ${url}`);
    else {
      const target = new URL(url);
      const sameApp = target.hostname === baseOrigin.hostname && target.port === baseOrigin.port;
      if (!sameApp && !hostMatches(url, ALLOWED_THIRD_PARTY)) failures.push(`unexpected third-party socket ${url}`);
    }
  };
  const watchPage = (p) => p.on('websocket', (ws) => onSocket(ws.url()));
  context.on('page', watchPage);
  // Wallet SDK sockets never reach the network; they are recorded and closed.
  await context.routeWebSocket((url) => hostMatches(url.href, WALLET_SDK_DOMAINS), (ws) => {
    onSocket(ws.url());
    ws.close();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => { if (recording) failures.push(`page error: ${String(error.message).slice(0, 160)}`); });
  try {
    let response;
    try {
      response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'load', timeout: 60_000 });
      if (seed) {
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.evaluate(seed);
        recording = true;
        response = await page.reload({ waitUntil: 'load', timeout: 60_000 });
      }
    } catch (error) {
      failures.push(`navigation failed: ${String(error.message).split('\n')[0]}`);
      return result;
    }
    const status = response?.status() ?? 0;
    if (!(status >= 200 && status < 400)) failures.push(`HTTP ${status}`);

    let idle = true;
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { idle = false; });
    if (!idle) failures.push('network never reached idle within 30 s; post-idle observation not possible');

    if (await page.locator(ERROR_BOUNDARY_SELECTOR).count()) failures.push('error boundary rendered');
    const hydrated = await page.evaluate(() => {
      const nodes = [document.querySelector('main'), document.body?.firstElementChild].filter(Boolean);
      return nodes.some((node) => Object.keys(node).some((key) => key.startsWith('__reactFiber') || key.startsWith('__reactProps')));
    });
    if (!hydrated) failures.push('React did not hydrate the page');
    for (const heading of route.headings || []) {
      const visible = await page.getByRole('heading', { name: heading }).first().isVisible().catch(() => false);
      if (!visible) failures.push(`expected heading ${heading} not visible`);
    }
    if (route.walletControl) {
      const control = page.locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]').first();
      const ready = await control.waitFor({ state: 'attached', timeout: 30_000 }).then(() => true, () => false);
      if (!ready) failures.push('wallet chooser did not become ready');
      else if (expectWalletConnect) {
        const ids = (await control.getAttribute('data-wallet-connector-ids')) || '';
        if (!ids.split(',').includes('walletConnect')) {
          failures.push(`WalletConnect connector missing (ids="${ids}"); build with NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`);
        }
      }
      // T-284: on phones the fixed Copilot launcher must not sit on the "Connect with" box or the WalletConnect
      // hint at its end. Hint text boxes stay left of the launcher band and the box keeps a visible 12px gap.
      if (ready && expectWalletConnect && vp.viewport.width < 821) {
        const clearance = await page.evaluate(() => {
          const launcher = document.querySelector('.shop-copilot-button');
          const hint = document.querySelector('[data-walletconnect-hint]');
          const box = document.querySelector('[data-wallet-connect-with]');
          if (!launcher || !hint || !box) return { missing: true };
          const band = launcher.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(hint);
          const textRight = Math.max(...[...range.getClientRects()].map((r) => r.right));
          return { launcherLeft: band.left, textRight, boxRight: box.getBoundingClientRect().right };
        });
        if (clearance.missing) failures.push('wallet chooser hint, Connect-with box or Copilot launcher missing');
        else {
          if (clearance.textRight > clearance.launcherLeft) failures.push(`WalletConnect hint text reaches the launcher band (${Math.round(clearance.textRight)} > ${Math.round(clearance.launcherLeft)})`);
          if (clearance.boxRight > clearance.launcherLeft - 12) failures.push(`Connect-with box ends ${Math.round(clearance.launcherLeft - clearance.boxRight)}px before the launcher band (needs >= 12px)`);
        }
      }
    }

    const started = Date.now();
    while (Date.now() - started < observeMs) {
      await page.waitForTimeout(Math.max(50, observeMs - (Date.now() - started)));
    }
    result.observedMs = Date.now() - started;
    if (!(result.observedMs >= observeMs)) failures.push(`observation window too short (${result.observedMs} ms)`);
  } finally {
    await page.close();
    await context.close();
  }
  for (const hit of result.telemetry) failures.push(`telemetry ${hit}`);
  return result;
}

// Browser-side seeds: Wagmi storage exactly as the app leaves it.
// - Disconnected: Wagmi keeps `recentConnectorId` and an empty store; before
//   the disconnect fix this alone re-activated the SDK on the next visit.
// - Still connected: the deferred connector's session marker is present.
function seedDisconnected(connectorId) {
  return new Function(`
    const raw = window.localStorage.getItem('wagmi.store');
    const version = raw ? JSON.parse(raw).version : 0;
    window.localStorage.removeItem('wagmi.deferredSdkConnectorId');
    window.localStorage.setItem('wagmi.recentConnectorId', JSON.stringify(${JSON.stringify(connectorId)}));
    window.localStorage.setItem('wagmi.store', JSON.stringify({
      state: { connections: { __type: 'Map', value: [] }, chainId: 1, current: null },
      version,
    }));
  `);
}

function seedConnected(connectorId) {
  return new Function(`
    window.localStorage.setItem('wagmi.recentConnectorId', JSON.stringify(${JSON.stringify(connectorId)}));
    window.localStorage.setItem('wagmi.deferredSdkConnectorId', JSON.stringify(${JSON.stringify(connectorId)}));
  `);
}

/**
 * @param {{ baseUrl: string, routes: typeof BENEFITS_ROUTES, viewports: typeof VIEWPORTS,
 *   observeMs: number, expectWalletConnect?: boolean, returningVisitors?: boolean }} options
 * @returns {Promise<{ failures: string[], passes: string[], expectedChecks: number }>}
 */
async function runGate(options) {
  const failures = [];
  const passes = [];
  const browser = await chromium.launch({ headless: true });
  const record = (label, r, okText) => {
    if (r.failures.length) for (const f of r.failures) failures.push(`${label} -> ${f}`);
    else passes.push(`${label} ${okText(r)}`);
  };
  try {
    for (const vp of options.viewports) {
      for (const route of options.routes) {
        const r = await observe(browser, vp, options, { route });
        for (const hit of r.sdkInit) r.failures.push(`Coinbase SDK initialised (${hit})`);
        record(`[fresh ${vp.name}] ${route.path}`, r, (x) => `working page, ${x.observedMs} ms observed, 0 telemetry, 0 wallet-SDK hosts`);
      }
    }
    if (options.returningVisitors) {
      const home = options.routes.find((route) => route.path === '/');
      const desktop = options.viewports[options.viewports.length - 1];
      const disconnected = [['coinbaseWalletSDK', 'Coinbase Wallet']];
      if (options.expectWalletConnect) disconnected.push(['walletConnect', 'WalletConnect']);
      for (const [id, name] of disconnected) {
        const r = await observe(browser, desktop, options, { route: home, seed: seedDisconnected(id) });
        for (const hit of r.sdkInit) r.failures.push(`Coinbase SDK initialised (${hit})`);
        record(`[returning, disconnected from ${name}] /`, r, () => 'working page, no SDK load, 0 telemetry');
      }
      const r = await observe(browser, desktop, options, { route: home, seed: seedConnected('coinbaseWalletSDK') });
      // The restore legitimately starts the Coinbase SDK (and may reach its hosts).
      r.failures.splice(0, r.failures.length, ...r.failures.filter((f) => !f.startsWith('wallet SDK host') && !f.startsWith('wallet SDK socket')));
      if (r.sdkInit.length === 0) r.failures.push('session restore did not initialise the Coinbase SDK (restore behaviour changed)');
      record('[returning, still connected with Coinbase Wallet] /', r, () => 'working page, restore ran (SDK initialised), 0 telemetry');
    }
  } finally {
    await browser.close();
  }
  const expectedChecks = options.viewports.length * options.routes.length
    + (options.returningVisitors ? (options.expectWalletConnect ? 3 : 2) : 0);
  return { failures, passes, expectedChecks };
}

async function main() {
  const observeMs = parseObserveMs(process.env.BENEFITS_TELEMETRY_SETTLE_MS);
  const expectWalletConnect = process.env.BENEFITS_EXPECT_WALLETCONNECT === '1';
  const { failures, passes, expectedChecks } = await runGate({
    baseUrl: process.env.BENEFITS_BASE_URL || 'http://127.0.0.1:3000',
    routes: BENEFITS_ROUTES,
    viewports: VIEWPORTS,
    observeMs,
    expectWalletConnect,
    returningVisitors: true,
  });
  console.log(`[benefits-wallet-telemetry] observe=${observeMs}ms after network idle; expect-walletconnect=${expectWalletConnect}`);
  for (const line of passes) console.log(`[benefits-wallet-telemetry] ok ${line}`);
  if (failures.length > 0) {
    console.error(`[benefits-wallet-telemetry] FAIL: ${failures.length} finding(s):\n${failures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  if (passes.length !== expectedChecks) {
    console.error(`[benefits-wallet-telemetry] FAIL: ${passes.length}/${expectedChecks} checks asserted`);
    process.exitCode = 1;
    return;
  }
  console.log(`[benefits-wallet-telemetry] PASS ${passes.length}/${expectedChecks} checks (routes=${BENEFITS_ROUTES.length} x viewports=${VIEWPORTS.length} fresh + returning visitors), telemetry-requests=0`);
}

module.exports = { runGate, parseObserveMs, MIN_OBSERVE_MS, BENEFITS_ROUTES, VIEWPORTS, TELEMETRY_HOSTS };

if (require.main === module) {
  main().catch((error) => {
    console.error(`[benefits-wallet-telemetry] FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
