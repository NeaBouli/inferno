// services/verificationStore.js — IFR 3-Tier Wallet Verification Store
//
// Tier 1 — SIGNER:    Gnosis Safe Signers (Whitelist)  → Core Dev (58) + Council (21)
// Tier 2 — VOTER:     IFRLock.lockedBalance > 0        → Vote (23)
// Tier 3 — BUILDER:   BuilderRegistry / Whitelist      → Dev & Builder (11)

const SIGNER_WHITELIST = (process.env.SIGNER_WALLETS || '')
  .split(',').map(a => a.trim().toLowerCase()).filter(a => a.startsWith('0x'));

// Fallback: Deployer address
if (SIGNER_WHITELIST.length === 0) {
  SIGNER_WHITELIST.push('0x6b36687b0cd4386fb14cf565b67d7862110fed67');
}

const TOPIC_ACCESS = {
  58: 'signer',   // Core Dev
  21: 'signer',   // Council
  23: 'voter',    // Vote
  11: 'builder',  // Dev & Builder
};

// Nonce Store (TTL 10 min)
const nonceStore = new Map();
const TTL_MS = 10 * 60 * 1000;

// Verified Users: userId → { wallet, tier, verifiedAt }
const verifiedUsers = new Map();

// Builder Whitelist (Phase 3 Placeholder)
const builderWhitelist = new Set(
  (process.env.BUILDER_WALLETS || '').split(',')
    .map(a => a.trim().toLowerCase()).filter(a => a.startsWith('0x'))
);

// ── Nonce Management ─────────────────────────────────
function createNonce(userId, username) {
  // Remove old nonces for this user
  for (const [n, d] of nonceStore.entries()) {
    if (d.userId === String(userId)) nonceStore.delete(n);
  }
  const nonce = 'IFR-' +
    Math.random().toString(36).substr(2, 6).toUpperCase() + '-' +
    Date.now().toString(36).toUpperCase();
  nonceStore.set(nonce, {
    userId: String(userId),
    username: username || 'unknown',
    createdAt: Date.now()
  });
  return nonce;
}

function getNonce(nonce) {
  const d = nonceStore.get(nonce);
  if (!d) return null;
  if (Date.now() - d.createdAt > TTL_MS) { nonceStore.delete(nonce); return null; }
  return d;
}

function consumeNonce(nonce) { nonceStore.delete(nonce); }

// Cleanup expired nonces every 60s
setInterval(() => {
  const now = Date.now();
  for (const [n, d] of nonceStore.entries()) {
    if (now - d.createdAt > TTL_MS) nonceStore.delete(n);
  }
}, 60000);

// ── Tier Determination ───────────────────────────────
function getTier(wallet) {
  const w = wallet.toLowerCase();
  if (SIGNER_WHITELIST.includes(w)) return 'signer';
  if (builderWhitelist.has(w)) return 'builder';
  return 'community';
}

// ── User Storage ─────────────────────────────────────
function setVerified(userId, wallet, tier) {
  verifiedUsers.set(String(userId), {
    wallet: wallet.toLowerCase(),
    tier,
    verifiedAt: Date.now()
  });
}

function isVerified(userId) { return verifiedUsers.has(String(userId)); }
function getUser(userId) { return verifiedUsers.get(String(userId)) || null; }
function getWallet(userId) { const u = getUser(userId); return u ? u.wallet : null; }
function getTierForUser(userId) { const u = getUser(userId); return u ? u.tier : null; }

function hasTopicAccess(userId, topicId) {
  const required = TOPIC_ACCESS[topicId];
  if (!required) return true; // Not a protected topic
  const user = getUser(userId);
  if (!user) return false;
  if (required === 'signer') return user.tier === 'signer';
  if (required === 'voter') return ['signer', 'voter', 'builder'].includes(user.tier);
  if (required === 'builder') return ['signer', 'builder'].includes(user.tier);
  return false;
}

module.exports = {
  createNonce, getNonce, consumeNonce,
  setVerified, isVerified, getUser, getWallet, getTierForUser,
  hasTopicAccess, getTier,
  SIGNER_WHITELIST, TOPIC_ACCESS, builderWhitelist
};
