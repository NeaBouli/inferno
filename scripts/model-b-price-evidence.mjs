#!/usr/bin/env node
/**
 * Model B price-evidence generator and independent verifier (T-290).
 *
 * Produces the JSON document consumed as `priceEvidence` by the Lane 4 Model B settlement
 * export (apps/benefits-network/backend/src/services/modelBSettlement.ts, priceEvidenceSchema)
 * and re-derives every field of such a document independently from chain state, closing
 * review finding F3 (T-275) procedurally: evidence is no longer only schema-checked, every
 * value must reproduce from the chain at the stated blocks before any Safe proposal.
 *
 * Price source (owner decision 2026-10-06): Uniswap V2 IFR/WETH pair TWAP over 7 days
 * (counterfactual accrual exactly as UniswapV2OracleLibrary.currentCumulativePrices) and
 * ETH/EUR from the on-chain Chainlink ETH/USD and EUR/USD aggregators read at the same
 * settlement end block, eth/eur = floor(ethUsd * 10^RATE_DECIMALS / eurUsd).
 *
 * Read-only: this tool never signs, never sends a transaction and never writes chain state.
 * It requires an archive-capable Ethereum mainnet RPC for historical `eth_call` reads.
 *
 * Usage:
 *   node scripts/model-b-price-evidence.mjs generate --rpc <url> --period YYYY-MM --end-block <n> [--out evidence.json]
 *   node scripts/model-b-price-evidence.mjs verify --rpc <url> --file evidence.json
 *
 * Exit codes: 0 success, 1 generation/verification failure, 2 usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ethers } from 'ethers';

// ── Pinned mainnet constants ────────────────────────────────────────────────
// IFR/WETH Uniswap V2 pair (the only IFR market) and the IFR token.
export const PAIR_ADDRESS = '0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0';
export const IFR_TOKEN_ADDRESS = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
// Canonical Chainlink aggregator proxies, confirmed against Chainlink's official data-feeds
// registry (the data source behind https://docs.chain.link/data-feeds/price-feeds/addresses):
// https://reference-data-directory.vercel.app/feeds-mainnet.json (entries "eth-usd" / "eur-usd").
export const CHAINLINK_ETH_USD = { address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', heartbeatSeconds: 3600, label: 'ETH/USD' };
export const CHAINLINK_EUR_USD = { address: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1', heartbeatSeconds: 86400, label: 'EUR/USD' };

// Must stay configurable in the pilot policy: modelBPolicy.ts restricts reviewed source ids
// to /^[A-Za-z0-9._:-]{1,80}$/, so the id uses ':' instead of '+'/'/' separators.
export const REVIEWED_SOURCE_ID = 'uniswap-v2-twap:chainlink-eth-usd:eur-usd';
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

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function price0CumulativeLast() view returns (uint256)',
];
const FEED_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
];

// ── Pure computation ────────────────────────────────────────────────────────

/**
 * Counterfactual price0 cumulative at a block, identical to
 * UniswapV2OracleLibrary.currentCumulativePrices: the stored price0CumulativeLast plus the
 * accrual the pair would have added between blockTimestampLast and the block timestamp.
 * All overflow semantics (uint32 time delta, uint224 quotient, uint256 accumulation) match
 * the on-chain arithmetic exactly.
 */
export function currentCumulativePrice0({ price0CumulativeLast, reserve0, reserve1, blockTimestampLast, blockTimestamp }) {
  const last = BigInt(price0CumulativeLast);
  const r0 = BigInt(reserve0);
  const r1 = BigInt(reserve1);
  if (r0 <= 0n || r1 <= 0n) throw new Error('Pair reserves must be positive');
  if (r0 >= Q112 || r1 >= Q112) throw new Error('Pair reserves do not fit uint112');
  const ts32 = BigInt(blockTimestamp) % UINT32_MOD;
  const tsLast32 = BigInt(blockTimestampLast) % UINT32_MOD;
  const timeElapsed = (ts32 - tsLast32 + UINT32_MOD) % UINT32_MOD;
  // FixedPoint.uq112x112.encode(reserve1).uqdiv(reserve0): uint224 floor division.
  const quotient = (r1 * Q112) / r0;
  if (quotient >= UINT224_MOD) throw new Error('Price quotient does not fit uint224');
  return (last + quotient * timeElapsed) % UINT256_MOD;
}

/** eth/eur = floor(ethUsd * 10^rateDecimals / eurUsd); both answers in their feed decimals. */
export function computeEthEurRate({ ethUsdAnswer, eurUsdAnswer, rateDecimals = RATE_DECIMALS }) {
  const ethUsd = BigInt(ethUsdAnswer);
  const eurUsd = BigInt(eurUsdAnswer);
  if (ethUsd <= 0n || eurUsd <= 0n) throw new Error('Chainlink answers must be positive');
  return (ethUsd * 10n ** BigInt(rateDecimals)) / eurUsd;
}

/** Rejects stale, non-positive, incomplete or future-dated Chainlink rounds. */
export function assertValidChainlinkRound({ roundId, answer, updatedAt, answeredInRound, blockTimestamp, heartbeatSeconds, feedLabel = 'feed' }) {
  const problems = [];
  if (BigInt(answer) <= 0n) problems.push('non-positive answer');
  if (BigInt(answeredInRound) < BigInt(roundId)) problems.push('answeredInRound < roundId (incomplete round)');
  const updated = BigInt(updatedAt);
  if (updated <= 0n) problems.push('updatedAt is zero');
  const age = BigInt(blockTimestamp) - updated;
  if (updated > 0n && age < 0n) problems.push('updatedAt is after the settlement block');
  if (age > BigInt(heartbeatSeconds)) problems.push(`stale answer (${age}s old, heartbeat ${heartbeatSeconds}s)`);
  if (problems.length > 0) throw new Error(`Chainlink ${feedLabel} round rejected: ${problems.join('; ')}`);
}

/** The 7-day TWAP window bound enforced by the settlement validator. */
export function assertSettlementWindow({ startTimestamp, endTimestamp }) {
  const windowSeconds = endTimestamp - startTimestamp;
  if (windowSeconds < TWAP_WINDOW_SECONDS || windowSeconds > TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS) {
    throw new Error(`TWAP window is ${windowSeconds}s, must be within [${TWAP_WINDOW_SECONDS}, ${TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS}]`);
  }
  return windowSeconds;
}

/** Deterministic ETH/EUR source label (<= 120 chars, matches the settlement schema bound). */
export function ethEurSourceLabel() {
  return `chainlink eth/usd ${CHAINLINK_ETH_USD.address.toLowerCase()} eur/usd ${CHAINLINK_EUR_USD.address.toLowerCase()}`;
}

/** Settlement periods are whole UTC calendar months, half-open [start, end) — mirrors modelBSettlement. */
export function settlementPeriodEndSeconds(period) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error('Settlement period must be a UTC calendar month (YYYY-MM)');
  return Date.UTC(Number(match[1]), Number(match[2]), 1) / 1000;
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

// ── Chain access ────────────────────────────────────────────────────────────
// A "reader" abstracts every chain read so generate/verify run identically against a live
// provider (CLI) or a fixture (tests):
//   getChainId() -> number
//   getBlockNumber() -> number
//   getBlock(n) -> { hash, timestamp }
//   readPair(n) -> { token0, token1, reserve0, reserve1, blockTimestampLast, price0CumulativeLast }
//   readFeed(feed, n) -> { roundId, answer, updatedAt, answeredInRound, decimals }

// Public endpoints commonly gate historical eth_call behind generic 403s, so a forbidden
// response to a state read at an old block is treated as an archive-capability failure too.
const ARCHIVE_ERROR_PATTERN = /missing trie node|state is unavailable|header not found|missing header|historical state|pruned|archive|403|forbidden/i;

export function isArchiveError(error) {
  const text = `${error?.shortMessage ?? ''} ${error?.message ?? ''} ${error?.info?.error?.message ?? ''}`;
  return ARCHIVE_ERROR_PATTERN.test(text);
}

function archiveWrap(promise, what, blockNumber) {
  return promise.catch((error) => {
    if (isArchiveError(error)) {
      throw new Error(
        `RPC cannot serve ${what} at block ${blockNumber}: historical state is unavailable or gated. ` +
        'An archive-capable Ethereum mainnet RPC is required (full nodes prune old state).'
      );
    }
    throw error;
  });
}

export function makeEthersReader(rpcUrl) {
  // batchMaxCount 1: never batch JSON-RPC requests; free tiers of public endpoints reject
  // batches, and a correctness-first evidence tool should behave identically everywhere.
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
  const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);
  const feedContracts = new Map();
  const feedContract = (address) => {
    if (!feedContracts.has(address)) feedContracts.set(address, new ethers.Contract(address, FEED_ABI, provider));
    return feedContracts.get(address);
  };
  return {
    provider,
    async getChainId() {
      const network = await provider.getNetwork();
      return Number(network.chainId);
    },
    getBlockNumber() {
      return provider.getBlockNumber();
    },
    async getBlock(n) {
      const block = await provider.getBlock(n);
      if (!block) throw new Error(`Block ${n} not found`);
      return { hash: block.hash, timestamp: block.timestamp };
    },
    async readPair(n) {
      const opts = { blockTag: n };
      const [token0, token1, reserves, price0CumulativeLast] = await archiveWrap(
        Promise.all([pair.token0(opts), pair.token1(opts), pair.getReserves(opts), pair.price0CumulativeLast(opts)]),
        'pair state',
        n
      );
      return {
        token0,
        token1,
        reserve0: reserves[0],
        reserve1: reserves[1],
        blockTimestampLast: reserves[2],
        price0CumulativeLast,
      };
    },
    async readFeed(feed, n) {
      const opts = { blockTag: n };
      const contract = feedContract(feed.address);
      const [round, decimals] = await archiveWrap(
        Promise.all([contract.latestRoundData(opts), contract.decimals(opts)]),
        `${feed.label} feed state`,
        n
      );
      return { roundId: round[0], answer: round[1], updatedAt: round[3], answeredInRound: round[4], decimals: Number(decimals) };
    },
  };
}

/** Greatest block number <= high whose timestamp is <= targetTimestamp (timestamps are monotone). */
export async function findBlockAtOrBefore(reader, targetTimestamp, high) {
  let lo = 1;
  let hi = high;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const block = await reader.getBlock(mid);
    if (block.timestamp <= targetTimestamp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function readObservation(reader, block) {
  const pairState = await reader.readPair(block.number);
  if (pairState.token0.toLowerCase() !== IFR_TOKEN_ADDRESS.toLowerCase()) {
    throw new Error(`Pair token0 at block ${block.number} is ${pairState.token0}, not IFR`);
  }
  if (pairState.token1.toLowerCase() !== WETH_ADDRESS.toLowerCase()) {
    throw new Error(`Pair token1 at block ${block.number} is ${pairState.token1}, not WETH`);
  }
  return {
    blockNumber: block.number,
    blockHash: block.hash,
    timestamp: block.timestamp,
    price0Cumulative: currentCumulativePrice0({ ...pairState, blockTimestamp: block.timestamp }),
  };
}

async function readEthEur(reader, endBlock) {
  const [ethUsd, eurUsd] = await Promise.all([
    reader.readFeed(CHAINLINK_ETH_USD, endBlock.number),
    reader.readFeed(CHAINLINK_EUR_USD, endBlock.number),
  ]);
  for (const [feed, round] of [[CHAINLINK_ETH_USD, ethUsd], [CHAINLINK_EUR_USD, eurUsd]]) {
    assertValidChainlinkRound({ ...round, blockTimestamp: endBlock.timestamp, heartbeatSeconds: feed.heartbeatSeconds, feedLabel: feed.label });
    if (round.decimals !== 8) throw new Error(`Chainlink ${feed.label} decimals changed to ${round.decimals}; rate derivation must be reviewed`);
  }
  const publishedAtSeconds = Number(ethUsd.updatedAt < eurUsd.updatedAt ? ethUsd.updatedAt : eurUsd.updatedAt);
  return {
    source: ethEurSourceLabel(),
    publishedAt: new Date(publishedAtSeconds * 1000).toISOString(),
    rate: computeEthEurRate({ ethUsdAnswer: ethUsd.answer, eurUsdAnswer: eurUsd.answer }),
    decimals: RATE_DECIMALS,
  };
}

// ── Generate ────────────────────────────────────────────────────────────────

export async function generateEvidence(reader, { period, endBlockNumber }) {
  if (await reader.getChainId() !== EXPECTED_CHAIN_ID) {
    throw new Error(`RPC is not Ethereum mainnet (chainId ${EXPECTED_CHAIN_ID} required)`);
  }
  const periodEnd = settlementPeriodEndSeconds(period);
  const endBlockRaw = await reader.getBlock(endBlockNumber);
  if (endBlockRaw.timestamp < periodEnd) {
    throw new Error(`End block ${endBlockNumber} (${new Date(endBlockRaw.timestamp * 1000).toISOString()}) precedes the end of period ${period} (${new Date(periodEnd * 1000).toISOString()})`);
  }
  if (endBlockRaw.timestamp > periodEnd + SETTLEMENT_MAX_LAG_SECONDS) {
    throw new Error(`End block ${endBlockNumber} is more than ${SETTLEMENT_MAX_LAG_SECONDS / 3600}h after the end of period ${period}`);
  }
  const startBlockNumber = await findBlockAtOrBefore(reader, endBlockRaw.timestamp - TWAP_WINDOW_SECONDS, endBlockNumber - 1);
  const startBlockRaw = await reader.getBlock(startBlockNumber);
  assertSettlementWindow({ startTimestamp: startBlockRaw.timestamp, endTimestamp: endBlockRaw.timestamp });

  const [start, end, ethEur] = await Promise.all([
    readObservation(reader, { number: startBlockNumber, ...startBlockRaw }),
    readObservation(reader, { number: endBlockNumber, ...endBlockRaw }),
    readEthEur(reader, { number: endBlockNumber, ...endBlockRaw }),
  ]);
  return buildEvidence({ start, end, ethEur });
}

// ── Verify ──────────────────────────────────────────────────────────────────

export class VerificationError extends Error {
  constructor(mismatches) {
    super(`Price evidence does not reproduce from chain:\n${mismatches.map((m) => `  - ${m}`).join('\n')}`);
    this.mismatches = mismatches;
  }
}

/**
 * Minimal structural guard so a malformed evidence file fails with a clear message instead
 * of a TypeError. The authoritative schema check is priceEvidenceSchema in the backend;
 * this guard only covers the fields the verifier dereferences.
 */
export function assertEvidenceShape(evidence) {
  const problems = [];
  const observation = (obs, label) => {
    if (!obs || typeof obs !== 'object') { problems.push(`${label} observation missing`); return; }
    if (!Number.isSafeInteger(obs.blockNumber) || obs.blockNumber <= 0) problems.push(`${label}.blockNumber`);
    if (typeof obs.blockHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(obs.blockHash)) problems.push(`${label}.blockHash`);
    if (!Number.isSafeInteger(obs.timestamp) || obs.timestamp <= 0) problems.push(`${label}.timestamp`);
    if (typeof obs.price0Cumulative !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(obs.price0Cumulative)) problems.push(`${label}.price0Cumulative`);
  };
  if (!evidence || typeof evidence !== 'object') throw new Error('Evidence file does not contain a JSON object');
  observation(evidence.start, 'start');
  observation(evidence.end, 'end');
  if (!evidence.ethEur || typeof evidence.ethEur !== 'object') problems.push('ethEur missing');
  else {
    if (typeof evidence.ethEur.rate !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(evidence.ethEur.rate)) problems.push('ethEur.rate');
    if (typeof evidence.ethEur.publishedAt !== 'string' || Number.isNaN(Date.parse(evidence.ethEur.publishedAt))) problems.push('ethEur.publishedAt');
    if (!Number.isSafeInteger(evidence.ethEur.decimals)) problems.push('ethEur.decimals');
    if (typeof evidence.ethEur.source !== 'string') problems.push('ethEur.source');
  }
  if (problems.length > 0) {
    throw new Error(`Evidence file does not match the expected shape (${problems.join(', ')}); validate it against priceEvidenceSchema or regenerate it`);
  }
}

/**
 * Independently re-derives every field of the evidence from chain state at the stated block
 * numbers. Throws VerificationError listing every mismatch; returns a check list on success.
 */
export async function verifyEvidence(reader, evidence) {
  assertEvidenceShape(evidence);
  const mismatches = [];
  const check = (condition, message) => { if (!condition) mismatches.push(message); };

  if (await reader.getChainId() !== EXPECTED_CHAIN_ID) {
    throw new Error(`RPC is not Ethereum mainnet (chainId ${EXPECTED_CHAIN_ID} required)`);
  }
  check(evidence.pair === PAIR_ADDRESS.toLowerCase(), `pair is ${evidence.pair}, expected ${PAIR_ADDRESS.toLowerCase()}`);
  check(evidence.token0 === IFR_TOKEN_ADDRESS.toLowerCase(), `token0 is ${evidence.token0}, expected IFR ${IFR_TOKEN_ADDRESS.toLowerCase()}`);
  check(evidence.reviewedSourceId === REVIEWED_SOURCE_ID, `reviewedSourceId is "${evidence.reviewedSourceId}", expected "${REVIEWED_SOURCE_ID}"`);
  check(evidence.rounding === 'floor', `rounding is "${evidence.rounding}", expected "floor"`);
  check(evidence.end.blockNumber > evidence.start.blockNumber, 'end block must follow the start block');
  if (mismatches.length > 0) throw new VerificationError(mismatches);

  for (const label of ['start', 'end']) {
    const obs = evidence[label];
    const block = await reader.getBlock(obs.blockNumber);
    check(block.hash.toLowerCase() === obs.blockHash, `${label}.blockHash is ${obs.blockHash}, chain has ${block.hash.toLowerCase()} at block ${obs.blockNumber}`);
    check(block.timestamp === obs.timestamp, `${label}.timestamp is ${obs.timestamp}, chain block has ${block.timestamp}`);
    const pairState = await reader.readPair(obs.blockNumber);
    check(pairState.token0.toLowerCase() === IFR_TOKEN_ADDRESS.toLowerCase(), `${label}: pair token0 on chain is ${pairState.token0}, not IFR`);
    check(pairState.token1.toLowerCase() === WETH_ADDRESS.toLowerCase(), `${label}: pair token1 on chain is ${pairState.token1}, not WETH`);
    const recomputed = currentCumulativePrice0({ ...pairState, blockTimestamp: block.timestamp });
    check(recomputed.toString() === obs.price0Cumulative, `${label}.price0Cumulative is ${obs.price0Cumulative}, re-derived ${recomputed.toString()}`);
  }

  try {
    assertSettlementWindow({ startTimestamp: evidence.start.timestamp, endTimestamp: evidence.end.timestamp });
  } catch (error) {
    mismatches.push(error.message);
  }

  const [ethUsd, eurUsd] = await Promise.all([
    reader.readFeed(CHAINLINK_ETH_USD, evidence.end.blockNumber),
    reader.readFeed(CHAINLINK_EUR_USD, evidence.end.blockNumber),
  ]);
  for (const [feed, round] of [[CHAINLINK_ETH_USD, ethUsd], [CHAINLINK_EUR_USD, eurUsd]]) {
    try {
      assertValidChainlinkRound({ ...round, blockTimestamp: evidence.end.timestamp, heartbeatSeconds: feed.heartbeatSeconds, feedLabel: feed.label });
      check(round.decimals === 8, `Chainlink ${feed.label} decimals on chain are ${round.decimals}, expected 8`);
    } catch (error) {
      mismatches.push(error.message);
    }
  }
  if (ethUsd.answer > 0n && eurUsd.answer > 0n) {
    const rate = computeEthEurRate({ ethUsdAnswer: ethUsd.answer, eurUsdAnswer: eurUsd.answer });
    check(rate.toString() === evidence.ethEur.rate, `ethEur.rate is ${evidence.ethEur.rate}, re-derived ${rate.toString()}`);
    const publishedAtSeconds = Number(ethUsd.updatedAt < eurUsd.updatedAt ? ethUsd.updatedAt : eurUsd.updatedAt);
    const publishedAt = new Date(publishedAtSeconds * 1000).toISOString();
    check(publishedAt === evidence.ethEur.publishedAt, `ethEur.publishedAt is ${evidence.ethEur.publishedAt}, re-derived ${publishedAt}`);
    check(Math.abs(publishedAtSeconds - evidence.end.timestamp) <= ETH_EUR_MAX_SKEW_SECONDS, `ethEur reference is more than ${ETH_EUR_MAX_SKEW_SECONDS / 3600}h away from the settlement block`);
  }
  check(evidence.ethEur.decimals === RATE_DECIMALS, `ethEur.decimals is ${evidence.ethEur.decimals}, expected ${RATE_DECIMALS}`);
  check(evidence.ethEur.source === ethEurSourceLabel(), `ethEur.source is "${evidence.ethEur.source}", expected "${ethEurSourceLabel()}"`);

  if (mismatches.length > 0) throw new VerificationError(mismatches);
  return [
    'chainId = 1',
    `pair ${evidence.pair}, token0 = IFR`,
    `start block ${evidence.start.blockNumber}: hash, timestamp and price0Cumulative reproduced`,
    `end block ${evidence.end.blockNumber}: hash, timestamp and price0Cumulative reproduced`,
    `TWAP window ${evidence.end.timestamp - evidence.start.timestamp}s within [${TWAP_WINDOW_SECONDS}, ${TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS}]`,
    `Chainlink ETH/USD + EUR/USD rounds valid at block ${evidence.end.blockNumber}`,
    `ethEur rate ${evidence.ethEur.rate} (10^-${RATE_DECIMALS}) and publishedAt ${evidence.ethEur.publishedAt} reproduced`,
  ];
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  node scripts/model-b-price-evidence.mjs generate --rpc <url> --period YYYY-MM --end-block <n> [--out evidence.json]
  node scripts/model-b-price-evidence.mjs verify --rpc <url> --file evidence.json

Read-only. Requires an archive-capable Ethereum mainnet RPC. The RPC URL is never printed
(it may contain credentials). Exit codes: 0 success, 1 failure, 2 usage error.`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const eq = token.indexOf('=');
    const flag = token.slice(2, eq === -1 ? undefined : eq);
    if (!['rpc', 'period', 'end-block', 'out', 'file'].includes(flag)) throw new Error(`Unknown option: --${flag}`);
    const value = eq === -1 ? rest[++i] : token.slice(eq + 1);
    if (value === undefined || value === '') throw new Error(`Missing value for --${flag}`);
    args[flag] = value;
  }
  return args;
}

function rpcHost(rpcUrl) {
  let url;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error('--rpc must be a valid URL (credentials in the URL are never printed)');
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    throw new Error(`--rpc must be an http(s) or ws(s) URL, got protocol "${url.protocol}"`);
  }
  return url.host;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.rpc) throw new Error('Missing required --rpc <url>');
  const host = rpcHost(args.rpc);
  const reader = makeEthersReader(args.rpc);

  if (args.command === 'generate') {
    if (!args.period) throw new Error('Missing required --period YYYY-MM');
    if (!args['end-block']) throw new Error('Missing required --end-block <n>');
    const endBlockNumber = Number(args['end-block']);
    if (!Number.isSafeInteger(endBlockNumber) || endBlockNumber <= 0) throw new Error('--end-block must be a positive integer');
    const evidence = await generateEvidence(reader, { period: args.period, endBlockNumber });
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    if (args.out) fs.writeFileSync(args.out, json);
    else process.stdout.write(json);
    process.stderr.write(
      `Generated price evidence for period ${args.period} via ${host}\n` +
      `  start block ${evidence.start.blockNumber} (${new Date(evidence.start.timestamp * 1000).toISOString()})\n` +
      `  end block   ${evidence.end.blockNumber} (${new Date(evidence.end.timestamp * 1000).toISOString()})\n` +
      `  window ${evidence.end.timestamp - evidence.start.timestamp}s, ethEur ${evidence.ethEur.rate}e-${evidence.ethEur.decimals} published ${evidence.ethEur.publishedAt}\n`
    );
    return;
  }

  if (args.command === 'verify') {
    if (!args.file) throw new Error('Missing required --file <evidence.json>');
    let evidence;
    try {
      evidence = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read evidence file ${args.file}: ${error.message}`);
    }
    const checks = await verifyEvidence(reader, evidence);
    process.stderr.write(`Verified price evidence against chain via ${host}:\n${checks.map((c) => `  ok: ${c}`).join('\n')}\n`);
    return;
  }

  throw new Error(args.command ? `Unknown command: ${args.command}` : 'Missing command (generate|verify)');
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      const usage = error instanceof Error && /Missing|Unknown|Unexpected|must be/.test(error.message) && !(error instanceof VerificationError);
      process.stderr.write(`${usage ? 'Usage error' : 'Error'}: ${error.message}\n`);
      if (usage) process.stderr.write(`${USAGE}\n`);
      process.exit(usage ? 2 : 1);
    }
  );
}
