#!/usr/bin/env node
// T-280: privacy gate for the Benefits frontend.
// Loads the built app (BENEFITS_BASE_URL, default http://127.0.0.1:3000) in
// fresh browser contexts with full network logging. Wallet telemetry requests
// are aborted (never sent upstream) and only recorded. The test never connects
// or signs with a wallet.
//
// Part 1, fresh visitor: every route x viewport gets its own hard assertions
// (page served, observation window completed, zero telemetry requests, zero
// wallet-SDK hosts or sockets, no Coinbase SDK initialisation).
// Part 2, returning visitor (Wagmi storage seeded exactly as Wagmi leaves it):
//   - disconnected after using Coinbase Wallet / WalletConnect: no SDK load
//     and no telemetry until a wallet is chosen again;
//   - still connected with Coinbase Wallet: the session restore still runs
//     (SDK initialises) and still sends no telemetry.

const { chromium } = require('playwright');

const BASE_URL = process.env.BENEFITS_BASE_URL || 'http://127.0.0.1:3000';
// AppKit flushes its analytics queue on a 10 s interval, so every page is
// observed for at least 15 s after the network went idle. The env var can only
// lengthen this window, never shorten it.
const MIN_OBSERVE_MS = 15_000;
const OBSERVE_MS = Math.max(MIN_OBSERVE_MS, Number(process.env.BENEFITS_TELEMETRY_SETTLE_MS || 0));
// Set to 1 when the bundle was built with NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
// so the WalletConnect/AppKit path is really present (otherwise the gate would
// be vacuous for WalletConnect telemetry).
const EXPECT_WALLETCONNECT = process.env.BENEFITS_EXPECT_WALLETCONNECT === '1';
const ROUTES = ['/', '/?mode=seller', '/guide', '/b/telemetry-check', '/r/telemetry-check'];
const VIEWPORTS = [
  { name: 'mobile 375x812', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: 'desktop 1440x1000', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false },
];
const DESKTOP = VIEWPORTS[1];

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
// Any host of a wallet SDK vendor: none may be contacted before a choice.
const WALLET_SDK_DOMAINS = ['coinbase.com', 'walletconnect.org', 'walletconnect.com', 'web3modal.org', 'web3modal.com', 'reown.com'];

function hostMatches(url, list) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

async function observe(browser, vp, { seed, route = '/' } = {}) {
  const context = await browser.newContext({
    viewport: vp.viewport,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    serviceWorkers: 'block',
  });
  const result = { telemetry: [], walletHosts: [], sockets: [], sdkInit: [], status: 0, connectorIds: null };
  let recording = !seed;
  await context.route('**/*', (r) => {
    const req = r.request();
    const url = req.url();
    if (recording) {
      if (hostMatches(url, TELEMETRY_HOSTS)) result.telemetry.push(`${req.method()} ${url}`);
      else if (hostMatches(url, WALLET_SDK_DOMAINS)) result.walletHosts.push(`${req.method()} ${url}`);
      // Coinbase Wallet SDK runs a HEAD request against the current page
      // (Cross-Origin-Opener-Policy check) as soon as it is created.
      if (req.method() === 'HEAD' && url.startsWith(BASE_URL)) result.sdkInit.push(`HEAD ${url}`);
    }
    if (hostMatches(url, TELEMETRY_HOSTS)) return r.abort();
    return r.continue();
  });
  context.on('websocket', (ws) => {
    if (recording && hostMatches(ws.url(), WALLET_SDK_DOMAINS)) result.sockets.push(ws.url());
  });
  const page = await context.newPage();
  try {
    let response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'load', timeout: 60_000 });
    if (seed) {
      // Seed Wagmi storage the way Wagmi itself leaves it, then load again.
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.evaluate(seed);
      recording = true;
      response = await page.reload({ waitUntil: 'load', timeout: 60_000 });
    }
    result.status = response?.status() ?? 0;
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    const control = page.locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]').first();
    if (route === '/') {
      await control.waitFor({ state: 'attached', timeout: 30_000 });
      result.connectorIds = (await control.getAttribute('data-wallet-connector-ids')) || '';
    }
    const started = Date.now();
    while (Date.now() - started < OBSERVE_MS) {
      await page.waitForTimeout(Math.max(50, OBSERVE_MS - (Date.now() - started)));
    }
    result.observedMs = Date.now() - started;
  } finally {
    await page.close();
    await context.close();
  }
  return result;
}

// Browser-side seeds: Wagmi storage exactly as the app leaves it.
// - Disconnected: Wagmi keeps `recentConnectorId` and an empty store; before
//   the fix this alone re-activated the SDK on the next visit.
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

(async () => {
  const failures = [];
  const passes = [];
  const fail = (label, detail) => failures.push(`${label} -> ${detail}`);
  const browser = await chromium.launch({ headless: true });
  try {
    // Part 1: every route and viewport, fresh visitor, hard assertions each.
    for (const vp of VIEWPORTS) {
      for (const route of ROUTES) {
        const label = `[fresh ${vp.name}] ${route}`;
        const before = failures.length;
        const r = await observe(browser, vp, { route });
        if (!(r.status >= 200 && r.status < 500)) fail(label, `page not served (HTTP ${r.status})`);
        if (!(r.observedMs >= MIN_OBSERVE_MS)) fail(label, `observation window too short (${r.observedMs} ms)`);
        for (const hit of r.telemetry) fail(label, `telemetry ${hit}`);
        for (const hit of r.walletHosts) fail(label, `wallet SDK host ${hit}`);
        for (const ws of r.sockets) fail(label, `wallet SDK socket ${ws}`);
        for (const hit of r.sdkInit) fail(label, `Coinbase SDK initialised (${hit})`);
        if (r.connectorIds !== null && EXPECT_WALLETCONNECT && !r.connectorIds.split(',').includes('walletConnect')) {
          fail(label, `WalletConnect connector missing (ids="${r.connectorIds}"); build with NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`);
        }
        if (failures.length === before) passes.push(`${label} HTTP ${r.status}, ${r.observedMs} ms, 0 telemetry, 0 wallet hosts`);
      }
    }

    // Part 2: returning visitors.
    const disconnected = [['coinbaseWalletSDK', 'Coinbase Wallet']];
    if (EXPECT_WALLETCONNECT) disconnected.push(['walletConnect', 'WalletConnect']);
    for (const [id, name] of disconnected) {
      const label = `[returning, disconnected from ${name}] /`;
      const before = failures.length;
      const r = await observe(browser, DESKTOP, { seed: seedDisconnected(id) });
      for (const hit of r.telemetry) fail(label, `telemetry ${hit}`);
      for (const hit of r.walletHosts) fail(label, `wallet SDK host ${hit}`);
      for (const ws of r.sockets) fail(label, `wallet SDK socket ${ws}`);
      for (const hit of r.sdkInit) fail(label, `Coinbase SDK initialised (${hit})`);
      if (failures.length === before) passes.push(`${label} no SDK load, 0 telemetry`);
    }
    {
      const label = '[returning, still connected with Coinbase Wallet] /';
      const before = failures.length;
      const r = await observe(browser, DESKTOP, { seed: seedConnected('coinbaseWalletSDK') });
      if (r.sdkInit.length === 0) fail(label, 'session restore did not initialise the Coinbase SDK (restore behaviour changed)');
      for (const hit of r.telemetry) fail(label, `telemetry ${hit}`);
      if (failures.length === before) passes.push(`${label} restore ran (SDK initialised), 0 telemetry`);
    }
  } finally {
    await browser.close();
  }

  const expectedChecks = ROUTES.length * VIEWPORTS.length + (EXPECT_WALLETCONNECT ? 3 : 2);
  console.log(`[benefits-wallet-telemetry] observe>=${OBSERVE_MS}ms after network idle; expect-walletconnect=${EXPECT_WALLETCONNECT}`);
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
  console.log(`[benefits-wallet-telemetry] PASS ${passes.length}/${expectedChecks} checks (routes=${ROUTES.length} x viewports=${VIEWPORTS.length} fresh + returning visitors), telemetry-requests=0`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
