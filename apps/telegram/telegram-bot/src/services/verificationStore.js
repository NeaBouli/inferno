// services/verificationStore.js — IFR 3-Tier Wallet Verification Store
//
// Tier 1 — SIGNER:    Gnosis Safe owners (on-chain via getOwners()) → Core Dev (58) + Council (21)
// Tier 2 — VOTER:     IFRLock.lockedBalance > 0                     → Vote (23)
// Tier 3 — BUILDER:   BuilderRegistry / Whitelist                   → Dev & Builder (11)
//
// Persistence: wallet mappings saved to /tmp/ifr_wallet_map.json
// On restart: known mappings are re-verified on-chain in the background

const fs = require('fs');
const path = require('path');

const WALLET_MAP_PATH = process.env.WALLET_MAP_PATH || '/tmp/ifr_wallet_map.json';

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

// Wallet Map (persistent): userId → wallet (survives restart via file)
const walletMap = new Map();

// Builder Whitelist (Phase 3 Placeholder)
const builderWhitelist = new Set(
  (process.env.BUILDER_WALLETS || '').split(',')
    .map(a => a.trim().toLowerCase()).filter(a => a.startsWith('0x'))
);

// ── Persistence: Save/Load wallet map ──────────────────
function saveWalletMap() {
  try {
    const data = {};
    for (const [userId, entry] of walletMap.entries()) {
      data[userId] = entry;
    }
    fs.writeFileSync(WALLET_MAP_PATH, JSON.stringify(data), 'utf8');
  } catch (e) { /* /tmp may be unavailable — ignore */ }
}

function loadWalletMap() {
  try {
    if (fs.existsSync(WALLET_MAP_PATH)) {
      const raw = JSON.parse(fs.readFileSync(WALLET_MAP_PATH, 'utf8'));
      for (const [userId, entry] of Object.entries(raw)) {
        if (entry && entry.wallet) walletMap.set(String(userId), entry);
      }
      console.log(`[Verify] Loaded ${walletMap.size} wallet mappings from disk`);
    }
  } catch (e) {
    console.error('[Verify] Failed to load wallet map:', e.message);
  }
}

// Load on module init
loadWalletMap();

// Auto-save every 5 minutes
setInterval(saveWalletMap, 5 * 60 * 1000);

// ── Auto-restore: re-verify all known wallets on-chain ──
async function autoRestoreAll() {
  if (walletMap.size === 0) return;
  console.log(`[Verify] Auto-restoring ${walletMap.size} users...`);
  const { determineTier } = require('./onChainReader');
  let restored = 0;
  for (const [userId, entry] of walletMap.entries()) {
    try {
      const tier = await determineTier(entry.wallet);
      verifiedUsers.set(String(userId), {
        wallet: entry.wallet.toLowerCase(),
        tier,
        verifiedAt: Date.now(),
        autoRestored: true
      });
      restored++;
    } catch (e) {
      console.error(`[Verify] Auto-restore failed for ${userId}:`, e.message);
    }
  }
  console.log(`[Verify] Auto-restored ${restored}/${walletMap.size} users`);
}

// ── On-demand re-verify for a single user ───────────────
async function reverifyFromMap(userId) {
  const entry = walletMap.get(String(userId));
  if (!entry || !entry.wallet) return false;
  try {
    const { determineTier } = require('./onChainReader');
    const tier = await determineTier(entry.wallet);
    verifiedUsers.set(String(userId), {
      wallet: entry.wallet.toLowerCase(),
      tier,
      verifiedAt: Date.now(),
      autoRestored: true
    });
    return true;
  } catch (e) {
    return false;
  }
}

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

// ── Tier Determination (async — uses on-chain Safe) ──
async function getTier(wallet) {
  const { getSignerWallets } = require('./onChainReader');
  const w = wallet.toLowerCase();
  const signers = await getSignerWallets();
  if (signers.includes(w)) return 'signer';
  if (builderWhitelist.has(w)) return 'builder';
  return 'community';
}

// ── User Storage ─────────────────────────────────────
function setVerified(userId, wallet, tier) {
  const uid = String(userId);
  const w = wallet.toLowerCase();
  verifiedUsers.set(uid, {
    wallet: w,
    tier,
    verifiedAt: Date.now()
  });
  // Persist wallet mapping for restart recovery
  walletMap.set(uid, { wallet: w, savedAt: Date.now() });
  saveWalletMap();
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
  autoRestoreAll, reverifyFromMap,
  TOPIC_ACCESS, builderWhitelist
};
