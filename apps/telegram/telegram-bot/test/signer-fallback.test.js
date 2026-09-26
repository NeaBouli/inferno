'use strict';

// CWA-38: no hardcoded privileged identity fallback. A Safe RPC failure with
// unset SIGNER_WALLETS must yield an empty signer set (deny), never the former
// hardcoded deployer EOA; an explicitly configured SIGNER_WALLETS list is the
// only fallback and is honored.
//
// The chain failure is injected by a narrowly scoped module stub of the ethers
// namespace (failing Contract calls, no real provider), so the test performs
// no network access and starts no retry/polling timers.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// The former hardcoded "last resort" identity from the audit finding.
const DEPLOYER_EOA = '0x6b36687b0cd4386fb14cf565b67d7862110fed67';

const botRoot = path.resolve(__dirname, '..');

// Isolated persistence + empty privileged config must be set before load.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-signer-'));
process.env.WALLET_MAP_PATH = path.join(tempDir, 'wallet-map.json');
delete process.env.SIGNER_WALLETS;
delete process.env.BUILDER_WALLETS;
delete process.env.BUILDER_REGISTRY_ADDR;
delete process.env.ALCHEMY_RPC_URL;
delete process.env.RPC_URL;
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

// ── ethers stub: every contract call rejects, no provider timers ─────────────
const ethersPath = require.resolve('ethers', { paths: [botRoot] });
const realEthers = require(ethersPath);

class FailingContract {
  getOwners() { return Promise.reject(new Error('fixture: rpc down')); }
  getLockAmount() { return Promise.reject(new Error('fixture: rpc down')); }
  isBuilder() { return Promise.reject(new Error('fixture: rpc down')); }
}
class StubProvider {}

const stubbedNamespace = {
  ...realEthers.ethers,
  JsonRpcProvider: StubProvider,
  Contract: FailingContract,
};
require.cache[ethersPath] = {
  id: ethersPath,
  filename: ethersPath,
  loaded: true,
  exports: {
    ...realEthers,
    JsonRpcProvider: StubProvider,
    Contract: FailingContract,
    ethers: stubbedNamespace,
  },
};

const reader = require('../src/services/onChainReader');

test('RPC failure with unset SIGNER_WALLETS returns an empty signer set', async () => {
  const signers = await reader.getSignerWallets();
  assert.deepEqual(signers, []);
  assert.equal(signers.includes(DEPLOYER_EOA), false);
});

test('RPC failure never grants the former deployer identity signer authority', async () => {
  assert.equal(await reader.determineTier(DEPLOYER_EOA), 'community');
});

test('explicitly configured SIGNER_WALLETS are honored during an RPC failure', async () => {
  process.env.SIGNER_WALLETS = '0x1111111111111111111111111111111111111111, 0x2222222222222222222222222222222222222222';
  try {
    const signers = await reader.getSignerWallets();
    assert.deepEqual(signers, [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ]);
    assert.equal(await reader.determineTier('0x2222222222222222222222222222222222222222'), 'signer');
  } finally {
    delete process.env.SIGNER_WALLETS;
  }
});

test('any other wallet falls back to community when every privileged read fails', async () => {
  delete process.env.SIGNER_WALLETS;
  assert.equal(await reader.determineTier('0x3333333333333333333333333333333333333333'), 'community');
});
