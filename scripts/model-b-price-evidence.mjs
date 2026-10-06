#!/usr/bin/env node
/**
 * Model B price-evidence generator and independent verifier (T-290).
 *
 * Produces the JSON document consumed as `priceEvidence` by the Lane 4 Model B settlement
 * export (apps/benefits-network/backend/src/services/modelBSettlement.ts, priceEvidenceSchema)
 * and re-derives every field of such a document from canonical chain state. The backend only
 * schema-checks evidence (T-275 finding F3); this tool is the operator-side chain check that
 * must pass before any Safe proposal. F3 stays OPEN until the owner/Codex review accepts it.
 *
 * Price source (owner decision 2026-10-06): Uniswap V2 IFR/WETH pair TWAP over 7 days
 * (counterfactual accrual exactly as UniswapV2OracleLibrary.currentCumulativePrices) and
 * ETH/EUR from the on-chain Chainlink ETH/USD and EUR/USD feeds read at the same settlement
 * end block, eth/eur = floor(ethUsd * 10^RATE_DECIMALS / eurUsd).
 *
 * Canonical snapshot (EIP-1898): every state/code read is pinned to the selected block hash
 * with `requireCanonical: true`; both blocks must be finalized; after the final read the
 * number -> hash mapping of both blocks is re-checked. A reorg, unsupported pinning, missing
 * archive state or any inconsistent response fails closed and produces no evidence.
 *
 * Diagnostics never contain the RPC URL, raw RPC/HTTP error text or argument values: every
 * failure is reported as a constant category (EvidenceError.code) plus a detail built only
 * from pinned constants and validated chain values.
 *
 * Read-only: this tool never signs, never sends a transaction and never writes chain state.
 *
 * Usage:
 *   node scripts/model-b-price-evidence.mjs generate --period YYYY-MM --end-block <n> [--out evidence.json] [--receipt receipt.json] [--rpc <url>]
 *   node scripts/model-b-price-evidence.mjs verify   --period YYYY-MM --file evidence.json [--receipt receipt.json] [--rpc <url>]
 * The RPC URL can be given via MODEL_B_EVIDENCE_RPC_URL instead of --rpc (keeps it out of ps).
 *
 * Exit codes: 0 success, 1 generation/verification failure, 2 usage error.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ethers } from 'ethers';

export const TOOL_VERSION = 2;

// ── Pinned mainnet identity ─────────────────────────────────────────────────
export const EXPECTED_CHAIN_ID = 1;
// IFR/WETH Uniswap V2 pair (the only IFR market), its canonical factory and both tokens.
export const PAIR_ADDRESS = '0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0';
export const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
export const IFR_TOKEN_ADDRESS = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
export const IFR_DECIMALS = 9;
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const WETH_DECIMALS = 18;
// Chainlink aggregator proxies, worker-attributed from Chainlink's data-feeds registry
// (https://docs.chain.link/data-feeds/price-feeds/addresses, backing JSON
// https://reference-data-directory.vercel.app/feeds-mainnet.json, entries "eth-usd"/"eur-usd").
// Identity is additionally pinned on chain: proxy code, decimals, description and a live
// aggregator with code at the pinned end block.
export const CHAINLINK_ETH_USD = {
  address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  heartbeatSeconds: 3600,
  label: 'ETH/USD',
  description: 'ETH / USD',
  decimals: 8,
};
export const CHAINLINK_EUR_USD = {
  address: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
  heartbeatSeconds: 86400,
  label: 'EUR/USD',
  description: 'EUR / USD',
  decimals: 8,
};
export const FEEDS = [CHAINLINK_ETH_USD, CHAINLINK_EUR_USD];

// Must stay configurable in the pilot policy: modelBPolicy.ts restricts reviewed source ids
// to /^[A-Za-z0-9._:-]{1,80}$/, so the id uses ':' instead of '+'/'/' separators.
export const REVIEWED_SOURCE_ID = 'uniswap-v2-twap:chainlink-eth-usd:eur-usd';
export const RATE_DECIMALS = 8;

// Settlement policy bounds mirrored from modelBSettlement.ts (validatePriceEvidence). The
// backend module stays authoritative and re-validates every bound itself.
export const TWAP_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const TWAP_WINDOW_TOLERANCE_SECONDS = 60 * 60;
export const SETTLEMENT_MAX_LAG_SECONDS = 72 * 60 * 60;
export const ETH_EUR_MAX_SKEW_SECONDS = 24 * 60 * 60;

const Q112 = 2n ** 112n;
const UINT32_MOD = 2n ** 32n;
const UINT224_MOD = 2n ** 224n;
const UINT256_MOD = 2n ** 256n;

// A block hash that cannot exist; an RPC that answers a read pinned to it ignores EIP-1898.
export const PINNING_PROBE_HASH = ethers.id('inferno:model-b-price-evidence:eip-1898-pinning-probe');

// ── Errors and safe diagnostics ─────────────────────────────────────────────

/**
 * Every failure the tool reports. `code` is a constant category; `detail` is built only from
 * pinned constants, numbers and validated hex values — never from RPC/HTTP error text, the RPC
 * URL or CLI argument values, so printing it cannot leak credentials.
 */
export class EvidenceError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'EvidenceError';
    this.code = code;
    this.detail = detail;
  }
}

export class VerificationError extends EvidenceError {
  constructor(mismatches) {
    super('VERIFICATION_MISMATCH', `price evidence does not reproduce from canonical chain state:\n${mismatches.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'VerificationError';
    this.mismatches = mismatches;
  }
}

const fail = (code, detail) => { throw new EvidenceError(code, detail); };

// Classification patterns are only matched internally; the matched text is never printed.
const REORG_PATTERN = /not currently canonical|not canonical|non-canonical|noncanonical/i;
const BLOCK_UNAVAILABLE_PATTERN = /header for hash not found|unknown block|block not found|header not found|could not find block|block .*not found/i;
const ARCHIVE_PATTERN = /missing trie node|historical state|state is unavailable|state .*not available|pruned|archive|state not found/i;
const PINNING_PATTERN = /invalid argument|invalid params|cannot unmarshal|unsupported block|blockhash|requirecanonical|eip-?1898/i;
const REVERT_PATTERN = /execution reverted|revert/i;

/** Maps a JSON-RPC error object to a constant category; never returns its message. */
export function classifyRpcError(method, rpcError) {
  const text = typeof rpcError?.message === 'string' ? rpcError.message.slice(0, 2000) : '';
  const code = Number.isSafeInteger(rpcError?.code) ? rpcError.code : 0;
  if (REORG_PATTERN.test(text)) return new EvidenceError('REORG_DETECTED', `${method}: the pinned block is no longer canonical`);
  if (ARCHIVE_PATTERN.test(text)) return new EvidenceError('ARCHIVE_UNAVAILABLE', `${method}: historical state is unavailable; an archive-capable mainnet RPC is required`);
  if (BLOCK_UNAVAILABLE_PATTERN.test(text)) return new EvidenceError('BLOCK_UNAVAILABLE', `${method}: the RPC does not know the requested block`);
  if (code === -32602 || PINNING_PATTERN.test(text)) return new EvidenceError('PINNING_UNSUPPORTED', `${method}: the RPC rejected the EIP-1898 blockHash/requireCanonical parameter`);
  if (REVERT_PATTERN.test(text)) return new EvidenceError('CALL_REVERTED', `${method}: the pinned call reverted`);
  return new EvidenceError('RPC_ERROR_RESPONSE', `${method}: JSON-RPC error code ${code}`);
}

// ── Pure computation ────────────────────────────────────────────────────────

/**
 * Counterfactual price0 cumulative at a block, identical to
 * UniswapV2OracleLibrary.currentCumulativePrices: the stored price0CumulativeLast plus the
 * accrual the pair would have added between blockTimestampLast and the block timestamp.
 * Semantics: elapsed time is uint32 (mod 2^32); the UQ112x112 quotient is a uint224 value;
 * the accumulator is uint256 (mod 2^256).
 */
export function currentCumulativePrice0({ price0CumulativeLast, reserve0, reserve1, blockTimestampLast, blockTimestamp }) {
  const last = BigInt(price0CumulativeLast);
  const r0 = BigInt(reserve0);
  const r1 = BigInt(reserve1);
  if (r0 <= 0n || r1 <= 0n) fail('PAIR_STATE_REJECTED', 'pair reserves must be positive');
  if (r0 >= Q112 || r1 >= Q112) fail('PAIR_STATE_REJECTED', 'pair reserves do not fit uint112');
  if (last < 0n || last >= UINT256_MOD) fail('PAIR_STATE_REJECTED', 'price0CumulativeLast does not fit uint256');
  const ts32 = BigInt(blockTimestamp) % UINT32_MOD;
  const tsLast32 = BigInt(blockTimestampLast) % UINT32_MOD;
  const timeElapsed = (ts32 - tsLast32 + UINT32_MOD) % UINT32_MOD;
  // FixedPoint.uq112x112.encode(reserve1).uqdiv(reserve0): uint224 floor division.
  const quotient = (r1 * Q112) / r0;
  if (quotient >= UINT224_MOD) fail('PAIR_STATE_REJECTED', 'price quotient does not fit uint224');
  return (last + quotient * timeElapsed) % UINT256_MOD;
}

/** eth/eur = floor(ethUsd * 10^rateDecimals / eurUsd); both answers in the same feed decimals. */
export function computeEthEurRate({ ethUsdAnswer, eurUsdAnswer, rateDecimals = RATE_DECIMALS }) {
  const ethUsd = BigInt(ethUsdAnswer);
  const eurUsd = BigInt(eurUsdAnswer);
  if (ethUsd <= 0n || eurUsd <= 0n) fail('FEED_ROUND_REJECTED', 'Chainlink answers must be positive');
  return (ethUsd * 10n ** BigInt(rateDecimals)) / eurUsd;
}

/** Rejects zero/malformed, incomplete, stale, non-positive or future-dated Chainlink rounds. */
export function assertValidChainlinkRound({ roundId, answer, startedAt, updatedAt, answeredInRound, blockTimestamp, heartbeatSeconds, feedLabel = 'feed' }) {
  const problems = [];
  const round = BigInt(roundId);
  const answered = BigInt(answeredInRound);
  const updated = BigInt(updatedAt);
  const started = startedAt === undefined ? undefined : BigInt(startedAt);
  if (round <= 0n) problems.push('roundId is zero');
  if (answered <= 0n) problems.push('answeredInRound is zero');
  if (answered < round) problems.push('answeredInRound < roundId (incomplete round)');
  if (BigInt(answer) <= 0n) problems.push('non-positive answer');
  if (updated <= 0n) problems.push('updatedAt is zero');
  if (started !== undefined) {
    if (started <= 0n) problems.push('startedAt is zero');
    else if (updated > 0n && started > updated) problems.push('startedAt is after updatedAt');
  }
  const age = BigInt(blockTimestamp) - updated;
  if (updated > 0n && age < 0n) problems.push('updatedAt is after the pinned block');
  if (updated > 0n && age > BigInt(heartbeatSeconds)) problems.push(`stale answer (${age}s old, heartbeat ${heartbeatSeconds}s)`);
  if (problems.length > 0) fail('FEED_ROUND_REJECTED', `Chainlink ${feedLabel} round rejected: ${problems.join('; ')}`);
}

/** The 7-day TWAP window bound enforced by the settlement validator. */
export function assertSettlementWindow({ startTimestamp, endTimestamp }) {
  const windowSeconds = endTimestamp - startTimestamp;
  if (windowSeconds < TWAP_WINDOW_SECONDS || windowSeconds > TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS) {
    fail('POLICY_BOUND', `TWAP window is ${windowSeconds}s, must be within [${TWAP_WINDOW_SECONDS}, ${TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS}]`);
  }
  return windowSeconds;
}

/** Deterministic ETH/EUR source label (<= 120 chars, matches the settlement schema bound). */
export function ethEurSourceLabel() {
  return `chainlink eth/usd ${CHAINLINK_ETH_USD.address.toLowerCase()} eur/usd ${CHAINLINK_EUR_USD.address.toLowerCase()}`;
}

/** Settlement periods are whole UTC calendar months, half-open [start, end) — mirrors modelBSettlement. */
export function settlementPeriodEndSeconds(period) {
  const match = typeof period === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period) : null;
  if (!match) fail('USAGE', 'settlement period must be a UTC calendar month (YYYY-MM)');
  return Date.UTC(Number(match[1]), Number(match[2]), 1) / 1000;
}

/**
 * Every bound validatePriceEvidence (modelBSettlement.ts) applies, except the pilot-policy
 * membership of reviewedSourceId, evaluated against the operator-supplied expected period.
 * Returns the list of violations (empty = consumer would accept the bounds).
 */
export function consumerBoundViolations(evidence, period) {
  const problems = [];
  const periodEnd = settlementPeriodEndSeconds(period);
  const latestSettlement = periodEnd + SETTLEMENT_MAX_LAG_SECONDS;
  // Supplied values are never echoed: only the field name and the pinned expected value.
  if (evidence.reviewedSourceId !== REVIEWED_SOURCE_ID) problems.push(`reviewedSourceId differs from the pinned "${REVIEWED_SOURCE_ID}"`);
  if (evidence.pair !== PAIR_ADDRESS.toLowerCase()) problems.push(`pair differs from the pinned ${PAIR_ADDRESS.toLowerCase()}`);
  if (evidence.token0 !== IFR_TOKEN_ADDRESS.toLowerCase()) problems.push(`token0 differs from the pinned IFR ${IFR_TOKEN_ADDRESS.toLowerCase()}`);
  if (evidence.rounding !== 'floor') problems.push('rounding differs from the pinned "floor"');
  if (evidence.end.blockNumber <= evidence.start.blockNumber) problems.push('end block must follow the start block');
  const windowSeconds = evidence.end.timestamp - evidence.start.timestamp;
  if (!(windowSeconds >= TWAP_WINDOW_SECONDS && windowSeconds <= TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS)) {
    problems.push(`TWAP window is outside [${TWAP_WINDOW_SECONDS}, ${TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS}] seconds`);
  }
  if (evidence.end.timestamp < periodEnd) problems.push(`end block timestamp precedes the end of period ${period} (${periodEnd})`);
  if (evidence.end.timestamp > latestSettlement) problems.push(`end block timestamp is more than 72h after the end of period ${period}`);
  const delta = (BigInt(evidence.end.price0Cumulative) - BigInt(evidence.start.price0Cumulative) + UINT256_MOD) % UINT256_MOD;
  if (delta === 0n) problems.push('cumulative price did not advance');
  if (BigInt(evidence.ethEur.rate) === 0n) problems.push('ETH/EUR rate must be positive');
  if (evidence.ethEur.decimals !== RATE_DECIMALS) problems.push(`ethEur.decimals differs from the pinned ${RATE_DECIMALS}`);
  const publishedAt = Date.parse(evidence.ethEur.publishedAt) / 1000;
  if (Number.isNaN(publishedAt) || Math.abs(publishedAt - evidence.end.timestamp) > ETH_EUR_MAX_SKEW_SECONDS) {
    problems.push('ethEur.publishedAt is not within 24h of the settlement block');
  }
  if (Number.isNaN(publishedAt) || publishedAt < periodEnd - ETH_EUR_MAX_SKEW_SECONDS || publishedAt > latestSettlement) {
    problems.push(`ethEur.publishedAt is not bound to period ${period}`);
  }
  return problems;
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

/** Canonical data digest; byte-compatible with canonicalDigest() in modelBSettlement.ts. */
export function canonicalEvidenceDigest(evidence) {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonicalize(evidence))));
}

// ── Transport (credential-safe JSON-RPC over HTTP) ──────────────────────────

/**
 * Minimal JSON-RPC transport. URL userinfo is moved into a Basic Authorization header (fetch
 * refuses credentialed URLs), redirects are refused, and every failure is mapped to a constant
 * category. Neither the URL nor any response/HTTP error text ever reaches an error message.
 */
export function makeHttpTransport(rpcUrl, { timeoutMs = 30_000, fetchImpl = globalThis.fetch } = {}) {
  let url;
  try {
    url = new URL(rpcUrl);
  } catch {
    fail('USAGE', 'the RPC URL is not a valid URL (its value is never printed)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('USAGE', 'the RPC URL must use http or https');
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (url.username || url.password) {
    let user;
    let pass;
    try {
      user = decodeURIComponent(url.username);
      pass = decodeURIComponent(url.password);
    } catch {
      fail('USAGE', 'the RPC URL credentials are not valid percent-encoding');
    }
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  const endpoint = url.toString();
  let nextId = 0;
  return {
    async request(method, params) {
      nextId += 1;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params }),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        fail(timeout ? 'RPC_TIMEOUT' : 'RPC_NETWORK_ERROR', `${method}: no response from the RPC endpoint`);
      }
      if (!response.ok) {
        const status = Number.isSafeInteger(response.status) ? response.status : 0;
        const hint = status === 401 || status === 403 ? ' (unauthorized, or historical state gated by the provider)' : status === 429 ? ' (rate limited)' : '';
        fail('RPC_HTTP_ERROR', `${method}: HTTP status ${status}${hint}`);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        fail('RPC_INVALID_RESPONSE', `${method}: response is not JSON`);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== nextId) {
        fail('RPC_INVALID_RESPONSE', `${method}: response is not a matching JSON-RPC 2.0 object`);
      }
      if (body.error !== undefined && body.error !== null) throw classifyRpcError(method, body.error);
      if (!Object.prototype.hasOwnProperty.call(body, 'result')) fail('RPC_INVALID_RESPONSE', `${method}: response has no result`);
      return body.result;
    },
  };
}

// ── Canonical chain reader (EIP-1898) ───────────────────────────────────────

const HEX_QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const HEX_DATA = /^0x([0-9a-f]{2})*$/;

function parseQuantity(value, what) {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) fail('RPC_INVALID_RESPONSE', `${what} is not a hex quantity`);
  const n = Number(BigInt(value));
  if (!Number.isSafeInteger(n)) fail('RPC_INVALID_RESPONSE', `${what} is out of range`);
  return n;
}

function parseHeader(raw, what, { number, hash } = {}) {
  if (raw === null || raw === undefined) fail('BLOCK_UNAVAILABLE', `${what} is unknown to the RPC`);
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('RPC_INVALID_RESPONSE', `${what} header is malformed`);
  const header = {
    number: parseQuantity(raw.number, `${what} number`),
    timestamp: parseQuantity(raw.timestamp, `${what} timestamp`),
    hash: typeof raw.hash === 'string' ? raw.hash.toLowerCase() : raw.hash,
    parentHash: typeof raw.parentHash === 'string' ? raw.parentHash.toLowerCase() : raw.parentHash,
  };
  if (!HASH32.test(header.hash ?? '') || !HASH32.test(header.parentHash ?? '')) fail('RPC_INVALID_RESPONSE', `${what} header hash is malformed`);
  if (number !== undefined && header.number !== number) fail('RPC_INVALID_RESPONSE', `${what} header reports block ${header.number}, requested ${number}`);
  if (hash !== undefined && header.hash !== hash.toLowerCase()) fail('RPC_INVALID_RESPONSE', `${what} header reports a different hash than requested`);
  return header;
}

const toHexQuantity = (n) => `0x${BigInt(n).toString(16)}`;
const pin = (blockHash) => ({ blockHash, requireCanonical: true });

/**
 * Chain reader over a JSON-RPC transport. Every eth_call/eth_getCode is pinned to a block hash
 * with requireCanonical (EIP-1898); numeric/tag block parameters are only used for header
 * lookups, whose number -> hash mapping is re-checked after the last state read.
 */
export function makeChainReader(transport) {
  return {
    async chainId() {
      return parseQuantity(await transport.request('eth_chainId', []), 'chain id');
    },
    async headerByNumber(numberOrTag) {
      const tag = typeof numberOrTag === 'number' ? toHexQuantity(numberOrTag) : numberOrTag;
      const what = typeof numberOrTag === 'number' ? `block ${numberOrTag}` : `${numberOrTag} block`;
      const raw = await transport.request('eth_getBlockByNumber', [tag, false]);
      return parseHeader(raw, what, typeof numberOrTag === 'number' ? { number: numberOrTag } : {});
    },
    async headerByHash(hash, expectedNumber) {
      const raw = await transport.request('eth_getBlockByHash', [hash, false]);
      return parseHeader(raw, `block ${expectedNumber}`, { number: expectedNumber, hash });
    },
    async call(blockHash, to, data) {
      const result = await transport.request('eth_call', [{ to, data }, pin(blockHash)]);
      if (typeof result !== 'string' || !HEX_DATA.test(result.toLowerCase())) fail('RPC_INVALID_RESPONSE', 'eth_call result is not hex data');
      return result.toLowerCase();
    },
    async code(blockHash, address) {
      const result = await transport.request('eth_getCode', [address, pin(blockHash)]);
      if (typeof result !== 'string' || !HEX_DATA.test(result.toLowerCase())) fail('RPC_INVALID_RESPONSE', 'eth_getCode result is not hex data');
      return result.toLowerCase();
    },
  };
}

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
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function aggregator() view returns (address)',
]);
export const ABIS = { PAIR_IFACE, FACTORY_IFACE, ERC20_IFACE, FEED_IFACE };

// Receipt values: integers as decimal strings, addresses as validated lowercase hex. Any other
// chain-returned string (e.g. description()) is recorded only as its keccak256, never raw.
const proofValue = (value) => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : { utf8Keccak256: ethers.id(value) };
  if (Array.isArray(value)) return value.map(proofValue);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
};

/** Reads pinned to one canonical block hash; every read is recorded as a credential-free proof. */
class PinnedBlock {
  constructor(reader, header, label, proofs) {
    Object.assign(this, { reader, header, label, proofs });
  }

  async call(iface, target, fn, args = []) {
    const data = iface.encodeFunctionData(fn, args);
    const raw = await this.reader.call(this.header.hash, target, data);
    let decoded;
    try {
      decoded = iface.decodeFunctionResult(fn, raw);
    } catch {
      fail('RPC_INVALID_RESPONSE', `${fn}() on ${target.toLowerCase()} at ${this.label} block ${this.header.number} returned malformed data`);
    }
    const values = [...decoded];
    this.proofs.push({
      block: this.label,
      blockNumber: this.header.number,
      blockHash: this.header.hash,
      method: 'eth_call',
      requireCanonical: true,
      target: target.toLowerCase(),
      selector: data.slice(0, 10),
      function: iface.getFunction(fn).format('sighash'),
      args: args.map(proofValue),
      result: values.length === 1 ? proofValue(values[0]) : values.map(proofValue),
      resultHash: ethers.keccak256(raw),
    });
    return values.length === 1 ? values[0] : values;
  }

  async requireCode(target, what) {
    const code = await this.reader.code(this.header.hash, target);
    this.proofs.push({
      block: this.label,
      blockNumber: this.header.number,
      blockHash: this.header.hash,
      method: 'eth_getCode',
      requireCanonical: true,
      target: target.toLowerCase(),
      codeHash: ethers.keccak256(code),
      codeBytes: (code.length - 2) / 2,
    });
    if (code === '0x') fail('IDENTITY_MISMATCH', `${what} ${target.toLowerCase()} has no code at ${this.label} block ${this.header.number}`);
    return code;
  }
}

const sameAddress = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

/** Pins pair/factory/token identity and reads the pair state at one canonical block. */
async function readPairObservation(block) {
  await block.requireCode(PAIR_ADDRESS, 'IFR/WETH pair');
  await block.requireCode(UNISWAP_V2_FACTORY, 'Uniswap V2 factory');
  await block.requireCode(IFR_TOKEN_ADDRESS, 'IFR token');
  await block.requireCode(WETH_ADDRESS, 'WETH token');
  const where = `${block.label} block ${block.header.number}`;
  const factory = await block.call(PAIR_IFACE, PAIR_ADDRESS, 'factory');
  if (!sameAddress(factory, UNISWAP_V2_FACTORY)) fail('IDENTITY_MISMATCH', `pair factory at ${where} differs from the pinned ${UNISWAP_V2_FACTORY.toLowerCase()}`);
  const registered = await block.call(FACTORY_IFACE, UNISWAP_V2_FACTORY, 'getPair', [IFR_TOKEN_ADDRESS, WETH_ADDRESS]);
  if (!sameAddress(registered, PAIR_ADDRESS)) fail('IDENTITY_MISMATCH', `factory getPair(IFR, WETH) at ${where} differs from the pinned ${PAIR_ADDRESS.toLowerCase()}`);
  const token0 = await block.call(PAIR_IFACE, PAIR_ADDRESS, 'token0');
  if (!sameAddress(token0, IFR_TOKEN_ADDRESS)) fail('IDENTITY_MISMATCH', `pair token0 at ${where} is not the pinned IFR token`);
  const token1 = await block.call(PAIR_IFACE, PAIR_ADDRESS, 'token1');
  if (!sameAddress(token1, WETH_ADDRESS)) fail('IDENTITY_MISMATCH', `pair token1 at ${where} is not the pinned WETH token`);
  const ifrDecimals = Number(await block.call(ERC20_IFACE, IFR_TOKEN_ADDRESS, 'decimals'));
  if (ifrDecimals !== IFR_DECIMALS) fail('IDENTITY_MISMATCH', `IFR decimals at ${where} differ from the pinned ${IFR_DECIMALS}`);
  const wethDecimals = Number(await block.call(ERC20_IFACE, WETH_ADDRESS, 'decimals'));
  if (wethDecimals !== WETH_DECIMALS) fail('IDENTITY_MISMATCH', `WETH decimals at ${where} differ from the pinned ${WETH_DECIMALS}`);
  const [reserve0, reserve1, blockTimestampLast] = await block.call(PAIR_IFACE, PAIR_ADDRESS, 'getReserves');
  const price0CumulativeLast = await block.call(PAIR_IFACE, PAIR_ADDRESS, 'price0CumulativeLast');
  if (BigInt(blockTimestampLast) > BigInt(block.header.timestamp)) fail('PAIR_STATE_REJECTED', `pair blockTimestampLast at ${where} is after the block timestamp`);
  const price0Cumulative = currentCumulativePrice0({ price0CumulativeLast, reserve0, reserve1, blockTimestampLast, blockTimestamp: block.header.timestamp });
  return {
    observation: { blockNumber: block.header.number, blockHash: block.header.hash, timestamp: block.header.timestamp, price0Cumulative },
    state: {
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
      blockTimestampLast: Number(blockTimestampLast),
      price0CumulativeLast: price0CumulativeLast.toString(),
      price0Cumulative: price0Cumulative.toString(),
    },
  };
}

/** Pins feed proxy identity (code, decimals, description, live aggregator) and validates the round. */
async function readFeed(block, feed) {
  const where = `end block ${block.header.number}`;
  await block.requireCode(feed.address, `Chainlink ${feed.label} proxy`);
  const decimals = Number(await block.call(FEED_IFACE, feed.address, 'decimals'));
  if (decimals !== feed.decimals) fail('IDENTITY_MISMATCH', `Chainlink ${feed.label} decimals at ${where} differ from the pinned ${feed.decimals}`);
  const description = await block.call(FEED_IFACE, feed.address, 'description');
  // The returned string is chain-controlled: compare only, never echo it.
  if (description !== feed.description) fail('IDENTITY_MISMATCH', `Chainlink ${feed.label} description at ${where} differs from the pinned "${feed.description}"`);
  const aggregator = await block.call(FEED_IFACE, feed.address, 'aggregator');
  if (/^0x0{40}$/i.test(aggregator)) fail('IDENTITY_MISMATCH', `Chainlink ${feed.label} proxy has no aggregator at ${where}`);
  await block.requireCode(aggregator, `Chainlink ${feed.label} aggregator`);
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = await block.call(FEED_IFACE, feed.address, 'latestRoundData');
  assertValidChainlinkRound({ roundId, answer, startedAt, updatedAt, answeredInRound, blockTimestamp: block.header.timestamp, heartbeatSeconds: feed.heartbeatSeconds, feedLabel: feed.label });
  return {
    label: feed.label,
    proxy: feed.address.toLowerCase(),
    aggregator: aggregator.toLowerCase(),
    description,
    decimals,
    heartbeatSeconds: feed.heartbeatSeconds,
    roundId: roundId.toString(),
    answer: answer.toString(),
    startedAt: Number(startedAt),
    updatedAt: Number(updatedAt),
    answeredInRound: answeredInRound.toString(),
  };
}

/** Fails closed unless the RPC rejects a read pinned to a block hash that cannot exist. */
export async function assertPinningEnforced(reader) {
  try {
    await reader.code(PINNING_PROBE_HASH, PAIR_ADDRESS);
  } catch (error) {
    if (error instanceof EvidenceError && (error.code === 'BLOCK_UNAVAILABLE' || error.code === 'REORG_DETECTED')) return;
    throw error;
  }
  fail('PINNING_UNSUPPORTED', 'the RPC answered a read pinned to a nonexistent block hash; it ignores EIP-1898 block pinning');
}

/**
 * Deterministic start block: the latest canonical block whose timestamp is <= target, searched
 * below `high`. The boundary is proven by the header pair (start, start + 1).
 */
export async function findStartBlock(reader, targetTimestamp, high) {
  let lo = 1;
  let hi = high;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const header = await reader.headerByNumber(mid);
    if (header.timestamp <= targetTimestamp) lo = mid;
    else hi = mid - 1;
  }
  const start = await reader.headerByNumber(lo);
  const next = await reader.headerByNumber(lo + 1);
  if (start.timestamp > targetTimestamp || next.timestamp <= targetTimestamp) {
    fail('RPC_INVALID_RESPONSE', `block timestamps around block ${lo} are not monotone; the start block cannot be determined`);
  }
  if (next.parentHash !== start.hash) fail('REORG_DETECTED', `block ${lo + 1} does not extend block ${lo}`);
  return { start, next };
}

/**
 * Reads one canonical snapshot (start + end block) for the given period and end block and
 * returns the evidence plus a credential-free read receipt. Throws EvidenceError (fail closed)
 * on any reorg, pinning, archive, identity, round or policy-bound problem.
 */
export async function collectEvidence(reader, { period, endBlockNumber }) {
  const periodEnd = settlementPeriodEndSeconds(period);
  if (!Number.isSafeInteger(endBlockNumber) || endBlockNumber <= 1) fail('USAGE', 'end block must be an integer > 1');
  const chainId = await reader.chainId();
  if (chainId !== EXPECTED_CHAIN_ID) fail('WRONG_CHAIN', `RPC chain id is ${chainId}, Ethereum mainnet (${EXPECTED_CHAIN_ID}) required`);
  await assertPinningEnforced(reader);

  const finalized = await reader.headerByNumber('finalized');
  if (endBlockNumber > finalized.number) fail('NOT_FINALIZED', `end block ${endBlockNumber} is not finalized yet (finalized head ${finalized.number})`);
  const endHeader = await reader.headerByNumber(endBlockNumber);
  if (endHeader.timestamp < periodEnd) fail('POLICY_BOUND', `end block ${endBlockNumber} (${endHeader.timestamp}) precedes the end of period ${period} (${periodEnd})`);
  if (endHeader.timestamp > periodEnd + SETTLEMENT_MAX_LAG_SECONDS) fail('POLICY_BOUND', `end block ${endBlockNumber} is more than 72h after the end of period ${period}`);

  const target = endHeader.timestamp - TWAP_WINDOW_SECONDS;
  const { start: startHeader, next: afterStart } = await findStartBlock(reader, target, endBlockNumber - 1);
  assertSettlementWindow({ startTimestamp: startHeader.timestamp, endTimestamp: endHeader.timestamp });

  // Bind both headers by hash as well (number -> hash and hash -> number must agree).
  await reader.headerByHash(startHeader.hash, startHeader.number);
  await reader.headerByHash(endHeader.hash, endHeader.number);

  const proofs = [];
  const startBlock = new PinnedBlock(reader, startHeader, 'start', proofs);
  const endBlock = new PinnedBlock(reader, endHeader, 'end', proofs);
  const start = await readPairObservation(startBlock);
  const end = await readPairObservation(endBlock);
  const feeds = [];
  for (const feed of FEEDS) feeds.push(await readFeed(endBlock, feed));

  // Final canonicality re-check after the last state read.
  for (const header of [startHeader, endHeader]) {
    const again = await reader.headerByNumber(header.number);
    if (again.hash !== header.hash) fail('REORG_DETECTED', `block ${header.number} changed hash during the snapshot`);
  }
  const finalizedAfter = await reader.headerByNumber('finalized');
  if (endHeader.number > finalizedAfter.number) fail('REORG_DETECTED', 'the finalized head moved below the end block during the snapshot');

  const [ethUsd, eurUsd] = feeds;
  const publishedAtSeconds = Math.min(ethUsd.updatedAt, eurUsd.updatedAt);
  const evidence = buildEvidence({
    start: start.observation,
    end: end.observation,
    ethEur: {
      source: ethEurSourceLabel(),
      publishedAt: new Date(publishedAtSeconds * 1000).toISOString(),
      rate: computeEthEurRate({ ethUsdAnswer: ethUsd.answer, eurUsdAnswer: eurUsd.answer }),
      decimals: RATE_DECIMALS,
    },
  });
  const violations = consumerBoundViolations(evidence, period);
  if (violations.length > 0) fail('POLICY_BOUND', violations.join('; '));

  const receipt = {
    kind: 'inferno.model-b.price-evidence-receipt',
    toolVersion: TOOL_VERSION,
    chainId,
    period,
    rpc: 'not recorded (credential-free receipt)',
    evidenceDigest: canonicalEvidenceDigest(evidence),
    evidenceDigestAlgorithm: 'keccak256(JSON of key-sorted evidence), equals modelBSettlement canonicalDigest',
    snapshot: {
      pinning: 'EIP-1898 blockHash + requireCanonical on every eth_call/eth_getCode; number->hash re-checked after the final read',
      finalizedHeadAtStart: finalized.number,
      finalizedHeadAtEnd: finalizedAfter.number,
      start: { number: startHeader.number, hash: startHeader.hash, timestamp: startHeader.timestamp },
      end: { number: endHeader.number, hash: endHeader.hash, timestamp: endHeader.timestamp },
      startSelection: {
        rule: 'latest canonical block with timestamp <= end.timestamp - 604800',
        targetTimestamp: target,
        nextBlock: { number: afterStart.number, hash: afterStart.hash, timestamp: afterStart.timestamp },
      },
    },
    pair: { address: PAIR_ADDRESS.toLowerCase(), factory: UNISWAP_V2_FACTORY.toLowerCase(), token0: IFR_TOKEN_ADDRESS.toLowerCase(), token1: WETH_ADDRESS.toLowerCase(), start: start.state, end: end.state },
    feeds,
    reads: proofs,
  };
  return { evidence, receipt };
}

/** Generates evidence for `period` at the finalized, operator-selected `endBlockNumber`. */
export async function generateEvidence(reader, { period, endBlockNumber }) {
  return collectEvidence(reader, { period, endBlockNumber });
}

// ── Verify ──────────────────────────────────────────────────────────────────

const UINT_STRING = /^(0|[1-9][0-9]{0,77})$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const BYTES32 = /^0x[a-fA-F0-9]{64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function exactKeys(value, keys, label, problems) {
  const actual = Object.keys(value);
  const unexpected = actual.filter((key) => !keys.includes(key)).length;
  if (unexpected > 0) problems.push(`${label} has ${unexpected} unexpected field(s)`); // key names are never echoed
  for (const key of keys) if (!actual.includes(key)) problems.push(`${label}.${key} missing`);
}

/**
 * Strict structural guard mirroring priceEvidenceSchema (.strict(), same regexes and bounds),
 * so every later check operates on well-typed values.
 */
export function assertEvidenceShape(evidence) {
  const problems = [];
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(evidence)) fail('EVIDENCE_FILE', 'evidence file does not contain a JSON object');
  exactKeys(evidence, ['reviewedSourceId', 'pair', 'token0', 'start', 'end', 'ethEur', 'rounding'], 'evidence', problems);
  if (typeof evidence.reviewedSourceId !== 'string' || evidence.reviewedSourceId.length < 1 || evidence.reviewedSourceId.length > 80) problems.push('reviewedSourceId');
  if (typeof evidence.pair !== 'string' || !ADDRESS.test(evidence.pair)) problems.push('pair');
  if (typeof evidence.token0 !== 'string' || !ADDRESS.test(evidence.token0)) problems.push('token0');
  for (const label of ['start', 'end']) {
    const obs = evidence[label];
    if (!isObject(obs)) { problems.push(`${label} observation`); continue; }
    exactKeys(obs, ['blockNumber', 'blockHash', 'timestamp', 'price0Cumulative'], label, problems);
    if (!Number.isSafeInteger(obs.blockNumber) || obs.blockNumber <= 0) problems.push(`${label}.blockNumber`);
    if (typeof obs.blockHash !== 'string' || !BYTES32.test(obs.blockHash)) problems.push(`${label}.blockHash`);
    if (!Number.isSafeInteger(obs.timestamp) || obs.timestamp <= 0) problems.push(`${label}.timestamp`);
    if (typeof obs.price0Cumulative !== 'string' || !UINT_STRING.test(obs.price0Cumulative)) problems.push(`${label}.price0Cumulative`);
  }
  if (!isObject(evidence.ethEur)) problems.push('ethEur');
  else {
    const e = evidence.ethEur;
    exactKeys(e, ['source', 'publishedAt', 'rate', 'decimals'], 'ethEur', problems);
    if (typeof e.source !== 'string' || e.source.length < 1 || e.source.length > 120) problems.push('ethEur.source');
    if (typeof e.publishedAt !== 'string' || !ISO_TIME.test(e.publishedAt) || Number.isNaN(Date.parse(e.publishedAt))) problems.push('ethEur.publishedAt');
    if (typeof e.rate !== 'string' || !UINT_STRING.test(e.rate)) problems.push('ethEur.rate');
    if (!Number.isSafeInteger(e.decimals) || e.decimals < 0 || e.decimals > 18) problems.push('ethEur.decimals');
  }
  if (evidence.rounding !== 'floor') problems.push('rounding');
  if (problems.length > 0) fail('EVIDENCE_FILE', `evidence does not match priceEvidenceSchema (${problems.join(', ')})`);
}

function leafMismatches(actual, expected, prefix, out) {
  for (const key of Object.keys(expected)) {
    const a = actual?.[key];
    const e = expected[key];
    const pathName = prefix ? `${prefix}.${key}` : key;
    if (e && typeof e === 'object') leafMismatches(a, e, pathName, out);
    // Only the field path (from our expected object) and the chain-derived, typed expected value.
    else if (a !== e) out.push(`${pathName} differs from the canonical chain derivation ${typeof e === 'number' ? e : `"${e}"`}`);
  }
}

/**
 * Distrusts every supplied field: checks the strict schema shape and the consumer bounds for
 * the operator-supplied expected period, then re-derives the complete evidence from a fresh
 * canonical snapshot at the stated end block (deterministic start block recomputed, identity
 * and rounds re-validated) and requires every field to match exactly.
 */
export async function verifyEvidence(reader, evidence, { period } = {}) {
  if (period === undefined) fail('USAGE', 'verification requires the expected settlement period (--period YYYY-MM)');
  settlementPeriodEndSeconds(period);
  assertEvidenceShape(evidence);
  const mismatches = consumerBoundViolations(evidence, period);
  // Evidence the consumer would reject for this period is rejected before any chain read.
  if (mismatches.length > 0) throw new VerificationError(mismatches);

  const { evidence: expected, receipt } = await collectEvidence(reader, { period, endBlockNumber: evidence.end.blockNumber });
  leafMismatches(evidence, expected, '', mismatches);
  if (mismatches.length > 0) throw new VerificationError(mismatches);

  receipt.mode = 'verify';
  return {
    receipt,
    checks: [
      `chainId = ${EXPECTED_CHAIN_ID}; EIP-1898 pinning enforced by the RPC`,
      `end block ${expected.end.blockNumber} ${expected.end.blockHash} finalized and canonical before and after all reads`,
      `start block ${expected.start.blockNumber} is the deterministic latest block at/before end - 7d`,
      `pair ${expected.pair}: factory ${UNISWAP_V2_FACTORY.toLowerCase()} getPair, token0 IFR (9), token1 WETH (18) at both blocks`,
      'price0Cumulative reproduced at both blocks (UniswapV2OracleLibrary counterfactual)',
      `Chainlink ETH/USD + EUR/USD identity and rounds valid at the end block; rate ${expected.ethEur.rate}e-${RATE_DECIMALS}`,
      `consumer bounds for period ${period} satisfied; canonical data digest ${receipt.evidenceDigest}`,
    ],
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  node scripts/model-b-price-evidence.mjs generate --period YYYY-MM --end-block <n> [--out evidence.json] [--receipt receipt.json] [--rpc <url>]
  node scripts/model-b-price-evidence.mjs verify   --period YYYY-MM --file evidence.json [--receipt receipt.json] [--rpc <url>]

The RPC URL comes from --rpc or MODEL_B_EVIDENCE_RPC_URL (preferred: keeps it out of the
process list). It must be an archive-capable Ethereum mainnet endpoint supporting EIP-1898.
The URL, argument values and raw RPC errors are never printed.
Exit codes: 0 success, 1 failure, 2 usage error.`;

const OPTIONS = {
  generate: ['rpc', 'period', 'end-block', 'out', 'receipt'],
  verify: ['rpc', 'period', 'file', 'receipt'],
};

/** Parses argv without ever echoing an argument value into an error message. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!Object.prototype.hasOwnProperty.call(OPTIONS, command ?? '')) fail('USAGE', 'first argument must be the command generate or verify');
  const allowed = OPTIONS[command];
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) fail('USAGE', `unexpected positional argument at position ${i + 2}`);
    const eq = token.indexOf('=');
    const flag = token.slice(2, eq === -1 ? undefined : eq);
    if (!allowed.includes(flag)) fail('USAGE', `unknown option at position ${i + 2} for ${command} (allowed: ${allowed.map((o) => `--${o}`).join(', ')})`);
    const value = eq === -1 ? rest[++i] : token.slice(eq + 1);
    if (value === undefined || value === '') fail('USAGE', `missing value for --${flag}`);
    if (Object.prototype.hasOwnProperty.call(args, flag)) fail('USAGE', `--${flag} given twice`);
    args[flag] = value;
  }
  return args;
}

function writeJson(file, value, what) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    fail('OUTPUT_FILE', `cannot write the ${what} file (${typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code) ? error.code : 'error'}; existing files are never overwritten)`);
  }
}

export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (!args.period) fail('USAGE', 'missing required --period YYYY-MM');
  settlementPeriodEndSeconds(args.period);
  const rpcUrl = args.rpc ?? env.MODEL_B_EVIDENCE_RPC_URL;
  if (!rpcUrl) fail('USAGE', 'missing RPC endpoint (--rpc or MODEL_B_EVIDENCE_RPC_URL)');
  const reader = makeChainReader(makeHttpTransport(rpcUrl));

  if (args.command === 'generate') {
    if (!args['end-block']) fail('USAGE', 'missing required --end-block <n>');
    if (!/^[1-9][0-9]{0,15}$/.test(args['end-block'])) fail('USAGE', '--end-block must be a positive integer');
    const endBlockNumber = Number(args['end-block']);
    const { evidence, receipt } = await generateEvidence(reader, { period: args.period, endBlockNumber });
    receipt.mode = 'generate';
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    receipt.evidenceFileSha256 = crypto.createHash('sha256').update(json).digest('hex');
    if (args.out) writeJson(args.out, evidence, 'evidence');
    else process.stdout.write(json);
    if (args.receipt) writeJson(args.receipt, receipt, 'receipt');
    process.stderr.write(
      `Generated price evidence for period ${args.period}\n` +
      `  start block ${evidence.start.blockNumber} ${evidence.start.blockHash} (${new Date(evidence.start.timestamp * 1000).toISOString()})\n` +
      `  end block   ${evidence.end.blockNumber} ${evidence.end.blockHash} (${new Date(evidence.end.timestamp * 1000).toISOString()})\n` +
      `  window ${evidence.end.timestamp - evidence.start.timestamp}s, ethEur ${evidence.ethEur.rate}e-${evidence.ethEur.decimals} published ${evidence.ethEur.publishedAt}\n` +
      `  canonical data digest ${receipt.evidenceDigest}; file sha256 ${receipt.evidenceFileSha256}\n` +
      '  Not an approval: run verify (preferably via a second RPC) before any settlement use.\n'
    );
    return;
  }

  if (!args.file) fail('USAGE', 'missing required --file <evidence.json>');
  let bytes;
  try {
    bytes = fs.readFileSync(args.file);
  } catch (error) {
    fail('EVIDENCE_FILE', `cannot read the evidence file (${typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code) ? error.code : 'error'})`);
  }
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('EVIDENCE_FILE', 'the evidence file is not valid JSON');
  }
  const { checks, receipt } = await verifyEvidence(reader, evidence, { period: args.period });
  receipt.evidenceFileSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (args.receipt) writeJson(args.receipt, receipt, 'receipt');
  process.stderr.write(
    `Verified price evidence for period ${args.period} against canonical chain state:\n${checks.map((c) => `  ok: ${c}`).join('\n')}\n` +
    `  exact file sha256 ${receipt.evidenceFileSha256} (bytes as supplied; the canonical data digest is key-order independent)\n`
  );
}

/** Defense in depth: printable ASCII and newlines only, length-bounded. */
export function safeText(text) {
  const clean = String(text).replace(/[^\x20-\x7e\n]/g, '?');
  return clean.length > 4000 ? `${clean.slice(0, 4000)}...(truncated)` : clean;
}

/** Renders any thrown value as a constant-category line; unknown errors never expose their text. */
export function renderError(error) {
  if (error instanceof EvidenceError) {
    return { text: `Error [${error.code}]: ${safeText(error.detail)}\n`, exitCode: error.code === 'USAGE' ? 2 : 1, usage: error.code === 'USAGE' };
  }
  return { text: 'Error [INTERNAL]: unexpected failure (details suppressed to avoid leaking endpoint data)\n', exitCode: 1, usage: false };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      const { text, exitCode, usage } = renderError(error);
      process.stderr.write(text);
      if (usage) process.stderr.write(`${USAGE}\n`);
      process.exit(exitCode);
    }
  );
}
