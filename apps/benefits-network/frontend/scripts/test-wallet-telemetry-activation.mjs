#!/usr/bin/env node
// Local fixtures only: no real SDK, session, signing, or network transport.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createConfig, createConnector, createStorage, http } from 'wagmi';
import { connect, disconnect, reconnect } from 'wagmi/actions';
import { mainnet } from 'wagmi/chains';
import { deferUntilChosen, RECENT_CONNECTOR_STORAGE_KEY, SDK_SESSION_STORAGE_KEY } from '../src/lib/deferredWalletConnector.mjs';
import { normalizeWalletConnectProjectId } from '../src/lib/walletConnectProjectId.mjs';

const guardSource = await readFile(new URL('../src/lib/wallet-telemetry-guard.mjs', import.meta.url), 'utf8');
const wagmiSource = await readFile(new URL('../src/lib/wagmi.ts', import.meta.url), 'utf8');
const pulse = 'https://pulse.walletconnect.org/batch';

function guardFixture() {
  const nativeCalls = [];
  const scope = {
    URL, Request, Response,
    document: { baseURI: 'https://benefits.invalid/synthetic' },
    fetch: (...args) => { nativeCalls.push(['fetch', ...args]); return Promise.resolve(new Response('{}')); },
    navigator: { sendBeacon: (...args) => { nativeCalls.push(['beacon', ...args]); return false; } },
  };
  const declaration = 'export function installWalletConnectTelemetryGuard()';
  assert.equal(guardSource.split(declaration).length, 2);
  const install = vm.runInNewContext('"use strict";\n' + guardSource.replace(declaration, 'function installWalletConnectTelemetryGuard()') +
    '\n;installWalletConnectTelemetryGuard;', scope, { timeout: 1000 });
  return { scope, nativeCalls, install };
}

function memoryStorage() {
  const map = new Map();
  return createStorage({ storage: {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  } });
}

function fixture({ id = 'walletConnect', storage = memoryStorage(), session = {}, guard = guardFixture() } = {}) {
  const log = [];
  let providerPromise;
  const factory = createConnector(() => ({
    id, name: id, type: id === 'injected' ? 'injected' : id,
    async setup() { await this.getProvider().catch(() => null); },
    async getProvider(parameters) {
      assert.equal(this.id, id, 'base provider receiver must be preserved');
      log.push('provider');
      if (session.providerError) throw session.providerError;
      if (!providerPromise) {
        log.push('evaluate');
        providerPromise = (async () => {
          if (id === 'walletConnect') {
            assert.equal((await guard.scope.fetch(pulse)).status, 200);
            assert.equal(guard.scope.navigator.sendBeacon(pulse), true);
          }
          return { id, parameters };
        })();
      }
      return providerPromise;
    },
    async connect() {
      await this.getProvider();
      if (session.connectError) throw session.connectError;
      return { accounts: ['0x0000000000000000000000000000000000000001'], chainId: mainnet.id };
    },
    async disconnect() {
      await this.getProvider();
      if (session.disconnectError) throw session.disconnectError;
    },
    async isAuthorized() {
      // The real WalletConnect connector catches getProvider errors here.
      try { await this.getProvider(); return session.live !== false; } catch { return false; }
    },
    async getAccounts() { await this.getProvider(); return ['0x0000000000000000000000000000000000000001']; },
    async getChainId() { await this.getProvider(); return mainnet.id; },
    onAccountsChanged() {}, onChainChanged() {},
    async onDisconnect() {
      await this.getProvider();
      if (session.onDisconnectError) throw session.onDisconnectError;
    },
  }));
  const options = id === 'walletConnect' ? { preGetProvider() { log.push('guard'); guard.install(); } } : undefined;
  const config = createConfig({
    ssr: true, chains: [mainnet], storage,
    connectors: [id === 'injected' ? factory : deferUntilChosen(factory, options)],
    transports: { [mainnet.id]: http('http://127.0.0.1:9') },
  });
  return { config, connector: config.connectors[0], storage, session, guard, log };
}

// Execute the actual configuration with synthetic settings and connector factories.
// No ambient process/environment or SDK is available in this realm.
for (const projectId of ['', 'invalid', '0123456789abcdef0123456789abcdef']) {
  let configured;
  const install = () => assert.fail('constructing the config must not install the guard');
  const connector = (id) => () => ({ id });
  const imports = {
    wagmi: { createConfig: (value) => { configured = value; return value; }, http: () => ({}) },
    'wagmi/chains': { mainnet, sepolia: { id: 11155111 } },
    'wagmi/connectors/injected': { injected: connector('injected') },
    'wagmi/connectors/coinbaseWallet': { coinbaseWallet: connector('coinbaseWalletSDK') },
    'wagmi/connectors/walletConnect': { walletConnect: connector('walletConnect') },
    '@/lib/deferredWalletConnector.mjs': { deferUntilChosen: (base, options) => ({ ...base, options }) },
    '@/lib/walletConnectProjectId.mjs': { normalizeWalletConnectProjectId },
    '@/lib/wallet-telemetry-guard.mjs': { installWalletConnectTelemetryGuard: install },
  };
  const code = ts.transpileModule(wagmiSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    exports: {}, process: { env: { NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: projectId } },
    require(name) { assert.ok(Object.hasOwn(imports, name), 'unexpected config import'); return imports[name]; },
  }, { timeout: 1000 });
  const guarded = configured.connectors.filter((entry) => entry.options?.preGetProvider);
  assert.equal(guarded.length, projectId.length === 32 ? 1 : 0);
  if (guarded.length) {
    assert.equal(guarded[0].id, 'walletConnect');
    assert.equal(guarded[0].options.preGetProvider, install);
  }
  assert.ok(configured.connectors.filter((entry) => entry.id !== 'walletConnect').every((entry) => !entry.options));
}

for (const marker of [undefined, 'coinbaseWalletSDK']) {
  const storage = memoryStorage();
  await storage.setItem(RECENT_CONNECTOR_STORAGE_KEY, 'walletConnect');
  if (marker) await storage.setItem(SDK_SESSION_STORAGE_KEY, marker);
  const f = fixture({ storage });
  await f.connector.setup();
  assert.equal(await f.connector.getProvider(), undefined);
  assert.equal(await f.connector.isAuthorized(), false);
  assert.deepEqual(await reconnect(f.config), []);
  assert.deepEqual(f.log, [], 'dormant setup, scan and reconnect must not install a guard or evaluate an SDK');
}

for (const id of ['injected', 'coinbaseWalletSDK']) {
  const f = fixture({ id });
  const nativeFetch = f.guard.scope.fetch;
  const nativeBeacon = f.guard.scope.navigator.sendBeacon;
  await connect(f.config, { connector: f.connector });
  assert.ok(!f.log.includes('guard'), `${id} must not run the WalletConnect guard`);
  assert.equal(f.guard.scope.fetch, nativeFetch);
  assert.equal(f.guard.scope.navigator.sendBeacon, nativeBeacon);
}

{
  const f = fixture();
  await connect(f.config, { connector: f.connector });
  assert.deepEqual(f.log.slice(0, 3), ['guard', 'provider', 'evaluate'], 'install before SDK evaluation');
  const fetch = f.guard.scope.fetch;
  const beacon = f.guard.scope.navigator.sendBeacon;
  const [first, second] = await Promise.all([f.connector.getProvider(), f.connector.getProvider()]);
  assert.equal(first, second, 'cached provider identity survives concurrent access');
  assert.deepEqual(f.log.slice(-4), ['guard', 'provider', 'guard', 'provider']);
  assert.equal(f.log.filter((entry) => entry === 'evaluate').length, 1);
  await disconnect(f.config, { connector: f.connector });
  assert.equal(await f.storage.getItem(SDK_SESSION_STORAGE_KEY), null);
  assert.equal(await f.storage.getItem(RECENT_CONNECTOR_STORAGE_KEY), null);
  assert.equal(f.guard.scope.fetch, fetch, 'disconnect must not uninstall the document guard');
  assert.equal(f.guard.scope.navigator.sendBeacon, beacon);
  await f.connector.getProvider();
  assert.deepEqual(f.log.slice(-2), ['guard', 'provider'], 'initialized SDK handlers remain usable after disconnect');
  const next = fixture({ storage: f.storage });
  assert.deepEqual(await reconnect(next.config), []);
  assert.deepEqual(next.log, [], 'disconnected next visit stays dormant');
  await connect(next.config, { connector: next.connector });
  assert.ok(next.log.includes('evaluate'), 'explicit choice still works after disconnect');
  assert.deepEqual(f.guard.nativeCalls, [], 'Pulse must not reach either native transport');
  const response = await f.guard.scope.fetch('https://rpc.invalid/synthetic');
  assert.equal(response.status, 200);
  assert.equal(f.guard.scope.navigator.sendBeacon('https://api.web3modal.org/getWallets'), false);
  assert.equal(f.guard.nativeCalls.length, 2, 'non-Pulse transports must still delegate');
}

for (const transport of ['fetch', 'sendBeacon']) {
  const f = fixture();
  await connect(f.config, { connector: f.connector });
  f.log.length = 0;
  const owner = transport === 'fetch' ? f.guard.scope : f.guard.scope.navigator;
  owner[transport] = () => assert.fail('replaced transport must not be used');
  await assert.rejects(f.connector.getProvider(), /guard replaced/);
  await assert.rejects(disconnect(f.config, { connector: f.connector }), /guard replaced/);
  assert.deepEqual(f.log, ['guard', 'guard'], 'cached base provider must not bypass a failed guard');
  assert.equal(f.config.state.status, 'connected');
  assert.equal(await f.storage.getItem(SDK_SESSION_STORAGE_KEY), 'walletConnect', 'failed disconnect retains marker');
  const restored = fixture({ storage: f.storage });
  assert.equal((await reconnect(restored.config)).length, 1, 'existing session can restore in a fresh document');
  assert.deepEqual(restored.log.slice(0, 3), ['guard', 'provider', 'evaluate']);
}

{
  const f = fixture();
  const beacon = f.guard.scope.navigator.sendBeacon;
  f.guard.scope.navigator.sendBeacon = undefined;
  await assert.rejects(connect(f.config, { connector: f.connector }), /guard unavailable/);
  f.guard.scope.navigator.sendBeacon = beacon;
  await assert.rejects(connect(f.config, { connector: f.connector }), /guard unavailable/);
  assert.deepEqual(f.log, ['guard', 'guard'], 'failed installation stays closed before base SDK access');
  assert.equal(await f.storage.getItem(SDK_SESSION_STORAGE_KEY), null);
}

for (const errorField of ['providerError', 'connectError']) {
  const error = new Error(`synthetic ${errorField}`);
  const f = fixture({ session: { [errorField]: error } });
  await assert.rejects(connect(f.config, { connector: f.connector }), (caught) => caught === error);
  assert.equal(await f.storage.getItem(SDK_SESSION_STORAGE_KEY), null, 'failed connect must not persist a new marker');
  assert.deepEqual(f.guard.nativeCalls, []);
}

for (const mode of ['live', 'expired', 'guard-failed']) {
  const storage = memoryStorage();
  await storage.setItem(SDK_SESSION_STORAGE_KEY, 'walletConnect');
  await storage.setItem(RECENT_CONNECTOR_STORAGE_KEY, mode === 'live' ? 'walletConnect' : 'coinbaseWalletSDK');
  const guard = guardFixture();
  if (mode === 'guard-failed') guard.scope.navigator.sendBeacon = undefined;
  const f = fixture({ storage, guard, session: { live: mode !== 'expired' } });
  await f.connector.setup();
  const restored = await reconnect(f.config);
  assert.equal(restored.length, mode === 'live' ? 1 : 0);
  // Wagmi reconnect skips isAuthorized when getProvider rejects: a guard
  // failure retains the existing marker, unlike an expired-session result.
  assert.equal(await storage.getItem(SDK_SESSION_STORAGE_KEY), mode === 'expired' ? null : 'walletConnect', mode);
  if (mode !== 'live') assert.equal(await storage.getItem(RECENT_CONNECTOR_STORAGE_KEY), 'coinbaseWalletSDK');
  if (mode === 'guard-failed') assert.ok(f.log.every((entry) => entry === 'guard'), 'restore cannot evaluate SDK after guard failure');
  else assert.deepEqual(f.log.slice(0, 3), ['guard', 'provider', 'evaluate']);
  if (mode === 'expired') {
    const next = fixture({ storage });
    assert.deepEqual(await reconnect(next.config), []);
    assert.deepEqual(next.log, []);
  } else if (mode === 'guard-failed') {
    const next = fixture({ storage });
    assert.equal((await reconnect(next.config)).length, 1, 'retained session may restore in a fresh guarded document');
  }
}

for (const fail of [false, true]) {
  const error = new Error('synthetic wallet-side disconnect failure');
  const f = fixture({ session: { onDisconnectError: fail ? error : undefined } });
  await connect(f.config, { connector: f.connector });
  if (fail) await assert.rejects(f.connector.onDisconnect(), (caught) => caught === error);
  else await f.connector.onDisconnect();
  assert.equal(await f.storage.getItem(SDK_SESSION_STORAGE_KEY), null, 'wallet-side finally must clear marker');
  assert.equal(await f.storage.getItem(RECENT_CONNECTOR_STORAGE_KEY), null);
}

console.log('[wallet-telemetry-activation] PASS wiring, dormant/order/cache, fail-closed, lifecycle (local fixtures only)');
