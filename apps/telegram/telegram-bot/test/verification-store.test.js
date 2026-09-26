const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Isolated persistence path must be set before the store module is loaded.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-store-'));
process.env.WALLET_MAP_PATH = path.join(tempDir, 'wallet-map.json');
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

const store = require('../src/services/verificationStore');

const WALLET_A = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const WALLET_B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB';
const WALLET_C = '0xCcCCCCccccCCCCccccccccCCCCCCCCccccCCCC';

// Negative: one wallet must not bind two Telegram accounts (Sybil, CWA-33).
test('setVerified rejects a wallet already bound to another account', () => {
  store.setVerified('2001', WALLET_A, 'voter');
  assert.throws(
    () => store.setVerified('2002', WALLET_A, 'voter'),
    (err) => err.code === 'WALLET_CONFLICT'
  );
  // The same account may re-verify the same wallet (idempotent re-verify).
  assert.doesNotThrow(() => store.setVerified('2001', WALLET_A, 'signer'));
});

// CWA-32: explicit unbind invalidates session and persisted mapping.
test('unverify removes binding and persisted mapping, freeing the wallet', () => {
  store.setVerified('2003', WALLET_B, 'voter');
  assert.equal(store.isVerified('2003'), true);
  assert.equal(store.unverify('2003'), true);
  assert.equal(store.isVerified('2003'), false);
  assert.equal(store.getWallet('2003'), null);
  const raw = JSON.parse(fs.readFileSync(process.env.WALLET_MAP_PATH, 'utf8'));
  assert.equal(raw['2003'], undefined);
  // Wallet is free for a new binding after unbind.
  assert.doesNotThrow(() => store.setVerified('2004', WALLET_B, 'community'));
});

test('unverify on an unbound account returns false', () => {
  assert.equal(store.unverify('9999'), false);
});

// CWA-44: the persisted wallet map must not be world-readable.
test('wallet map file is written with mode 0600', () => {
  store.setVerified('2005', WALLET_C, 'voter');
  const mode = fs.statSync(process.env.WALLET_MAP_PATH).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('tierHasTopicAccess topic matrix', () => {
  assert.equal(store.tierHasTopicAccess('signer', 58), true);   // Core Dev
  assert.equal(store.tierHasTopicAccess('signer', 21), true);   // Council
  assert.equal(store.tierHasTopicAccess('voter', 58), false);
  assert.equal(store.tierHasTopicAccess('voter', 23), true);    // Vote
  assert.equal(store.tierHasTopicAccess('builder', 11), true);  // Dev & Builder
  assert.equal(store.tierHasTopicAccess('builder', 58), false);
  assert.equal(store.tierHasTopicAccess('community', 23), false);
  assert.equal(store.tierHasTopicAccess('community', 999), true); // unprotected topic
});
