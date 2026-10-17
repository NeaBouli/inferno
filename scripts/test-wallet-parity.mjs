#!/usr/bin/env node
// JUL-11: exercise the shipped wallet UIs, real SDKs and CSP in both engines.
// Only EIP-1193 providers and network I/O are fixtures. Never approve a WC session.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, realpath, stat, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { chromium, webkit, expect } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FRONTEND = path.join(ROOT, 'apps/benefits-network/frontend');
const ACCOUNT = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const SHORT_ACCOUNT = '0x71c7...976f';
const ZERO_WORD = '0'.repeat(64);
const REPORT = path.join(ROOT, 'test-results/wallet-parity/report.json');
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 } },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
];
const SCENARIOS = ['no-provider', 'walletconnect', 'injected'];
const SURFACES = ['web3', 'benefits'];
const BROWSER_TYPES = { chromium, webkit };
const TIMEOUTS = { action: 15000, engine: 20000, case: 45000, global: 600000, cleanup: 3000 };
const RPC_HOSTS = ['ethereum-rpc.publicnode.com', 'eth.drpc.org', '1rpc.io', 'rpc.walletconnect.org'];
const VENDOR_DOMAINS = ['walletconnect.org', 'walletconnect.com', 'web3modal.org', 'web3modal.com', 'reown.com'];
const hostMatches = (host, domains) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
const redact = value => String(value)
  .replace(/wc:[^\s"'<>]+/gi, 'wc:[redacted]')
  .replace(/wc%3a[^\s"'<>]+/gi, 'wc%3A[redacted]')
  .replace(/([?&](?:auth|symKey|projectId|uri)=)[^\s&"'<>]+/gi, '$1[redacted]');

function parseArgs(args) {
  const options = { headed: false, selfTest: false, only: null };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--headed') options.headed = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--only') {
      const value = args[++index] || '';
      const [engine, viewport, surface, extra] = value.split(':');
      assert.ok(Object.hasOwn(BROWSER_TYPES, engine) && VIEWPORTS.some(item => item.name === viewport)
        && SURFACES.includes(surface) && extra === undefined,
        'Expected --only <chromium|webkit>:<desktop|mobile>:<web3|benefits>');
      options.only = { engine, viewport, surface };
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

class DeadlineError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; }
}

async function withinLimit(action, timeout, label, signal) {
  signal?.throwIfAborted();
  let timer;
  let abort;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineError(`${label()} timed out after ${timeout} ms`)), timeout);
        abort = () => reject(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function writeReport(report, file = REPORT) {
  mkdirSync(path.dirname(file), { recursive: true });
  // Atomic snapshots also remain readable if the process is interrupted.
  writeFileSync(`${file}.tmp`, `${redact(JSON.stringify(report, null, 2))}\n`);
  renameSync(`${file}.tmp`, file);
}

function caseResult(engine, viewport, surface, scenario) {
  return { engine, viewport: viewport.name, surface, scenario, status: 'failed', step: 'create-context', options: [],
    consoleErrors: [], pageErrors: [], cspViolations: [], networkErrors: [], vendorRequests: [], relayMethods: [] };
}

function rpcResult(method) {
  switch (method) {
    case 'eth_chainId': return '0x1';
    case 'net_version': return '1';
    case 'eth_accounts': return [];
    case 'eth_blockNumber': return '0x1234';
    case 'eth_getBalance': case 'eth_gasPrice': return '0x0';
    case 'eth_getCode': return '0x';
    // All-zero ABI words decode scalar and tuple reads; no numeric rounding.
    case 'eth_call': return `0x${ZERO_WORD.repeat(16)}`;
    case 'eth_getLogs': return [];
    case 'eth_syncing': return false;
    default: throw new Error(`Unimplemented read RPC: ${method}`);
  }
}

function relayResult(message) {
  const subscription = topic => createHash('sha256').update(topic).digest('hex');
  switch (message.method) {
    case 'irn_subscribe': return subscription(message.params.topic);
    case 'irn_batchSubscribe': return message.params.topics.map(subscription);
    // SDK 2.25 publishes proposals through a custom relay method. This only
    // acknowledges delivery; it never supplies a wallet/session approval.
    case 'wc_proposeSession': case 'irn_publish': case 'irn_unsubscribe': case 'irn_batchUnsubscribe': return true;
    default: throw new Error(`Unimplemented relay RPC: ${message.method}`);
  }
}

// Runs before application scripts, including in child frames. No SDK replacement.
function installBrowserFixtures({ profile, account }) {
  window.__walletParity = { violations: [], requests: [], authorized: false };
  document.addEventListener('securitypolicyviolation', event => {
    const violation = {
      directive: event.effectiveDirective, blockedURI: event.blockedURI,
      disposition: event.disposition, sourceFile: event.sourceFile, line: event.lineNumber,
    };
    window.__walletParity.violations.push(violation);
    // Persist events even if a modal frame navigates away or is removed.
    void window.__walletParityReportCsp(violation);
  });
  if (profile === 'none') return;
  const makeProvider = name => {
    const listeners = new Map();
    let authorized = false;
    return {
      isMetaMask: name === 'MetaMask', isPhantom: name === 'Phantom',
      isCoinbaseWallet: name === 'Coinbase Wallet', isConnected: () => true,
      on(event, handler) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(handler); },
      removeListener(event, handler) { listeners.get(event)?.delete(handler); },
      async request({ method }) {
        window.__walletParity.requests.push({ wallet: name, method });
        switch (method) {
          case 'eth_requestAccounts':
            authorized = true; window.__walletParity.authorized = true; return [account];
          case 'eth_accounts': return authorized ? [account] : [];
          case 'eth_chainId': return '0x1';
          case 'net_version': return '1';
          case 'wallet_requestPermissions': return [{ parentCapability: 'eth_accounts' }];
          case 'wallet_getPermissions': return authorized ? [{ parentCapability: 'eth_accounts' }] : [];
          case 'eth_getBalance': return '0x0';
          case 'eth_call': return `0x${'0'.repeat(64 * 16)}`;
          case 'eth_blockNumber': return '0x1234';
          default: throw Object.assign(new Error(`Unsupported mock wallet method: ${method}`), { code: 4200 });
        }
      },
    };
  };
  const names = profile === 'multiple' ? ['MetaMask', 'Phantom', 'Coinbase Wallet'] : ['MetaMask'];
  const rdns = ['io.metamask', 'app.phantom', 'com.coinbase.wallet'];
  const entries = names.map((name, index) => ({
    provider: makeProvider(name),
    info: { name, rdns: rdns[index], uuid: `00000000-0000-4000-8000-00000000000${index + 1}`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' },
  }));
  window.ethereum = entries[0].provider;
  if (profile === 'multiple') {
    window.ethereum.providers = entries.map(entry => entry.provider);
    window.phantom = { ethereum: entries[1].provider };
  }
  const announce = () => entries.forEach(detail => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail })));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
}

async function installNetwork(context, origin, result) {
  let font;
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  await context.route('**/*', async route => {
    const request = route.request();
    try {
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') return await route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': '*',
      } });
      if (RPC_HOSTS.includes(url.hostname) && request.method() === 'POST') {
        const payload = request.postDataJSON();
        const respond = entry => ({ jsonrpc: '2.0', id: entry.id, result: rpcResult(entry.method) });
        return await json(route, Array.isArray(payload) ? payload.map(respond) : respond(payload));
      }
      if (url.origin === origin) {
        if (url.pathname === '/api/ready') return await json(route, { status: 'ready', database: 'ok', chainId: 1 });
        if (url.pathname === '/api/businesses') return await json(route, { offers: [], categories: [], serviceAreas: [],
          pagination: { page: 1, limit: 12, total: 0, hasNext: false } });
        if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected Benefits API: ${request.method()} ${url.pathname}`);
        // Bound local asset reads too: every HTTP route ends in fulfill or abort.
        const response = await route.fetch({ timeout: TIMEOUTS.action, maxRedirects: 0 });
        return await route.fulfill({ response });
      }
      // Fonts are irrelevant to wallet parity; return a valid empty stylesheet.
      if (url.hostname === 'fonts.googleapis.com') return await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      if (hostMatches(url.hostname, VENDOR_DOMAINS)) {
        result.vendorRequests.push(`${request.method()} ${url.hostname}${url.pathname}`);
        if (url.hostname === 'fonts.reown.com' && /\.(woff2?|ttf)$/.test(url.pathname)) {
          // A valid local fallback avoids font-decoding console errors. Next is
          // already a pinned dependency of the Benefits production fixture.
          font ??= readFile(path.join(FRONTEND, 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'));
          return await route.fulfill({ status: 200, contentType: 'font/woff2',
            headers: { 'access-control-allow-origin': '*' }, body: await font });
        }
        if (url.hostname === 'api.web3modal.org' && url.pathname === '/getAnalyticsConfig') {
          return await json(route, { isAnalyticsEnabled: false });
        }
        if (url.hostname === 'verify.walletconnect.org' && url.pathname === '/v3/attestation') {
          // No origin attestation is issued offline. Let the SDK's bounded
          // attestation fallback run against an inert local document.
          return await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Offline verification fixture</title>' });
        }
        if (url.pathname === '/appkit/v1/config') return await json(route, { features: {} });
        if (url.pathname === '/appkit/v1/project-limits') return await json(route, { planLimits: {
          tier: 'unlimited', isAboveMauLimit: false, isAboveRpcLimit: false,
        } });
        if (url.pathname === '/projects/v1/origins') return await json(route, { allowedOrigins: [origin] });
        if (url.pathname === '/getWallets') return await json(route, { count: 0, data: [] });
        if (/\/(getWalletImage|public\/getAssetImage)\//.test(url.pathname)) return await route.fulfill({
          status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAccAAAAASUVORK5CYII=', 'base64'),
        });
        if (url.hostname.startsWith('pulse.') && request.method() === 'POST') return await json(route, {});
      }
      throw new Error(`Unstubbed request: ${request.method()} ${redact(url.href)}`);
    } catch (error) {
      const message = redact(error.message);
      result.networkErrors.push(message);
      console.error(`[wallet-parity] NETWORK ${message}`);
      try { await route.abort('blockedbyclient'); }
      catch (abortError) { result.networkErrors.push(`Route abort: ${redact(abortError.message)}`); }
    }
  });
  // Do not connectToServer(): no relay traffic or fake wallet approval goes upstream.
  await context.routeWebSocket('**/*', socket => {
    try {
      const url = new URL(socket.url());
      if (!['relay.walletconnect.org', 'relay.walletconnect.com'].includes(url.hostname)) {
        throw new Error(`Unexpected WebSocket: ${redact(url.href)}`);
      }
      socket.onMessage(raw => {
        try {
          const message = JSON.parse(String(raw));
          const reply = relayResult(message);
          result.relayMethods.push(message.method);
          const topic = message.method === 'wc_proposeSession' ? message.params?.pairingTopic
            : message.method === 'irn_publish' ? message.params?.topic : undefined;
          if (typeof topic === 'string' && /^[a-f0-9]{64}$/i.test(topic)) {
            result.relayPairing = { kind: 'relay-publish', version: 2, method: message.method, topic };
          }
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: reply }));
        } catch (error) {
          result.networkErrors.push(redact(error.message));
          socket.close();
        }
      });
    } catch (error) {
      result.networkErrors.push(redact(error.message));
      console.error(`[wallet-parity] NETWORK ${redact(error.message)}`);
      socket.close();
    }
  });
}

async function startWeb3Server() {
  const docs = await realpath(path.join(ROOT, 'docs'));
  const conf = await readFile(path.join(ROOT, 'infra/web3/web3-security-headers.conf'), 'utf8');
  const headers = Object.fromEntries([...conf.matchAll(/^add_header\s+(\S+)\s+"([^"]+)"\s+always;/gm)].map(match => [match[1], match[2]]));
  assert.ok(headers['Content-Security-Policy'], 'Web3 release CSP missing');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      // Same docroot/root mapping as scripts/web3-release.cjs and deployed nginx.
      const file = await realpath(path.resolve(docs, `.${pathname === '/' ? '/web3/index.html' : pathname}`));
      if (!file.startsWith(`${docs}${path.sep}`) || path.relative(docs, file).split(path.sep).some(part => part.startsWith('.'))) {
        response.writeHead(403, headers).end(); return;
      }
      const body = await readFile(file);
      response.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404, headers).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

async function startBenefitsServer() {
  await stat(path.join(FRONTEND, '.next/BUILD_ID')).catch(() => {
    throw new Error('Missing Benefits production build. See docs/qa/WALLET_PARITY.md for the offline build command.');
  });
  let log = '';
  // Port 0 lets Next bind an unused port without a reservation race.
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: FRONTEND, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const close = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Next start timed out: ${redact(log)}`)), 30000);
      const fail = error => { clearTimeout(timer); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`Next start exited ${code}: ${redact(log)}`)));
      const data = chunk => {
        log = (log + chunk.toString()).slice(-4000);
        const address = log.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (address && !address[1].match(/^0+$/) && /Ready in/.test(log)) { clearTimeout(timer); resolve(address[0]); }
      };
      child.stdout.on('data', data); child.stderr.on('data', data);
    });
    return { url, close };
  } catch (error) { await close(); throw error; }
}

async function openChooser(page, surface) {
  if (surface === 'web3') {
    await page.waitForFunction(() => Boolean(window.IFRWallet?.listWallets));
    await page.locator('[data-wallet-header-connect]').click();
    const chooser = page.locator('[data-wallet-chooser][aria-hidden="false"]');
    await expect(chooser).toBeVisible();
    return chooser.locator('[data-wallet-option]');
  }
  const control = page.locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]').first();
  await expect(control).toBeVisible();
  return control.locator('[aria-label="Connect with a wallet"] button');
}

function assertOptions(options, surface, scenario) {
  assert.ok(options.length > 0, 'Empty wallet chooser');
  assert.ok(options.some(label => /WalletConnect/.test(label)), 'WalletConnect missing: rebuild Benefits with a valid project ID');
  if (scenario !== 'no-provider') assert.ok(options.some(label => /MetaMask|Browser wallet/i.test(label)), 'Injected/MetaMask missing');
  if (scenario === 'walletconnect') assert.ok(options.includes('Phantom'), 'Phantom EVM provider missing');
  if (scenario === 'walletconnect' || surface === 'benefits') {
    assert.ok(options.some(label => /Coinbase/.test(label)), 'Coinbase missing');
  }
  if (scenario === 'no-provider') assert.ok(!options.some(label => /MetaMask|Browser wallet|Phantom/i.test(label)), 'Unavailable injected wallet offered');
}

// Inspect URI properties/attributes across nested AppKit/w3m open shadow roots.
// Instructional text mentioning "wc:" never counts as pairing material.
function renderedPairing() {
  const roots = [document];
  for (const root of roots) for (const node of root.querySelectorAll('*')) if (node.shadowRoot) roots.push(node.shadowRoot);
  const visible = node => {
    for (let current = node; current; current = current.parentElement || current.getRootNode()?.host) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || current.hidden) return false;
    }
    const box = node.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return true;
    // Some web-component hosts use display: contents.
    return [...(node.shadowRoot?.querySelectorAll('button, svg, canvas') || [])].some(child => visible(child));
  };
  const valid = value => {
    if (typeof value !== 'string') return false;
    let uri = value;
    try {
      if (/^https?:/i.test(uri)) uri = new URL(uri).searchParams.get('uri') || '';
      if (/^wc%3a/i.test(uri)) uri = decodeURIComponent(uri);
    } catch { return false; }
    return /^wc:[a-f0-9]{64}@2\?/i.test(uri) && /(?:\?|&)symKey=[a-f0-9]{64}(?:&|$)/i.test(uri);
  };
  for (const root of roots) {
    for (const node of root.querySelectorAll('*')) {
      const values = [node.uri, node.value, node.href, ...Array.from(node.attributes, attribute => attribute.value)];
      if (values.some(valid) && visible(node)) {
        return { kind: /qr/i.test(node.localName) ? 'qr' : 'uri-element', version: 2 };
      }
    }
  }
  return false;
}

async function runCase(getBrowser, engine, viewport, surface, url, scenario, {
  result = caseResult(engine, viewport, surface, scenario), signal, timeouts = TIMEOUTS,
} = {}) {
  let browser;
  let context;
  let page;
  let stopped = false;
  const step = name => {
    if (stopped) throw new Error('Case already stopped');
    signal?.throwIfAborted();
    result.step = name;
  };
  const fail = error => {
    const unavailable = !signal?.aborted && ['launch-browser', 'create-context', 'create-page'].includes(result.step);
    result.status = unavailable ? 'engine-unavailable' : 'failed';
    result.failureStep = result.step;
    result[unavailable ? 'skipReason' : 'failure'] = `${result.step}: ${redact(error.message)}`;
    if (error.name === 'TimeoutError') result.timedOut = true;
  };
  const work = async () => {
    try {
      step('launch-browser');
      browser = await getBrowser();
      step('create-context');
      context = await withinLimit(() => browser.newContext({ viewport: viewport.viewport, isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch, userAgent: viewport.userAgent, serviceWorkers: 'block' }),
      timeouts.engine, () => 'create-context', signal);
      step('install-fixtures');
      context.setDefaultTimeout(timeouts.action);
      context.setDefaultNavigationTimeout(timeouts.action);
      const configurePage = newPage => {
        newPage.setDefaultTimeout(timeouts.action);
        newPage.setDefaultNavigationTimeout(timeouts.action);
      };
      context.on('page', configurePage);
      await context.exposeBinding('__walletParityReportCsp', (_source, violation) => result.cspViolations.push(violation));
      await context.addInitScript(installBrowserFixtures, { account: ACCOUNT,
        profile: scenario === 'walletconnect' ? 'multiple' : scenario === 'injected' ? 'single' : 'none' });
      // Capture every page/frame from the start, with no console/CSP allowlist.
      context.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(redact(message.text())); });
      context.on('weberror', error => result.pageErrors.push(redact(error.error().message)));
      step('install-network');
      await installNetwork(context, url, result);
      step('create-page');
      page = await withinLimit(() => context.newPage(), timeouts.engine, () => 'create-page', signal);
      configurePage(page);
      step('navigate');
      const response = await page.goto(`${url}/`, { waitUntil: 'load' });
      assert.equal(response.status(), 200, 'Surface did not load');
      assert.ok(response.headers()['content-security-policy'], 'Missing enforced CSP: this is not the release surface');
      if (surface === 'benefits') {
        assert.ok(response.headers()['content-security-policy-report-only'], 'Missing Benefits report-only CSP');
      }
      step('open-wallet-chooser');
      const buttons = await openChooser(page, surface);
      step('verify-wallet-options');
      await expect(buttons.filter({ hasText: /WalletConnect/ })).toBeVisible();
      if (scenario === 'walletconnect') await expect(buttons.filter({ hasText: /^Phantom$/ })).toBeVisible();
      for (const button of await buttons.all()) {
        await expect(button).toBeVisible();
        await expect(button).toBeEnabled();
      }
      result.options = (await buttons.allTextContents()).map(label => label.replace(/\s+/g, ' ').trim()).sort();
      assertOptions(result.options, surface, scenario);
      if (scenario === 'walletconnect') {
        step('select-walletconnect');
        await buttons.filter({ hasText: /WalletConnect/ }).click();
        step('wait-for-pairing');
        let pairing;
        await expect.poll(async () => {
          pairing = await page.evaluate(renderedPairing) || result.relayPairing;
          return Boolean(pairing);
        }, { timeout: timeouts.action, message: 'No SDK pairing URI or relay proposal' }).toBe(true);
        step('verify-pairing');
        result.pairing = pairing;
        // The DOM URI can precede publication while origin attestation falls
        // back. Wait for delivery rather than racing the SDK's async publish.
        await expect.poll(() => result.relayMethods.some(method => ['irn_publish', 'wc_proposeSession'].includes(method)),
          { timeout: timeouts.action, message: 'No real SDK pairing proposal' }).toBe(true);
        assert.ok(result.relayMethods.includes('irn_subscribe') || result.relayMethods.includes('irn_batchSubscribe'), 'No real SDK relay subscription');
      } else if (scenario === 'injected') {
        step('select-injected-wallet');
        await buttons.filter({ hasText: /MetaMask|Browser wallet/i }).click();
        step('verify-connected-account');
        const connected = page.locator(surface === 'web3' ? '[data-wallet-address]' : '[data-wallet-connect-control]').first();
        await expect(connected).toContainText(/0x71c7\.\.\.976f/i);
        await expect(page.locator(surface === 'web3' ? '[data-wallet-header-disconnect]' : '[data-wallet-connect-control] button').filter({ hasText: /^Disconnect$/ })).toBeVisible();
        const provider = await page.evaluate(() => window.__walletParity);
        assert.equal(provider.authorized, true, 'UI did not request account access');
        assert.ok(provider.requests.some(request => request.method === 'eth_chainId'), 'Provider chain was never read');
        assert.ok(!provider.requests.some(request => /sign|sendTransaction|switchEthereumChain/i.test(request.method)), 'Unexpected signing/write/network-switch request');
        result.connectedAccount = SHORT_ACCOUNT;
      }
      // Catch asynchronous errors just after UI success (including report-only CSP).
      step('observe-asynchronous-errors');
      await page.waitForTimeout(1500);
    } catch (error) { if (!stopped) fail(error); }
    // Collection is inside the case deadline: frame.evaluate has no timeout.
    if (!result.timedOut) {
      step('collect-frame-csp');
      if (page) for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        try {
          for (const violation of await frame.evaluate(() => window.__walletParity?.violations || [])) {
            if (!result.cspViolations.some(existing => JSON.stringify(existing) === JSON.stringify(violation))) result.cspViolations.push(violation);
          }
        }
        catch (error) { result.pageErrors.push(`Could not collect frame CSP: ${redact(error.message)}`); }
      }
    }
    if (!result.failure && !result.skipReason) result.status = 'passed';
  };
  try {
    await withinLimit(work, timeouts.case, () => `Case step ${result.step}`, signal);
  } catch (error) { fail(error); }
  finally {
    // Stop late continuations before they can start another step after a timeout.
    stopped = true;
    const close = async (resource, name) => withinLimit(() => resource.close(), timeouts.cleanup, () => name);
    if (result.timedOut || result.status === 'engine-unavailable') {
      result.browserClosed = true;
      const closed = await Promise.allSettled([
        ...(context ? [close(context, 'close-context')] : []),
        ...(browser ? [close(browser, 'close-browser')] : []),
      ]);
      for (const outcome of closed) if (outcome.status === 'rejected') result.pageErrors.push(`Cleanup: ${redact(outcome.reason.message)}`);
    } else if (context) {
      try { await close(context, 'close-context'); }
      catch (error) {
        result.pageErrors.push(`Cleanup: ${redact(error.message)}`);
        if (!result.failure) { result.step = 'close-context'; fail(error); }
        result.browserClosed = true;
        try { await close(browser, 'close-browser'); }
        catch (closeError) { result.pageErrors.push(`Cleanup: ${redact(closeError.message)}`); }
      }
    }
  }
  if (result.status !== 'engine-unavailable'
    && [result.consoleErrors, result.pageErrors, result.cspViolations, result.networkErrors].some(items => items.length)) result.status = 'failed';
  return structuredClone(result);
}

function compareEngines(cases) {
  for (const surface of ['web3', 'benefits']) for (const viewport of VIEWPORTS) for (const scenario of SCENARIOS) {
    const pair = cases.filter(result => result.surface === surface && result.viewport === viewport.name && result.scenario === scenario);
    assert.equal(pair.length, 2, `Missing engine result: ${surface}/${viewport.name}/${scenario}`);
    assert.deepEqual(pair[0].options, pair[1].options, `Wallet options differ: ${surface}/${viewport.name}/${scenario}`);
  }
}

async function main(options, {
  browserTypes = BROWSER_TYPES, serverFactories = { web3: startWeb3Server, benefits: startBenefitsServer },
  reportFile = REPORT, timeouts = TIMEOUTS, hardExit = code => process.exit(code), log = console.log,
} = {}) {
  const report = { audit: 'JUL-11', startedAt: new Date().toISOString(), plannedCases: options.only ? 3 : 24, status: 'blocked',
    mockNetwork: true, filter: options.only, headed: options.headed, timeouts,
    engineComparison: options.only ? 'not-run-filtered' : 'pending', cases: [], unavailableEngines: [], infrastructureErrors: [] };
  const browsers = [];
  const servers = new Map();
  const resources = new Set();
  const unavailableBrowsers = new Set();
  const controller = new AbortController();
  const { signal } = controller;
  let activeCase;
  let activeStarted;
  let hardStop;
  let cleanupTimedOut = false;
  const printedCases = new Set();
  const progress = result => {
    const name = `${result.engine}/${result.viewport}/${result.surface}/${result.scenario}`;
    if (printedCases.has(name)) return;
    printedCases.add(name);
    const reason = result.failure || result.skipReason;
    log(`[wallet-parity] ${result.status.toUpperCase()} ${name} (${result.elapsedMs} ms)${reason ? `; ${reason.replace(/\s+/g, ' ')}` : ''}`);
  };
  const unavailable = (engine, step, reason) => {
    report.unavailableEngines.push({ engine, step, reason });
    report.infrastructureErrors.push({ engine, status: 'engine-unavailable', error: reason });
    for (const viewport of VIEWPORTS) for (const surface of SURFACES) for (const scenario of SCENARIOS) {
      if (options.only && (options.only.viewport !== viewport.name || options.only.surface !== surface)) continue;
      if (report.cases.some(result => result.engine === engine && result.viewport === viewport.name
        && result.surface === surface && result.scenario === scenario)) continue;
      const result = { ...caseResult(engine, viewport, surface, scenario), status: 'engine-unavailable',
        step, skipReason: reason, elapsedMs: 0 };
      report.cases.push(result);
      progress(result);
    }
    writeReport(report, reportFile);
  };
  writeReport(report, reportFile);
  const globalTimer = setTimeout(() => {
    const error = new DeadlineError(`Global timeout after ${timeouts.global} ms`);
    report.status = 'failed';
    report.infrastructureErrors.push({ error: error.message });
    if (activeCase) Object.assign(activeCase, { status: 'failed', timedOut: true,
      elapsedMs: Date.now() - activeStarted, failureStep: activeCase.step, failure: `${activeCase.step}: ${error.message}` });
    // Persist before cleanup, even when the protocol connection cannot close.
    writeReport(report, reportFile);
    if (activeCase) progress(activeCase);
    hardStop = setTimeout(() => hardExit(1), timeouts.cleanup);
    controller.abort(error);
  }, timeouts.global);
  const acquire = async (factory, name, timeout) => {
    let settled = false;
    try {
      return await withinLimit(async () => {
        const resource = await factory();
        if (settled || signal.aborted) {
          // A launch may resolve after its deadline; never retain that browser.
          void withinLimit(() => resource.close(), timeouts.cleanup, () => `Late ${name} cleanup`).catch(() => {});
          throw signal.reason || new DeadlineError(`${name} already timed out`);
        }
        resources.add(resource);
        return resource;
      }, timeout, () => name, signal);
    } finally { settled = true; }
  };
  const launch = (type, engine) => acquire(() => type.launch({ headless: !options.headed, timeout: timeouts.engine }),
    `Launch ${engine}`, timeouts.engine);
  try {
    for (const [engine, type] of Object.entries(browserTypes)) {
      if (options.only && options.only.engine !== engine) continue;
      try { browsers.push({ engine, type, browser: await launch(type, engine) }); }
      catch (error) {
        signal.throwIfAborted();
        unavailable(engine, 'launch-browser', `Launch ${engine}: ${redact(error.message)}`);
      }
    }
    for (const surface of SURFACES) {
      if (browsers.length === 0) break;
      if (options.only && options.only.surface !== surface) continue;
      servers.set(surface, await acquire(serverFactories[surface], `Start ${surface} server`, 30000));
    }
    engineLoop: for (const entry of browsers) {
      for (const viewport of VIEWPORTS) {
        if (options.only && options.only.viewport !== viewport.name) continue;
        const { engine, type } = entry;
        for (const surface of SURFACES) for (const scenario of SCENARIOS) {
          if (options.only && options.only.surface !== surface) continue;
          signal.throwIfAborted();
          activeCase = caseResult(engine, viewport, surface, scenario);
          const index = report.cases.push(activeCase) - 1;
          const started = Date.now();
          activeStarted = started;
          const result = await runCase(async () => {
            entry.browser ??= await launch(type, engine);
            return entry.browser;
          }, engine, viewport, surface, servers.get(surface).url, scenario, { result: activeCase, signal, timeouts });
          result.elapsedMs = Date.now() - started;
          report.cases[index] = result;
          activeCase = null;
          if (result.status === 'engine-unavailable') {
            unavailableBrowsers.add(entry.browser);
            progress(result);
            unavailable(engine, result.failureStep, result.skipReason);
            continue engineLoop;
          }
          if (result.browserClosed) entry.browser = null;
          writeReport(report, reportFile);
          progress(result);
        }
      }
    }
    signal.throwIfAborted();
    if (!options.only) {
      if (report.unavailableEngines.length) report.engineComparison = 'not-run-engine-unavailable';
      else { compareEngines(report.cases); report.engineComparison = 'passed'; }
    }
    const incomplete = report.cases.length !== report.plannedCases
      || report.cases.some(result => !['passed', 'engine-unavailable'].includes(result.status))
      || report.infrastructureErrors.some(entry => entry.status !== 'engine-unavailable');
    report.status = incomplete ? 'failed' : report.unavailableEngines.length ? 'partial' : 'passed';
    if (report.unavailableEngines.length) {
      report.partialReason = report.unavailableEngines.map(({ engine, reason }) => `${engine}: ${reason}`).join('; ');
    }
  } catch (error) {
    if (report.cases.length) report.status = 'failed';
    const message = redact(error.message);
    if (!report.infrastructureErrors.some(entry => entry.error === message)) report.infrastructureErrors.push({ error: message });
  } finally {
    const cleanupResources = [...resources].reverse();
    const closed = await Promise.allSettled(cleanupResources.map(resource =>
      withinLimit(() => resource.close(), timeouts.cleanup, () => 'Resource cleanup')));
    for (const [index, outcome] of closed.entries()) if (outcome.status === 'rejected') {
      cleanupTimedOut ||= outcome.reason.name === 'TimeoutError';
      const engineUnavailable = unavailableBrowsers.has(cleanupResources[index]);
      if (!engineUnavailable) report.status = 'failed';
      report.infrastructureErrors.push({ ...(engineUnavailable ? { status: 'engine-unavailable' } : {}),
        error: `Cleanup: ${redact(outcome.reason.message)}` });
    }
    report.finishedAt = new Date().toISOString();
    writeReport(report, reportFile);
    clearTimeout(globalTimer);
    clearTimeout(hardStop);
    const skipped = report.cases.filter(result => result.status === 'engine-unavailable').length;
    log(`[wallet-parity] ${report.status.toUpperCase()} ${report.cases.filter(result => result.status === 'passed').length}/${report.plannedCases}${skipped ? `; ${skipped} engine-unavailable` : ''}${options.only ? ' (filtered; engine comparison not run)' : ''}; ${path.relative(ROOT, reportFile)}`);
    for (const failure of report.infrastructureErrors) console.error(redact(failure.error));
    // Bound process lifetime even if an interrupted protocol promise stays live.
    if (signal.aborted || cleanupTimedOut) hardExit(1);
  }
  return report;
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) {
  // Browser-free checks of the offline boundary and fail-closed comparison.
  assert.deepEqual(parseArgs(['--headed', '--only', 'webkit:mobile:benefits']), {
    headed: true, selfTest: false, only: { engine: 'webkit', viewport: 'mobile', surface: 'benefits' },
  });
  for (const value of ['', 'firefox:mobile:web3', 'chromium:tablet:web3', 'webkit:mobile:unknown', 'webkit:mobile:web3:extra']) {
    assert.throws(() => parseArgs(['--only', value]), /Expected --only/);
  }
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
  assert.equal(rpcResult('eth_chainId'), '0x1');
  assert.throws(() => rpcResult('eth_sendTransaction'), /Unimplemented/);
  assert.throws(() => rpcResult('personal_sign'), /Unimplemented/);
  assert.equal(relayResult({ method: 'irn_publish' }), true);
  assert.equal(relayResult({ method: 'wc_proposeSession' }), true);
  assert.match(relayResult({ method: 'irn_subscribe', params: { topic: 'test' } }), /^[a-f0-9]{64}$/);
  assert.throws(() => relayResult({ method: 'wc_sessionApprove' }), /Unimplemented/);
  assert.throws(() => compareEngines([]), /Missing engine/);
  assert.throws(() => assertOptions(['Coinbase Wallet'], 'benefits', 'no-provider'), /WalletConnect missing/);
  assert.throws(() => assertOptions(['WalletConnect', 'MetaMask'], 'web3', 'walletconnect'), /Phantom/);
  assert.equal(redact('wc:topic@2?symKey=fixture'), 'wc:[redacted]');
  // Run the exact page callback against nested open shadow roots, including a
  // copy-button property that is not reflected to a DOM attribute.
  const pairingUri = `wc:${'a'.repeat(64)}@2?symKey=${'b'.repeat(64)}&relay-protocol=irn`;
  const element = (localName, values = {}) => ({
    localName, attributes: [], getRootNode: () => ({}),
    getBoundingClientRect: () => ({ width: 40, height: 40 }), ...values,
  });
  const copy = element('wui-link', { value: pairingUri });
  const qr = element('w3m-qrcode', { attributes: [{ name: 'data-uri', value: pairingUri }] });
  const inner = element('w3m-connecting-wc-view');
  const modal = element('w3m-modal');
  inner.shadowRoot = { host: inner, querySelectorAll: () => [copy] };
  modal.shadowRoot = { host: modal, querySelectorAll: () => [inner] };
  copy.getRootNode = () => inner.shadowRoot;
  inner.getRootNode = () => modal.shadowRoot;
  const dom = { document: { querySelectorAll: () => [modal] }, URL,
    getComputedStyle: node => ({ display: node.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) };
  const detect = () => runInNewContext(`(${renderedPairing})()`, dom);
  assert.equal(detect().kind, 'uri-element');
  modal.hidden = true;
  assert.equal(detect(), false);
  modal.hidden = false;
  inner.shadowRoot.querySelectorAll = () => [qr];
  assert.equal(detect().kind, 'qr');
  inner.shadowRoot.querySelectorAll = () => [element('a', { href: `https://wallet.invalid/wc?uri=${encodeURIComponent(pairingUri)}` })];
  assert.equal(detect().version, 2);
  inner.shadowRoot.querySelectorAll = () => [element('button', { value: 'wc:', textContent: pairingUri })];
  assert.equal(detect(), false);
  const cases = [];
  for (const engine of ['chromium', 'webkit']) for (const surface of ['web3', 'benefits']) {
    for (const viewport of VIEWPORTS) for (const scenario of SCENARIOS) {
      cases.push({ engine, surface, viewport: viewport.name, scenario, options: ['WalletConnect'] });
    }
  }
  compareEngines(cases);
  cases.at(-1).options.push('Different wallet');
  assert.throws(() => compareEngines(cases), /Wallet options differ/);
  // Exercise routing without sockets: unknown hosts and write calls must abort.
  let routeHandler;
  let socketHandler;
  const network = { networkErrors: [], vendorRequests: [], relayMethods: [] };
  await installNetwork({
    route: async (_pattern, handler) => { routeHandler = handler; },
    routeWebSocket: async (_pattern, handler) => { socketHandler = handler; },
  }, 'http://127.0.0.1:1234', network);
  const request = async (url, payload, overrides = {}) => {
    let response;
    await routeHandler({
      request: () => ({ url: () => url, method: () => payload ? 'POST' : 'GET', postDataJSON: () => payload }),
      fulfill: async value => { response = value; },
      abort: async () => { response = 'aborted'; },
      ...overrides,
    });
    return response;
  };
  const read = await request('https://ethereum-rpc.publicnode.com', [{ id: 1, method: 'eth_chainId' }]);
  assert.deepEqual(JSON.parse(read.body), [{ jsonrpc: '2.0', id: 1, result: '0x1' }]);
  const analytics = await request('https://api.web3modal.org/getAnalyticsConfig?projectId=fixture');
  assert.deepEqual(JSON.parse(analytics.body), { isAnalyticsEnabled: false });
  const verification = await request('https://verify.walletconnect.org/v3/attestation?projectId=fixture&id=fixture');
  assert.equal(verification.status, 200);
  assert.equal(verification.contentType, 'text/html');
  for (const extension of ['woff2', 'woff']) {
    const font = await request(`https://fonts.reown.com/KHTeka-Regular.${extension}`);
    assert.equal(font.status, 200);
    assert.equal(font.body.subarray(0, 4).toString(), 'wOF2');
    assert.equal(font.headers['access-control-allow-origin'], '*');
  }
  assert.deepEqual(network.networkErrors, []);
  assert.equal(await request('https://ethereum-rpc.publicnode.com', { id: 2, method: 'eth_sendTransaction' }), 'aborted');
  assert.equal(await request('https://unlisted.invalid/'), 'aborted');
  assert.equal(await request('not a URL'), 'aborted');
  const localResponse = { fixture: true };
  const local = await request('http://127.0.0.1:1234/assets/app.js', null, { fetch: async value => {
    assert.equal(value.timeout, TIMEOUTS.action);
    assert.equal(value.maxRedirects, 0);
    return localResponse;
  } });
  assert.deepEqual(local, { response: localResponse });
  assert.equal(await request('https://api.web3modal.org/getWallets', null, {
    fulfill: async () => { throw new Error('Fixture fulfill rejection'); },
  }), 'aborted');
  assert.ok(network.networkErrors.includes('Fixture fulfill rejection'));
  assert.equal(await request('https://api.web3modal.org/unmatched?projectId=fixture'), 'aborted');
  assert.ok(network.networkErrors.at(-1).endsWith('/unmatched?projectId=[redacted]'));
  let onMessage;
  let reply;
  socketHandler({ url: () => 'wss://relay.walletconnect.org', onMessage: handler => { onMessage = handler; }, send: value => { reply = JSON.parse(value); } });
  onMessage(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'irn_publish', params: { topic: 'a'.repeat(64) } }));
  assert.deepEqual(reply, { jsonrpc: '2.0', id: 3, result: true });
  assert.equal(network.relayPairing.topic, 'a'.repeat(64));
  delete network.relayPairing;
  onMessage(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'wc_proposeSession', params: { pairingTopic: 'c'.repeat(64) } }));
  assert.deepEqual(reply, { jsonrpc: '2.0', id: 4, result: true });
  assert.equal(network.relayPairing.method, 'wc_proposeSession');
  assert.equal(network.relayPairing.topic, 'c'.repeat(64));
  delete network.relayPairing;
  onMessage(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'irn_subscribe', params: { topic: 'a'.repeat(64) } }));
  assert.equal(network.relayPairing, undefined); // Subscription alone is not a proposal.
  onMessage(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'wc_proposeSession', params: { pairingTopic: 'invalid' } }));
  assert.equal(network.relayPairing, undefined);
  let socketClosed = false;
  socketHandler({ url: () => 'wss://unlisted.invalid/', close: () => { socketClosed = true; } });
  assert.ok(socketClosed);

  // Reproduce hung protocol calls without requiring a browser or loopback bind.
  const never = () => new Promise(() => {});
  const makeBrowser = ({ hangAt = '', onContext = () => {} } = {}) => {
    const calls = { contextClosed: 0, browserClosed: 0, pages: 0, pageTimeouts: [], navigationTimeouts: [] };
    const makePage = () => ({
      setDefaultTimeout: value => calls.pageTimeouts.push(value),
      setDefaultNavigationTimeout: value => calls.navigationTimeouts.push(value),
      goto: hangAt === 'navigate' ? never : async () => { throw new Error('Controlled navigation failure'); },
      frames: () => hangAt === 'collect-frame-csp' ? [{ isDetached: () => false, evaluate: never }] : [],
    });
    const handlers = new Map();
    const context = {
      setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {},
      exposeBinding: async () => {}, addInitScript: async () => {}, route: async () => {}, routeWebSocket: async () => {},
      on: (event, handler) => handlers.set(event, handler),
      newPage: async () => {
        calls.pages++;
        if (hangAt === 'create-page') return never();
        if (hangAt === 'create-page-error') throw new Error('Engine failed to create page');
        handlers.get('page')(makePage()); // A popup receives the same defaults.
        return makePage();
      },
      close: async () => { calls.contextClosed++; if (hangAt === 'close-context') await never(); },
    };
    return { calls, newContext: async () => { onContext(); return hangAt === 'create-context' ? never() : context; },
      close: async () => { calls.browserClosed++; } };
  };
  const fastTimeouts = { action: 15, engine: 15, case: 30, global: 2000, cleanup: 10 };
  for (const hangAt of ['create-context', 'create-page', 'navigate', 'collect-frame-csp', 'close-context']) {
    const browser = makeBrowser({ hangAt });
    const result = await runCase(async () => browser, 'chromium', VIEWPORTS[0], 'web3', 'http://fixture', 'no-provider', { timeouts: fastTimeouts });
    assert.equal(result.status, ['create-context', 'create-page'].includes(hangAt) ? 'engine-unavailable' : 'failed');
    assert.equal(result.browserClosed, true);
    assert.ok(browser.calls.browserClosed > 0);
    if (hangAt !== 'create-context') {
      assert.ok(browser.calls.contextClosed > 0);
      const expectedTimeouts = hangAt === 'create-page' ? [] : [15, 15];
      assert.deepEqual(browser.calls.pageTimeouts, expectedTimeouts);
      assert.deepEqual(browser.calls.navigationTimeouts, expectedTimeouts);
    }
    if (hangAt !== 'close-context') {
      assert.equal(result.timedOut, true);
      assert.equal(result.failureStep, hangAt);
      assert.match(result.failure || result.skipReason, /timed out/);
    } else assert.ok(result.pageErrors.some(error => error.includes('close-context timed out')));
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), 'wallet-parity-self-test-'));
  try {
    const reportFile = path.join(temp, 'report.json');
    const filter = parseArgs(['--only', 'chromium:desktop:web3', '--headed']);
    const launches = [];
    const progress = [];
    let contextCount = 0;
    const report = await main(filter, {
      reportFile, timeouts: fastTimeouts, log: line => progress.push(line),
      browserTypes: { chromium: { launch: async launchOptions => {
        assert.equal(launchOptions.headless, false);
        const browser = makeBrowser({ hangAt: launches.length === 0 ? 'navigate' : '', onContext: () => {
          const saved = JSON.parse(readFileSync(reportFile, 'utf8'));
          assert.equal(saved.cases.length, contextCount++);
          if (saved.cases.length) assert.equal(saved.cases[0].failureStep, 'navigate');
        } });
        launches.push(browser);
        return browser;
      } } },
      serverFactories: { web3: async () => ({ url: 'http://fixture', close: async () => {} }) },
    });
    assert.equal(report.plannedCases, 3);
    assert.equal(report.cases.length, 3); // A timeout must not skip subsequent cases.
    assert.equal(contextCount, 3);
    assert.equal(launches.length, 2); // Relaunch the browser closed by the timeout.
    assert.equal(report.cases[0].timedOut, true);
    assert.equal(report.cases[1].timedOut, undefined);
    assert.equal(report.engineComparison, 'not-run-filtered');
    assert.equal(progress.length, 4); // One result per case plus the final summary.
    assert.deepEqual(JSON.parse(await readFile(reportFile, 'utf8')), report);

    assert.equal(TIMEOUTS.engine, 20000);
    const webkitFilter = parseArgs(['--only', 'webkit:mobile:benefits']);
    for (const hangAt of ['create-context', 'create-page', 'create-page-error']) {
      let launches = 0;
      const engine = makeBrowser({ hangAt });
      const skipped = await main(webkitFilter, {
        reportFile, timeouts: fastTimeouts, log: () => {},
        browserTypes: { webkit: { launch: async () => { launches++; return engine; } } },
        serverFactories: { benefits: async () => ({ url: 'http://fixture', close: async () => {} }) },
      });
      assert.equal(skipped.status, 'partial');
      assert.equal(skipped.cases.length, 3);
      assert.ok(skipped.cases.every(result => result.status === 'engine-unavailable' && result.skipReason && !result.failure));
      assert.equal(skipped.unavailableEngines.length, 1);
      assert.match(skipped.partialReason, /webkit: (create-context|create-page):/);
      assert.equal(launches, 1);
      assert.equal(engine.calls.pages, hangAt === 'create-context' ? 0 : 1);
      assert.deepEqual(JSON.parse(await readFile(reportFile, 'utf8')), skipped);
    }

    // A rejected launch and a hung launch each skip their complete matrix;
    // no server is needed if neither engine can run.
    let serverStarts = 0;
    const launchFailures = await main(parseArgs([]), {
      reportFile, timeouts: fastTimeouts, log: () => {},
      browserTypes: {
        chromium: { launch: async () => { throw new Error('Engine binary unavailable'); } },
        webkit: { launch: launchOptions => { assert.equal(launchOptions.timeout, fastTimeouts.engine); return never(); } },
      },
      serverFactories: { web3: async () => { serverStarts++; throw new Error('Must not start'); } },
    });
    assert.equal(launchFailures.status, 'partial');
    assert.equal(launchFailures.cases.length, 24);
    assert.ok(launchFailures.cases.every(result => result.status === 'engine-unavailable'));
    assert.equal(launchFailures.engineComparison, 'not-run-engine-unavailable');
    assert.equal(launchFailures.unavailableEngines.length, 2);
    assert.equal(serverStarts, 0);

    // Do not revisit the unusable engine or suppress real failures in the
    // remaining engine. All twelve cases of the next engine must still run.
    const badEngine = makeBrowser({ hangAt: 'create-page' });
    const nextEngine = makeBrowser();
    const continued = await main(parseArgs([]), {
      reportFile, timeouts: fastTimeouts, log: () => {},
      browserTypes: { webkit: { launch: async () => badEngine }, chromium: { launch: async () => nextEngine } },
      serverFactories: Object.fromEntries(SURFACES.map(surface => [surface, async () => ({ url: 'http://fixture', close: async () => {} })])),
    });
    assert.equal(continued.status, 'failed');
    assert.equal(continued.cases.length, 24);
    assert.equal(continued.cases.filter(result => result.status === 'engine-unavailable').length, 12);
    assert.equal(continued.cases.filter(result => result.status === 'failed').length, 12);
    assert.equal(badEngine.calls.pages, 1);
    assert.equal(nextEngine.calls.pages, 12);

    // A late launch must be closed rather than added after report/cleanup.
    let finishLaunch;
    const lateBrowser = makeBrowser();
    const late = await main(filter, {
      reportFile, timeouts: fastTimeouts, log: () => {},
      browserTypes: { chromium: { launch: () => new Promise(resolve => { finishLaunch = resolve; }) } },
    });
    assert.equal(late.status, 'partial');
    finishLaunch(lateBrowser);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lateBrowser.calls.browserClosed, 1);

    let exits = 0;
    const browser = makeBrowser({ hangAt: 'navigate' });
    const global = await main(filter, {
      reportFile, timeouts: { ...fastTimeouts, action: 1000, case: 1000, global: 30 },
      log: () => {}, hardExit: code => { assert.equal(code, 1); exits++; },
      browserTypes: { chromium: { launch: async () => browser } },
      serverFactories: { web3: async () => ({ url: 'http://fixture', close: async () => {} }) },
    });
    assert.equal(exits, 1);
    assert.equal(global.status, 'failed');
    assert.equal(global.cases.length, 1);
    assert.equal(global.cases[0].failureStep, 'navigate');
    assert.match(global.cases[0].failure, /Global timeout/);
    assert.ok(browser.calls.browserClosed > 0 && browser.calls.contextClosed > 0);
    assert.deepEqual(JSON.parse(await readFile(reportFile, 'utf8')), global);
  } finally { await rm(temp, { recursive: true, force: true }); }
  console.log('[wallet-parity] PASS browser-free fixture/boundary self-test (not browser parity evidence)');
} else {
  const report = await main(options);
  if (report.status !== 'passed') process.exitCode = 1;
}
