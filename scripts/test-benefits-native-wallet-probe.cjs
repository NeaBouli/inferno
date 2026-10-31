#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const modulePath = path.join(__dirname, '..', 'apps/benefits-network/frontend/src/lib/nativeWalletProbe.mjs');
const requireFrontend = createRequire(path.join(__dirname, '..', 'apps/benefits-network/frontend/package.json'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(create, handler = async () => []) {
  let now = 100;
  let current = true;
  let busy = false;
  let providerCalls = 0;
  const requests = [];
  const timers = new Map();
  const provider = {
    isMetaMask: true,
    request(args) {
      requests.push({ receiver: this, args });
      return handler(args);
    },
  };
  const connector = {
    id: 'injected', type: 'injected',
    async getProvider() { providerCalls += 1; return provider; },
  };
  const probe = create({
    now: () => now,
    schedule: (callback, milliseconds) => {
      const handle = {};
      timers.set(handle, { callback, at: now + milliseconds });
      return handle;
    },
    cancelScheduled: (handle) => timers.delete(handle),
  });
  return {
    probe, connector, provider, requests, timers,
    providerCalls: () => providerCalls,
    current: (value) => { current = value; },
    busy: (value) => { busy = value; },
    advance: (milliseconds) => {
      now += milliseconds;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(handle); timer.callback(); }
      }
    },
    start: (method = 'eth_accounts', overrides = {}) => probe.start({
      method, connector, isCurrent: () => current, isOrdinaryPending: () => busy, ...overrides,
    }),
  };
}

async function main() {
  const { PROBE_METHODS, createNativeWalletProbe, isEligibleNativeConnector, isOrdinaryWalletBusy } =
    await import(pathToFileURL(modulePath).href);
  let passed = 0;
  async function check(name, run) {
    await run();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  }

  await check('import, subscription and snapshot are passive', async () => {
    const f = fixture(createNativeWalletProbe);
    const unsubscribe = f.probe.subscribe(() => {});
    assert.deepEqual(f.probe.getSnapshot(), { pending: false, current: null, records: [] });
    unsubscribe();
    assert.equal(f.providerCalls(), 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.timers.size, 0);
  });

  await check('exact five requests and original provider receiver', async () => {
    const f = fixture(createNativeWalletProbe);
    for (const { method } of PROBE_METHODS) await f.start(method);
    assert.deepEqual(f.requests.map(({ args }) => args), [
      { method: 'eth_accounts' }, { method: 'eth_chainId' }, { method: 'wallet_getPermissions' },
      { method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] },
      { method: 'eth_requestAccounts' },
    ]);
    assert.equal(f.providerCalls(), 5);
    assert.ok(f.requests.every(({ receiver }) => receiver === f.provider));
    assert.equal(f.probe.getSnapshot().records.length, 5);
    assert.equal(f.timers.size, 0);
  });

  await check('unknown methods and nonnative connectors do not dispatch', async () => {
    const f = fixture(createNativeWalletProbe);
    await f.start('eth_sendTransaction');
    assert.equal(f.probe.getSnapshot().current, null);
    for (const connector of [
      { ...f.connector, type: 'walletConnect' }, { ...f.connector, id: 'phantom' },
      { ...f.connector, type: undefined }, { ...f.connector, getProvider: undefined },
    ]) {
      assert.equal(isEligibleNativeConnector(connector), false);
      await f.start('eth_accounts', { connector });
    }
    assert.equal(f.providerCalls(), 0);
    assert.equal(f.requests.length, 0);
  });

  await check('provider compatibility does not fall back', async () => {
    const f = fixture(createNativeWalletProbe);
    for (const value of [undefined, {}, { request() {} }, { isMetaMask: true }]) {
      await f.start('eth_accounts', { connector: { ...f.connector, getProvider: async () => value } });
      assert.equal(f.probe.getSnapshot().current.state, 'provider_unavailable');
    }
    assert.equal(f.requests.length, 0);
  });

  await check('same-tick starts and soft wait retain one unresolved slot', async () => {
    const result = deferred();
    const f = fixture(createNativeWalletProbe, () => result.promise);
    const first = f.start();
    await f.start('eth_chainId');
    await Promise.resolve();
    assert.equal(f.requests.length, 1);
    f.advance(12_000);
    assert.equal(f.probe.getSnapshot().current.state, 'request_waiting_long');
    assert.equal(f.probe.getSnapshot().pending, true);
    await f.start('wallet_getPermissions');
    assert.equal(f.requests.length, 1);
    assert.equal(f.timers.size, 0);
    result.resolve([]);
    await first;
    assert.equal(f.probe.getSnapshot().pending, false);
    await f.start('eth_chainId');
    assert.equal(f.requests.length, 2);
  });

  await check('deferred provider holds slot and stale owner never dispatches', async () => {
    const provider = deferred();
    const f = fixture(createNativeWalletProbe);
    const first = f.start('eth_accounts', { connector: { ...f.connector, getProvider: () => provider.promise } });
    await f.start('eth_chainId');
    f.advance(12_000);
    assert.equal(f.probe.getSnapshot().current.state, 'provider_waiting_long');
    f.current(false);
    provider.resolve(f.provider);
    await first;
    assert.equal(f.requests.length, 0);
    assert.equal(f.probe.getSnapshot().current.state, 'not_sent');
  });

  await check('selection change after provider lookup prevents dispatch', async () => {
    const provider = deferred();
    const f = fixture(createNativeWalletProbe);
    let sameSelection = true;
    const first = f.start('eth_accounts', {
      connector: { ...f.connector, getProvider: () => provider.promise }, isCurrent: () => sameSelection,
    });
    sameSelection = false;
    provider.resolve(f.provider);
    await first;
    assert.equal(f.requests.length, 0);
    assert.equal(f.probe.getSnapshot().current.state, 'not_sent');
  });

  await check('live registry removal or replacement defeats stale render refs', async () => {
    for (const change of ['removed', 'replaced']) {
      const provider = deferred();
      const f = fixture(createNativeWalletProbe);
      const connector = { ...f.connector, uid: 'synthetic-same-id', getProvider: () => provider.promise };
      const renderedRegistry = [connector];
      let liveRegistry = [connector];
      const first = f.start('eth_accounts', {
        connector,
        isCurrent: () => renderedRegistry.includes(connector) && isEligibleNativeConnector(connector, liveRegistry),
      });
      liveRegistry = change === 'removed' ? [] : [{ ...connector }];
      provider.resolve(f.provider);
      await first;
      assert.equal(f.requests.length, 0);
      assert.equal(f.probe.getSnapshot().current.state, 'not_sent');
    }
  });

  await check('provider lookup preserves receiver and sanitizes its failures', async () => {
    const f = fixture(createNativeWalletProbe);
    let receiver;
    const connector = { ...f.connector, getProvider() { receiver = this; throw { code: -32002, message: 'synthetic-private-only' }; } };
    await f.start('eth_accounts', { connector });
    assert.equal(receiver, connector);
    assert.equal(f.requests.length, 0);
    assert.equal(f.probe.getSnapshot().current.errorCode, -32002);
    await f.start('eth_accounts', { connector: { ...connector, getProvider: () => Promise.reject('synthetic-private-only') } });
    assert.equal(f.probe.getSnapshot().current.errorCode, null);
    assert.ok(!JSON.stringify(f.probe.getSnapshot()).includes('synthetic-private-only'));
    assert.equal(f.timers.size, 0);
  });

  await check('SPA unsubscribe and remount cannot unlock a native promise', async () => {
    const result = deferred();
    const f = fixture(createNativeWalletProbe, () => result.promise);
    const unsubscribe = f.probe.subscribe(() => {});
    const first = f.start();
    await Promise.resolve();
    unsubscribe();
    f.current(false);
    const remount = f.probe.subscribe(() => {});
    assert.equal(f.probe.getSnapshot().pending, true);
    await f.start('eth_chainId');
    assert.equal(f.requests.length, 1);
    result.resolve(['synthetic-account-only']);
    await first;
    assert.equal(f.probe.getSnapshot().current.state, 'answered');
    assert.equal(f.probe.getSnapshot().current.count, 1);
    remount();
  });

  await check('late native rejection after unmount only finalizes metadata', async () => {
    const result = deferred();
    const f = fixture(createNativeWalletProbe, () => result.promise);
    let notifications = 0;
    const unsubscribe = f.probe.subscribe(() => { notifications += 1; });
    const first = f.start();
    await Promise.resolve();
    unsubscribe();
    f.current(false);
    const before = notifications;
    result.reject({ code: 4001, message: 'synthetic-hidden-error' });
    await first;
    assert.equal(notifications, before);
    assert.equal(f.probe.getSnapshot().pending, false);
    assert.equal(f.probe.getSnapshot().current.errorCode, 4001);
    assert.equal(f.requests.length, 1);
    assert.ok(!JSON.stringify(f.probe.getSnapshot()).includes('synthetic-hidden-error'));
  });

  await check('ordinary pending gates only interactive methods', async () => {
    const f = fixture(createNativeWalletProbe);
    f.busy(true);
    await f.start('wallet_requestPermissions');
    await f.start('eth_requestAccounts');
    assert.equal(f.providerCalls(), 0);
    assert.equal(f.probe.getSnapshot().current.state, 'ordinary_busy');
    for (const method of ['eth_accounts', 'eth_chainId', 'wallet_getPermissions']) await f.start(method);
    assert.equal(f.requests.length, 3);
  });

  await check('ordinary pending is rechecked after deferred provider', async () => {
    const provider = deferred();
    const f = fixture(createNativeWalletProbe);
    const first = f.start('eth_requestAccounts', { connector: { ...f.connector, getProvider: () => provider.promise } });
    f.busy(true);
    provider.resolve(f.provider);
    await first;
    assert.equal(f.requests.length, 0);
    assert.equal(f.probe.getSnapshot().current.state, 'ordinary_busy');
  });

  await check('shared cache filter and both config busy states are read fresh', async () => {
    let pending = 0;
    let observed;
    const client = { isMutating(filter) { observed = filter; return pending; } };
    const config = { state: { status: 'disconnected' } };
    assert.equal(isOrdinaryWalletBusy(client, config), false);
    assert.deepEqual(observed, { mutationKey: ['connect'], exact: true });
    pending = 1;
    assert.equal(isOrdinaryWalletBusy(client, config), true);
    pending = 0;
    for (const status of ['connecting', 'reconnecting']) {
      config.state.status = status;
      assert.equal(isOrdinaryWalletBusy(client, config), true);
    }
    config.state.status = 'connected';
    assert.equal(isOrdinaryWalletBusy(client, config), false);
  });

  await check('real QueryClient exact pending key independently gates and releases', async () => {
    // This is required in the default test. Missing frontend dependencies fail;
    // local offline qualification may use ordinary CommonJS NODE_PATH lookup.
    const { QueryClient, MutationObserver } = requireFrontend('@tanstack/query-core');
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps/benefits-network/frontend/package-lock.json'), 'utf8'));
    assert.equal(requireFrontend('@tanstack/query-core/package.json').version, lock.packages['node_modules/@tanstack/query-core'].version);
    const client = new QueryClient();
    const config = { state: { status: 'disconnected' } };
    const otherResult = deferred();
    const connectResult = deferred();
    const other = new MutationObserver(client, {
      mutationKey: ['connect', 'other'], mutationFn: () => otherResult.promise,
    });
    const connect = new MutationObserver(client, {
      mutationKey: ['connect'], mutationFn: () => connectResult.promise,
    });
    let otherRun;
    let connectRun;
    try {
      otherRun = other.mutate();
      assert.equal(client.isMutating({ mutationKey: ['connect', 'other'], exact: true }), 1);
      assert.equal(isOrdinaryWalletBusy(client, config), false);
      connectRun = connect.mutate();
      assert.equal(config.state.status, 'disconnected');
      assert.equal(client.isMutating({ mutationKey: ['connect'], exact: true }), 1);
      assert.equal(isOrdinaryWalletBusy(client, config), true);
      connectResult.resolve();
      await connectRun;
      assert.equal(config.state.status, 'disconnected');
      assert.equal(client.isMutating({ mutationKey: ['connect', 'other'], exact: true }), 1);
      assert.equal(isOrdinaryWalletBusy(client, config), false);
    } finally {
      connectResult.resolve();
      otherResult.resolve();
      await Promise.allSettled([connectRun, otherRun].filter(Boolean));
      connect.reset();
      other.reset();
      client.clear();
    }
    assert.equal(client.getMutationCache().getAll().length, 0);
  });

  await check('results reveal only shape and array length', async () => {
    let itemReads = 0;
    const sentinel = 'SYNTHETIC_PRIVATE_SENTINEL_https://invalid.example/0xABC';
    const list = [sentinel];
    Object.defineProperty(list, '0', { get() { itemReads += 1; throw new Error(sentinel); } });
    const f = fixture(createNativeWalletProbe, async () => list);
    await f.start();
    assert.equal(itemReads, 0);
    assert.equal(f.probe.getSnapshot().current.shape, 'array');
    assert.equal(f.probe.getSnapshot().current.count, 1);
    assert.ok(!JSON.stringify(f.probe.getSnapshot()).includes(sentinel));
    for (const [value, shape] of [[sentinel, 'string'], [{ secret: sentinel }, 'object'], [null, 'null'], [7, 'number'], [true, 'boolean'], [undefined, 'undefined']]) {
      const run = fixture(createNativeWalletProbe, async () => value);
      await run.start();
      assert.equal(run.probe.getSnapshot().current.shape, shape);
      assert.ok(!JSON.stringify(run.probe.getSnapshot()).includes(sentinel));
    }
  });

  await check('error projection never invokes getters or emits strings', async () => {
    let reads = 0;
    const sentinel = 'SYNTHETIC_REJECTION_SECRET';
    const getterError = Object.create(null, {
      code: { get() { reads += 1; throw new Error(sentinel); } },
      message: { get() { reads += 1; throw new Error(sentinel); } },
      stack: { get() { reads += 1; throw new Error(sentinel); } },
    });
    const errors = [getterError, Object.create({ code: 4001 }), { code: '4001', message: sentinel },
      { code: NaN }, { code: Infinity }, { code: 1.5 }, { code: 4001, message: sentinel }];
    for (let i = 0; i < errors.length; i += 1) {
      const f = fixture(createNativeWalletProbe, () => { throw errors[i]; });
      await f.start();
      assert.equal(f.probe.getSnapshot().current.errorCode, i === errors.length - 1 ? 4001 : null);
      assert.ok(!JSON.stringify(f.probe.getSnapshot()).includes(sentinel));
    }
    assert.equal(reads, 0);
  });

  await check('projection traps and primitive errors stay fixed and bounded', async () => {
    const malformed = new Proxy([], { getOwnPropertyDescriptor() { throw new Error('synthetic-only'); } });
    const f = fixture(createNativeWalletProbe, async () => malformed);
    await f.start();
    assert.equal(f.probe.getSnapshot().current.shape, 'unreadable');
    const error = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('synthetic-only'); } });
    for (const value of [error, 'synthetic-only', null, undefined]) {
      const run = fixture(createNativeWalletProbe, () => Promise.reject(value));
      await run.start();
      assert.equal(run.probe.getSnapshot().current.state, 'error');
      assert.equal(run.probe.getSnapshot().current.errorCode, null);
    }
    for (let i = 0; i < 12; i += 1) await f.start(PROBE_METHODS[i % 5].method);
    assert.equal(f.probe.getSnapshot().records.length, 5);
    assert.ok(Object.isFrozen(f.probe.getSnapshot()));
    assert.ok(Object.isFrozen(f.probe.getSnapshot().records));
  });

  await check('UI observer failure does not alter native request outcome', async () => {
    const f = fixture(createNativeWalletProbe);
    f.probe.subscribe(() => { throw new Error('synthetic UI observer failure'); });
    await f.start();
    assert.equal(f.requests.length, 1);
    assert.equal(f.probe.getSnapshot().current.state, 'answered');
    assert.equal(f.timers.size, 0);
  });

  await check('snapshots expose only finite fixed metadata fields', async () => {
    const f = fixture(createNativeWalletProbe);
    await f.start();
    const snapshot = f.probe.getSnapshot();
    assert.deepEqual(Object.keys(snapshot).sort(), ['current', 'pending', 'records']);
    assert.deepEqual(Object.keys(snapshot.current).sort(), [
      'count', 'elapsedMs', 'errorCode', 'method', 'shape', 'startedMs', 'state',
    ]);
    assert.ok(Object.isFrozen(snapshot.current));
    assert.ok(snapshot.records.every(Object.isFrozen));
    assert.ok(Number.isFinite(snapshot.current.startedMs));
    assert.ok(Number.isFinite(snapshot.current.elapsedMs));
  });

  process.stdout.write(`${JSON.stringify({ passed, failed: 0, realSharedQueryClientIntegration: 'PASS_EXACT_KEY_DISCONNECTED_CONFIG', mountedUiAndHydrationBaseline: 'NOT_RUN', realProviderOrDevice: 'NOT_RUN' })}\n`);
}

main().catch(() => {
  process.stderr.write('FAIL native wallet probe focused control\n');
  process.exitCode = 1;
});
