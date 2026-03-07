// services/onchain.js — Ethereum Read-Only Calls (ethers v5)
// IFR Token: 9 Decimals — IMMER formatUnits(amount, 9) nutzen, NICHT formatEther()
require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');
const cache = require('./cache');
const logger = require('./logger');

const INITIAL_SUPPLY = 1_000_000_000; // 1 Milliarde IFR

// Minimale ABIs — nur benötigte Funktionen
const TOKEN_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const LOCK_ABI = [
  'function isLocked(address user, uint256 minAmount) view returns (bool)',
  'function getLockAmount(address user) view returns (uint256)',
];

// Provider — lazy init
let provider = null;
let tokenContract = null;
let lockContract = null;

function getProvider() {
  if (!provider) {
    provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_RPC_URL);
  }
  return provider;
}

function getTokenContract() {
  if (!tokenContract) {
    tokenContract = new ethers.Contract(
      process.env.IFR_TOKEN_ADDRESS,
      TOKEN_ABI,
      getProvider()
    );
  }
  return tokenContract;
}

function getLockContract() {
  if (!lockContract) {
    lockContract = new ethers.Contract(
      process.env.IFR_LOCK_ADDRESS,
      LOCK_ABI,
      getProvider()
    );
  }
  return lockContract;
}

/**
 * Lock-Status einer Wallet prüfen.
 * Gibt { isLocked, lockAmount (IFR als String), wallet } zurück.
 */
async function getLockStatus(wallet) {
  if (!ethers.utils.isAddress(wallet)) {
    throw new Error('Ungültige Ethereum-Adresse');
  }

  const cacheKey = `lock_${wallet.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const contract = getLockContract();

  // ethers v5: 0 als normale Zahl, KEIN 0n (BigInt-Literal)
  const locked = await contract.isLocked(wallet, ethers.BigNumber.from(0));
  let amount = ethers.BigNumber.from(0);
  try {
    amount = await contract.getLockAmount(wallet);
  } catch (e) {
    // Wallet hat noch nie gelockt — amount bleibt 0
  }

  const result = {
    wallet,
    isLocked: locked,
    lockAmount: ethers.utils.formatUnits(amount, 9), // 9 Decimals!
  };

  cache.set(cacheKey, result, parseInt(process.env.CACHE_TTL_SECONDS || '60'));
  return result;
}

/**
 * Burns & Supply abrufen.
 * Primär: Railway Proxy (gecacht, korrekt berechnet)
 * Fallback: Direkt via ethers.js RPC
 */
async function getBurnStats() {
  const cacheKey = 'burn_stats';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const ttl = parseInt(process.env.CACHE_TTL_BURNS || '300');

  // Primär: Railway Proxy
  try {
    const url = `${process.env.RAILWAY_API_URL}/api/ifr/supply`;
    const { data } = await axios.get(url, { timeout: 5000 });
    const totalSupply = data.totalSupply ?? data.total_supply ?? 0;
    const burned = data.burned ?? data.totalBurned ?? 0;
    const burnedPercent = burned > 0 ? (burned / 1000000000 * 100) : 0;
    const result = {
      totalSupply,
      burned,
      burnedPercent: parseFloat(burnedPercent.toFixed(4)),
      source: 'railway',
    };
    cache.set(cacheKey, result, ttl);
    return result;
  } catch (err) {
    logger.warn({ err: err.message }, 'Railway proxy unavailable, falling back to RPC');
  }

  // Fallback: direkt via RPC
  const contract = getTokenContract();
  const rawSupply = await contract.totalSupply();
  const totalSupply = parseFloat(ethers.utils.formatUnits(rawSupply, 9));
  const burned = INITIAL_SUPPLY - totalSupply;
  const burnedPercent = (burned / INITIAL_SUPPLY) * 100;

  const result = {
    totalSupply: Math.round(totalSupply),
    burned: Math.round(burned),
    burnedPercent: parseFloat(burnedPercent.toFixed(4)),
    source: 'rpc',
  };

  cache.set(cacheKey, result, ttl);
  return result;
}

module.exports = { getLockStatus, getBurnStats };
