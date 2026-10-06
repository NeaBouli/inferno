#!/usr/bin/env node
/**
 * Model B price-evidence generator and independent verifier (T-290).
 *
 * Produces the JSON document consumed as `priceEvidence` by the Lane 4 Model B settlement
 * export (apps/benefits-network/backend/src/services/modelBSettlement.ts, priceEvidenceSchema)
 * plus a credential-free read-proof receipt, and re-derives both from chain state for
 * verification. This is a procedural control for review finding F3 (T-275); it does not
 * approve the price source, the end-block benchmark or any pilot activation.
 *
 * Price source (owner decision 2026-10-06): Uniswap V2 IFR/WETH pair TWAP over 7 days
 * (counterfactual accrual exactly as UniswapV2OracleLibrary.currentCumulativePrices) and
 * ETH/EUR from the on-chain Chainlink ETH/USD and EUR/USD aggregators read at the same
 * settlement end block, eth/eur = floor(ethUsd * 10^RATE_DECIMALS / eurUsd).
 *
 * Canonical snapshot: every state and code read is pinned to a block hash with EIP-1898
 * `{ blockHash, requireCanonical: true }`; the end block must be finalized; every pinned
 * number -> hash mapping is re-checked after the final read. Reorgs, missing archive data,
 * unsupported pinning or inconsistent responses fail closed without writing output.
 *
 * Read-only: this tool never signs, never sends a transaction and never writes chain state.
 * Diagnostics never contain the RPC URL, raw RPC error text or provider payloads.
 *
 * Usage:
 *   node scripts/model-b-price-evidence.mjs generate --rpc <url> --period YYYY-MM --end-block <n> --out evidence.json --receipt receipt.json
 *   node scripts/model-b-price-evidence.mjs verify --rpc <url> --period YYYY-MM --file evidence.json [--receipt receipt.json]
 *
 * Exit codes: 0 success, 1 generation/verification failure, 2 usage error.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ethers } from 'ethers';

// ── Pinned mainnet constants ────────────────────────────────────────────────
// IFR/WETH Uniswap V2 pair (the only IFR market), its factory and both tokens.
export const PAIR_ADDRESS = '0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0';
export const UNISWAP_V2_FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
export const IFR_TOKEN_ADDRESS = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const IFR_DECIMALS = 9;
export const WETH_DECIMALS = 18;
// Canonical Chainlink aggregator proxies, decimals and heartbeats from Chainlink's official
// data-feeds registry (the data source behind https://docs.chain.link/data-feeds/price-feeds/addresses):
// https://reference-data-directory.vercel.app/feeds-mainnet.json (entries "eth-usd" / "eur-usd").
export const CHAINLINK_REGISTRY_URL = 'https://reference-data-directory.vercel.app/feeds-mainnet.json';
export const CHAINLINK_ETH_USD = Object.freeze({ address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', description: 'ETH / USD', decimals: 8, heartbeatSeconds: 3600, label: 'ETH/USD' });
export const CHAINLINK_EUR_USD = Object.freeze({ address: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1', description: 'EUR / USD', decimals: 8, heartbeatSeconds: 86400, label: 'EUR/USD' });
export const FEEDS = Object.freeze([CHAINLINK_ETH_USD, CHAINLINK_EUR_USD]);

// keccak256 of the deployed runtime code, read with block-hash pinning on 2026-10-06
// (finalized block 26132402). The pair, factory and tokens are immutable; the feed
// proxies are immutable proxies (the aggregator behind them may rotate and is recorded
// in the receipt instead of pinned).
export const MAINNET_CODE_HASHES = Object.freeze({
  [PAIR_ADDRESS.toLowerCase()]: '0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5',
  [UNISWAP_V2_FACTORY_ADDRESS.toLowerCase()]: '0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0',
  [IFR_TOKEN_ADDRESS.toLowerCase()]: '0x80d99e75fceacca75077e0530ecad622e11e8225883dc8679948f572d6c8f699',
  [WETH_ADDRESS.toLowerCase()]: '0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23',
  [CHAINLINK_ETH_USD.address.toLowerCase()]: '0x4b79b5c8aee6da0f7b393e8b53e6265ef7320a1d16184c65bd3841b5aa3d700d',
  [CHAINLINK_EUR_USD.address.toLowerCase()]: '0x4b79b5c8aee6da0f7b393e8b53e6265ef7320a1d16184c65bd3841b5aa3d700d',
});

// Must stay configurable in the pilot policy: modelBPolicy.ts restricts reviewed source ids
// to /^[A-Za-z0-9._:-]{1,80}$/, so the id uses ':' instead of '+'/'/' separators.
export const REVIEWED_SOURCE_ID = 'uniswap-v2-twap:chainlink-eth-usd:eur-usd';
export const RECEIPT_KIND = 'ifr-model-b-price-evidence-receipt/1';
export const RATE_DECIMALS = 8;
export const EXPECTED_CHAIN_ID = 1;

// Settlement policy bounds mirrored from modelBSettlement.ts (kept in sync by review;
// the backend module is the authoritative copy and re-validates every bound itself).
export const TWAP_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const TWAP_WINDOW_TOLERANCE_SECONDS = 60 * 60;
export const SETTLEMENT_MAX_LAG_SECONDS = 72 * 60 * 60;
export const ETH_EUR_MAX_SKEW_SECONDS = 24 * 60 * 60;

const Q112 = 2n ** 112n;
const UINT32_MOD = 2n ** 32n;
const UINT224_MOD = 2n ** 224n;
const UINT256_MOD = 2n ** 256n;

const PAIR_IFACE = new ethers.Interface([
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function price0CumulativeLast() view returns (uint256)',
]);
const FACTORY_IFACE = new ethers.Interface(['function getPair(address, address) view returns (address)']);
const ERC20_IFACE = new ethers.Interface(['function decimals() view returns (uint8)']);
const FEED_IFACE = new ethers.Interface([
  'function description() view returns (string)',
  'function decimals() view returns (uint8)',
  'function aggregator() view returns (address)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);
export const ABI = Object.freeze({ PAIR_IFACE, FACTORY_IFACE, ERC20_IFACE, FEED_IFACE });

// ── Errors ──────────────────────────────────────────────────────────────────
// Only ToolError messages are ever printed. They are built from fixed text, chain values
// and numeric RPC codes — never from the RPC URL, raw provider messages or payloads.

export class ToolError extends Error {}
export class UsageError extends ToolError {}

export class RpcFailure extends ToolError {
  constructor(method, kind, detail = '') {
    super(`RPC ${method} failed: ${kind}${detail ? ` (${detail})` : ''}`);
    this.method = method;
    this.kind = kind;
  }
}

export class VerificationError extends ToolError {
  constructor(mismatches) {
    super(`Price evidence does not reproduce from chain:\n${mismatches.map((m) => `  - ${m}`).join('\n')}`);
    this.mismatches = mismatches;
  }
}

// ── Pure computation ────────────────────────────────────────────────────────

/**
 * Counterfactual price0 cumulative at a block, identical to
 * UniswapV2OracleLibrary.currentCumulativePrices: the stored price0CumulativeLast plus the
 * accrual the pair would have added between blockTimestampLast and the block timestamp.
 * Accumulators are uint256 (mod 2^256), elapsed time is uint32 (mod 2^32); the UQ112x112
 * quotient always fits uint224 for uint112 reserves.
 */
export function currentCumulativePrice0({ price0CumulativeLast, reserve0, reserve1, blockTimestampLast, blockTimestamp }) {
  const last = BigInt(price0CumulativeLast);
  const r0 = BigInt(reserve0);
  const r1 = BigInt(reserve1);
  if (r0 <= 0n || r1 <= 0n) throw new ToolError('Pair reserves must be positive');
  if (r0 >= Q112 || r1 >= Q112) throw new ToolError('Pair reserves do not fit uint112');
  const ts32 = BigInt(blockTimestamp) % UINT32_MOD;
  const tsLast32 = BigInt(blockTimestampLast) % UINT32_MOD;
  const timeElapsed = (ts32 - tsLast32 + UINT32_MOD) % UINT32_MOD;
  // FixedPoint.uq112x112.encode(reserve1).uqdiv(reserve0): uint224 floor division.
  const quotient = (r1 * Q112) / r0;
  if (quotient >= UINT224_MOD) throw new ToolError('Price quotient does not fit uint224');
  return (last + quotient * timeElapsed) % UINT256_MOD;
}

/** eth/eur = floor(ethUsd * 10^rateDecimals / eurUsd); both answers in their feed decimals. */
export function computeEthEurRate({ ethUsdAnswer, eurUsdAnswer, rateDecimals = RATE_DECIMALS }) {
  const ethUsd = BigInt(ethUsdAnswer);
  const eurUsd = BigInt(eurUsdAnswer);
  if (ethUsd <= 0n || eurUsd <= 0n) throw new ToolError('Chainlink answers must be positive');
  return (ethUsd * 10n ** BigInt(rateDecimals)) / eurUsd;
}

/** Rejects malformed, stale, non-positive, incomplete or future-dated Chainlink rounds. */
export function assertValidChainlinkRound({ roundId, answer, startedAt, updatedAt, answeredInRound, blockTimestamp, heartbeatSeconds, feedLabel = 'feed' }) {
  const problems = [];
  const id = BigInt(roundId);
  const answered = BigInt(answeredInRound);
  const started = BigInt(startedAt);
  const updated = BigInt(updatedAt);
  if (id <= 0n) problems.push('roundId is zero');
  if (answered <= 0n) problems.push('answeredInRound is zero');
  if (answered < id) problems.push('answeredInRound < roundId (incomplete round)');
  if (BigInt(answer) <= 0n) problems.push('non-positive answer');
  if (started <= 0n) problems.push('startedAt is zero');
  if (updated <= 0n) problems.push('updatedAt is zero');
  if (started > 0n && updated > 0n && started > updated) problems.push('startedAt is after updatedAt');
  const age = BigInt(blockTimestamp) - updated;
  if (updated > 0n && age < 0n) problems.push('updatedAt is after the settlement block');
  if (updated > 0n && age > BigInt(heartbeatSeconds)) problems.push(`stale answer (${age}s old, heartbeat ${heartbeatSeconds}s)`);
  if (problems.length > 0) throw new ToolError(`Chainlink ${feedLabel} round rejected: ${problems.join('; ')}`);
}

/** The 7-day TWAP window bound enforced by the settlement validator. */
export function assertSettlementWindow({ startTimestamp, endTimestamp }) {
  const windowSeconds = endTimestamp - startTimestamp;
  if (windowSeconds < TWAP_WINDOW_SECONDS || windowSeconds > TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS) {
    throw new ToolError(`TWAP window is ${windowSeconds}s, must be within [${TWAP_WINDOW_SECONDS}, ${TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS}]`);
  }
  return windowSeconds;
}

/** Settlement periods are whole UTC calendar months, half-open [start, end) — mirrors modelBSettlement. */
export function settlementPeriodEndSeconds(period) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period));
  if (!match) throw new UsageError('Settlement period must be a UTC calendar month (YYYY-MM)');
  return Date.UTC(Number(match[1]), Number(match[2]), 1) / 1000;
}

/**
 * Period bounds equivalent to validatePriceEvidence: the settlement (end) block lies in
 * [period end, period end + 72h]; the ETH/EUR reference lies within 24h of the end block
 * and within [period end - 24h, period end + 72h].
 */
export function assertPeriodBounds({ period, endTimestamp, publishedAtSeconds }) {
  const periodEnd = settlementPeriodEndSeconds(period);
  const latest = periodEnd + SETTLEMENT_MAX_LAG_SECONDS;
  const iso = (s) => new Date(s * 1000).toISOString();
  if (endTimestamp < periodEnd) {
    throw new ToolError(`End block (${iso(endTimestamp)}) precedes the end of period ${period} (${iso(periodEnd)})`);
  }
  if (endTimestamp > latest) {
    throw new ToolError(`End block (${iso(endTimestamp)}) is more than ${SETTLEMENT_MAX_LAG_SECONDS / 3600}h after the end of period ${period}`);
  }
  if (publishedAtSeconds === undefined) return;
  if (Math.abs(publishedAtSeconds - endTimestamp) > ETH_EUR_MAX_SKEW_SECONDS) {
    throw new ToolError(`ETH/EUR reference (${iso(publishedAtSeconds)}) is more than ${ETH_EUR_MAX_SKEW_SECONDS / 3600}h away from the end block`);
  }
  if (publishedAtSeconds < periodEnd - ETH_EUR_MAX_SKEW_SECONDS || publishedAtSeconds > latest) {
    throw new ToolError(`ETH/EUR reference (${iso(publishedAtSeconds)}) is not bound to period ${period}`);
  }
}

/** Deterministic ETH/EUR source label (<= 120 chars, matches the settlement schema bound). */
export function ethEurSourceLabel() {
  return `chainlink eth/usd ${CHAINLINK_ETH_USD.address.toLowerCase()} eur/usd ${CHAINLINK_EUR_USD.address.toLowerCase()}`;
}

/** Same algorithm as canonicalDigest in modelBSettlement.ts: keccak256 of key-sorted JSON. */
export function canonicalDigest(value) {
  const canonicalize = (v) => {
    if (Array.isArray(v)) return v.map(canonicalize);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalize(v[k])]));
    return v;
  };
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonicalize(value))));
}

/**
 * Assembles the evidence object in exactly the shape of priceEvidenceSchema
 * (lowercase addresses and hashes, decimal-string integers, rounding floor).
 */
export function buildEvidence({ start, end, ethEur }) {
  const observation = (obs) => ({
    blockNumber: obs.blockNumber,
    blockHash: obs.blockHash.toLowerCase(),
    timestamp: obs.timestamp,
    price0Cumulative: BigInt(obs.price0Cumulative).toString(),
  });
  return {
    reviewedSourceId: REVIEWED_SOURCE_ID,
    pair: PAIR_ADDRESS.toLowerCase(),
    token0: IFR_TOKEN_ADDRESS.toLowerCase(),
    start: observation(start),
    end: observation(end),
    ethEur: {
      source: ethEur.source,
      publishedAt: ethEur.publishedAt,
      rate: BigInt(ethEur.rate).toString(),
      decimals: ethEur.decimals,
    },
    rounding: 'floor',
  };
}

// ── JSON-RPC transport ──────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 30_000;
const ARCHIVE_ERROR_PATTERN = /missing trie node|state is unavailable|state not available|header not found|missing header|historical state|pruned|archive/i;

/** Maps a JSON-RPC error message to a fixed diagnostic kind; the message itself is never printed. */
export function classifyRpcErrorMessage(message) {
  return ARCHIVE_ERROR_PATTERN.test(String(message ?? '')) ? 'archive-state-unavailable' : 'rpc-error';
}

function archiveHint(kind) {
  return kind === 'archive-state-unavailable' || kind === 'http-403'
    ? '; historical state is unavailable or gated, an archive-capable Ethereum mainnet RPC is required'
    : '';
}

/** Validates the RPC URL without ever echoing it. */
export function parseRpcUrl(rpcUrl) {
  let url;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new UsageError('--rpc must be a valid http(s) URL (the value is never printed)');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError('--rpc must be an http(s) URL (the value is never printed)');
  }
  return url;
}

/** Minimal JSON-RPC client over fetch: one request per call, no batching, no retries, safe errors. */
export function makeHttpRpc(rpcUrl) {
  const url = parseRpcUrl(rpcUrl);
  const headers = { 'content-type': 'application/json' };
  if (url.username || url.password) {
    const user = decodeURIComponent(url.username);
    const pass = decodeURIComponent(url.password);
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  const endpoint = url.toString();
  let nextId = 0;
  return async function rpc(method, params) {
    nextId += 1;
    const id = nextId;
    let response;
    let text;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        redirect: 'error',
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      throw new RpcFailure(method, error?.name === 'TimeoutError' ? 'timeout' : 'network-error');
    }
    if (!response.ok) {
      const status = Number.isSafeInteger(response.status) ? response.status : 0;
      const kind = `http-${status}`;
      throw new RpcFailure(method, kind, archiveHint(kind).slice(2));
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new RpcFailure(method, 'malformed-response', 'body is not JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== id) {
      throw new RpcFailure(method, 'malformed-response', 'not a matching JSON-RPC 2.0 response');
    }
    if (body.error !== undefined) {
      const code = Number.isSafeInteger(body.error?.code) ? body.error.code : 'unknown';
      const kind = classifyRpcErrorMessage(body.error?.message);
      throw new RpcFailure(method, kind, `code ${code}${archiveHint(kind)}`);
    }
    if (!('result' in body)) throw new RpcFailure(method, 'malformed-response', 'missing result');
    return body.result;
  };
}

// ── Chain reader (strict parsing, EIP-1898 pinned reads) ────────────────────

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY_RE = /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const DATA_RE = /^0x([0-9a-fA-F]{2})*$/;

function quantity(value, what) {
  if (typeof value !== 'string' || !QUANTITY_RE.test(value)) throw new ToolError(`Malformed RPC response: ${what} is not a hex quantity`);
  const n = Number(BigInt(value));
  if (!Number.isSafeInteger(n)) throw new ToolError(`Malformed RPC response: ${what} out of range`);
  return n;
}

function parseHeader(raw, what, expectedNumber) {
  if (raw === null || raw === undefined) throw new ToolError(`${what} not found on the RPC`);
  if (typeof raw !== 'object') throw new ToolError(`Malformed RPC response: ${what} is not a block`);
  const header = {
    number: quantity(raw.number, `${what} number`),
    hash: raw.hash,
    parentHash: raw.parentHash,
    timestamp: quantity(raw.timestamp, `${what} timestamp`),
  };
  if (typeof header.hash !== 'string' || !HASH_RE.test(header.hash)) throw new ToolError(`Malformed RPC response: ${what} hash`);
  if (typeof header.parentHash !== 'string' || !HASH_RE.test(header.parentHash)) throw new ToolError(`Malformed RPC response: ${what} parentHash`);
  header.hash = header.hash.toLowerCase();
  header.parentHash = header.parentHash.toLowerCase();
  if (expectedNumber !== undefined && header.number !== expectedNumber) {
    throw new ToolError(`Inconsistent RPC response: asked for block ${expectedNumber}, got ${header.number}`);
  }
  return header;
}

/** Wraps a JSON-RPC function (see makeHttpRpc) into the strict reads this tool needs. */
export function makeChainReader(rpc) {
  const pinned = (blockHash) => ({ blockHash, requireCanonical: true });
  return {
    async chainId() {
      return quantity(await rpc('eth_chainId', []), 'eth_chainId');
    },
    async headerByNumber(tag) {
      const param = typeof tag === 'number' ? ethers.toQuantity(tag) : tag;
      const what = typeof tag === 'number' ? `block ${tag}` : `${tag} block`;
      return parseHeader(await rpc('eth_getBlockByNumber', [param, false]), what, typeof tag === 'number' ? tag : undefined);
    },
    async headerByHash(hash) {
      const raw = await rpc('eth_getBlockByHash', [hash, false]);
      return raw === null ? null : parseHeader(raw, `block ${hash}`);
    },
    async call(to, data, blockHash) {
      const result = await rpc('eth_call', [{ to, data }, pinned(blockHash)]);
      if (typeof result !== 'string' || !DATA_RE.test(result)) throw new ToolError('Malformed RPC response: eth_call result is not hex data');
      return result;
    },
    async getCode(address, blockHash) {
      const result = await rpc('eth_getCode', [address, pinned(blockHash)]);
      if (typeof result !== 'string' || !DATA_RE.test(result)) throw new ToolError('Malformed RPC response: eth_getCode result is not hex data');
      return result;
    },
  };
}

async function pinnedCall(reader, header, address, iface, fn, args = []) {
  const raw = await reader.call(address, iface.encodeFunctionData(fn, args), header.hash);
  try {
    return iface.decodeFunctionResult(fn, raw);
  } catch {
    throw new ToolError(`Malformed ${fn}() result from ${address} at block ${header.number}`);
  }
}

// Hash that no chain will ever contain; a pinned read against it must be rejected.
const PINNING_PROBE_HASH = ethers.id('ifr-model-b-price-evidence/eip-1898-pinning-probe');

/** Fails closed when the RPC silently ignores EIP-1898 block-hash pinning. */
export async function assertPinningHonoured(reader) {
  try {
    await reader.call(IFR_TOKEN_ADDRESS, ERC20_IFACE.encodeFunctionData('decimals'), PINNING_PROBE_HASH);
  } catch (error) {
    if (error instanceof RpcFailure && (error.kind === 'rpc-error' || error.kind === 'archive-state-unavailable')) return;
    throw error;
  }
  throw new ToolError('RPC ignores EIP-1898 block-hash pinning (a read at an unknown block hash succeeded); use a different RPC');
}

/** Greatest block number <= high whose timestamp is <= targetTimestamp (timestamps are monotone). */
export async function findBlockAtOrBefore(reader, targetTimestamp, high) {
  let lo = 1;
  let hi = high;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const header = await reader.headerByNumber(mid);
    if (header.timestamp <= targetTimestamp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function readCodeHash(reader, header, address, codeHashes) {
  const code = await reader.getCode(address, header.hash);
  if (code === '0x') throw new ToolError(`No contract code at ${address} at block ${header.number}`);
  const hash = ethers.keccak256(code);
  const expected = codeHashes[address.toLowerCase()];
  if (hash !== expected) throw new ToolError(`Contract code at ${address} at block ${header.number} has hash ${hash}, expected pinned ${expected}`);
  return hash;
}

const eqAddr = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Authenticates pair, factory and tokens at a pinned block and returns the read proof. */
async function readPairIdentity(reader, header, codeHashes) {
  for (const address of [PAIR_ADDRESS, UNISWAP_V2_FACTORY_ADDRESS, IFR_TOKEN_ADDRESS, WETH_ADDRESS]) {
    await readCodeHash(reader, header, address, codeHashes);
  }
  const [factory] = await pinnedCall(reader, header, PAIR_ADDRESS, PAIR_IFACE, 'factory');
  if (!eqAddr(factory, UNISWAP_V2_FACTORY_ADDRESS)) throw new ToolError(`Pair factory at block ${header.number} is ${factory}, not the Uniswap V2 factory`);
  const [registered] = await pinnedCall(reader, header, UNISWAP_V2_FACTORY_ADDRESS, FACTORY_IFACE, 'getPair', [IFR_TOKEN_ADDRESS, WETH_ADDRESS]);
  if (!eqAddr(registered, PAIR_ADDRESS)) throw new ToolError(`Factory getPair(IFR, WETH) at block ${header.number} is ${registered}, not the pinned pair`);
  const [token0] = await pinnedCall(reader, header, PAIR_ADDRESS, PAIR_IFACE, 'token0');
  if (!eqAddr(token0, IFR_TOKEN_ADDRESS)) throw new ToolError(`Pair token0 at block ${header.number} is ${token0}, not IFR`);
  const [token1] = await pinnedCall(reader, header, PAIR_ADDRESS, PAIR_IFACE, 'token1');
  if (!eqAddr(token1, WETH_ADDRESS)) throw new ToolError(`Pair token1 at block ${header.number} is ${token1}, not WETH`);
  const [ifrDecimals] = await pinnedCall(reader, header, IFR_TOKEN_ADDRESS, ERC20_IFACE, 'decimals');
  if (Number(ifrDecimals) !== IFR_DECIMALS) throw new ToolError(`IFR decimals at block ${header.number} are ${ifrDecimals}, expected ${IFR_DECIMALS}`);
  const [wethDecimals] = await pinnedCall(reader, header, WETH_ADDRESS, ERC20_IFACE, 'decimals');
  if (Number(wethDecimals) !== WETH_DECIMALS) throw new ToolError(`WETH decimals at block ${header.number} are ${wethDecimals}, expected ${WETH_DECIMALS}`);
}

async function readPairState(reader, header) {
  const [reserve0, reserve1, blockTimestampLast] = await pinnedCall(reader, header, PAIR_ADDRESS, PAIR_IFACE, 'getReserves');
  const [price0CumulativeLast] = await pinnedCall(reader, header, PAIR_ADDRESS, PAIR_IFACE, 'price0CumulativeLast');
  const price0Cumulative = currentCumulativePrice0({ price0CumulativeLast, reserve0, reserve1, blockTimestampLast, blockTimestamp: header.timestamp });
  return {
    proof: {
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
      blockTimestampLast: Number(blockTimestampLast),
      price0CumulativeLast: price0CumulativeLast.toString(),
    },
    price0Cumulative,
  };
}

const roundTuple = (r) => ({ roundId: r[0], answer: r[1], startedAt: r[2], updatedAt: r[3], answeredInRound: r[4] });

async function readFeed(reader, header, feed, codeHashes) {
  const codeHash = await readCodeHash(reader, header, feed.address, codeHashes);
  const [description] = await pinnedCall(reader, header, feed.address, FEED_IFACE, 'description');
  if (description !== feed.description) throw new ToolError(`Chainlink ${feed.label} description at block ${header.number} is "${String(description).slice(0, 40)}", expected "${feed.description}"`);
  const [decimals] = await pinnedCall(reader, header, feed.address, FEED_IFACE, 'decimals');
  if (Number(decimals) !== feed.decimals) throw new ToolError(`Chainlink ${feed.label} decimals at block ${header.number} are ${decimals}, expected ${feed.decimals}`);
  const [aggregator] = await pinnedCall(reader, header, feed.address, FEED_IFACE, 'aggregator');
  const latest = roundTuple(await pinnedCall(reader, header, feed.address, FEED_IFACE, 'latestRoundData'));
  assertValidChainlinkRound({ ...latest, blockTimestamp: header.timestamp, heartbeatSeconds: feed.heartbeatSeconds, feedLabel: feed.label });
  const byId = roundTuple(await pinnedCall(reader, header, feed.address, FEED_IFACE, 'getRoundData', [latest.roundId]));
  for (const key of Object.keys(latest)) {
    if (byId[key] !== latest[key]) throw new ToolError(`Chainlink ${feed.label} getRoundData(${latest.roundId}) disagrees with latestRoundData on ${key} at block ${header.number}`);
  }
  return {
    label: feed.label,
    proxy: feed.address.toLowerCase(),
    codeHash,
    description,
    decimals: Number(decimals),
    heartbeatSeconds: feed.heartbeatSeconds,
    aggregator: String(aggregator).toLowerCase(),
    roundId: latest.roundId.toString(),
    answer: latest.answer.toString(),
    startedAt: Number(latest.startedAt),
    updatedAt: Number(latest.updatedAt),
    answeredInRound: latest.answeredInRound.toString(),
  };
}

/** Re-reads every pinned number -> hash mapping (both directions); any drift fails closed. */
async function assertStillCanonical(reader, headers, endNumber) {
  for (const header of headers) {
    const byNumber = await reader.headerByNumber(header.number);
    if (byNumber.hash !== header.hash) throw new ToolError(`Reorg detected: block ${header.number} is now ${byNumber.hash}, was ${header.hash}`);
    const byHash = await reader.headerByHash(header.hash);
    if (!byHash) throw new ToolError(`Reorg detected: block hash ${header.hash} is no longer known to the RPC`);
    if (byHash.number !== header.number || byHash.hash !== header.hash) throw new ToolError(`Inconsistent RPC response: block hash ${header.hash} maps to block ${byHash.number}`);
  }
  const finalized = await reader.headerByNumber('finalized');
  if (finalized.number < endNumber) throw new ToolError(`Inconsistent RPC response: finalized head moved back below end block ${endNumber}`);
}

/**
 * Derives the evidence and its read-proof receipt from a canonical, finalized snapshot.
 * Shared by generate and verify; verify additionally distrusts and diffs every supplied field.
 */
export async function deriveEvidence(reader, { period, endBlockNumber, codeHashes = MAINNET_CODE_HASHES }) {
  settlementPeriodEndSeconds(period);
  if (!Number.isSafeInteger(endBlockNumber) || endBlockNumber <= 1) throw new UsageError('--end-block must be a positive integer');
  const chainId = await reader.chainId();
  if (chainId !== EXPECTED_CHAIN_ID) throw new ToolError(`RPC is not Ethereum mainnet (chainId ${EXPECTED_CHAIN_ID} required, got ${chainId})`);
  await assertPinningHonoured(reader);

  const finalized = await reader.headerByNumber('finalized');
  if (endBlockNumber > finalized.number) throw new ToolError(`End block ${endBlockNumber} is not finalized yet (finalized head ${finalized.number}); wait and retry`);
  const end = await reader.headerByNumber(endBlockNumber);
  assertPeriodBounds({ period, endTimestamp: end.timestamp });

  // Deterministic start: latest canonical block at or before end.timestamp - 7d; the next
  // block is the witness that no later block qualifies.
  const target = end.timestamp - TWAP_WINDOW_SECONDS;
  const startNumber = await findBlockAtOrBefore(reader, target, endBlockNumber - 1);
  const start = await reader.headerByNumber(startNumber);
  const startNext = await reader.headerByNumber(startNumber + 1);
  if (start.timestamp > target || startNext.timestamp <= target) throw new ToolError(`Start block selection is not deterministic around block ${startNumber}`);
  const windowSeconds = assertSettlementWindow({ startTimestamp: start.timestamp, endTimestamp: end.timestamp });

  await readPairIdentity(reader, start, codeHashes);
  await readPairIdentity(reader, end, codeHashes);
  const startState = await readPairState(reader, start);
  const endState = await readPairState(reader, end);
  const feedProofs = [];
  for (const feed of FEEDS) feedProofs.push(await readFeed(reader, end, feed, codeHashes));
  const [ethUsd, eurUsd] = feedProofs;

  const publishedAtSeconds = Math.min(ethUsd.updatedAt, eurUsd.updatedAt);
  assertPeriodBounds({ period, endTimestamp: end.timestamp, publishedAtSeconds });
  const rate = computeEthEurRate({ ethUsdAnswer: ethUsd.answer, eurUsdAnswer: eurUsd.answer });

  await assertStillCanonical(reader, [start, startNext, end], end.number);

  const evidence = buildEvidence({
    start: { blockNumber: start.number, blockHash: start.hash, timestamp: start.timestamp, price0Cumulative: startState.price0Cumulative },
    end: { blockNumber: end.number, blockHash: end.hash, timestamp: end.timestamp, price0Cumulative: endState.price0Cumulative },
    ethEur: { source: ethEurSourceLabel(), publishedAt: new Date(publishedAtSeconds * 1000).toISOString(), rate, decimals: RATE_DECIMALS },
  });
  const blockProof = (h) => ({ number: h.number, hash: h.hash, parentHash: h.parentHash, timestamp: h.timestamp });
  const receipt = {
    kind: RECEIPT_KIND,
    period,
    chainId,
    evidenceDigest: canonicalDigest(evidence),
    pinning: 'eip-1898 blockHash requireCanonical; end block finalized; number<->hash rechecked after final read',
    blocks: { start: blockProof(start), startNext: blockProof(startNext), end: blockProof(end) },
    twap: { targetStartTimestamp: target, windowSeconds },
    identity: {
      pair: PAIR_ADDRESS.toLowerCase(),
      factory: UNISWAP_V2_FACTORY_ADDRESS.toLowerCase(),
      token0: IFR_TOKEN_ADDRESS.toLowerCase(),
      token1: WETH_ADDRESS.toLowerCase(),
      token0Decimals: IFR_DECIMALS,
      token1Decimals: WETH_DECIMALS,
      codeHashes: Object.fromEntries([PAIR_ADDRESS, UNISWAP_V2_FACTORY_ADDRESS, IFR_TOKEN_ADDRESS, WETH_ADDRESS].map((a) => [a.toLowerCase(), codeHashes[a.toLowerCase()]])),
      checkedAtBlocks: [start.number, end.number],
    },
    pairState: { start: startState.proof, end: endState.proof },
    feeds: feedProofs,
    sources: {
      chainlinkRegistry: CHAINLINK_REGISTRY_URL,
      uniswapOracleLibrary: 'https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2OracleLibrary.sol',
      eip1898: 'https://eips.ethereum.org/EIPS/eip-1898',
    },
  };
  return { evidence, receipt, finalizedNumber: finalized.number };
}

// ── Generate ────────────────────────────────────────────────────────────────

export async function generateEvidence(reader, { period, endBlockNumber, codeHashes }) {
  return deriveEvidence(reader, { period, endBlockNumber, codeHashes });
}

// ── Verify ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural guard so a malformed evidence file fails with a clear message instead
 * of a TypeError. The authoritative schema check is priceEvidenceSchema in the backend.
 */
export function assertEvidenceShape(evidence) {
  const problems = [];
  const observation = (obs, label) => {
    if (!obs || typeof obs !== 'object') { problems.push(`${label} observation missing`); return; }
    if (!Number.isSafeInteger(obs.blockNumber) || obs.blockNumber <= 1) problems.push(`${label}.blockNumber`);
    if (typeof obs.blockHash !== 'string' || !HASH_RE.test(obs.blockHash)) problems.push(`${label}.blockHash`);
    if (!Number.isSafeInteger(obs.timestamp) || obs.timestamp <= 0) problems.push(`${label}.timestamp`);
    if (typeof obs.price0Cumulative !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(obs.price0Cumulative)) problems.push(`${label}.price0Cumulative`);
  };
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new ToolError('Evidence file does not contain a JSON object');
  observation(evidence.start, 'start');
  observation(evidence.end, 'end');
  if (!evidence.ethEur || typeof evidence.ethEur !== 'object') problems.push('ethEur missing');
  if (problems.length > 0) {
    throw new ToolError(`Evidence file does not match the expected shape (${problems.join(', ')}); validate it against priceEvidenceSchema or regenerate it`);
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => {
  const text = JSON.stringify(v) ?? String(v);
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

/** Lists every difference between the re-derived value and the supplied one, by JSON path. */
export function diffValues(expected, actual, at, out = []) {
  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      if (!(key in actual)) out.push(`${at}.${key} is missing, chain re-derivation gives ${show(expected[key])}`);
      else if (!(key in expected)) out.push(`${at}.${key} is not part of the re-derived document`);
      else diffValues(expected[key], actual[key], `${at}.${key}`, out);
    }
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push(`${at} has ${actual.length} entries, chain re-derivation gives ${expected.length}`);
    for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) diffValues(expected[i], actual[i], `${at}[${i}]`, out);
  } else if (!Object.is(expected, actual)) {
    out.push(`${at} is ${show(actual)}, chain re-derivation gives ${show(expected)}`);
  }
  return out;
}

/**
 * Distrusts every supplied field: re-derives evidence (and receipt) for the explicitly
 * expected period from the canonical chain at the stated end block, including the
 * deterministic start block, and fails on any difference.
 */
export async function verifyEvidence(reader, evidence, { period, receipt, codeHashes } = {}) {
  if (!period) throw new UsageError('Missing required --period YYYY-MM (the period the evidence must settle)');
  settlementPeriodEndSeconds(period);
  assertEvidenceShape(evidence);
  if (evidence.end.blockNumber <= evidence.start.blockNumber) throw new VerificationError(['end block must follow the start block']);
  let derived;
  try {
    derived = await deriveEvidence(reader, { period, endBlockNumber: evidence.end.blockNumber, codeHashes });
  } catch (error) {
    if (error instanceof RpcFailure || error instanceof UsageError || !(error instanceof ToolError)) throw error;
    throw new VerificationError([`evidence does not reproduce for period ${period} at end block ${evidence.end.blockNumber}: ${error.message}`]);
  }
  const mismatches = diffValues(derived.evidence, evidence, 'evidence');
  if (receipt !== undefined) diffValues(derived.receipt, receipt, 'receipt', mismatches);
  if (mismatches.length > 0) throw new VerificationError(mismatches);
  return {
    receipt: derived.receipt,
    checks: [
      `chainId = 1; EIP-1898 pinning honoured; end block ${evidence.end.blockNumber} finalized (head ${derived.finalizedNumber})`,
      `period ${period}: end block and ETH/EUR reference within the settlement bounds`,
      `start block ${evidence.start.blockNumber} is the latest block at or before end - 7d (witness ${derived.receipt.blocks.startNext.number})`,
      'pair, factory, tokens (IFR 9 / WETH 18 decimals) and feed proxies authenticated by pinned code hash at the pinned blocks',
      'Chainlink ETH/USD + EUR/USD rounds well-formed, positive, fresh and consistent with getRoundData',
      'every evidence field reproduced exactly from chain',
      receipt !== undefined ? 'every receipt read proof reproduced exactly from chain' : 'receipt not supplied: read proofs not compared',
      'number <-> hash mappings unchanged after the final read',
    ],
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  node scripts/model-b-price-evidence.mjs generate --rpc <url> --period YYYY-MM --end-block <n> --out evidence.json --receipt receipt.json
  node scripts/model-b-price-evidence.mjs verify --rpc <url> --period YYYY-MM --file evidence.json [--receipt receipt.json]

Read-only. Requires an archive-capable Ethereum mainnet RPC that supports EIP-1898 block-hash
pinning. The RPC URL and raw RPC errors are never printed (they may contain credentials).
Exit codes: 0 success, 1 failure, 2 usage error.`;

const FLAGS = ['rpc', 'period', 'end-block', 'out', 'receipt', 'file'];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new UsageError('Unexpected positional argument (values are never printed)');
    const eq = token.indexOf('=');
    const flag = token.slice(2, eq === -1 ? undefined : eq);
    if (!FLAGS.includes(flag)) throw new UsageError(/^[a-z-]{1,20}$/.test(flag) ? `Unknown option: --${flag}` : 'Unknown option');
    if (flag in args) throw new UsageError(`Duplicate option: --${flag}`);
    const value = eq === -1 ? rest[++i] : token.slice(eq + 1);
    if (value === undefined || value === '') throw new UsageError(`Missing value for --${flag}`);
    args[flag] = value;
  }
  return args;
}

function readJsonFile(file, what) {
  let text;
  try {
    text = fs.readFileSync(file);
  } catch (error) {
    throw new ToolError(`Cannot read ${what} file (${error?.code ?? 'read error'})`);
  }
  try {
    return { value: JSON.parse(text.toString('utf8')), sha256: crypto.createHash('sha256').update(text).digest('hex') };
  } catch {
    throw new ToolError(`${what} file is not valid JSON`);
  }
}

function writeNewFile(file, content, what) {
  try {
    fs.writeFileSync(file, content, { flag: 'wx' });
  } catch (error) {
    throw new ToolError(`Cannot write ${what} file (${error?.code ?? 'write error'}); existing files are never overwritten`);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.command !== 'generate' && args.command !== 'verify') {
    throw new UsageError(args.command ? 'Unknown command (generate|verify)' : 'Missing command (generate|verify)');
  }
  if (!args.rpc) throw new UsageError('Missing required --rpc <url>');
  if (!args.period) throw new UsageError('Missing required --period YYYY-MM');
  settlementPeriodEndSeconds(args.period);
  const reader = makeChainReader(makeHttpRpc(args.rpc));

  if (args.command === 'generate') {
    if (!args['end-block']) throw new UsageError('Missing required --end-block <n>');
    if (!args.out || !args.receipt) throw new UsageError('Missing required --out <evidence.json> and --receipt <receipt.json>');
    if (!/^[1-9][0-9]{0,15}$/.test(args['end-block'])) throw new UsageError('--end-block must be a positive integer');
    const endBlockNumber = Number(args['end-block']);
    const { evidence, receipt, finalizedNumber } = await generateEvidence(reader, { period: args.period, endBlockNumber });
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    writeNewFile(args.out, json, 'evidence');
    writeNewFile(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`, 'receipt');
    process.stderr.write(
      `Generated price evidence for period ${args.period} (end block finalized, head ${finalizedNumber})\n` +
      `  start block ${evidence.start.blockNumber} (${new Date(evidence.start.timestamp * 1000).toISOString()})\n` +
      `  end block   ${evidence.end.blockNumber} (${new Date(evidence.end.timestamp * 1000).toISOString()})\n` +
      `  window ${evidence.end.timestamp - evidence.start.timestamp}s, ethEur ${evidence.ethEur.rate}e-${evidence.ethEur.decimals} published ${evidence.ethEur.publishedAt}\n` +
      `  canonical evidence digest (keccak256, key-sorted JSON) ${receipt.evidenceDigest}\n` +
      `  evidence file bytes sha256 ${crypto.createHash('sha256').update(json).digest('hex')}\n`
    );
    return;
  }

  if (!args.file) throw new UsageError('Missing required --file <evidence.json>');
  const evidenceFile = readJsonFile(args.file, 'evidence');
  const receiptFile = args.receipt ? readJsonFile(args.receipt, 'receipt') : undefined;
  const { checks, receipt } = await verifyEvidence(reader, evidenceFile.value, { period: args.period, receipt: receiptFile?.value });
  process.stderr.write(
    `Verified price evidence for period ${args.period} against chain:\n${checks.map((c) => `  ok: ${c}`).join('\n')}\n` +
    `  canonical evidence digest (keccak256, key-sorted JSON) ${receipt.evidenceDigest}\n` +
    `  evidence file bytes sha256 ${evidenceFile.sha256}\n`
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      if (error instanceof UsageError) {
        process.stderr.write(`Usage error: ${error.message}\n${USAGE}\n`);
        process.exit(2);
      }
      // Only messages this tool constructed are printed; anything else may embed RPC details.
      process.stderr.write(error instanceof ToolError
        ? `Error: ${error.message}\n`
        : 'Error: unexpected internal failure (details suppressed because they may contain RPC credentials)\n');
      process.exit(1);
    }
  );
}
