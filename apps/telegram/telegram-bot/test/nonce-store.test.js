const assert = require('node:assert/strict');
const test = require('node:test');

const { createNonceStore } = require('../src/services/nonceStore');

// Every test builds an isolated store instance (own TTL/clock) — the shared
// production instance's state is never touched and no file is involved.

// CWA-31: nonce must come from a CSPRNG — 64 bits of entropy, hex-encoded.
test('nonce format is CSPRNG hex and unique per call', () => {
  const store = createNonceStore();
  const n1 = store.createNonce('1001', 'alice');
  const n2 = store.createNonce('1002', 'bob');
  assert.match(n1, /^IFR-[0-9A-F]{16}$/);
  assert.match(n2, /^IFR-[0-9A-F]{16}$/);
  assert.notEqual(n1, n2);
});

test('a new nonce invalidates the previous one of the same user', () => {
  const store = createNonceStore();
  const first = store.createNonce('1010', 'erin');
  const second = store.createNonce('1010', 'erin');
  assert.equal(store.claimNonce(first), null, 'rotated nonce is dead');
  const data = store.claimNonce(second);
  assert.ok(data, 'current nonce claims');
  assert.equal(data.userId, '1010');
});

// Negative: expired nonces must be rejected (replay/expiry, CWA-31).
test('expired nonce is rejected and purged', () => {
  let clock = 1_000_000;
  const store = createNonceStore({ ttlMs: 1000, now: () => clock });
  const nonce = store.createNonce('1003', 'carol');
  clock += 1001; // beyond the TTL
  assert.equal(store.claimNonce(nonce), null, 'expired nonce rejected');
  clock -= 1001; // rewind: entry must be gone, not merely expired
  assert.equal(store.claimNonce(nonce), null, 'expired nonce was purged');
});

// Negative: claimed (single-use) nonces must not verify twice (CWA-32).
test('claimed nonce cannot be used again', () => {
  const store = createNonceStore();
  const nonce = store.createNonce('1004', 'dave');
  assert.ok(store.claimNonce(nonce));
  assert.equal(store.claimNonce(nonce), null);
});

test('unknown nonce is rejected', () => {
  const store = createNonceStore();
  assert.equal(store.claimNonce('IFR-DEADBEEFDEADBEEF'), null);
});

// Atomicity: claim validates and deletes synchronously, so between one claim
// and any later await no second claim of the same nonce can succeed.
test('claims of one nonce: exactly the first succeeds', () => {
  const store = createNonceStore();
  const nonce = store.createNonce('1005', 'eve');
  const results = [store.claimNonce(nonce), store.claimNonce(nonce), store.claimNonce(nonce)];
  assert.equal(results.filter(Boolean).length, 1);
});
