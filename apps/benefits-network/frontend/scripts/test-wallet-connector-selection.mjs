#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createConfig, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors/coinbaseWallet';
import { injected } from 'wagmi/connectors/injected';
import {
  listAvailableWalletConnectors,
  selectPreferredWalletConnector,
  walletConnectionErrorMessage,
  walletConnectorLabel,
} from '../src/lib/walletConnectorSelection.mjs';

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

assert.equal(await selectPreferredWalletConnector([metamask, coinbase]), metamask);
assert.equal(await selectPreferredWalletConnector([unavailableInjected, metamask, coinbase]), metamask);
assert.equal(await selectPreferredWalletConnector([unavailableInjected, coinbase]), coinbase);
assert.equal(await selectPreferredWalletConnector([unavailableInjected, walletConnect]), walletConnect);
assert.equal(await selectPreferredWalletConnector([]), undefined);
assert.deepEqual(await listAvailableWalletConnectors([unavailableInjected, coinbase]), [coinbase]);
assert.deepEqual(await listAvailableWalletConnectors([metamask, coinbase]), [metamask, coinbase]);

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

console.log('[wallet-connector-selection] PASS');
