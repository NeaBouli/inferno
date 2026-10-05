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
import { connect, reconnect } from 'wagmi/actions';
import { mainnet } from 'wagmi/chains';
import { deferUntilChosen, RECENT_CONNECTOR_STORAGE_KEY } from '../src/lib/deferredWalletConnector.mjs';

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
function fakeSdkConnector(id, log) {
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
    async isAuthorized() { await this.getProvider(); return true; },
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

function makeConfig(log, storage) {
  return createConfig({
    chains: [mainnet],
    connectors: [deferUntilChosen(fakeSdkConnector('sdkA', log)), deferUntilChosen(fakeSdkConnector('sdkB', log))],
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

{
  // Returning visitor who chose sdkB before: its session is still restored.
  const log = [];
  const storage = memoryStorage();
  await storage.setItem(RECENT_CONNECTOR_STORAGE_KEY, 'sdkB');
  const config = makeConfig(log, storage);
  const restored = await reconnect(config);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].connector.id, 'sdkB');
  assert.ok(!log.some((entry) => entry.startsWith('sdkA:')), 'non-recent SDK must stay dormant on reconnect');
}

console.log('[wallet-telemetry-config] PASS');
