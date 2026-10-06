#!/usr/bin/env node
/**
 * Unit, contract and CLI tests for scripts/model-b-price-evidence.mjs (T-290).
 *
 * Covers: counterfactual cumulative-price math (uint32 elapsed wrap, uint256 accumulator
 * wrap), Chainlink ETH/EUR floor division and malformed/stale round rejection, TWAP window
 * and period bounds, a JSON-RPC level mock chain for generate + verify, EIP-1898 pinning and
 * reorg fail-closed paths, pair/factory/token/feed identity, deterministic start and
 * expected-period verification, credential-free CLI diagnostics (dummy sentinels against a
 * local HTTP server) and the fixture bridge to the backend schema test
 * (apps/benefits-network/backend/tests/modelBPriceEvidence.test.ts).
 *
 * Run: node scripts/test-model-b-price-evidence.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import {
  ABI,
  CHAINLINK_ETH_USD,
  CHAINLINK_EUR_USD,
  IFR_TOKEN_ADDRESS,
  MAINNET_CODE_HASHES,
  PAIR_ADDRESS,
  RATE_DECIMALS,
  RECEIPT_KIND,
  REVIEWED_SOURCE_ID,
  RpcFailure,
  TWAP_WINDOW_SECONDS,
  UNISWAP_V2_FACTORY_ADDRESS,
  UsageError,
  VerificationError,
  WETH_ADDRESS,
  assertPeriodBounds,
  assertSettlementWindow,
  assertValidChainlinkRound,
  buildEvidence,
  canonicalDigest,
  classifyRpcErrorMessage,
  computeEthEurRate,
  currentCumulativePrice0,
  diffValues,
  ethEurSourceLabel,
  findBlockAtOrBefore,
  generateEvidence,
  makeChainReader,
  settlementPeriodEndSeconds,
  verifyEvidence,
} from './model-b-price-evidence.mjs';

const Q112 = 2n ** 112n;
const pass = (label) => console.log(`[model-b-price-evidence] PASS - ${label}`);

// ── Cumulative price math (UniswapV2OracleLibrary.currentCumulativePrices parity) ──
// Differential vectors are hand-derived from the Solidity arithmetic, not from the tool.

// quotient = (2^111 * 2^112) / 1 = 2^223; 3 seconds accrual.
assert.equal(currentCumulativePrice0({ price0CumulativeLast: 7n, reserve0: 1n, reserve1: 2n ** 111n, blockTimestampLast: 100, blockTimestamp: 103 }), 7n + 3n * 2n ** 223n);
// uint256 accumulator wrap: (2^256 - 10) + 5 * 2^114 wraps to 5 * 2^114 - 10.
assert.equal(currentCumulativePrice0({ price0CumulativeLast: 2n ** 256n - 10n, reserve0: 1n, reserve1: 4n, blockTimestampLast: 40, blockTimestamp: 45 }), 5n * 2n ** 114n - 10n);
// uint32 elapsed wrap: blockTimestamp casts to 5, last is 2^32 - 6, elapsed wraps to 11.
assert.equal(currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: 2n, blockTimestampLast: 2n ** 32n - 6n, blockTimestamp: 2n ** 32n + 5n }), 11n * 2n ** 113n);
// IFR (9 decimals) / WETH (18 decimals): price0 is raw wei per IFR base unit, no decimal scaling.
// 1000 IFR (1e12 base units) vs 2 WETH (2e18 wei) -> 2e6 wei per base unit -> q = 2e6 * 2^112.
assert.equal(currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 10n ** 12n, reserve1: 2n * 10n ** 18n, blockTimestampLast: 0, blockTimestamp: 1 }), 2_000_000n * Q112);
// BigInt floor of the UQ112x112 quotient: (1 * 2^112) / 3 floors.
assert.equal(currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 3n, reserve1: 1n, blockTimestampLast: 0, blockTimestamp: 1 }), Q112 / 3n);
assert.equal(currentCumulativePrice0({ price0CumulativeLast: 9n, reserve0: 1n, reserve1: Q112 - 1n, blockTimestampLast: 50, blockTimestamp: 50 }), 9n);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 0n, reserve1: 1n, blockTimestampLast: 0, blockTimestamp: 1 }), /reserves must be positive/);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: 0n, blockTimestampLast: 0, blockTimestamp: 1 }), /reserves must be positive/);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: Q112, blockTimestampLast: 0, blockTimestamp: 1 }), /uint112/);
pass('cumulative price math incl. uint32 elapsed / uint256 accumulator wrap, IFR9/WETH18, floor');

// ── Chainlink ETH/EUR division, decimals and floor rounding ──

assert.equal(computeEthEurRate({ ethUsdAnswer: 250_000_000_000n, eurUsdAnswer: 125_000_000n }), 200_000_000_000n);
assert.equal(computeEthEurRate({ ethUsdAnswer: 100_000_000n, eurUsdAnswer: 300_000_000n }), 33_333_333n);
assert.equal(computeEthEurRate({ ethUsdAnswer: 271_227_435_732n, eurUsdAnswer: 112_307_000n }), 241_505_369_862n);
assert.equal(computeEthEurRate({ ethUsdAnswer: 271_227_435_732n, eurUsdAnswer: 112_307_000n, rateDecimals: 2 }), 241_505n);
assert.throws(() => computeEthEurRate({ ethUsdAnswer: 0n, eurUsdAnswer: 112_307_000n }), /positive/);
assert.throws(() => computeEthEurRate({ ethUsdAnswer: 271_227_435_732n, eurUsdAnswer: -1n }), /positive/);
pass('ETH/EUR floor division and decimals');

// ── Chainlink round rejection ──

const goodRound = { roundId: 100n, answer: 271_227_435_732n, startedAt: 1790900500n, updatedAt: 1790900500n, answeredInRound: 100n, blockTimestamp: 1790901000, heartbeatSeconds: 3600 };
assertValidChainlinkRound(goodRound);
assertValidChainlinkRound({ ...goodRound, startedAt: 1790901000n - 3600n, updatedAt: 1790901000n - 3600n });
assert.throws(() => assertValidChainlinkRound({ ...goodRound, startedAt: 1790901000n - 3601n, updatedAt: 1790901000n - 3601n }), /stale/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, answer: 0n }), /non-positive/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, answer: -5n }), /non-positive/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, answeredInRound: 99n }), /answeredInRound < roundId/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, updatedAt: 0n }), /updatedAt is zero/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, updatedAt: 1790901001n }), /after the settlement block/);
// F4 regressions: zero/malformed rounds with a positive fresh answer (accepted before the fix).
assert.throws(() => assertValidChainlinkRound({ ...goodRound, roundId: 0n, answeredInRound: 0n }), /roundId is zero/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, roundId: 0n, answeredInRound: 0n }), /answeredInRound is zero/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, startedAt: 0n }), /startedAt is zero/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, startedAt: 1790900501n }), /startedAt is after updatedAt/);
pass('Chainlink round rejection (stale, negative, incomplete, future, zero ids, malformed timestamps)');

// ── TWAP window and period bounds ──

assert.equal(assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS }), TWAP_WINDOW_SECONDS);
assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS + 3600 });
assert.throws(() => assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS - 1 }), /TWAP window/);
assert.throws(() => assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS + 3601 }), /TWAP window/);

const PERIOD = '2026-09';
const PERIOD_END = settlementPeriodEndSeconds(PERIOD); // 2026-10-01T00:00:00Z
assert.equal(PERIOD_END, Date.parse('2026-10-01T00:00:00Z') / 1000);
assert.throws(() => settlementPeriodEndSeconds('2026-13'), UsageError);
assertPeriodBounds({ period: PERIOD, endTimestamp: PERIOD_END, publishedAtSeconds: PERIOD_END - 86400 });
assertPeriodBounds({ period: PERIOD, endTimestamp: PERIOD_END + 72 * 3600, publishedAtSeconds: PERIOD_END + 72 * 3600 });
assert.throws(() => assertPeriodBounds({ period: PERIOD, endTimestamp: PERIOD_END - 1 }), /precedes the end of period/);
assert.throws(() => assertPeriodBounds({ period: PERIOD, endTimestamp: PERIOD_END + 72 * 3600 + 1 }), /72h after/);
assert.throws(() => assertPeriodBounds({ period: PERIOD, endTimestamp: PERIOD_END + 3600, publishedAtSeconds: PERIOD_END + 3600 - 86401 }), /24h away/);
assert.throws(() => assertPeriodBounds({ period: PERIOD, endTimestamp: PERIOD_END, publishedAtSeconds: PERIOD_END - 86401 }), /24h away|not bound/);
pass('TWAP window and consumer-equivalent period bounds');

// ── RPC error classification (internal only; messages are never printed) ──

assert.equal(classifyRpcErrorMessage('missing trie node 0xabc (path ) state is unavailable'), 'archive-state-unavailable');
assert.equal(classifyRpcErrorMessage('header not found'), 'archive-state-unavailable');
assert.equal(classifyRpcErrorMessage('execution reverted'), 'rpc-error');
assert.equal(classifyRpcErrorMessage(undefined), 'rpc-error');
pass('RPC error classification');

// ── Diff helper ──

assert.deepEqual(diffValues({ a: 1, b: { c: '2' } }, { a: 1, b: { c: '2' } }, 'x'), []);
assert.deepEqual(diffValues({ a: 1 }, { a: 2, z: 0 }, 'x'), ['x.a is 2, chain re-derivation gives 1', 'x.z is not part of the re-derived document']);
assert.deepEqual(diffValues({ a: [1, 2] }, { a: [1] }, 'x'), ['x.a has 1 entries, chain re-derivation gives 2']);
pass('diffValues reports every path');

// ── JSON-RPC level mock chain ───────────────────────────────────────────────
// 12 s blocks ending at HEAD; the pair accrues a constant cumulative rate; both feeds answer
// with fixed freshness relative to each block. Block hashes depend on a fork id so reorgs
// can be simulated; non-canonical hashes stay resolvable by hash like on a real node.

const END_BLOCK = 26_100_000;
const HEAD = END_BLOCK + 200;
const END_TS = PERIOD_END + 1800; // settlement 30 min after period end
const START_BLOCK = END_BLOCK - TWAP_WINDOW_SECONDS / 12; // exact 7-day window: 26049600
const ts = (n) => END_TS - 12 * (END_BLOCK - n);
const R0 = 17_732_250_426_124_888n;
const R1 = 385_399_916_033_610_356n;
const QUOTIENT = (R1 * Q112) / R0;
const T0 = ts(1);
const C0 = 123_456_789n * Q112;
const ETH_USD_ANSWER = 271_227_435_732n;
const EUR_USD_ANSWER = 112_307_000n;
const AGGREGATORS = { [CHAINLINK_ETH_USD.address.toLowerCase()]: '0x7d4e742018fb52e48b08be73d041c18b21de6fb5', [CHAINLINK_EUR_USD.address.toLowerCase()]: '0x966dad3b93c207a9ee3a79c336145e013c5cd3fc' };
const lc = (a) => a.toLowerCase();
const MOCK_CODE = Object.fromEntries([PAIR_ADDRESS, UNISWAP_V2_FACTORY_ADDRESS, IFR_TOKEN_ADDRESS, WETH_ADDRESS, CHAINLINK_ETH_USD.address, CHAINLINK_EUR_USD.address]
  .map((a) => [lc(a), ethers.hexlify(ethers.toUtf8Bytes(`mock-runtime:${lc(a)}`))]));
const MOCK_CODE_HASHES = Object.fromEntries(Object.entries(MOCK_CODE).map(([a, code]) => [a, ethers.keccak256(code)]));
const { PAIR_IFACE, FACTORY_IFACE, ERC20_IFACE, FEED_IFACE } = ABI;

class MockRpcError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function mockChain(opts = {}) {
  const state = { reads: 0, reorged: opts.reorg?.afterReads === 0 };
  const forkOf = (n) => (state.reorged && n >= (opts.reorg?.fromBlock ?? 0) ? 1 : 0);
  const hashOf = (n, fork) => ethers.id(`mock-block:${fork}:${n}`);
  const byHash = new Map();
  const header = (n, fork = forkOf(n)) => {
    const h = { number: ethers.toQuantity(n), hash: hashOf(n, fork), parentHash: hashOf(n - 1, n - 1 >= (opts.reorg?.fromBlock ?? Infinity) ? fork : 0), timestamp: ethers.toQuantity(ts(n)) };
    byHash.set(h.hash, { n, fork });
    return h;
  };
  const resolvePinned = (param) => {
    if (opts.ignorePinning) return END_BLOCK + 150;
    if (!param || typeof param !== 'object' || typeof param.blockHash !== 'string' || param.requireCanonical !== true) throw new MockRpcError(-32602, 'invalid argument 1: expected blockHash object');
    const entry = byHash.get(param.blockHash);
    if (!entry) throw new MockRpcError(-32000, `header for hash ${param.blockHash} not found`);
    if (entry.fork !== forkOf(entry.n)) throw new MockRpcError(-32000, `hash ${param.blockHash} is not currently canonical`);
    return entry.n;
  };
  const afterRead = () => {
    state.reads += 1;
    if (opts.reorg && state.reads === opts.reorg.afterReads) state.reorged = true;
  };
  const feedRound = (address, n) => {
    const isEth = lc(address) === lc(CHAINLINK_ETH_USD.address);
    const updatedAt = BigInt(ts(n) - (isEth ? 500 : 800) - (opts.staleFeeds ? 90_000 : 0));
    const round = [100_000n + BigInt(n), isEth ? ETH_USD_ANSWER : EUR_USD_ANSWER, updatedAt, updatedAt, 100_000n + BigInt(n)];
    return opts.feedRound ? opts.feedRound(isEth ? 'ETH/USD' : 'EUR/USD', round) : round;
  };
  const call = (to, data, n) => {
    const target = lc(to);
    const encode = (iface, fn, values) => iface.encodeFunctionResult(fn, values);
    if (target === lc(PAIR_ADDRESS)) {
      const fn = PAIR_IFACE.parseTransaction({ data }).name;
      const blockTs = ts(n);
      if (fn === 'factory') return encode(PAIR_IFACE, fn, [opts.factory ?? UNISWAP_V2_FACTORY_ADDRESS]);
      if (fn === 'token0') return encode(PAIR_IFACE, fn, [opts.reversed ? WETH_ADDRESS : IFR_TOKEN_ADDRESS]);
      if (fn === 'token1') return encode(PAIR_IFACE, fn, [opts.reversed ? IFR_TOKEN_ADDRESS : WETH_ADDRESS]);
      if (fn === 'getReserves') return encode(PAIR_IFACE, fn, [R0, R1, blockTs - 17]);
      if (fn === 'price0CumulativeLast') return encode(PAIR_IFACE, fn, [C0 + QUOTIENT * BigInt(blockTs - 17 - T0)]);
    }
    if (target === lc(UNISWAP_V2_FACTORY_ADDRESS)) return encode(FACTORY_IFACE, 'getPair', [opts.registeredPair ?? PAIR_ADDRESS]);
    if (target === lc(IFR_TOKEN_ADDRESS)) return encode(ERC20_IFACE, 'decimals', [opts.ifrDecimals ?? 9]);
    if (target === lc(WETH_ADDRESS)) return encode(ERC20_IFACE, 'decimals', [18]);
    if (target in AGGREGATORS) {
      const tx = FEED_IFACE.parseTransaction({ data });
      const isEth = target === lc(CHAINLINK_ETH_USD.address);
      if (tx.name === 'description') return encode(FEED_IFACE, tx.name, [opts.description ?? (isEth ? 'ETH / USD' : 'EUR / USD')]);
      if (tx.name === 'decimals') return encode(FEED_IFACE, tx.name, [opts.feedDecimals ?? 8]);
      if (tx.name === 'aggregator') return encode(FEED_IFACE, tx.name, [AGGREGATORS[target]]);
      const latest = feedRound(target, n);
      if (tx.name === 'latestRoundData') return encode(FEED_IFACE, tx.name, latest);
      if (tx.name === 'getRoundData') {
        const answer = opts.roundDataMismatch ? latest[1] + 1n : latest[1];
        return encode(FEED_IFACE, tx.name, tx.args[0] === latest[0] ? [latest[0], answer, latest[2], latest[3], latest[4]] : [tx.args[0], 0n, 0n, 0n, 0n]);
      }
    }
    throw new MockRpcError(3, 'execution reverted');
  };
  async function rpc(method, params) {
    switch (method) {
      case 'eth_chainId': return ethers.toQuantity(opts.chainId ?? 1);
      case 'eth_getBlockByNumber': {
        const tag = params[0];
        if (tag === 'finalized') return header(opts.finalized ?? HEAD - 64);
        const n = Number(BigInt(tag));
        if (n < 1 || n > HEAD) return null;
        if (opts.wrongNumber && n === END_BLOCK) return header(END_BLOCK - 1);
        return header(n);
      }
      case 'eth_getBlockByHash': {
        const entry = byHash.get(params[0]);
        if (!entry || (opts.vanish && state.reorged)) return null;
        return header(entry.n, entry.fork);
      }
      case 'eth_call': {
        const n = resolvePinned(params[1]);
        afterRead();
        return call(params[0].to, params[0].data, n);
      }
      case 'eth_getCode': {
        resolvePinned(params[1]);
        afterRead();
        return opts.codeOverride?.[lc(params[0])] ?? MOCK_CODE[lc(params[0])] ?? '0x';
      }
      default: throw new MockRpcError(-32601, 'method not found');
    }
  }
  return { rpc, state };
}

// In-process adapter mirroring makeHttpRpc's error mapping (JSON-RPC error -> RpcFailure).
function readerFor(opts = {}, seen = undefined) {
  const chain = mockChain(opts);
  const reader = makeChainReader(async (method, params) => {
    seen?.push([method, params]);
    try {
      return await chain.rpc(method, params);
    } catch (error) {
      if (error instanceof MockRpcError) throw new RpcFailure(method, classifyRpcErrorMessage(error.message), `code ${error.code}`);
      throw error;
    }
  });
  return { reader, chain };
}

const gen = async (opts = {}, args = {}) => generateEvidence(readerFor(opts).reader, { period: PERIOD, endBlockNumber: END_BLOCK, codeHashes: MOCK_CODE_HASHES, ...args });
const ver = async (evidence, opts = {}, args = {}) => verifyEvidence(readerFor(opts).reader, evidence, { period: PERIOD, codeHashes: MOCK_CODE_HASHES, ...args });

// ── Generate + verify end-to-end on the mock chain ──

const { evidence, receipt } = await gen();
assert.equal(evidence.reviewedSourceId, REVIEWED_SOURCE_ID);
assert.equal(evidence.pair, PAIR_ADDRESS.toLowerCase());
assert.equal(evidence.token0, IFR_TOKEN_ADDRESS.toLowerCase());
assert.equal(evidence.start.blockNumber, START_BLOCK);
assert.equal(evidence.end.blockNumber, END_BLOCK);
assert.equal(evidence.start.blockHash, ethers.id(`mock-block:0:${START_BLOCK}`));
assert.equal(evidence.end.timestamp - evidence.start.timestamp, TWAP_WINDOW_SECONDS);
assert.equal(BigInt(evidence.start.price0Cumulative), C0 + QUOTIENT * BigInt(ts(START_BLOCK) - T0));
assert.equal(BigInt(evidence.end.price0Cumulative), C0 + QUOTIENT * BigInt(ts(END_BLOCK) - T0));
assert.equal(evidence.ethEur.rate, '241505369862');
assert.equal(evidence.ethEur.decimals, RATE_DECIMALS);
assert.equal(evidence.ethEur.publishedAt, new Date((END_TS - 800) * 1000).toISOString());
assert.equal(evidence.ethEur.source, ethEurSourceLabel());
assert.ok(evidence.ethEur.source.length <= 120);
assert.equal(evidence.rounding, 'floor');
// Receipt: credential-free read proofs bound to the evidence by its canonical digest.
assert.equal(receipt.kind, RECEIPT_KIND);
assert.equal(receipt.period, PERIOD);
assert.equal(receipt.evidenceDigest, canonicalDigest(evidence));
assert.equal(receipt.blocks.startNext.number, START_BLOCK + 1);
assert.equal(receipt.identity.factory, UNISWAP_V2_FACTORY_ADDRESS.toLowerCase());
assert.equal(receipt.feeds.length, 2);
assert.deepEqual(receipt.feeds.map((f) => [f.label, f.decimals, f.description, f.roundId, f.answer]), [
  ['ETH/USD', 8, 'ETH / USD', String(100_000 + END_BLOCK), String(ETH_USD_ANSWER)],
  ['EUR/USD', 8, 'EUR / USD', String(100_000 + END_BLOCK), String(EUR_USD_ANSWER)],
]);
assert.ok(!/rpc|url|http:\/\/127/i.test(JSON.stringify(receipt).replace(/https:\/\/(eips\.ethereum\.org|github\.com|reference-data-directory\.vercel\.app)\S*?"/g, '"')), 'receipt must not reference the RPC');
pass('generateEvidence + receipt on mock chain');

const verified = await ver(evidence, {}, { receipt });
assert.equal(verified.checks.length, 8);
assert.deepEqual(verified.receipt, receipt);
pass('verifyEvidence (evidence + receipt) on mock chain');

// ── Verify rejects every tampered field ──

async function expectVerificationFailure(mutate, pattern, label, opts = {}) {
  const tampered = structuredClone(evidence);
  mutate(tampered);
  await assert.rejects(ver(tampered, opts), (error) => {
    assert.ok(error instanceof VerificationError, `${label}: expected VerificationError, got ${error?.constructor?.name}: ${error?.message}`);
    assert.match(error.message, pattern, label);
    return true;
  });
}

await expectVerificationFailure((e) => { e.start.blockHash = `0x${'99'.repeat(32)}`; }, /evidence\.start\.blockHash/, 'start blockHash');
await expectVerificationFailure((e) => { e.end.blockHash = `0x${'99'.repeat(32)}`; }, /evidence\.end\.blockHash/, 'end blockHash');
await expectVerificationFailure((e) => { e.start.timestamp += 12; }, /evidence\.start\.timestamp/, 'start timestamp');
await expectVerificationFailure((e) => { e.start.price0Cumulative = (BigInt(e.start.price0Cumulative) + 1n).toString(); }, /evidence\.start\.price0Cumulative/, 'start cumulative');
await expectVerificationFailure((e) => { e.end.price0Cumulative = (BigInt(e.end.price0Cumulative) - 1n).toString(); }, /evidence\.end\.price0Cumulative/, 'end cumulative');
await expectVerificationFailure((e) => { e.ethEur.rate = (BigInt(e.ethEur.rate) + 1n).toString(); }, /evidence\.ethEur\.rate/, 'rate');
await expectVerificationFailure((e) => { e.ethEur.publishedAt = new Date((END_TS - 740) * 1000).toISOString(); }, /evidence\.ethEur\.publishedAt/, 'publishedAt');
await expectVerificationFailure((e) => { e.ethEur.decimals = 9; }, /evidence\.ethEur\.decimals/, 'decimals');
await expectVerificationFailure((e) => { e.ethEur.source = 'chainlink'; }, /evidence\.ethEur\.source/, 'source');
await expectVerificationFailure((e) => { e.pair = `0x${'11'.repeat(20)}`; }, /evidence\.pair/, 'pair');
await expectVerificationFailure((e) => { e.token0 = `0x${'11'.repeat(20)}`; }, /evidence\.token0/, 'token0');
await expectVerificationFailure((e) => { e.reviewedSourceId = 'other'; }, /evidence\.reviewedSourceId/, 'source id');
await expectVerificationFailure((e) => { e.rounding = 'ceil'; }, /evidence\.rounding/, 'rounding');
await expectVerificationFailure((e) => { e.extra = 1; }, /evidence\.extra is not part/, 'extra field');
await expectVerificationFailure((e) => { e.start.blockNumber = e.end.blockNumber; }, /end block must follow/, 'block order');
// Every independent mismatch is reported, not just the first.
await expectVerificationFailure((e) => { e.start.blockHash = `0x${'99'.repeat(32)}`; e.ethEur.rate = '1'; }, /start\.blockHash[\s\S]*ethEur\.rate|ethEur\.rate[\s\S]*start\.blockHash/, 'multiple mismatches');
// Receipt proofs are re-derived and compared too.
for (const [label, mutate, pattern] of [
  ['feed answer', (r) => { r.feeds[0].answer = '1'; }, /receipt\.feeds\[0\]\.answer/],
  ['feed roundId', (r) => { r.feeds[1].roundId = '1'; }, /receipt\.feeds\[1\]\.roundId/],
  ['feed decimals', (r) => { r.feeds[0].decimals = 18; }, /receipt\.feeds\[0\]\.decimals/],
  ['digest', (r) => { r.evidenceDigest = `0x${'00'.repeat(32)}`; }, /receipt\.evidenceDigest/],
  ['period', (r) => { r.period = '2026-08'; }, /receipt\.period/],
]) {
  const tampered = structuredClone(receipt);
  mutate(tampered);
  await assert.rejects(ver(evidence, {}, { receipt: tampered }), (error) => error instanceof VerificationError && pattern.test(error.message), label);
}
await assert.rejects(ver({ start: {}, end: {} }), /does not match the expected shape/);
await assert.rejects(ver(null), /JSON object/);
pass('verify rejects every tampered evidence and receipt field');

// ── F3: explicit expected period and deterministic start (red before the fix) ──

// A truthful older start block (genuine hash/timestamp/cumulative, window still within the
// 1h tolerance) must fail: the start is not the deterministic latest block at/before end-7d.
const olderStart = START_BLOCK - 5;
const truthfulOlder = structuredClone(evidence);
truthfulOlder.start = {
  blockNumber: olderStart,
  blockHash: ethers.id(`mock-block:0:${olderStart}`),
  timestamp: ts(olderStart),
  price0Cumulative: (C0 + QUOTIENT * BigInt(ts(olderStart) - T0)).toString(),
};
assertSettlementWindow({ startTimestamp: truthfulOlder.start.timestamp, endTimestamp: truthfulOlder.end.timestamp });
await assert.rejects(ver(truthfulOlder), (error) => error instanceof VerificationError && /evidence\.start\.blockNumber is 26049595, chain re-derivation gives 26049600/.test(error.message));
// Wrong period: the same truthful evidence does not settle August or October.
await assert.rejects(ver(evidence, {}, { period: '2026-08' }), (error) => error instanceof VerificationError && /72h after the end of period 2026-08/.test(error.message));
await assert.rejects(ver(evidence, {}, { period: '2026-10' }), (error) => error instanceof VerificationError && /precedes the end of period 2026-10/.test(error.message));
// Period is mandatory for verify.
await assert.rejects(verifyEvidence(readerFor().reader, evidence, { codeHashes: MOCK_CODE_HASHES }), UsageError);
// Generation refuses end blocks outside the period bounds.
await assert.rejects(gen({}, { endBlockNumber: END_BLOCK - 1000 }), /precedes the end of period/);
pass('verify enforces expected period and deterministic start block');

// ── F1: canonical snapshot, pinning, reorg and finality (red before the fix) ──

// Every state/code read carries an EIP-1898 pinned block hash.
const PINNED_READS = 36;
{
  const seen = [];
  await generateEvidence(readerFor({}, seen).reader, { period: PERIOD, endBlockNumber: END_BLOCK, codeHashes: MOCK_CODE_HASHES });
  const stateReads = seen.filter(([m]) => m === 'eth_call' || m === 'eth_getCode');
  // 2 x (4 code + 6 identity calls) + 2 x 2 pair-state calls + 2 feeds x (1 code + 5 calls).
  // Plus one rejected pinning probe at an unknown hash.
  assert.equal(stateReads.length, PINNED_READS + 1);
  for (const [, params] of stateReads) {
    assert.equal(params[1].requireCanonical, true);
    assert.match(params[1].blockHash, /^0x[0-9a-f]{64}$/);
  }
  assert.equal(seen.filter(([m]) => m === 'eth_getBlockByHash').length, 3, 'final number<->hash recheck covers start, startNext, end');
}
// RPC that silently ignores pinning is rejected before any evidence is produced.
await assert.rejects(gen({ ignorePinning: true }), /ignores EIP-1898/);
// Reorg right after the last pinned read (end block replaced): only the final recheck can see it.
await assert.rejects(gen({ reorg: { afterReads: PINNED_READS, fromBlock: END_BLOCK } }), /Reorg detected: block 26100000 is now/);
// Reorg in the middle of the reads: pinned reads on the stale hash fail closed.
await assert.rejects(gen({ reorg: { afterReads: 5, fromBlock: START_BLOCK } }), /RPC eth_(call|getCode) failed: rpc-error \(code -32000\)/);
// Reorg that also makes the old hash unknown (vanished): fails closed.
await assert.rejects(gen({ reorg: { afterReads: PINNED_READS, fromBlock: START_BLOCK }, vanish: true }), /Reorg detected/);
// Evidence generated on a chain that later reorgs no longer verifies.
await assert.rejects(ver(evidence, { reorg: { afterReads: 0, fromBlock: START_BLOCK } }), /evidence\.end\.blockHash[\s\S]*evidence\.start\.blockHash/);
// Unfinalized end block is refused.
await assert.rejects(gen({ finalized: END_BLOCK - 1 }), /not finalized/);
// Inconsistent RPC responses (block number mismatch, wrong chain) fail closed.
await assert.rejects(gen({ wrongNumber: true }), /Inconsistent RPC response/);
await assert.rejects(gen({ chainId: 11_155_111 }), /not Ethereum mainnet/);
await assert.rejects(gen({ staleFeeds: true }), /stale/);
pass('canonical pinning, reorg, vanished hash, finality and inconsistent-response fail closed');

// ── F4: pair/factory/token/feed identity and malformed rounds (red before the fix) ──

for (const [label, opts, pattern] of [
  ['wrong factory', { factory: `0x${'22'.repeat(20)}` }, /not the Uniswap V2 factory/],
  ['factory registers another pair', { registeredPair: `0x${'33'.repeat(20)}` }, /getPair\(IFR, WETH\)/],
  ['token order reversed', { reversed: true }, /token0 .* not IFR/],
  ['IFR decimals', { ifrDecimals: 18 }, /IFR decimals/],
  ['pair code hash', { codeOverride: { [lc(PAIR_ADDRESS)]: '0x6001' } }, /code at 0xbE495E9c.* has hash/],
  ['feed code hash', { codeOverride: { [lc(CHAINLINK_EUR_USD.address)]: '0x6001' } }, /code at 0xb49f6779.* has hash/],
  ['feed without code', { codeOverride: { [lc(CHAINLINK_ETH_USD.address)]: '0x' } }, /No contract code/],
  ['feed description', { description: 'BTC / USD' }, /description/],
  ['feed decimals', { feedDecimals: 18 }, /decimals at block .* are 18/],
  ['zero round ids', { feedRound: (_l, r) => [0n, r[1], r[2], r[3], 0n] }, /roundId is zero/],
  ['zero startedAt', { feedRound: (_l, r) => [r[0], r[1], 0n, r[3], r[4]] }, /startedAt is zero/],
  ['negative answer', { feedRound: (_l, r) => [r[0], -1n, r[2], r[3], r[4]] }, /non-positive/],
  ['getRoundData disagrees', { roundDataMismatch: true }, /getRoundData/],
]) {
  await assert.rejects(gen(opts), pattern, label);
}
// The pinned mainnet code hashes are the default identity (mock code never matches them).
await assert.rejects(generateEvidence(readerFor().reader, { period: PERIOD, endBlockNumber: END_BLOCK }), /expected pinned 0x5b83bdbc/);
assert.equal(Object.keys(MAINNET_CODE_HASHES).length, 6);
for (const hash of Object.values(MAINNET_CODE_HASHES)) assert.match(hash, /^0x[0-9a-f]{64}$/);
pass('identity authentication (factory, getPair, token order, decimals, code hashes, feed metadata, rounds)');

// ── findBlockAtOrBefore ──

{
  const { reader } = readerFor();
  assert.equal(await findBlockAtOrBefore(reader, ts(END_BLOCK) - TWAP_WINDOW_SECONDS, END_BLOCK - 1), START_BLOCK);
  assert.equal(await findBlockAtOrBefore(reader, ts(START_BLOCK) + 5, END_BLOCK - 1), START_BLOCK);
  assert.equal(await findBlockAtOrBefore(reader, ts(START_BLOCK) - 1, END_BLOCK - 1), START_BLOCK - 1);
}
pass('start-block binary search');

// ── buildEvidence shape ──

const built = buildEvidence({
  start: { blockNumber: 1, blockHash: `0x${'AB'.repeat(32)}`, timestamp: 100, price0Cumulative: 5n },
  end: { blockNumber: 2, blockHash: `0x${'CD'.repeat(32)}`, timestamp: 200, price0Cumulative: 6n },
  ethEur: { source: 's', publishedAt: '2026-10-01T00:00:00.000Z', rate: 1n, decimals: 8 },
});
assert.equal(built.start.blockHash, `0x${'ab'.repeat(32)}`);
assert.match(built.pair, /^0x[a-f0-9]{40}$/);
// Canonical digest is key-order independent (it is not a hash of the file bytes).
assert.equal(canonicalDigest({ b: 1, a: { d: 2, c: 3 } }), canonicalDigest({ a: { c: 3, d: 2 }, b: 1 }));
pass('buildEvidence schema shape and canonical digest');

// ── F2: CLI diagnostics never contain RPC credentials (red before the fix) ──

const SCRIPT = fileURLToPath(new URL('./model-b-price-evidence.mjs', import.meta.url));
const SENTINELS = ['SENTINELUSER7f3a', 'SENTINELPASS9c2e', 'SENTINELPATH4b1d', 'SENTINELQUERY8e6f', 'SENTINELPOS1a2b'];

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Hostile endpoint: every response echoes the request URL and auth header back.
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const echo = `${req.url} ${req.headers.authorization ?? ''} ${Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString()}`;
    const mode = req.url.split('/')[1];
    if (mode === 'http500') { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(`internal error for ${echo}`); return; }
    if (mode === 'http403') { res.writeHead(403); res.end(`forbidden ${echo}`); return; }
    if (mode === 'notjson') { res.writeHead(200); res.end(`<html>${echo}</html>`); return; }
    let id = 1;
    try { id = JSON.parse(body).id; } catch { /* keep default */ }
    if (mode === 'rpcerror') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: `missing trie node; request ${echo}` } })); return; }
    // 'chain' mode: a mainnet-looking chain id, then a revert carrying the echo.
    const method = JSON.parse(body).method;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (method === 'eth_chainId') res.end(JSON.stringify({ jsonrpc: '2.0', id, result: '0x1' }));
    else res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 3, message: `execution reverted ${echo}`, data: echo } }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const closedPort = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const credUrl = (mode, p = port) => `http://${SENTINELS[0]}:${SENTINELS[1]}@127.0.0.1:${p}/${mode}/${SENTINELS[2]}?key=${SENTINELS[3]}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-b-evidence-'));
const evidenceFile = path.join(tmp, 'evidence.json');
fs.writeFileSync(evidenceFile, JSON.stringify(evidence));

const cliCases = [
  ['generate HTTP 500', ['generate', '--rpc', credUrl('http500'), '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', path.join(tmp, 'a.json'), '--receipt', path.join(tmp, 'a.r.json')], 1, /RPC eth_chainId failed: http-500/],
  ['generate HTTP 403', ['generate', '--rpc', credUrl('http403'), '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', path.join(tmp, 'b.json'), '--receipt', path.join(tmp, 'b.r.json')], 1, /http-403.*archive-capable/],
  ['generate non-JSON body', ['generate', '--rpc', credUrl('notjson'), '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', path.join(tmp, 'c.json'), '--receipt', path.join(tmp, 'c.r.json')], 1, /malformed-response/],
  ['generate JSON-RPC error', ['generate', '--rpc', credUrl('rpcerror'), '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', path.join(tmp, 'd.json'), '--receipt', path.join(tmp, 'd.r.json')], 1, /archive-state-unavailable \(code -32000/],
  ['generate revert with echoed data', ['generate', '--rpc', credUrl('chain'), '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', path.join(tmp, 'e.json'), '--receipt', path.join(tmp, 'e.r.json')], 1, /RPC eth_getBlockByNumber failed: rpc-error \(code 3\)/],
  ['verify connection refused', ['verify', '--rpc', credUrl('chain', closedPort), '--period', PERIOD, '--file', evidenceFile], 1, /network-error/],
  ['verify HTTP 500', ['verify', '--rpc', credUrl('http500'), '--period', PERIOD, '--file', evidenceFile], 1, /http-500/],
  ['usage: invalid URL', ['verify', '--rpc', `not a url ${SENTINELS[1]}`, '--period', PERIOD, '--file', evidenceFile], 2, /valid http\(s\) URL/],
  ['usage: non-http protocol', ['verify', '--rpc', `ftp://${SENTINELS[0]}:${SENTINELS[1]}@h/${SENTINELS[2]}`, '--period', PERIOD, '--file', evidenceFile], 2, /http\(s\) URL/],
  ['usage: positional value', ['verify', SENTINELS[4], '--rpc', credUrl('chain')], 2, /Unexpected positional/],
  ['usage: unknown option value', ['verify', `--${SENTINELS[4]}=${SENTINELS[1]}`], 2, /Unknown option/],
  ['usage: missing period', ['verify', '--rpc', credUrl('chain'), '--file', evidenceFile], 2, /--period/],
];
try {
  for (const [label, args, expectedCode, pattern] of cliCases) {
    const { code, stdout, stderr } = await runCli(args);
    assert.equal(code, expectedCode, `${label}: exit code (stderr: ${stderr})`);
    assert.match(stderr, pattern, label);
    for (const sentinel of SENTINELS) {
      assert.ok(!stdout.includes(sentinel) && !stderr.includes(sentinel), `${label}: output leaks sentinel ${sentinel}`);
    }
    assert.ok(!stderr.includes(`127.0.0.1:${port}`) && !stderr.includes('Basic '), `${label}: output leaks endpoint or auth header`);
  }
  // No output files are written on failure.
  assert.deepEqual(fs.readdirSync(tmp).sort(), ['evidence.json']);
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
pass('CLI diagnostics free of RPC credentials (HTTP, JSON-RPC, network, malformed, usage)');

// ── Fixture bridge: committed backend fixtures equal this tool's generate output ──

const fixtureDir = new URL('../apps/benefits-network/backend/tests/fixtures/', import.meta.url);
const evidenceFixture = new URL('modelBPriceEvidence.sample.json', fixtureDir);
const receiptFixture = new URL('modelBPriceEvidence.sample.receipt.json', fixtureDir);
if (process.env.WRITE_MODEL_B_FIXTURE === '1') {
  fs.writeFileSync(evidenceFixture, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(receiptFixture, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log('[model-b-price-evidence] fixtures regenerated from generateEvidence output');
}
assert.deepEqual(JSON.parse(fs.readFileSync(evidenceFixture, 'utf8')), evidence, 'backend evidence fixture must equal generateEvidence output (regenerate with WRITE_MODEL_B_FIXTURE=1)');
assert.deepEqual(JSON.parse(fs.readFileSync(receiptFixture, 'utf8')), receipt, 'backend receipt fixture must equal generateEvidence output (regenerate with WRITE_MODEL_B_FIXTURE=1)');
pass('backend fixture bridge (evidence + receipt)');

console.log('[model-b-price-evidence] ALL TESTS PASSED');
