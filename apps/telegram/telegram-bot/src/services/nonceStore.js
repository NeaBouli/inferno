// services/nonceStore.js — Single-use verification nonces for /verify (CWA-31)
//
// CSPRNG codes (64 bits hex), at most one active code per Telegram account,
// 10-minute TTL. claimNonce() validates and deletes in one synchronous step,
// so a concurrent replay can never pass the check twice; once claimed, a code
// stays burned even when the downstream verification fails (fail closed — the
// user requests a fresh code via /verify).

const crypto = require('crypto');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const SWEEP_MS = 60 * 1000;

// Factory: tests build isolated instances (own TTL/clock) instead of reaching
// into the shared instance's state.
function createNonceStore({ ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const nonces = new Map();

  function createNonce(userId, username) {
    // A new code invalidates the previous one of the same account.
    for (const [n, d] of nonces.entries()) {
      if (d.userId === String(userId)) nonces.delete(n);
    }
    const nonce = 'IFR-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    nonces.set(nonce, {
      userId: String(userId),
      username: username || 'unknown',
      createdAt: now()
    });
    return nonce;
  }

  function claimNonce(nonce) {
    const d = nonces.get(nonce);
    if (!d) return null;
    nonces.delete(nonce);
    if (now() - d.createdAt > ttlMs) return null;
    return d;
  }

  // Cleanup expired codes (unref'd: must not keep the process alive alone)
  setInterval(() => {
    const t = now();
    for (const [n, d] of nonces.entries()) {
      if (t - d.createdAt > ttlMs) nonces.delete(n);
    }
  }, SWEEP_MS).unref();

  return { createNonce, claimNonce };
}

// Shared instance used by the bot; the factory rides along for isolated tests.
module.exports = createNonceStore();
module.exports.createNonceStore = createNonceStore;
