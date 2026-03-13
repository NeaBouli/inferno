// services/onChainReader.js — On-chain tier determination (IFRLock + BuilderRegistry + Gnosis Safe)
const { ethers } = require('ethers');

const RPC_URL = process.env.ALCHEMY_RPC_URL || process.env.RPC_URL || 'https://eth.llamarpc.com';
const IFRLOCK_ADDR = process.env.IFR_LOCK_ADDRESS || '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb';

const ABI_LOCK = [
  'function getLockAmount(address user) view returns (uint256)'
];

// BuilderRegistry — Phase 3
const BUILDER_REGISTRY_ADDR = process.env.BUILDER_REGISTRY_ADDR || null;
const ABI_BUILDER = [
  'function isBuilder(address) view returns (bool)'
];

// Gnosis Safe — Signer auto-sync
const GNOSIS_SAFE_ADDR = process.env.GNOSIS_SAFE_ADDR ||
  '0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b';
const ABI_SAFE = [
  'function getOwners() view returns (address[])'
];

// Cache: key → { val, ts }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Signer cache (separate, same TTL)
let signerCache = { owners: [], ts: 0 };

function getProvider() {
  return new ethers.providers.JsonRpcProvider(RPC_URL);
}

// ── Gnosis Safe: getSignerWallets() ─────────────────
async function getSignerWallets() {
  if (Date.now() - signerCache.ts < CACHE_TTL && signerCache.owners.length > 0) {
    return signerCache.owners;
  }

  try {
    const provider = getProvider();
    const safe = new ethers.Contract(GNOSIS_SAFE_ADDR, ABI_SAFE, provider);
    const owners = await safe.getOwners();
    const normalized = owners.map(a => a.toLowerCase());
    signerCache = { owners: normalized, ts: Date.now() };
    return normalized;
  } catch (e) {
    // Fallback: env variable if Safe unreachable
    const fallback = (process.env.SIGNER_WALLETS || '')
      .split(',').map(a => a.trim().toLowerCase()).filter(a => a.startsWith('0x'));
    if (fallback.length > 0) return fallback;
    // Last resort: deployer address
    return ['0x6b36687b0cd4386fb14cf565b67d7862110fed67'];
  }
}

// ── IFRLock: getLockedBalance() ─────────────────────
async function getLockedBalance(wallet) {
  const key = 'lock:' + wallet.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.val;

  try {
    const provider = getProvider();
    const lock = new ethers.Contract(IFRLOCK_ADDR, ABI_LOCK, provider);
    const bal = await lock.getLockAmount(wallet);
    const result = parseFloat(ethers.utils.formatUnits(bal, 9));
    cache.set(key, { val: result, ts: Date.now() });
    return result;
  } catch (e) {
    return 0;
  }
}

// ── BuilderRegistry: isBuilderOnChain() ─────────────
async function isBuilderOnChain(wallet) {
  if (!BUILDER_REGISTRY_ADDR) return false;

  const key = 'builder:' + wallet.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.val;

  try {
    const provider = getProvider();
    const registry = new ethers.Contract(BUILDER_REGISTRY_ADDR, ABI_BUILDER, provider);
    const result = await registry.isBuilder(wallet);
    cache.set(key, { val: result, ts: Date.now() });
    return result;
  } catch (e) {
    return false;
  }
}

// ── determineTier() — full on-chain check ───────────
async function determineTier(wallet) {
  const { builderWhitelist } = require('./verificationStore');
  const w = wallet.toLowerCase();

  // Tier 1: Signer (Gnosis Safe owners, auto-synced)
  const signers = await getSignerWallets();
  if (signers.includes(w)) return 'signer';

  // Tier 3: Builder (on-chain or whitelist)
  const builderOnChain = await isBuilderOnChain(w);
  if (builderOnChain || builderWhitelist.has(w)) return 'builder';

  // Tier 2: Voter (IFRLock > 0)
  const locked = await getLockedBalance(w);
  if (locked > 0) return 'voter';

  return 'community';
}

module.exports = { getLockedBalance, isBuilderOnChain, determineTier, getSignerWallets };
