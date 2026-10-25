#!/usr/bin/env node
// Real pinned SDK + actual guard, not an encrypted-session or signing E2E test.
// HTTP and WS terminate in local Playwright fixtures. Never record request data.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const sdk = readFileSync(path.join(root, 'docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js'));
const guard = readFileSync(path.join(root, 'docs/assets/wallet-telemetry-guard.js'));
const sdkHash = '77843c24c6c5aa5b4f743af3f2dd3a9d94e16b15bb8c5ff1bba58db2b14cd63e';
const flushWait = 21000; // Two unchanged SDK 10-second flush periods.
let stage = 'setup';

function observeTransports() {
  const counts = { fetch: 0, beacon: 0 };
  const pulse = input => {
    const value = typeof input === 'string' ? input : input?.url || input?.href;
    try { return new URL(value, document.baseURI).origin === 'https://pulse.walletconnect.org'; }
    catch { return false; }
  };
  const fetch = window.fetch;
  const beacon = navigator.sendBeacon;
  window.fetch = function(input) {
    if (pulse(input)) counts.fetch++;
    return Reflect.apply(fetch, this, arguments);
  };
  navigator.sendBeacon = function(input) {
    if (pulse(input)) counts.beacon++;
    return Reflect.apply(beacon, this, arguments);
  };
  window.telemetryCounts = counts;
}

async function runCase(browser, origin, mutation) {
  const counts = { error: 0, sdkError: 0, batch: 0, initialize: 0, qr: 0, httpFixture: 0, relay: 0, forbidden: 0 };
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  try {
    await context.addInitScript(observeTransports);
    await context.route('**/*', async route => {
      // Classify only in memory; no URL, payload, pairing topic or error logging.
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS' } });
      if (url.origin === origin) {
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local SDK fixture</title>' });
        if (url.pathname === '/sdk.js') return route.fulfill({ contentType: 'text/javascript', body: sdk });
        if (url.pathname === '/guard.js') return route.fulfill({ contentType: 'text/javascript', body: guard });
        counts.forbidden++;
        return route.abort();
      }
      counts.httpFixture++;
      if (url.origin === 'https://pulse.walletconnect.org') {
        if (url.pathname === '/e') {
          counts.error++;
          try {
            const event = request.postDataJSON();
            if (event.props?.type === 'error' && event.props.errorMessage === 'synthetic-public-canary') counts.sdkError++;
          } catch { counts.forbidden++; }
        }
        else if (url.pathname === '/batch') {
          counts.batch++;
          try {
            const events = request.postDataJSON();
            if (Array.isArray(events) && events.some(event => event.props?.event === 'INITIALIZE')) counts.initialize++;
          } catch { counts.forbidden++; }
        } else counts.forbidden++;
        return json(route, {});
      }
      if (request.method() === 'POST') {
        try {
          const payload = request.postDataJSON();
          const respond = entry => {
            const values = { eth_chainId: '0x1', net_version: '1', eth_accounts: [], eth_blockNumber: '0x1234',
              eth_getBalance: '0x0', eth_getCode: '0x', eth_call: `0x${'0'.repeat(1024)}`, eth_getLogs: [] };
            if (!Object.hasOwn(values, entry.method)) { counts.forbidden++; return { jsonrpc: '2.0', id: entry.id, error: { code: 4200, message: 'Fixture refuses method' } }; }
            return { jsonrpc: '2.0', id: entry.id, result: values[entry.method] };
          };
          return json(route, Array.isArray(payload) ? payload.map(respond) : respond(payload));
        } catch { counts.forbidden++; return route.abort(); }
      }
      if (url.pathname === '/getAnalyticsConfig') return json(route, { isAnalyticsEnabled: false });
      if (url.pathname === '/appkit/v1/config') return json(route, { features: {} });
      if (url.pathname === '/appkit/v1/project-limits') return json(route, { planLimits: {
        tier: 'unlimited', isAboveMauLimit: false, isAboveRpcLimit: false } });
      if (url.pathname === '/projects/v1/origins') return json(route, { allowedOrigins: [origin] });
      if (url.pathname === '/getWallets') return json(route, { count: 0, data: [] });
      if (url.hostname === 'verify.walletconnect.org') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline</title>' });
      if (url.hostname.startsWith('fonts.')) return route.fulfill({ contentType: 'text/css', body: '' });
      // No fallback network access, including unexpected vendor asset endpoints.
      return json(route, {});
    });
    await context.routeWebSocket('**/*', socket => {
      const host = new URL(socket.url()).hostname;
      if (!['relay.walletconnect.org', 'relay.walletconnect.com'].includes(host)) {
        counts.forbidden++;
        socket.close();
        return;
      }
      // Never connectToServer or issue a session approval.
      socket.onMessage(raw => {
        try {
          const message = JSON.parse(String(raw));
          let result;
          const subscription = topic => createHash('sha256').update(topic).digest('hex');
          switch (message.method) {
            case 'irn_subscribe': result = subscription(message.params.topic); break;
            case 'irn_batchSubscribe': result = message.params.topics.map(subscription); break;
            case 'wc_proposeSession': case 'irn_publish': case 'irn_unsubscribe': case 'irn_batchUnsubscribe': result = true; break;
            default: counts.forbidden++; socket.close(); return;
          }
          counts.relay++;
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
        } catch { counts.forbidden++; socket.close(); }
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${origin}/#synthetic-public-canary`);
    stage = mutation ? 'mutation-initialize' : 'guard-initialize';
    console.log(`[wallet-telemetry-integration] ${stage}`);
    await page.evaluate(async removeGuard => {
      const guard = await import('/guard.js');
      // The only mutation: omit installation in this fresh browser realm.
      if (!removeGuard) guard.installWalletConnectTelemetryGuard();
      const { EthereumProvider } = await import('/sdk.js');
      window.fixtureProvider = await EthereumProvider.init({
        projectId: '00000000000000000000000000000000', chains: [1], showQrModal: true,
        telemetryEnabled: false, rpcMap: { 1: `${location.origin}/rpc` },
        metadata: { name: 'Synthetic public canary', description: 'Offline fixture', url: location.origin, icons: [] },
      });
    }, mutation);
    stage = mutation ? 'mutation-error' : 'guard-error';
    console.log(`[wallet-telemetry-integration] ${stage}`);
    const threw = await page.evaluate(() => {
      const variables = Object.defineProperty({}, '--w3m-accent', { enumerable: true,
        get() { throw new Error('synthetic-public-canary'); } });
      try { window.fixtureProvider.modal.setThemeVariables(variables); return false; }
      catch { return true; }
    });
    assert.ok(threw, 'SDK error trigger must throw');
    for (let attempt = 0; attempt < 2; attempt++) {
      stage = mutation ? 'mutation-qr' : 'guard-qr';
      console.log(`[wallet-telemetry-integration] ${stage}`);
      await page.evaluate(() => {
        window.fixtureQr = 0;
        window.fixtureSettled = false;
        window.fixtureProvider.once('display_uri', () => { window.fixtureQr++; });
        window.fixtureProvider.connect().then(() => { window.fixtureSettled = true; }, () => { window.fixtureSettled = true; });
      });
      await page.waitForFunction(() => window.fixtureQr > 0 && window.fixtureProvider.modal.getState().open);
      await page.evaluate(() => window.fixtureProvider.modal.close());
      await page.waitForFunction(() => window.fixtureSettled);
      counts.qr++;
    }
    stage = mutation ? 'mutation-flush' : 'guard-flush';
    console.log(`[wallet-telemetry-integration] ${stage}`);
    await page.waitForTimeout(flushWait);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.waitForTimeout(1000);
    const transport = await page.evaluate(() => ({ ...window.telemetryCounts, session: Boolean(window.fixtureProvider.session) }));
    assert.equal(transport.session, false, 'No session approval');
    assert.equal(counts.forbidden, 0, 'No unsupported RPC or telemetry shape');
    assert.ok(counts.relay > 0, 'Real SDK relay fixture must be exercised');
    assert.ok(counts.httpFixture > 0, 'Non-Pulse native network must remain usable');
    if (mutation) {
      assert.ok(counts.sdkError > 0 && counts.batch > 0 && counts.initialize > 0, 'Guard removal must expose actual SDK canary error and INITIALIZE telemetry');
      assert.ok(transport.fetch > 0 && transport.beacon > 0, 'Both native transports must be exercised');
    } else {
      assert.equal(counts.error + counts.batch, 0, 'Guard must block native Pulse HTTP routes');
      assert.equal(transport.fetch + transport.beacon, 0, 'Guard must block native fetch and beacon');
    }
    return { error: counts.error, sdkError: counts.sdkError, batch: counts.batch, initialize: counts.initialize,
      fetch: transport.fetch, beacon: transport.beacon, qr: counts.qr, relay: counts.relay };
  } finally { await context.close(); }
}

async function main() {
  assert.equal(createHash('sha256').update(sdk).digest('hex'), sdkHash, 'Pinned SDK integrity');
  // Refuse missing/mismatched browser installations; never install or fall back.
  const server = http.createServer((_, response) => { response.writeHead(404); response.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const deadline = setTimeout(() => { console.error(`[wallet-telemetry-integration] FAIL timeout ${stage}`); process.exit(1); }, 150000);
  try {
    browser = await chromium.launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const normal = await runCase(browser, origin, false);
    const mutation = await runCase(browser, origin, true);
    console.log(`[wallet-telemetry-integration] PASS guard=${JSON.stringify(normal)} mutation=${JSON.stringify(mutation)}`);
  } finally {
    clearTimeout(deadline);
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(() => {
  // Raw Playwright/SDK errors can contain pairing material. Fixed categories only.
  console.error(`[wallet-telemetry-integration] FAIL ${stage}`);
  process.exitCode = 1;
});
