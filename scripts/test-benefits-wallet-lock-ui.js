#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const { ethers } = require('ethers');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_WALLET_UI_PORT || 3211);
const origin = `http://127.0.0.1:${port}`;
const wallet = '0x3333333333333333333333333333333333333333';
const token = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const lock = '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb';
const commitment = '0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3';
const decimals = 9n;
const unit = 10n ** decimals;
const amount = 1000n * unit;
const zeroEthOnly = process.env.BENEFITS_WALLET_ZERO_ETH_ONLY === '1';
const wrongChainOnly = process.env.BENEFITS_WALLET_WRONG_CHAIN_ONLY === '1';
const readFailureOnly = process.env.BENEFITS_WALLET_READ_FAILURE_ONLY === '1';
const reconnectOnly = process.env.BENEFITS_WALLET_RECONNECT_ONLY === '1';
const restorationCase = process.env.BENEFITS_WALLET_RESTORATION_CASE;
const selectors = {
  approve: ethers.id('approve(address,uint256)').slice(0, 10),
  balanceOf: ethers.id('balanceOf(address)').slice(0, 10),
  allowance: ethers.id('allowance(address,address)').slice(0, 10),
  lockedBalance: ethers.id('lockedBalance(address)').slice(0, 10),
  lock: ethers.id('lock(uint256)').slice(0, 10),
  unlock: ethers.id('unlock()').slice(0, 10),
  getEthBalance: ethers.id('getEthBalance(address)').slice(0, 10),
  token: ethers.id('token()').slice(0, 10),
  ifrToken: ethers.id('ifrToken()').slice(0, 10),
  getTranches: ethers.id('getTranches(address)').slice(0, 10),
};
const multicallAddress = '0xca11bde05977b3631167028862be2a173976ca11';
const multicall = new ethers.Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
]);
const coder = ethers.AbiCoder.defaultAbiCoder();

function encodeUint(value) {
  return coder.encode(['uint256'], [value.toString()]);
}

function decodeAmount(data) {
  return BigInt(`0x${data.slice(-64)}`);
}

function callResult(state, target, data) {
  const normalizedTarget = String(target).toLowerCase();
  const selector = String(data).slice(0, 10).toLowerCase();
  state.readCalls.push({ target: normalizedTarget, selector });
  if ((normalizedTarget === lock.toLowerCase() && selector === selectors.token) || (normalizedTarget === commitment.toLowerCase() && selector === selectors.ifrToken)) return coder.encode(['address'], [token]);
  if (normalizedTarget === commitment.toLowerCase() && selector === selectors.getTranches) return coder.encode(['tuple(uint256,uint8,uint256,uint256,bool,uint256)[]'], [state.commitment > 0n ? [[state.commitment, 0, 0, 1_000, false, 0]] : []]);
  if (normalizedTarget === token.toLowerCase() && selector === selectors.balanceOf) return encodeUint(state.ifr);
  if (normalizedTarget === token.toLowerCase() && selector === selectors.allowance) return encodeUint(state.allowance);
  if (normalizedTarget === lock.toLowerCase() && selector === selectors.lockedBalance) return encodeUint(state.locked);
  if (normalizedTarget === multicallAddress && selector === selectors.getEthBalance) return encodeUint(state.eth);
  return encodeUint(0n);
}

function rpcResult(payload, state) {
  const method = payload.method;
  if (method === 'eth_chainId') return '0x1';
  if (method === 'net_version') return '1';
  if (method === 'eth_blockNumber') return '0x10';
  if (method === 'eth_getBalance') return `0x${state.eth.toString(16)}`;
  if (method === 'eth_getCode') return '0x01';
  if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
  if (method === 'eth_call') {
    const call = payload.params?.[0] || {};
    const data = call.data || '0x';
    if (data.startsWith(multicall.getFunction('aggregate3').selector)) {
      const decoded = multicall.decodeFunctionData('aggregate3', data);
      return multicall.encodeFunctionResult('aggregate3', [
        decoded.calls.map((item) => [true, callResult(state, item.target, item.callData)]),
      ]);
    }
    return callResult(state, call.to, data);
  }
  if (method === 'eth_getTransactionReceipt') {
    const hash = payload.params?.[0];
    const transaction = state.transactions.find((item) => item.hash === hash);
    if (!transaction) return null;
    return {
      blockHash: `0x${'ab'.repeat(32)}`,
      blockNumber: '0x10',
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
      from: wallet,
      gasUsed: '0x5208',
      logs: [],
      logsBloom: `0x${'00'.repeat(256)}`,
      status: '0x1',
      to: transaction.to,
      transactionHash: hash,
      transactionIndex: '0x0',
      type: '0x2',
    };
  }
  if (method === 'eth_getTransactionByHash') return null;
  throw new Error(`Unexpected public RPC method: ${method}`);
}

function applyTransaction(state, transaction) {
  const to = String(transaction.to || '').toLowerCase();
  const data = String(transaction.data || '0x').toLowerCase();
  let action;
  let rawAmount = 0n;

  if (to === token.toLowerCase() && data.startsWith(selectors.approve)) {
    const spender = `0x${data.slice(34, 74)}`;
    assert.equal(spender.toLowerCase(), lock.toLowerCase(), 'approval spender must be IFRLock');
    rawAmount = decodeAmount(data);
    assert.equal(rawAmount, amount, 'approval must preserve IFR 9-decimal amount');
    state.allowance = rawAmount;
    action = 'approve';
  } else if (to === lock.toLowerCase() && data.startsWith(selectors.lock)) {
    rawAmount = decodeAmount(data);
    assert.equal(rawAmount, amount, 'lock must preserve IFR 9-decimal amount');
    assert.ok(state.ifr >= rawAmount, 'lock cannot exceed unlocked IFR');
    assert.ok(state.allowance >= rawAmount, 'lock cannot exceed allowance');
    state.ifr -= rawAmount;
    state.allowance -= rawAmount;
    state.locked += rawAmount;
    action = 'lock';
  } else if (to === lock.toLowerCase() && data.startsWith(selectors.unlock)) {
    rawAmount = state.locked;
    state.ifr += state.locked;
    state.locked = 0n;
    action = 'unlock';
  } else {
    throw new Error(`Unexpected wallet transaction: ${transaction.to} ${transaction.data}`);
  }

  const hash = `0x${String(state.transactions.length + 1).padStart(64, '0')}`;
  state.transactions.push({ action, amount: rawAmount.toString(), hash, to: transaction.to });
  return hash;
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before startup (${child.exitCode})`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for Benefits frontend');
}

// Runs the real app in a fresh synthetic-only browser context. Unlike the normal
// local-server fixture, this can bind the currently admitted public static build
// without requiring another dependency install/build. Every nonstatic request is
// handled or rejected before navigation; no real wallet/provider is loaded.
async function runInjectedRestorationControls() {
  const { pathToFileURL } = require('node:url');
  const { startInjectedSessionRestoration, cancelInjectedSessionRestoration } = await import(
    pathToFileURL(path.join(frontend, 'src/lib/injectedSessionRestoration.mjs')).href);
  // This exact installed action has no transitive imports. Exercise real pinned
  // Core state commits, not a fake reconnect implementation or a complete npm install.
  const { reconnect } = await import(pathToFileURL(path.join(frontend, 'node_modules/wagmi/node_modules/@wagmi/core/dist/esm/actions/reconnect.js')).href);
  const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (predicate) => {
    for (let count = 0; count < 100; count += 1) {
      if (predicate()) return;
      await tick();
    }
    assert.fail('restoration control did not settle');
  };
  const results = [];
  function fixture({ marker = 'io.metamask', shim = false, denied = false, ready = true, available = true } = {}) {
    const methods = [];
    const storage = new Map([['recentConnectorId', marker], ['io.metamask.disconnected', shim], ['injected.connected', true]]);
    const watchers = new Set();
    const listeners = new Map();
    let connectorChanged = () => {};
    let state = { status: 'disconnected', current: null, connections: new Map(), chainId: 1 };
    let accountReady = ready;
    let account = wallet;
    let holdMethod;
    let release;
    const provider = {
      on: (event, listener) => listeners.set(event, new Set([...(listeners.get(event) || []), listener])),
      removeListener: (event, listener) => listeners.get(event)?.delete(listener),
      async request({ method }) {
        methods.push(method);
        if (method === holdMethod) await new Promise((resolve) => { release = resolve; });
        if (method === 'eth_accounts') return accountReady ? [account] : [];
        if (method === 'eth_chainId') return '0x1';
        throw new Error('Prompting/mutating method reached synthetic control');
      },
    };
    const emitterListeners = new Map();
    const emitter = {
      on: (event, listener) => emitterListeners.set(event, new Set([...(emitterListeners.get(event) || []), listener])),
      off: (event, listener) => emitterListeners.get(event)?.delete(listener),
      emit: (event, value) => { for (const listener of emitterListeners.get(event) || []) listener(value); },
    };
    const connector = { id: 'io.metamask', uid: 'synthetic-metamask', name: 'MetaMask', type: 'injected', emitter,
      getProvider: async () => provider,
      getAccounts: () => provider.request({ method: 'eth_accounts' }),
      getChainId: async () => Number(await provider.request({ method: 'eth_chainId' })),
      isAuthorized: async () => (await provider.request({ method: 'eth_accounts' })).length > 0,
      connect: async () => { throw new Error('Native permission/consent-writing connect must not be used'); },
    };
    const config = {
      connectors: available ? [connector] : [],
      get state() { return state; },
      setState(value) {
        const previous = state;
        state = typeof value === 'function' ? value(state) : value;
        for (const { selector, listener } of watchers) {
          if (selector(previous) !== selector(state)) listener(selector(state));
        }
      },
      storage: { getItem: async (key) => { if (denied) throw new Error('Synthetic storage denied'); return storage.get(key); } },
      subscribe(selector, listener) { const entry = { selector, listener }; watchers.add(entry); return () => watchers.delete(entry); },
      _internal: { events: { connect() {}, change() {}, disconnect() {
        config.setState({ ...state, status: 'disconnected', current: null, connections: new Map() });
      } } },
    };
    const browser = new EventTarget();
    const stop = startInjectedSessionRestoration(config, { reconnect, browser,
      watchConnectors: (_config, { onChange }) => { connectorChanged = onChange; return () => { connectorChanged = () => {}; }; } });
    return { config, storage, methods, stop, browser, provider, connector,
      ready: (value) => { accountReady = value; },
      account: (value) => { account = value; },
      expose: () => { config.connectors = [connector]; connectorChanged(); browser.dispatchEvent(new Event('ethereum#initialized')); },
      emit: (event) => { for (const listener of [...(listeners.get(event) || [])]) listener(); },
      hold: (method) => { holdMethod = method; },
      pending: () => Boolean(release),
      release: () => { holdMethod = undefined; release?.(); release = undefined; },
      cancel: () => cancelInjectedSessionRestoration(config),
    };
  }
  const check = async (name, options, run) => {
    const f = fixture(options);
    try {
      await run(f);
      assert.equal(f.methods.some((method) => /requestAccounts|requestPermissions|sign|sendTransaction/i.test(method)), false);
      results.push({ case: name, result: 'PASS', passiveAccountCalls: f.methods.filter((method) => method === 'eth_accounts').length });
    } finally { f.stop(); f.release(); await tick(); }
  };
  await check('late-specific-identity', { available: false }, async (f) => {
    await tick(); assert.equal(f.methods.length, 0);
    f.expose(); await until(() => f.config.state.status === 'connected');
    assert.equal(f.config.state.current, f.connector.uid);
    assert.deepEqual(f.config.state.connections.get(f.connector.uid).accounts, [wallet]);
    f.cancel(); f.config.setState({ ...f.config.state, status: 'disconnected', current: null, connections: new Map() });
    f.storage.set('io.metamask.disconnected', true);
    const count = f.methods.length; f.expose(); f.emit('accountsChanged'); await tick(300);
    assert.equal(f.methods.length, count, 'no passive reads after explicit disconnect');
    assert.equal(f.config.state.status, 'disconnected');
  });
  await check('empty-then-live-account', { ready: false }, async (f) => {
    await until(() => f.methods.includes('eth_accounts'));
    assert.equal(f.config.state.status, 'disconnected');
    f.account('0x4444444444444444444444444444444444444444'); f.ready(true); f.expose();
    await until(() => f.config.state.status === 'connected');
    assert.deepEqual(f.config.state.connections.get(f.connector.uid).accounts, ['0x4444444444444444444444444444444444444444']);
  });
  for (const [name, options] of [['missing-intent', { marker: null }],
    ['disconnected-specific-with-generic-alias-marker', { shim: true }],
    ['storage-denied', { denied: true }]]) {
    await check(name, options, async (f) => { await tick(300); f.expose(); await tick();
      assert.equal(f.methods.length, 0); assert.equal(f.config.state.status, 'disconnected'); });
  }
  await check('permission-stays-empty', { ready: false }, async (f) => {
    // Exercise the real finite startup deadline rather than merely clearing it
    // at test cleanup: readiness events after the window must do nothing.
    await tick(10_200); assert.equal(f.config.state.status, 'disconnected');
    assert.equal(f.methods.includes('eth_chainId'), false);
    assert.ok(f.methods.length <= 8, 'the startup retry budget must be finite');
    const count = f.methods.length; f.ready(true); f.expose(); await tick(300);
    assert.equal(f.methods.length, count, 'a completed startup window must not reactivate');
    assert.equal(f.config.state.status, 'disconnected');
  });
  await check('sdk-intent-does-not-activate-injected-or-sdk', { marker: 'walletConnect' }, async (f) => {
    f.config.connectors.push({ id: 'walletConnect', type: 'walletConnect',
      getProvider: async () => assert.fail('an SDK must remain dormant') });
    await tick(300); assert.equal(f.methods.length, 0); assert.equal(f.config.state.status, 'disconnected');
  });
  for (const method of ['eth_accounts', 'eth_chainId']) {
    await check(`disconnect-during-pending-${method}`, {}, async (f) => {
      f.hold(method); await until(f.pending); f.cancel(); f.storage.set('io.metamask.disconnected', true);
      f.config.setState({ ...f.config.state, status: 'disconnected', current: null, connections: new Map() });
      f.release(); await tick(300);
      assert.equal(f.config.state.status, 'disconnected');
      assert.equal(f.storage.get('io.metamask.disconnected'), true, 'restore must never erase the disconnect shim');
    });
  }
  await check('new-explicit-connect-wins-pending-response', {}, async (f) => {
    f.hold('eth_accounts'); await until(f.pending); f.cancel();
    f.storage.set('recentConnectorId', 'other-wallet');
    f.config.setState({ ...f.config.state, status: 'connected', current: 'explicit-other-wallet', connections: new Map() });
    f.release(); await tick(300); assert.equal(f.config.state.current, 'explicit-other-wallet');
  });
  await check('wallet-disconnect-cancels-pending-response', {}, async (f) => {
    f.hold('eth_accounts'); await until(f.pending); f.emit('disconnect'); f.release(); await tick(300);
    assert.equal(f.config.state.status, 'disconnected');
  });
  await check('changed-intent-does-not-fall-across-wallets', {}, async (f) => {
    f.hold('eth_accounts'); await until(f.pending); f.storage.set('recentConnectorId', 'other-wallet');
    f.release(); await tick(300); assert.equal(f.config.state.status, 'disconnected');
  });
  for (const event of ['accountsChanged', 'chainChanged']) {
    await check(`${event}-invalidates-pending-generation`, {}, async (f) => {
      f.hold('eth_accounts'); await until(f.pending); f.emit(event);
      f.account('0x4444444444444444444444444444444444444444'); f.release();
      await until(() => f.config.state.status === 'connected');
      assert.deepEqual(f.config.state.connections.get(f.connector.uid).accounts, ['0x4444444444444444444444444444444444444444']);
      assert.ok(f.methods.filter((method) => method === 'eth_accounts').length >= 3,
        'the invalidated response must be followed by a new passive authorization');
    });
  }
  const fs = require('node:fs');
  const receiptPath = process.env.BENEFITS_WALLET_RESTORATION_RECEIPT;
  assert.ok(receiptPath && path.isAbsolute(receiptPath), 'an owned absolute receipt path is required');
  fs.writeFileSync(receiptPath, `${JSON.stringify({ case: 'helper-controls', result: 'PASS',
    scope: 'actual helper + actual pinned Core reconnect; synthetic provider/config; not React/browser/build acceptance',
    controls: results }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`[benefits-wallet-lock-ui] PASS - ${results.length} bounded injected restoration controls`);
}

async function runInjectedRestorationFixture() {
  if (restorationCase === 'helper-controls') return runInjectedRestorationControls();
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  assert.equal(restorationCase, 'late-provider', 'unknown restoration fixture case');
  const target = new URL(process.env.BENEFITS_WALLET_UI_ORIGIN || origin);
  assert.ok(
    (target.origin === 'https://shop.ifrunit.tech' ||
      (target.protocol === 'http:' && target.hostname === '127.0.0.1')) &&
    target.pathname === '/' && !target.search && !target.hash && !target.username && !target.password,
    'fixture target must be the admitted Shop origin or an explicitly served loopback build'
  );
  const receiptPath = process.env.BENEFITS_WALLET_RESTORATION_RECEIPT;
  assert.ok(receiptPath && path.isAbsolute(receiptPath), 'an owned absolute receipt path is required');
  const receipt = {
    case: restorationCase, origin: target.origin, startedUtc: new Date().toISOString(),
    appCommit: 'UNPROVEN_STATIC_BUILD', syntheticWalletOnly: true,
    staticAssets: [], blockedRequests: [], websocketAttempts: 0, apiFixtures: 0,
    rpcMethods: [], stages: [], result: 'INCOMPLETE',
  };
  const state = { ifr: 10_000n * unit, locked: 0n, commitment: 0n, allowance: 0n,
    eth: 10n ** 18n, transactions: [], rpcCalls: [], readCalls: [] };
  let staticBytes = 0;
  let browser;
  let page;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US',
      viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await context.routeWebSocket('**/*', (socket) => {
      receipt.websocketAttempts += 1;
      socket.close();
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        receipt.apiFixtures += 1;
        return route.fulfill({ status: request.method() === 'GET' ? 200 : 403,
          contentType: 'application/json', body: JSON.stringify(url.pathname === '/api/businesses'
            ? { offers: [], categories: [], serviceAreas: [], pagination: {
              page: 1, limit: 8, total: 0, totalPages: 0, hasNext: false } }
            : { status: 'fixture-only', chainId: 1 }) });
      }
      if (request.method() === 'POST') {
        let payload;
        try { payload = request.postDataJSON(); } catch {}
        const calls = Array.isArray(payload) ? payload : [payload];
        if (calls.length && calls.every((call) => call && typeof call.method === 'string')) {
          const respond = (call) => {
            receipt.rpcMethods.push(call.method);
            try { return { jsonrpc: '2.0', id: call.id, result: rpcResult(call, state) }; }
            catch { return { jsonrpc: '2.0', id: call.id,
              error: { code: -32601, message: 'Method unavailable in synthetic fixture' } }; }
          };
          return route.fulfill({ contentType: 'application/json',
            body: JSON.stringify(Array.isArray(payload) ? calls.map(respond) : respond(payload)) });
        }
      }
      const staticPath = url.pathname === '/' || url.pathname.startsWith('/_next/static/') ||
        /^\/(?:icons\/[^/]+|favicon\.ico|manifest(?:\.webmanifest|\.json))$/.test(url.pathname);
      if (request.method() === 'GET' && url.origin === target.origin && staticPath && !url.search) {
        const headers = { ...request.headers() };
        delete headers.cookie;
        delete headers.authorization;
        const response = await route.fetch({ headers, maxRedirects: 0 });
        assert.equal(response.status(), 200, `static request did not return 200: ${url.pathname}`);
        const body = await response.body();
        staticBytes += body.length;
        assert.ok(staticBytes <= 64 * 1024 * 1024, 'static fixture exceeded its finite byte limit');
        receipt.staticAssets.push({ path: url.pathname, bytes: body.length,
          sha256: crypto.createHash('sha256').update(body).digest('hex') });
        const responseHeaders = { ...response.headers() };
        delete responseHeaders['set-cookie'];
        delete responseHeaders['content-encoding'];
        delete responseHeaders['content-length'];
        return route.fulfill({ response, headers: responseHeaders, body });
      }
      receipt.blockedRequests.push({ method: request.method(), origin: url.origin,
        resourceType: request.resourceType() });
      return route.abort('blockedbyclient');
    });
    await context.addInitScript(({ account }) => {
      const visit = Number(sessionStorage.getItem('__ifrM1Visit') || 0) + 1;
      sessionStorage.setItem('__ifrM1Visit', String(visit));
      const methods = [];
      const listeners = new Map();
      const provider = {
        isMetaMask: true,
        request: async ({ method }) => {
          methods.push(method);
          if (method === 'wallet_requestPermissions' || method === 'eth_requestAccounts') {
            sessionStorage.setItem('__ifrM1Permission', 'yes');
            return method === 'eth_requestAccounts' ? [account] :
              [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [account] }] }];
          }
          if (method === 'eth_accounts') return sessionStorage.getItem('__ifrM1Permission') === 'yes' ? [account] : [];
          if (method === 'eth_chainId') return '0x1';
          if (method === 'net_version') return '1';
          if (method === 'wallet_getCapabilities') return {};
          throw new Error('Unsupported synthetic wallet method');
        },
        on: (event, listener) => listeners.set(event, [...(listeners.get(event) || []), listener]),
        removeListener: (event, listener) => listeners.set(event,
          (listeners.get(event) || []).filter((entry) => entry !== listener)),
      };
      const detail = Object.freeze({ provider, info: { uuid: 'be61c572-fce5-41a3-aee1-41c53437a59e',
        rdns: 'io.metamask', name: 'MetaMask', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' } });
      let exposed = false;
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      const expose = () => {
        if (exposed) return;
        exposed = true;
        Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
        window.addEventListener('eip6963:requestProvider', announce);
        window.dispatchEvent(new Event('ethereum#initialized'));
        announce();
      };
      Object.defineProperty(window, '__ifrM1', { value: { visit, methods, expose,
        snapshot: () => ({ visit, exposed, methods: [...methods],
          rememberedSpecificConnector: localStorage.getItem('wagmi.recentConnectorId') === '"io.metamask"',
          genericConnectedMarker: Boolean(localStorage.getItem('wagmi.injected.connected')) }) } });
      if (visit === 1) expose();
    }, { account: wallet });
    page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.name));
    await page.goto(`${target.origin}/#customer-wallet`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('#customer-wallet');
    const control = panel.locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]');
    const disconnect = panel.getByRole('button', { name: 'Disconnect', exact: true });
    await control.waitFor({ timeout: 15_000 });
    assert.match(await control.getAttribute('data-wallet-connector-ids'), /io\.metamask/);
    await panel.locator('[data-wallet-action="connect"]').click();
    await disconnect.waitFor({ timeout: 10_000 });
    const connected = await page.evaluate(() => window.__ifrM1.snapshot());
    assert.equal(connected.rememberedSpecificConnector, true, 'explicit connect must remember the specific connector');
    assert.equal(connected.genericConnectedMarker, false, 'specific connect must not need a generic marker');
    receipt.stages.push({ stage: 'explicit-specific-connect', ...connected });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await control.waitFor({ timeout: 15_000 });
    await panel.locator('[data-wallet-action="connect"]').waitFor();
    assert.doesNotMatch(await control.getAttribute('data-wallet-connector-ids'), /io\.metamask/);
    const before = await page.evaluate(() => window.__ifrM1.snapshot());
    assert.equal(before.visit, 2, 'the fixture must reload the same browser tab');
    assert.equal(before.exposed, false, 'provider must be absent during initial restoration');
    assert.equal(before.rememberedSpecificConnector, true, 'synthetic selection intent must survive reload');
    receipt.stages.push({ stage: 'settled-before-late-provider', ...before });
    await page.evaluate(() => window.__ifrM1.expose());
    await page.waitForFunction(() => [...document.querySelectorAll('[data-wallet-connector-ids]')]
      .some((element) => element.getAttribute('data-wallet-connector-ids').includes('io.metamask')));
    await disconnect.waitFor({ timeout: 10_000 }).catch(() => {
      throw new Error('RESTORATION_LATE_PROVIDER: remembered EIP-6963 provider appeared after initial restore, but live connection did not recover');
    });
    const restored = await page.evaluate(() => window.__ifrM1.snapshot());
    assert.equal(restored.methods.some((method) => /requestAccounts|requestPermissions|sign|sendTransaction/i.test(method)),
      false, 'restoration must not request permission, sign or transact');
    assert.ok(restored.methods.includes('eth_accounts'), 'restoration must verify a fresh passive account');
    assert.ok(restored.methods.includes('eth_chainId'), 'restoration must verify the live chain');
    receipt.stages.push({ stage: 'restored-after-late-provider', ...restored });
    assert.deepEqual(pageErrors, []);
    assert.equal(state.transactions.length, 0);
    receipt.result = 'PASS';
    console.log('[benefits-wallet-lock-ui] PASS - late intended injected provider restores passively');
  } catch (error) {
    receipt.result = 'FAIL';
    receipt.failure = error.message;
    throw error;
  } finally {
    if (page) receipt.finalWalletState = await page.evaluate(() => window.__ifrM1?.snapshot()).catch(() => null);
    receipt.contractReadCount = state.readCalls.length;
    receipt.finishedUtc = new Date().toISOString();
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (browser) await browser.close();
  }
}

async function verifyCustomerWalletAnchor(page, onVerified = async () => {}) {
  const originalViewport = page.viewportSize();
  const destination = new URL(page.url());
  destination.hash = 'customer-wallet';
  const fallback = require('node:fs').readFileSync(path.join(frontend, 'src', 'app', 'page.tsx'), 'utf8');
  assert.match(fallback, /<section\s+id="customer-wallet"\s+role="status"/, 'the loading fallback must retain the same wallet anchor');

  async function settledGeometry() {
    await page.evaluate(() => document.fonts.ready);
    // Home retries its anchor scroll after 700ms; observe that behavior unchanged.
    await page.waitForTimeout(700);
    return page.evaluate(() => new Promise((resolve, reject) => {
      const started = performance.now();
      let previous = '';
      let stableFrames = 0;
      const sample = () => {
        const panel = document.getElementById('customer-wallet');
        const heading = panel?.querySelector('h2');
        const header = document.querySelector('header.shop-header');
        if (!panel || !heading || !header) return reject(new Error('Missing wallet anchor, heading or header'));
        const box = (element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const geometry = { panel: box(panel), heading: box(heading), header: box(header), scrollX, scrollY };
        const current = JSON.stringify(geometry);
        stableFrames = current === previous && document.fonts.status === 'loaded' ? stableFrames + 1 : 0;
        previous = current;
        if (stableFrames >= 12) {
          const hit = document.elementFromPoint(
            geometry.heading.x + geometry.heading.width / 2,
            geometry.heading.y + geometry.heading.height / 2
          );
          return resolve({
            ...geometry,
            hash: location.hash,
            fontsStatus: document.fonts.status,
            scrollMarginTop: getComputedStyle(panel).scrollMarginTop,
            headingHit: hit === heading || heading.contains(hit),
            viewport: { width: innerWidth, height: innerHeight },
            pageScrollWidth: document.documentElement.scrollWidth,
          });
        }
        if (performance.now() - started > 5000) return reject(new Error('Wallet anchor scroll did not settle'));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
  }

  function assertClear(geometry, entry) {
    assert.equal(geometry.hash, '#customer-wallet', `${entry}: actual wallet anchor must be selected`);
    assert.ok(geometry.heading.y >= geometry.header.bottom, `${entry}: the whole wallet heading must remain below the sticky header`);
    assert.ok(geometry.heading.x >= 0 && geometry.heading.right <= geometry.viewport.width, `${entry}: heading must fit horizontally`);
    assert.ok(geometry.heading.bottom <= geometry.viewport.height, `${entry}: heading must fit vertically`);
    assert.equal(geometry.headingHit, true, `${entry}: hit testing must reach the wallet heading`);
    assert.ok(geometry.pageScrollWidth <= geometry.viewport.width, `${entry}: anchor navigation must not overflow horizontally`);
  }

  const results = [];
  try {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1180, height: 820 },
      { width: 820, height: 1180 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(destination.href, { waitUntil: 'domcontentloaded' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#customer-wallet').getByRole('heading', { name: 'Wallet balances and IFRLock tools', exact: true }).waitFor();
      await page.locator('#customer-wallet').locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]').waitFor({ timeout: 10_000 });
      const deepLink = await settledGeometry();
      assertClear(deepLink, 'fresh deep link');
      const universalRule = await page.evaluate(() => {
        const visit = (rules) => Array.from(rules).some((rule) =>
          (rule.selectorText === '#customer-wallet' && rule.style.scrollMarginTop === '9rem') ||
          (rule.cssRules && visit(rule.cssRules))
        );
        return Array.from(document.styleSheets).some((sheet) => {
          try { return visit(sheet.cssRules); } catch { return false; }
        });
      });
      assert.equal(universalRule, true, 'the shared ID rule must cover both the loaded wallet and its loading fallback');
      await page.evaluate(() => {
        history.replaceState(history.state, '', location.pathname + location.search);
        window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      });
      const link = page.locator('header.shop-header a[href="/#customer-wallet"]');
      const linkBox = await link.boundingBox();
      assert.ok(linkBox && linkBox.width >= 44 && linkBox.height >= 44, 'the actual wallet anchor must retain a 44px touch target');
      await link.click();
      await page.waitForFunction(() => location.hash === '#customer-wallet');
      const headerLink = await settledGeometry();
      assertClear(headerLink, 'header Lock IFR link');
      const result = { viewport, deepLink, headerLink, loadingFallbackRule: universalRule };
      results.push(result);
      await onVerified(result);
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  return results;
}

async function verifyWalletGuidance(page, state, { scenario, connected = true, captureDirectory = '', viewports = [] } = {}) {
  const panel = page.locator('#customer-wallet');
  await panel.getByRole('heading', { name: 'Wallet balances and IFRLock tools', exact: true }).waitFor();
  await panel.getByText('IFRLock example overview', { exact: true }).waitFor();
  await panel.getByText('Checkout depends on the selected offer.', { exact: false }).waitFor();
  assert.equal(await panel.getByText('Ready for checkout', { exact: true }).count(), 0, 'a generic IFRLock balance must not claim exact-offer checkout eligibility');
  assert.equal(await panel.getByText('Checkout readiness', { exact: true }).count(), 0, 'the generic tools must not masquerade as an exact checkout gate');
  assert.equal(await panel.getByText('Lock IFR before scanning seller QR codes.', { exact: false }).count(), 0, 'IFRLock must not be a universal prerequisite for other accepted sources');
  assert.equal(await panel.getByText('Use seller QR proofs and redeem benefits once.', { exact: true }).count(), 0, 'the example transaction path must not promise exact-offer redemption');
  if (connected && state.locked >= amount) {
    await panel.getByText('Example IFRLock threshold met', { exact: true }).waitFor();
  }
  if (connected && state.ifr === 0n && state.locked >= amount) {
    const balance = panel.getByText('IFR balance', { exact: true }).locator('..');
    await balance.getByText('0.000 IFR', { exact: true }).waitFor();
    const holding = panel.getByText('Free IFR or example lock', { exact: true }).locator('..');
    await holding.getByText('Detected', { exact: true }).waitFor();
  }
  if (connected && state.eth === 0n) {
    for (const name of ['Approve', 'Lock IFR', 'Unlock all']) {
      assert.equal(await panel.getByRole('button', { name, exact: true }).isEnabled(), false, `${name} must still require native gas`);
    }
    await panel.getByText('Signing an off-chain checkout proof does not spend ETH', { exact: false }).waitFor();
    assert.equal(state.transactions.length, 0, 'gasless guidance must not request a transaction');
  }
  if (state.guidanceOffer) {
    const offer = page.locator('article').filter({ hasText: 'Guidance fixture offer' });
    await offer.waitFor();
    if (state.guidanceOffer.eligible) {
      await offer.getByText('Eligible with this wallet', { exact: true }).waitFor();
    } else {
      await offer.getByText('Lock 4,000 more IFR', { exact: true }).waitFor();
      assert.equal(await offer.getByText('Eligible with this wallet', { exact: true }).count(), 0, 'meeting the generic example must not make a higher-threshold offer eligible');
    }
  }
  const captures = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await panel.scrollIntoViewIfNeeded();
    const metrics = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const controls = Array.from(element.querySelectorAll('button, a[href], input')).filter(node => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }).map(node => { const box = node.getBoundingClientRect(); return { text: (node.innerText || node.getAttribute('aria-label') || node.tagName).trim(), x: box.left, y: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height, disabled: Boolean(node.disabled) }; });
      const clipped = Array.from(element.querySelectorAll('h2, h3, p, label, button, a, input')).filter(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.left < rect.left - 1 || box.right > rect.right + 1 || node.scrollWidth > node.clientWidth + 1);
      }).map(node => ({ tag: node.tagName, text: (node.innerText || '').slice(0, 100), width: node.clientWidth, scrollWidth: node.scrollWidth }));
      const style = getComputedStyle(element);
      return { width: rect.width, height: rect.height, pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(Number.parseFloat), controls, clipped };
    });
    assert.ok(metrics.pageScrollWidth <= metrics.pageWidth + 1, 'wallet guidance must not create horizontal page overflow');
    assert.deepEqual(metrics.clipped, [], 'wallet guidance text and controls must remain inside their panel without clipping');
    assert.ok(metrics.padding.every(value => value >= 16), 'wallet panel must keep its internal inset on every edge');
    assert.ok(metrics.controls.every(control => control.width >= 44 && control.height >= 44), 'all wallet controls must retain44px touch targets');
    for (let a = 0; a < metrics.controls.length; a += 1) {
      for (let b = a + 1; b < metrics.controls.length; b += 1) {
        const first = metrics.controls[a]; const second = metrics.controls[b];
        const overlapX = Math.min(first.right, second.right) - Math.max(first.x, second.x);
        const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.y, second.y);
        assert.ok(overlapX <= 1 || overlapY <= 1, 'wallet controls must not overlap');
      }
    }
    const focus = panel.locator('button:not([disabled]), a[href], input:not([disabled])').first();
    await focus.focus();
    assert.equal(await focus.evaluate(element => element === document.activeElement), true, 'keyboard focus remains usable');
    await page.keyboard.press('Tab');
    assert.equal(await panel.evaluate(element => element.contains(document.activeElement)), true, 'keyboard traversal must reach another wallet control');
    if (captureDirectory) {
      const fs = require('node:fs');
      fs.mkdirSync(captureDirectory, { recursive: true });
      const screenshot = path.join(captureDirectory, `${scenario}-${viewport.width}x${viewport.height}.png`);
      await panel.screenshot({ path: screenshot, animations: 'disabled' });
      captures.push({ scenario, viewport, screenshot, metrics });
    }
  }
  return captures;
}

async function run() {
  const state = {
    ifr: 10_000n * unit,
    locked: 0n,
    commitment: 0n,
    guidanceOffer: null,
    allowance: 0n,
    eth: zeroEthOnly ? 0n : 10n ** 18n,
    transactions: [],
    rpcCalls: [],
    readCalls: [],
  };
  const serverOutput = [];
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: frontend,
    env: {
      ...process.env,
      NEXT_PUBLIC_CHAIN_ID: '1',
      NEXT_PUBLIC_IFR_TOKEN_ADDRESS: token,
      NEXT_PUBLIC_IFRLOCK_ADDRESS: lock,
      BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(({ account, methodSelectors, initialEth, wrongChainOnly }) => {
      const listeners = new Map();
      const methods = [];
      let currentChainId = wrongChainOnly ? '0xaa36a7' : '0x1';
      Object.defineProperty(window, '__ifrWalletLockMethods', { value: methods });
      Object.defineProperty(window, '__ifrWalletChainId', { get: () => currentChainId });
      const provider = {
        isMetaMask: true,
        providers: [],
        request: async ({ method, params }) => {
          methods.push(method);
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
          if (method === 'eth_chainId') return currentChainId;
          if (method === 'net_version') return String(Number.parseInt(currentChainId, 16));
          if (method === 'wallet_getCapabilities') return {};
          if (method === 'wallet_switchEthereumChain') {
            currentChainId = params?.[0]?.chainId || currentChainId;
            for (const listener of listeners.get('chainChanged') || []) listener(currentChainId);
            return null;
          }
          if (method === 'wallet_requestPermissions') return null;
          if (method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
          if (method === 'eth_estimateGas') return '0x186a0';
          if (method === 'eth_getTransactionCount') return '0x0';
          if (method === 'eth_sendTransaction') {
            const response = await fetch('/__test_wallet_tx', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(params?.[0] || {}),
            });
            if (!response.ok) throw new Error(await response.text());
            return (await response.json()).hash;
          }
          if (method === 'eth_getBalance') return initialEth;
          if (method === 'eth_blockNumber') return '0x10';
          if (method === 'eth_getCode') return '0x01';
          if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
          throw new Error(`Unsupported test wallet method: ${method} (${JSON.stringify(methodSelectors)})`);
        },
        on: (event, listener) => {
          const current = listeners.get(event) || [];
          current.push(listener);
          listeners.set(event, current);
        },
        removeListener: (event, listener) => {
          listeners.set(event, (listeners.get(event) || []).filter((item) => item !== listener));
        },
      };
      provider.providers = [provider];
      Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
      window.dispatchEvent(new Event('ethereum#initialized'));
    }, {
      account: wallet,
      methodSelectors: selectors,
      initialEth: `0x${state.eth.toString(16)}`,
      wrongChainOnly,
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/__test_wallet_tx', async (route) => {
      try {
        const hash = applyTransaction(state, route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hash }) });
      } catch (error) {
        await route.fulfill({ status: 400, contentType: 'text/plain', body: error.stack || error.message });
      }
    });
    await page.route(/^https:\/\/.+/, async (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      let payload;
      try {
        payload = route.request().postDataJSON();
      } catch {
        return route.continue();
      }
      const requests = Array.isArray(payload) ? payload : [payload];
      if (!requests.every((item) => item && typeof item.method === 'string')) {
        return route.continue();
      }
      const respond = (item) => {
        state.rpcCalls.push({
          method: item.method,
          rpcOrigin: new URL(route.request().url()).origin,
          to: item.params?.[0]?.to,
          data: item.params?.[0]?.data?.slice(0, 10),
        });
        if (readFailureOnly && item.method === 'eth_call') {
          return { jsonrpc: '2.0', id: item.id, error: { code: -32000, message: 'Injected contract read failure' } };
        }
        try {
          return { jsonrpc: '2.0', id: item.id, result: rpcResult(item, state) };
        } catch (error) {
          return { jsonrpc: '2.0', id: item.id, error: { code: -32000, message: error.message } };
        }
      };
      const body = Array.isArray(payload) ? payload.map(respond) : respond(payload);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/businesses') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            offers: state.guidanceOffer ? [{
              id: 'guidance-rule', label: 'Guidance fixture offer', category: 'Fixture', productName: 'Fixture item',
              discountPercent: 10, requiredLockIFR: state.guidanceOffer.requiredLockIFR, minIFRHeld: 0,
              lockSource: state.guidanceOffer.lockSource, dailyRedemptionLimit: 0, monthlyRedemptionLimit: 0,
              business: { id: 'guidance-business', slug: 'guidance-fixture', name: 'Guidance fixture seller', description: null, website: null, logoUrl: null, serviceArea: null, categories: ['Fixture'] },
              product: null,
            }] : [],
            categories: state.guidanceOffer ? ['Fixture'] : [], serviceAreas: [],
            pagination: { page: 1, limit: 8, total: state.guidanceOffer ? 1 : 0, totalPages: state.guidanceOffer ? 1 : 0, hasNext: false },
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', chainId: 1 }) });
    });

    await page.goto(`${origin}/#customer-wallet`, { waitUntil: 'domcontentloaded' });
    const walletPanel = page.locator('#customer-wallet');
    await walletPanel.getByText('MetaMask provider', { exact: true }).waitFor();
    const walletControl = walletPanel.locator('[data-wallet-connect-control]');
    await walletPanel.locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]').waitFor({ timeout: 10_000 }).catch(async () => {
      throw new Error(`Wallet connectors did not resolve. State: ${JSON.stringify(await walletControl.evaluate((element) => ({
        ready: element.getAttribute('data-wallet-connectors-ready'),
        ids: element.getAttribute('data-wallet-connector-ids'),
      })))}`);
    });
    if (!zeroEthOnly && !wrongChainOnly && !readFailureOnly && !reconnectOnly) {
      await verifyCustomerWalletAnchor(page);
    }
    await verifyWalletGuidance(page, state, { scenario: 'disconnected', connected: false });
    const connectButton = walletPanel.locator('[data-wallet-action="connect"]');
    if (await connectButton.isVisible()) {
      assert.equal(
        await walletPanel.getByText('Reading...', { exact: false }).count(),
        0,
        'disconnected wallet fields must not claim an active read'
      );
      await connectButton.click();
    }
    await page.getByRole('button', { name: 'Disconnect', exact: true }).first().waitFor({ timeout: 10_000 }).catch(async () => {
      throw new Error(`Wallet did not connect. Methods: ${JSON.stringify(await page.evaluate(() => window.__ifrWalletLockMethods || []))}`);
    });
    await page.waitForTimeout(2000);
    if (reconnectOnly) {
      // connect -> reload -> restored session -> disconnect -> reload stays
      // disconnected -> reconnect. No transaction is ever submitted.
      const readySelector = '[data-wallet-connect-control][data-wallet-connectors-ready="true"]';
      const disconnectButton = walletPanel.getByRole('button', { name: 'Disconnect', exact: true });
      const shortAddress = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

      await page.reload({ waitUntil: 'domcontentloaded' });
      await walletPanel.locator(readySelector).waitFor({ timeout: 10_000 });
      await disconnectButton.waitFor({ timeout: 10_000 });
      await walletPanel.getByText(shortAddress, { exact: true }).first().waitFor();
      assert.equal(
        await walletPanel.locator('[data-wallet-action="connect"]').count(),
        0,
        'a restored session must not offer a fresh connect action'
      );

      await disconnectButton.click();
      const connectButton = walletPanel.locator('[data-wallet-action="connect"]');
      await connectButton.waitFor({ timeout: 10_000 });
      const disconnectedReadCount = state.readCalls.length;

      await page.reload({ waitUntil: 'domcontentloaded' });
      await walletPanel.locator(readySelector).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(2000);
      assert.equal(
        await walletPanel.getByRole('button', { name: 'Disconnect', exact: true }).count(),
        0,
        'a disconnected wallet must stay disconnected after reload'
      );
      assert.equal(await connectButton.isEnabled(), true, 'reconnect action must be available');
      assert.equal(
        state.readCalls.length,
        disconnectedReadCount,
        'a disconnected reload must not issue IFR or IFRLock contract reads'
      );

      await connectButton.click();
      await disconnectButton.waitFor({ timeout: 10_000 });
      await walletPanel.getByText(shortAddress, { exact: true }).first().waitFor();
      assert.equal(state.transactions.length, 0, 'reconnect regression must not submit a transaction');
      assert.deepEqual(pageErrors, []);
      console.log('[benefits-wallet-lock-ui] PASS - connect -> reload restores -> disconnect -> reload stays disconnected -> reconnect');
      return;
    }
    if (wrongChainOnly) {
      const switchAction = walletPanel.getByRole('button', { name: 'Switch to Ethereum Mainnet', exact: true });
      await switchAction.waitFor();
      assert.equal(await walletPanel.getByRole('button', { name: 'Approve', exact: true }).isEnabled(), false);
      assert.equal(await walletPanel.getByRole('button', { name: 'Lock IFR', exact: true }).isEnabled(), false);
      assert.equal(state.transactions.length, 0, 'wrong-chain state must not submit a transaction');
      assert.equal(
        state.readCalls.some((item) => item.target === token.toLowerCase() || item.target === lock.toLowerCase()),
        false,
        'wrong-chain state must not read IFR or IFRLock contracts'
      );
      await switchAction.click();
      await walletPanel.getByText('10,000.000 IFR', { exact: true }).first().waitFor({ timeout: 10_000 });
      assert.equal(await page.evaluate(() => window.__ifrWalletChainId), '0x1');
      assert.ok(
        await page.evaluate(() => window.__ifrWalletLockMethods.includes('wallet_switchEthereumChain')),
        'Mainnet recovery must ask the connected wallet to switch chain'
      );
      assert.equal(state.transactions.length, 0, 'chain recovery must not submit a contract transaction');
      await page.evaluate(async () => {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }],
        });
      });
      await switchAction.waitFor();
      const allowanceStatus = walletPanel.locator('p').filter({ hasText: 'Allowance:' }).first();
      await allowanceStatus.waitFor();
      assert.match(await allowanceStatus.innerText(), /Allowance:\s*-- IFR/);
      assert.equal(
        await walletPanel.getByText('Example tier guide').locator('..').getByText('None', { exact: true }).isVisible(),
        true,
        'cached Mainnet tier data must be masked after switching away'
      );
      assert.equal(state.transactions.length, 0, 'switching away must not submit a contract transaction');
      assert.deepEqual(pageErrors, []);
      console.log('[benefits-wallet-lock-ui] PASS - wrong chain fails closed and recovers through Mainnet switch');
      return;
    }
    if (zeroEthOnly) {
      const zeroGasAction = walletPanel.getByRole('link', { name: 'Get ETH for gas', exact: true });
      await zeroGasAction.waitFor();
      const zeroGasGuide = walletPanel.getByRole('link', { name: 'Open official ETH guide', exact: true });
      await zeroGasGuide.waitFor();
      assert.equal(await zeroGasGuide.getAttribute('href'), 'https://ethereum.org/get-eth/');
      assert.equal(await zeroGasGuide.getAttribute('target'), '_blank');
      assert.deepEqual((await zeroGasGuide.getAttribute('rel')).split(/\s+/).sort(), ['noopener', 'noreferrer']);
      assert.equal(new URL(await zeroGasGuide.getAttribute('href')).search, '', 'Get ETH URL must not contain wallet or tracking data');
      assert.equal(await walletPanel.getByRole('button', { name: 'Approve', exact: true }).isEnabled(), false);
      assert.equal(await walletPanel.getByRole('button', { name: 'Lock IFR', exact: true }).isEnabled(), false);
      const methodsBeforeGuideClick = await page.evaluate(() => [...window.__ifrWalletLockMethods]);
      await zeroGasGuide.evaluate((element) => {
        element.addEventListener('click', (event) => event.preventDefault(), { once: true });
        element.click();
      });
      assert.deepEqual(
        await page.evaluate(() => [...window.__ifrWalletLockMethods]),
        methodsBeforeGuideClick,
        'Get ETH navigation must not call the wallet provider'
      );
      assert.equal(state.transactions.length, 0, 'zero-ETH guidance must not submit a transaction');
      assert.ok(
        state.readCalls.some((item) => item.target === multicallAddress && item.selector === selectors.getEthBalance),
        'zero-ETH state must come from Multicall3.getEthBalance'
      );
      assert.deepEqual(pageErrors, []);
      await verifyWalletGuidance(page, state, { scenario: 'zero-unlocked' });
      for (const fixture of [
        { scenario: 'zero-locked-higher-rule', locked: amount, commitment: 0n, ifr: 0n, requiredLockIFR: 5000, lockSource: 'ifrlock', eligible: false },
        { scenario: 'zero-lower-rule', locked: 500n * unit, commitment: 0n, ifr: 9500n * unit, requiredLockIFR: 500, lockSource: 'ifrlock', eligible: true },
        { scenario: 'zero-commitment-rule', locked: 0n, commitment: 2500n * unit, ifr: 0n, requiredLockIFR: 2500, lockSource: 'commitment_time_only', eligible: true },
      ]) {
        Object.assign(state, { locked: fixture.locked, commitment: fixture.commitment, ifr: fixture.ifr, guidanceOffer: fixture });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await walletPanel.getByRole('button', { name: 'Disconnect', exact: true }).waitFor({ timeout: 10_000 });
        await verifyWalletGuidance(page, state, { scenario: fixture.scenario });
      }
      assert.equal(state.transactions.length, 0, 'all exact-offer zero-ETH previews must remain transaction-free');
      assert.deepEqual(pageErrors, []);
      console.log('[benefits-wallet-lock-ui] PASS - zero-ETH recovery and exact-offer guidance are provider-neutral and transaction-free');
      return;
    }
    if (readFailureOnly) {
      const retry = walletPanel.getByRole('button', { name: 'Retry wallet checks', exact: true });
      await retry.waitFor({ timeout: 10_000 });
      await walletPanel.getByText('Unavailable IFR', { exact: true }).first().waitFor();
      assert.equal(await walletPanel.getByRole('button', { name: 'Approve', exact: true }).isEnabled(), false);
      assert.equal(await walletPanel.getByRole('button', { name: 'Lock IFR', exact: true }).isEnabled(), false);
      assert.equal(await walletPanel.getByRole('button', { name: 'Unlock all', exact: true }).isEnabled(), false);
      assert.equal(await walletPanel.getByRole('button', { name: 'Use max', exact: true }).isEnabled(), false);
      await retry.click();
      await retry.waitFor({ timeout: 10_000 });
      assert.equal(state.transactions.length, 0, 'failed contract reads must never submit a transaction');
      assert.deepEqual(pageErrors, []);
      console.log('[benefits-wallet-lock-ui] PASS - contract read failures stay unavailable and fail closed');
      return;
    }

    if (!await walletPanel.getByText('10,000.000 IFR', { exact: true }).count()) {
      throw new Error(`Wallet state did not load. RPC calls: ${JSON.stringify(state.rpcCalls)}\n${await walletPanel.innerText()}`);
    }
    await walletPanel.getByText('10,000.000 IFR', { exact: true }).first().waitFor();
    for (const tier of ['Bronze / 1,000 IFR', 'Silver / 2,500 IFR', 'Gold / 5,000 IFR', 'Platinum / 10,000 IFR']) {
      await walletPanel.getByRole('button', { name: tier, exact: true }).waitFor();
    }
    await walletPanel.getByText('Sellers define each real rule and may use different thresholds.', { exact: true }).waitFor();
    const approveRecommended = walletPanel.getByRole('button', { name: 'Approve 1,000 IFR', exact: true });
    await approveRecommended.waitFor({ timeout: 10_000 }).catch(async () => {
      const walletDebug = await page.evaluate(async () => ({
        methods: [...window.__ifrWalletLockMethods],
        directBalance: await window.ethereum.request({ method: 'eth_getBalance', params: [window.ethereum.selectedAddress || '', 'latest'] }),
      }));
      throw new Error(
        `Funded wallet did not reach approve state (zeroOnly=${zeroEthOnly}, stateEth=${state.eth}).\n` +
        `${await walletPanel.innerText()}\nWallet: ${JSON.stringify(walletDebug)}\nRPC: ${JSON.stringify(state.rpcCalls.slice(-20))}`
      );
    });
    await approveRecommended.click();
    await walletPanel.getByText('Approval confirmed. You can lock IFR now.', { exact: true }).waitFor({ timeout: 15_000 });
    await walletPanel.getByText('1,000.000 IFR', { exact: true }).first().waitFor();
    await walletPanel.getByRole('button', { name: 'Lock 1,000 IFR', exact: true }).click();
    await walletPanel.getByText('Lock confirmed. Wallet status is refreshing.', { exact: true }).waitFor({ timeout: 15_000 });
    await walletPanel.getByText('9,000.000 IFR', { exact: true }).first().waitFor();
    await verifyWalletGuidance(page, state, { scenario: 'funded-locked' });
    const currentTier = walletPanel.getByText('Example tier guide', { exact: true }).locator('xpath=..');
    await currentTier.getByText('Bronze', { exact: true }).waitFor();
    const unlock = walletPanel.getByRole('button', { name: 'Unlock all', exact: true });
    assert.equal(await unlock.isEnabled(), true, 'unlock must be enabled after the lock receipt refresh');
    await unlock.click();
    await walletPanel.getByText('Unlock confirmed. Wallet status is refreshing.', { exact: true }).waitFor({ timeout: 15_000 });
    await walletPanel.getByText('10,000.000 IFR', { exact: true }).first().waitFor();
    await currentTier.getByText('None', { exact: true }).waitFor();

    assert.deepEqual(state.transactions.map(({ action, amount: raw }) => ({ action, amount: raw })), [
      { action: 'approve', amount: amount.toString() },
      { action: 'lock', amount: amount.toString() },
      { action: 'unlock', amount: amount.toString() },
    ]);
    assert.equal(state.ifr, 10_000n * unit);
    assert.equal(state.locked, 0n);
    assert.equal(state.allowance, 0n);
    assert.ok(
      state.readCalls.some((item) => item.target === multicallAddress && item.selector === selectors.getEthBalance),
      'funded state must come from Multicall3.getEthBalance'
    );
    assert.deepEqual(pageErrors, []);
    await context.close();
    console.log('[benefits-wallet-lock-ui] PASS - approve -> lock -> refreshed access -> unlock');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (process.exitCode) process.stderr.write(serverOutput.join(''));
  }
}

(restorationCase ? runInjectedRestorationFixture() : run()).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
