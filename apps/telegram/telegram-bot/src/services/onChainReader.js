// services/onChainReader.js — On-chain tier determination (IFRLock + BuilderRegistry)
const { ethers } = require('ethers');

const RPC_URL = process.env.ALCHEMY_RPC_URL || process.env.RPC_URL || 'https://eth.llamarpc.com';
const IFRLOCK_ADDR = process.env.IFR_LOCK_ADDRESS || '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb';

const ABI_LOCK = [
  'function getLockAmount(address user) view returns (uint256)'
];

// BuilderRegistry — Phase 3 Placeholder
const BUILDER_REGISTRY_ADDR = process.env.BUILDER_REGISTRY_ADDR || null;
const ABI_BUILDER = [
  'function isBuilder(address) view returns (bool)'
];

// Cache: key → { val, ts }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getProvider() {
  return new ethers.providers.JsonRpcProvider(RPC_URL);
}

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

async function determineTier(wallet) {
  const { SIGNER_WHITELIST, builderWhitelist } = require('./verificationStore');
  const w = wallet.toLowerCase();

  // Tier 1: Signer (Whitelist)
  if (SIGNER_WHITELIST.includes(w)) return 'signer';

  // Tier 3: Builder (on-chain or whitelist)
  const builderOnChain = await isBuilderOnChain(w);
  if (builderOnChain || builderWhitelist.has(w)) return 'builder';

  // Tier 2: Voter (IFRLock > 0)
  const locked = await getLockedBalance(w);
  if (locked > 0) return 'voter';

  return 'community';
}

module.exports = { getLockedBalance, isBuilderOnChain, determineTier };
