#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createConfig, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors/coinbaseWallet';
import { injected } from 'wagmi/connectors/injected';
import {
  listAvailableWalletConnectors,
  selectBrowserWalletConnector,
  selectPrimaryWalletConnector,
  selectPreferredWalletConnector,
  walletConnectionErrorMessage,
  walletConnectorLabel,
} from '../src/lib/walletConnectorSelection.mjs';
import {
  hasValidWalletConnectProjectId,
  normalizeWalletConnectProjectId,
} from '../src/lib/walletConnectProjectId.mjs';
import { detectWalletEnvironment } from '../src/lib/walletEnvironment.mjs';

const connector = (id, name, provider, type) => ({
  id,
  name,
  type,
  getProvider: async () => provider,
});

const unavailableInjected = connector('injected', 'Injected', undefined, 'injected');
const metamask = connector('io.metamask', 'MetaMask', { request() {} }, 'injected');
const coinbase = connector('coinbaseWalletSDK', 'Coinbase Wallet', { request() {} });
const walletConnect = connector('walletConnect', 'WalletConnect', { request() {} });
const unavailablePhantom = connector('app.phantom', 'Phantom', undefined, 'injected');
const trustUniversal = { id: 'trustUniversal', name: 'Trust Wallet', type: 'walletConnect' };
const sharedPhantomProvider = { isPhantom: true, request() {} };
const genericSharedProvider = connector('injected', 'Injected', sharedPhantomProvider, 'injected');
const targetedSharedProvider = connector('phantom', 'Phantom', sharedPhantomProvider, 'injected');
const announcedSharedProvider = connector('app.phantom', 'Phantom', sharedPhantomProvider, 'injected');

assert.equal(await selectPreferredWalletConnector([metamask, coinbase]), metamask);
assert.equal(await selectPreferredWalletConnector([unavailableInjected, metamask, coinbase]), metamask);
assert.equal(await selectPreferredWalletConnector([unavailableInjected, coinbase]), coinbase);
assert.equal(await selectPreferredWalletConnector([unavailableInjected, walletConnect]), walletConnect);
assert.equal(await selectPreferredWalletConnector([]), undefined);
assert.equal(await selectBrowserWalletConnector([metamask, coinbase]), metamask);
assert.equal(await selectBrowserWalletConnector([unavailableInjected, coinbase]), undefined);
assert.equal(await selectBrowserWalletConnector([unavailableInjected, walletConnect]), undefined);
assert.equal(await selectPrimaryWalletConnector([metamask, walletConnect, coinbase]), metamask);
assert.equal(await selectPrimaryWalletConnector([unavailableInjected, walletConnect, coinbase]), walletConnect);
assert.equal(await selectPrimaryWalletConnector([unavailableInjected, coinbase]), undefined);
assert.equal(await selectPrimaryWalletConnector([unavailableInjected, trustUniversal, coinbase]), trustUniversal);
assert.deepEqual(await listAvailableWalletConnectors([unavailableInjected, coinbase]), [coinbase]);
assert.deepEqual(await listAvailableWalletConnectors([metamask, coinbase]), [metamask, coinbase]);
assert.deepEqual(await listAvailableWalletConnectors([unavailablePhantom, coinbase]), [coinbase]);
assert.deepEqual(await listAvailableWalletConnectors([trustUniversal, coinbase]), [trustUniversal, coinbase]);
assert.deepEqual(
  await listAvailableWalletConnectors([
    genericSharedProvider,
    targetedSharedProvider,
    announcedSharedProvider,
    coinbase,
  ]),
  [announcedSharedProvider, coinbase],
);
assert.equal(
  await selectPreferredWalletConnector([
    genericSharedProvider,
    announcedSharedProvider,
    coinbase,
  ]),
  announcedSharedProvider,
);

const wagmiConfigWithoutInjectedProvider = createConfig({
  chains: [mainnet],
  connectors: [injected(), coinbaseWallet({ appName: 'IFR Connector Test' })],
  transports: { [mainnet.id]: http() },
});
const realWagmiSelection = await selectPreferredWalletConnector(wagmiConfigWithoutInjectedProvider.connectors);
assert.equal(realWagmiSelection?.id, 'coinbaseWalletSDK');
assert.deepEqual(
  (await listAvailableWalletConnectors(wagmiConfigWithoutInjectedProvider.connectors)).map(({ id }) => id),
  ['coinbaseWalletSDK'],
);

const throwingInjected = {
  id: 'injected',
  name: 'Injected',
  type: 'injected',
  getProvider: async () => { throw new Error('provider unavailable'); },
};
assert.equal(await selectPreferredWalletConnector([throwingInjected, coinbase]), coinbase);

assert.equal(walletConnectorLabel(unavailableInjected), 'Browser wallet');
assert.equal(walletConnectorLabel(coinbase), 'Coinbase Wallet');
assert.equal(walletConnectorLabel(walletConnect), 'WalletConnect');
assert.equal(walletConnectionErrorMessage(new Error('User rejected request')), 'Connection cancelled in the wallet.');
assert.match(walletConnectionErrorMessage(new Error('Provider not found')), /wallet provider was found/);
assert.equal(walletConnectionErrorMessage(null), 'Wallet connection failed. Open this page in your wallet app browser and try again.');
assert.equal(hasValidWalletConnectProjectId(undefined), false);
assert.equal(hasValidWalletConnectProjectId(''), false);
assert.equal(hasValidWalletConnectProjectId('your_walletconnect_project_id'), false);
assert.equal(hasValidWalletConnectProjectId('ci-walletconnect-project-id'), false);
assert.equal(hasValidWalletConnectProjectId('0123456789abcdef0123456789abcdef'), true);
assert.equal(
  normalizeWalletConnectProjectId(' 0123456789ABCDEF0123456789ABCDEF '),
  '0123456789abcdef0123456789abcdef',
);

const phantomProvider = { isPhantom: true, request() {} };
assert.deepEqual(
  detectWalletEnvironment({
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
    platform: 'MacIntel',
    maxTouchPoints: 5,
    phantomEthereum: phantomProvider,
  }),
  {
    surface: 'iPad/iPhone',
    provider: 'Phantom provider',
    detail: '1 provider available in this browser.',
    providerCount: 1,
    providerNames: ['Phantom'],
  },
);
assert.deepEqual(
  detectWalletEnvironment({
    userAgent: 'Mozilla/5.0 (Linux; Android 15)',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    ethereum: { isMetaMask: true, isPhantom: true, request() {} },
  }).providerNames,
  ['Phantom'],
);

const metamaskProvider = { isMetaMask: true, request() {} };
const trustProvider = { isTrust: true, request() {} };
const providerAggregator = {
  providers: [metamaskProvider, trustProvider, phantomProvider],
  request() {},
};
assert.deepEqual(
  detectWalletEnvironment({
    userAgent: 'Mozilla/5.0 (Linux; Android 15)',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    ethereum: providerAggregator,
    phantomEthereum: phantomProvider,
  }),
  {
    surface: 'Android',
    provider: 'MetaMask, Trust and Phantom providers',
    detail: '3 providers available in this browser.',
    providerCount: 3,
    providerNames: ['MetaMask', 'Trust', 'Phantom'],
  },
);

const coinbaseProvider = { isCoinbaseWallet: true, request() {} };
const okxProvider = { isOkxWallet: true, request() {} };
const rainbowProvider = { isRainbow: true, request() {} };
assert.deepEqual(
  detectWalletEnvironment({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    ethereum: {
      providers: [coinbaseProvider, okxProvider, rainbowProvider],
      request() {},
    },
  }),
  {
    surface: 'Desktop',
    provider: 'Coinbase, OKX and Rainbow providers',
    detail: '3 providers available in this browser.',
    providerCount: 3,
    providerNames: ['Coinbase', 'OKX', 'Rainbow'],
  },
);

const arrayAt = Array.prototype.at;
try {
  Object.defineProperty(Array.prototype, 'at', { configurable: true, value: undefined });
  assert.equal(
    detectWalletEnvironment({
      ethereum: {
        providers: [coinbaseProvider, okxProvider, rainbowProvider],
        request() {},
      },
    }).provider,
    'Coinbase, OKX and Rainbow providers',
  );
} finally {
  Object.defineProperty(Array.prototype, 'at', { configurable: true, value: arrayAt });
}

console.log('[wallet-connector-selection] PASS');
