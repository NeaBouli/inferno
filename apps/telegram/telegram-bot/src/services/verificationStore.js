// services/verificationStore.js — IFR 3-Tier Wallet Verification Store
//
// Tier 1 — SIGNER:    Gnosis Safe owners (on-chain via getOwners()) → Core Dev (58) + Council (21)
// Tier 2 — VOTER:     IFRLock.lockedBalance > 0                     → Vote (23)
// Tier 3 — BUILDER:   BuilderRegistry / Whitelist                   → Dev & Builder (11)
//
// Persistence: wallet mappings saved to WALLET_MAP_PATH (default /tmp/ifr_wallet_map.json)
// On restart: known mappings are re-verified on-chain in the background
// Nonce lifecycle (single-use codes for /verify): services/nonceStore.js

const fs = require('fs');
const path = require('path');

const WALLET_MAP_PATH = process.env.WALLET_MAP_PATH || '/tmp/ifr_wallet_map.json';

const TOPIC_ACCESS = {
  58: 'signer',   // Core Dev
  21: 'signer',   // Council
  23: 'voter',    // Vote
  11: 'builder',  // Dev & Builder
};

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
    fs.writeFileSync(WALLET_MAP_PATH, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    // writeFileSync mode only applies on creation — tighten pre-existing files too (CWA-44)
    fs.chmodSync(WALLET_MAP_PATH, 0o600);
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

// Auto-save every 5 minutes (unref'd: must not keep the process alive alone)
setInterval(saveWalletMap, 5 * 60 * 1000).unref();

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
function walletConflictError() {
  const err = new Error('wallet already bound to another Telegram account');
  err.code = 'WALLET_CONFLICT';
  return err;
}

// One wallet may be bound to at most one Telegram account (CWA-33).
function assertWalletAvailable(uid, w) {
  for (const [otherId, entry] of verifiedUsers.entries()) {
    if (otherId !== uid && entry.wallet === w) throw walletConflictError();
  }
  for (const [otherId, entry] of walletMap.entries()) {
    if (otherId !== uid && entry.wallet === w) throw walletConflictError();
  }
}

function setVerified(userId, wallet, tier) {
  const uid = String(userId);
  const w = wallet.toLowerCase();
  assertWalletAvailable(uid, w);
  verifiedUsers.set(uid, {
    wallet: w,
    tier,
    verifiedAt: Date.now()
  });
  // Persist wallet mapping for restart recovery
  walletMap.set(uid, { wallet: w, savedAt: Date.now() });
  saveWalletMap();
}

// Explicit unbind: removes the verification state and the persisted mapping
// so the account (and the wallet) is free again (CWA-32).
function unverify(userId) {
  const uid = String(userId);
  const hadSession = verifiedUsers.delete(uid);
  const hadMapping = walletMap.delete(uid);
  if (hadMapping) saveWalletMap();
  return hadSession || hadMapping;
}

function isVerified(userId) { return verifiedUsers.has(String(userId)); }
function getUser(userId) { return verifiedUsers.get(String(userId)) || null; }
function getWallet(userId) { const u = getUser(userId); return u ? u.wallet : null; }
function getTierForUser(userId) { const u = getUser(userId); return u ? u.tier : null; }

// Pure topic matrix for a given tier. The protected-topic gate calls this with
// a freshly derived on-chain tier — never with stored metadata (CWA-44).
function tierHasTopicAccess(tier, topicId) {
  const required = TOPIC_ACCESS[topicId];
  if (!required) return true; // Not a protected topic
  if (required === 'signer') return tier === 'signer';
  if (required === 'voter') return ['signer', 'voter', 'builder'].includes(tier);
  if (required === 'builder') return ['signer', 'builder'].includes(tier);
  return false;
}

function hasTopicAccess(userId, topicId) {
  const required = TOPIC_ACCESS[topicId];
  if (!required) return true; // Not a protected topic
  const user = getUser(userId);
  if (!user) return false;
  return tierHasTopicAccess(user.tier, topicId);
}

module.exports = {
  setVerified, unverify, isVerified, getUser, getWallet, getTierForUser,
  hasTopicAccess, tierHasTopicAccess, getTier,
  autoRestoreAll, reverifyFromMap,
  TOPIC_ACCESS, builderWhitelist
};
