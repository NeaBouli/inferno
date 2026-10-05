#!/usr/bin/env node
// T-280: wallet SDK telemetry stays off and SDK connectors stay dormant until
// the visitor chooses them. Complements the browser gate
// scripts/test-benefits-wallet-telemetry.js (repo root), which proves the
// built app sends no telemetry request before a wallet is chosen.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig, createConnector, createStorage, http } from 'wagmi';
import { connect, disconnect, reconnect } from 'wagmi/actions';
import { mainnet } from 'wagmi/chains';
import { deferUntilChosen, RECENT_CONNECTOR_STORAGE_KEY, SDK_SESSION_STORAGE_KEY } from '../src/lib/deferredWalletConnector.mjs';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = (name) => path.join(frontendDir, 'node_modules', ...name.split('/'));

// 1. Config: official telemetry switches are set.
const wagmiSource = await readFile(path.join(frontendDir, 'src/lib/wagmi.ts'), 'utf8');
assert.match(wagmiSource, /deferUntilChosen\(coinbaseWallet\(/, 'Coinbase connector must be deferred until chosen');
assert.match(wagmiSource, /deferUntilChosen\(walletConnect\(/, 'WalletConnect connector must be deferred until chosen');
assert.match(wagmiSource, /preference:\s*\{[^}]*telemetry:\s*false/, 'Coinbase Wallet SDK telemetry must be disabled');
assert.match(wagmiSource, /telemetryEnabled:\s*false/, 'WalletConnect Core telemetry must be disabled');

// 2. Installed SDKs still honour those switches (guards silent upgrades).
const coinbaseSdkDir = pkgDir('@coinbase/wallet-sdk');
const coinbaseFactory = await readFile(path.join(coinbaseSdkDir, 'dist/createCoinbaseWalletSDK.js'), 'utf8');
assert.match(coinbaseFactory, /preference\.telemetry !== false\)\s*\{\s*void loadTelemetryScript\(\)/, 'Coinbase SDK no longer gates telemetry on preference.telemetry');
const wcProviderDir = pkgDir('@walletconnect/ethereum-provider');
const wcProvider = await readFile(path.join(wcProviderDir, 'dist/index.js'), 'utf8');
assert.ok(wcProvider.includes('telemetryEnabled:t.telemetryEnabled'), 'WalletConnect EthereumProvider no longer forwards telemetryEnabled');

// 3. Behaviour with the real wagmi reconnect/connect actions.
function fakeSdkConnector(id, log, session = { live: true }) {
  return createConnector(() => ({
    id,
    name: id,
    type: id,
    async setup() { await this.getProvider(); },
    async connect() {
      const provider = await this.getProvider();
      assert.ok(provider, 'connect() must reach the SDK provider');
      return { accounts: ['0x0000000000000000000000000000000000000001'], chainId: mainnet.id };
    },
    async disconnect() { log.push(`${id}:disconnect`); },
    async getAccounts() { return ['0x0000000000000000000000000000000000000001']; },
    async getChainId() { return mainnet.id; },
    async getProvider() { log.push(`${id}:sdk-init`); return { sdk: id }; },
    async isAuthorized() { await this.getProvider(); return session.live; },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return createStorage({
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, value); },
      removeItem: (key) => { map.delete(key); },
    },
  });
}

function makeConfig(log, storage, ssr = false, session = { live: true }) {
  return createConfig({
    ssr,
    chains: [mainnet],
    connectors: [deferUntilChosen(fakeSdkConnector('sdkA', log, session)), deferUntilChosen(fakeSdkConnector('sdkB', log, session))],
    storage,
    transports: { [mainnet.id]: http('http://127.0.0.1:9') },
  });
}

{
  // Fresh visitor: setup + reconnect-on-load must not initialise any SDK.
  const log = [];
  const config = makeConfig(log, memoryStorage());
  await new Promise((resolve) => setTimeout(resolve, 10));
  const restored = await reconnect(config);
  assert.equal(restored.length, 0);
  assert.deepEqual(log, [], `SDK initialised before a wallet was chosen: ${log.join(', ')}`);

  // Explicit choice: only the chosen SDK initialises, and connect works.
  const [sdkA] = config.connectors;
  const result = await connect(config, { connector: sdkA });
  assert.equal(result.accounts.length, 1);
  assert.ok(log.includes('sdkA:sdk-init'));
  assert.ok(!log.some((entry) => entry.startsWith('sdkB:')), 'unchosen SDK must stay dormant');
}

// A page visit as WagmiProvider performs it with ssr: true: rehydrate the
// persisted store, then reconnect (Hydrate.onMount).
async function visit(log, storage, session) {
  // In the browser, Wagmi (ssr: true) overwrites its persisted store with the
  // empty pre-hydration state before reconnect runs; mirror that here so a
  // restore can only come from the wrapper's own session marker.
  await storage.removeItem('store');
  const config = makeConfig(log, storage, true, session);
  await config._internal.store.persist.rehydrate();
  const restored = await reconnect(config);
  return { config, restored };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

{
  // connect -> disconnect -> reload: no SDK may load until chosen again.
  const storage = memoryStorage();
  const first = await visit([], storage);
  const [sdkA] = first.config.connectors;
  await connect(first.config, { connector: sdkA });
  await disconnect(first.config, { connector: sdkA });
  await settle();
  assert.notEqual(await storage.getItem(RECENT_CONNECTOR_STORAGE_KEY), 'sdkA', 'disconnect must clear the stored wallet choice');
  assert.equal(await storage.getItem(SDK_SESSION_STORAGE_KEY), null, 'disconnect must clear the SDK session marker');

  const log = [];
  const second = await visit(log, storage);
  await settle();
  assert.equal(second.restored.length, 0, 'a disconnected wallet must not be restored');
  assert.deepEqual(log, [], `SDK loaded after the visitor disconnected: ${log.join(', ')}`);
}

{
  // Wallet-side disconnect (session ended in the wallet app) -> reload: same.
  const storage = memoryStorage();
  const first = await visit([], storage);
  const [sdkA] = first.config.connectors;
  await connect(first.config, { connector: sdkA });
  sdkA.emitter.emit('disconnect');
  await sdkA.onDisconnect();
  await settle();
  assert.notEqual(await storage.getItem(RECENT_CONNECTOR_STORAGE_KEY), 'sdkA', 'wallet-side disconnect must clear the stored wallet choice');

  const log = [];
  const second = await visit(log, storage);
  await settle();
  assert.equal(second.restored.length, 0);
  assert.deepEqual(log, [], `SDK loaded after a wallet-side disconnect: ${log.join(', ')}`);
}

{
  // connect -> reload while still connected: the session restores as before.
  const storage = memoryStorage();
  const first = await visit([], storage);
  const [sdkA] = first.config.connectors;
  await connect(first.config, { connector: sdkA });
  await settle();

  const log = [];
  const second = await visit(log, storage);
  assert.equal(second.restored.length, 1, 'a connected wallet must be restored on reload');
  assert.equal(second.restored[0].connector.id, 'sdkA');
  assert.ok(log.includes('sdkA:sdk-init'));
  assert.ok(!log.some((entry) => entry.startsWith('sdkB:')), 'the unused SDK must stay dormant on reload');
}

{
  // Still marked as connected, but the wallet session ended elsewhere: the
  // restore attempt finds nothing and the following visit stays dormant.
  const storage = memoryStorage();
  const first = await visit([], storage);
  await connect(first.config, { connector: first.config.connectors[0] });
  await settle();
  assert.equal(await storage.getItem(SDK_SESSION_STORAGE_KEY), 'sdkA');

  const session = { live: false };
  const second = await visit([], storage, session);
  await settle();
  assert.equal(second.restored.length, 0);
  assert.equal(await storage.getItem(SDK_SESSION_STORAGE_KEY), null, 'a failed restore must clear the session marker');

  const log = [];
  await visit(log, storage, session);
  await settle();
  assert.deepEqual(log, [], `SDK loaded after the session was gone: ${log.join(', ')}`);
}

console.log('[wallet-telemetry-config] PASS');
