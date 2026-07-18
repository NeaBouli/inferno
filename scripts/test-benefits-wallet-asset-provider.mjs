#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  requestWalletAsset,
  selectWalletAssetProvider,
} from '../apps/benefits-network/frontend/src/lib/walletAssetProvider.mjs';

const connectorRequests = [];
const injectedRequests = [];
const connectorProvider = {
  async request(args) {
    connectorRequests.push(args);
    if (args.method === 'eth_chainId') return '0xaa36a7';
    if (args.method === 'wallet_switchEthereumChain') return null;
    if (args.method === 'wallet_watchAsset') return true;
    return null;
  },
};
const injectedProvider = {
  async request(args) {
    injectedRequests.push(args);
    return true;
  },
};

assert.equal(
  selectWalletAssetProvider({ connectorActive: true, connectorProvider, injectedProvider }),
  connectorProvider,
  'active connector must win over an injected provider'
);
assert.equal(
  selectWalletAssetProvider({ connectorActive: true, connectorProvider: {}, injectedProvider }),
  undefined,
  'invalid active connector must not fall back to another wallet'
);
assert.equal(
  selectWalletAssetProvider({ connectorActive: false, connectorProvider: undefined, injectedProvider }),
  injectedProvider,
  'injected fallback should be used only without an active connector'
);
assert.equal(
  selectWalletAssetProvider({ connectorActive: false, connectorProvider: undefined, injectedProvider: {} }),
  undefined,
  'missing provider must remain unavailable'
);

const accepted = await requestWalletAsset({
  provider: connectorProvider,
  chainId: 1,
  address: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
  symbol: 'IFR',
  decimals: 9,
  image: 'https://ifrunit.tech/assets/ifr_icon_256.png',
});
assert.equal(accepted, true);
assert.deepEqual(connectorRequests, [
  { method: 'eth_chainId' },
  { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] },
  {
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: {
        address: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
        symbol: 'IFR',
        decimals: 9,
        image: 'https://ifrunit.tech/assets/ifr_icon_256.png',
      },
    },
  },
]);
assert.equal(injectedRequests.length, 0, 'unrelated injected provider received a request');

const mainnetRequests = [];
await requestWalletAsset({
  provider: {
    async request(args) {
      mainnetRequests.push(args);
      return args.method === 'eth_chainId' ? '0x1' : true;
    },
  },
  chainId: 1,
  address: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
  symbol: 'IFR',
  decimals: 9,
  image: 'https://ifrunit.tech/assets/ifr_icon_256.png',
});
assert.equal(mainnetRequests.some((request) => request.method === 'wallet_switchEthereumChain'), false);

const declined = await requestWalletAsset({
  provider: {
    async request({ method }) {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_watchAsset') return false;
      return null;
    },
  },
  chainId: 1,
  address: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
  symbol: 'IFR',
  decimals: 9,
  image: 'https://ifrunit.tech/assets/ifr_icon_256.png',
});
assert.equal(declined, false);

const rejection = Object.assign(new Error('User rejected the request.'), { code: 4001 });
await assert.rejects(
  requestWalletAsset({
    provider: {
      async request({ method }) {
        if (method === 'eth_chainId') return '0xaa36a7';
        throw rejection;
      },
    },
    chainId: 1,
    address: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
    symbol: 'IFR',
    decimals: 9,
    image: 'https://ifrunit.tech/assets/ifr_icon_256.png',
  }),
  (error) => error === rejection
);

console.log('[benefits-wallet-asset-test] PASS');
