#!/usr/bin/env node
/**
 * Unit and contract tests for scripts/model-b-price-evidence.mjs (T-290).
 *
 * Covers: counterfactual cumulative-price math incl. uint32/uint224/uint256 wrap semantics,
 * Chainlink ETH/EUR floor division and round rejection, TWAP window bounds, archive-error
 * detection, end-to-end generate + verify against a deterministic mock chain, and the
 * fixture bridge: the committed backend fixture must equal this tool's generate output, so
 * the backend schema test (apps/benefits-network/backend/tests/modelBPriceEvidence.test.ts)
 * validates real tool output against the real priceEvidenceSchema.
 *
 * Run: node scripts/test-model-b-price-evidence.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHAINLINK_ETH_USD,
  CHAINLINK_EUR_USD,
  IFR_TOKEN_ADDRESS,
  PAIR_ADDRESS,
  RATE_DECIMALS,
  REVIEWED_SOURCE_ID,
  TWAP_WINDOW_SECONDS,
  WETH_ADDRESS,
  VerificationError,
  assertSettlementWindow,
  assertValidChainlinkRound,
  buildEvidence,
  computeEthEurRate,
  currentCumulativePrice0,
  ethEurSourceLabel,
  findBlockAtOrBefore,
  generateEvidence,
  isArchiveError,
  settlementPeriodEndSeconds,
  verifyEvidence,
} from './model-b-price-evidence.mjs';

const Q112 = 2n ** 112n;

// ── Cumulative price math (UniswapV2OracleLibrary.currentCumulativePrices parity) ──

// Exact vector: quotient = (2^111 * 2^112) / 1 = 2^223; 3 seconds accrual.
assert.equal(
  currentCumulativePrice0({ price0CumulativeLast: 7n, reserve0: 1n, reserve1: 2n ** 111n, blockTimestampLast: 100, blockTimestamp: 103 }),
  7n + 3n * 2n ** 223n
);
// uint256 accumulation wrap: (2^256 - 10) + 5 * 2^114 wraps to 5 * 2^114 - 10.
assert.equal(
  currentCumulativePrice0({ price0CumulativeLast: 2n ** 256n - 10n, reserve0: 1n, reserve1: 4n, blockTimestampLast: 40, blockTimestamp: 45 }),
  5n * 2n ** 114n - 10n
);
// uint32 timestamp wrap: blockTimestamp casts to 5, last is 2^32 - 6, elapsed wraps to 11.
assert.equal(
  currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: 2n, blockTimestampLast: 2n ** 32n - 6n, blockTimestamp: 2n ** 32n + 5n }),
  11n * 2n ** 113n
);
// Maximal uint112 reserves: quotient (2^112 - 1) * 2^112 still fits uint224, no accrual without elapsed time.
assert.equal(
  currentCumulativePrice0({ price0CumulativeLast: 9n, reserve0: 1n, reserve1: Q112 - 1n, blockTimestampLast: 50, blockTimestamp: 50 }),
  9n
);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 0n, reserve1: 1n, blockTimestampLast: 0, blockTimestamp: 1 }), /reserves must be positive/);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: 0n, blockTimestampLast: 0, blockTimestamp: 1 }), /reserves must be positive/);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: Q112, blockTimestampLast: 0, blockTimestamp: 1 }), /uint112/);
console.log('[model-b-price-evidence] PASS - cumulative price math incl. uint32/uint256 wrap');

// ── Chainlink ETH/EUR division, decimals and floor rounding ──

assert.equal(computeEthEurRate({ ethUsdAnswer: 250_000_000_000n, eurUsdAnswer: 125_000_000n }), 200_000_000_000n);
// floor: 1.00 / 3.00 = 0.33333333... truncates, never rounds up.
assert.equal(computeEthEurRate({ ethUsdAnswer: 100_000_000n, eurUsdAnswer: 300_000_000n }), 33_333_333n);
// Live-shape vector (2026-10-06): 2712.27435732 / 1.12307 floors to 2415.05369862 EUR per ETH.
assert.equal(computeEthEurRate({ ethUsdAnswer: 271_227_435_732n, eurUsdAnswer: 112_307_000n }), 241_505_369_862n);
assert.equal(computeEthEurRate({ ethUsdAnswer: 271_227_435_732n, eurUsdAnswer: 112_307_000n, rateDecimals: 2 }), 241_505n);
assert.throws(() => computeEthEurRate({ ethUsdAnswer: 0n, eurUsdAnswer: 112_307_000n }), /positive/);
assert.throws(() => computeEthEurRate({ ethUsdAnswer: 271_227_435_732n, eurUsdAnswer: -1n }), /positive/);
console.log('[model-b-price-evidence] PASS - ETH/EUR floor division and decimals');

// ── Chainlink round rejection ──

const goodRound = { roundId: 100n, answer: 271_227_435_732n, updatedAt: 1790900500n, answeredInRound: 100n, blockTimestamp: 1790901000, heartbeatSeconds: 3600 };
assertValidChainlinkRound(goodRound);
assertValidChainlinkRound({ ...goodRound, updatedAt: 1790901000n - 3600n }); // exactly at heartbeat: still fresh
assert.throws(() => assertValidChainlinkRound({ ...goodRound, updatedAt: 1790901000n - 3601n }), /stale/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, answer: 0n }), /non-positive/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, answer: -5n }), /non-positive/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, answeredInRound: 99n }), /answeredInRound < roundId/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, updatedAt: 0n }), /updatedAt is zero/);
assert.throws(() => assertValidChainlinkRound({ ...goodRound, updatedAt: 1790901001n }), /after the settlement block/);
console.log('[model-b-price-evidence] PASS - Chainlink round rejection (stale, negative, incomplete, future)');

// ── TWAP window bounds ──

assert.equal(assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS }), TWAP_WINDOW_SECONDS);
assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS + 3600 });
assert.throws(() => assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS - 1 }), /TWAP window/);
assert.throws(() => assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS + 3601 }), /TWAP window/);
console.log('[model-b-price-evidence] PASS - TWAP window bounds');

// ── Archive-error detection ──

assert.equal(isArchiveError(new Error('missing trie node 0xabc (path ) state is unavailable')), true);
assert.equal(isArchiveError(new Error('header not found')), true);
assert.equal(isArchiveError({ shortMessage: 'server response 403 Forbidden' }), true);
assert.equal(isArchiveError(new Error('execution reverted: ERC20: insufficient balance')), false);
assert.equal(isArchiveError(new Error('network timeout')), false);
console.log('[model-b-price-evidence] PASS - archive-error detection');

// ── Deterministic mock chain ──
// Timestamps: 12s blocks ending at END_BLOCK; the pair accrues a constant cumulative rate;
// both feeds answer with fixed freshness relative to each block. Every generate/verify read
// is reproducible from this model, so the fixture below is a captured generate output.

const PERIOD = '2026-09';
const PERIOD_END = settlementPeriodEndSeconds(PERIOD); // 2026-10-01T00:00:00Z
const END_BLOCK = 26_100_000;
const END_TS = PERIOD_END + 1800; // settlement 30 min after period end
const START_BLOCK = END_BLOCK - TWAP_WINDOW_SECONDS / 12; // exact 7-day window: 26049600
const ts = (n) => END_TS - 12 * (END_BLOCK - n);
const R0 = 17_732_250_426_124_888n;
const R1 = 385_399_916_033_610_356n;
const QUOTIENT = (R1 * Q112) / R0; // wei per IFR base unit, UQ112x112
const T0 = ts(1); // pair "deploy" timestamp: cumulative accrual origin
const C0 = 123_456_789n * Q112; // cumulative at T0
const ETH_USD_ANSWER = 271_227_435_732n;
const EUR_USD_ANSWER = 112_307_000n;

function mockReader(overrides = {}) {
  return {
    async getChainId() { return overrides.chainId ?? 1; },
    async getBlockNumber() { return END_BLOCK; },
    async getBlock(n) {
      if (n < 1 || n > END_BLOCK) throw new Error(`Block ${n} not found`);
      return { hash: `0x${n.toString(16).padStart(8, '0')}${'ab'.repeat(28)}`, timestamp: ts(n) };
    },
    async readPair(n) {
      const blockTs = ts(n);
      return {
        token0: IFR_TOKEN_ADDRESS,
        token1: WETH_ADDRESS,
        reserve0: R0,
        reserve1: R1,
        blockTimestampLast: blockTs - 17,
        price0CumulativeLast: C0 + QUOTIENT * BigInt(blockTs - 17 - T0),
      };
    },
    async readFeed(feed, n) {
      const stale = overrides.staleFeeds ? 90_000 : 0;
      return {
        roundId: 100_000n + BigInt(n),
        answer: feed.address === CHAINLINK_ETH_USD.address ? ETH_USD_ANSWER : EUR_USD_ANSWER,
        updatedAt: BigInt(ts(n) - (feed.address === CHAINLINK_ETH_USD.address ? 500 : 800) - stale),
        answeredInRound: 100_000n + BigInt(n),
        decimals: 8,
      };
    },
  };
}

// ── Generate + verify end-to-end on the mock chain ──

const evidence = await generateEvidence(mockReader(), { period: PERIOD, endBlockNumber: END_BLOCK });
assert.equal(evidence.reviewedSourceId, REVIEWED_SOURCE_ID);
assert.equal(evidence.pair, PAIR_ADDRESS.toLowerCase());
assert.equal(evidence.token0, IFR_TOKEN_ADDRESS.toLowerCase());
assert.equal(evidence.start.blockNumber, START_BLOCK);
assert.equal(evidence.end.blockNumber, END_BLOCK);
assert.equal(evidence.end.timestamp - evidence.start.timestamp, TWAP_WINDOW_SECONDS);
// Counterfactual accrual of 17s per block is included: cumulative = C0 + q * (ts - T0).
assert.equal(BigInt(evidence.start.price0Cumulative), C0 + QUOTIENT * BigInt(ts(START_BLOCK) - T0));
assert.equal(BigInt(evidence.end.price0Cumulative), C0 + QUOTIENT * BigInt(ts(END_BLOCK) - T0));
assert.ok(BigInt(evidence.end.price0Cumulative) > BigInt(evidence.start.price0Cumulative));
assert.equal(evidence.ethEur.rate, computeEthEurRate({ ethUsdAnswer: ETH_USD_ANSWER, eurUsdAnswer: EUR_USD_ANSWER }).toString());
assert.equal(evidence.ethEur.decimals, RATE_DECIMALS);
assert.equal(evidence.ethEur.publishedAt, new Date((END_TS - 800) * 1000).toISOString());
assert.equal(evidence.ethEur.source, ethEurSourceLabel());
assert.ok(evidence.ethEur.source.length <= 120);
assert.equal(evidence.rounding, 'floor');
console.log('[model-b-price-evidence] PASS - generateEvidence on mock chain');

const checks = await verifyEvidence(mockReader(), evidence);
assert.equal(checks.length, 7);
console.log('[model-b-price-evidence] PASS - verifyEvidence on mock chain');

// ── Verify rejects every tampered field ──

async function expectVerificationFailure(mutate, pattern, label) {
  const tampered = JSON.parse(JSON.stringify(evidence));
  mutate(tampered);
  await assert.rejects(verifyEvidence(mockReader(), tampered), (error) => {
    assert.ok(error instanceof VerificationError, `${label}: expected VerificationError`);
    assert.match(error.message, pattern);
    return true;
  });
}

await expectVerificationFailure((e) => { e.start.blockHash = `0x${'99'.repeat(32)}`; }, /start\.blockHash/, 'blockHash mismatch');
await expectVerificationFailure((e) => { e.end.blockHash = `0x${'99'.repeat(32)}`; }, /end\.blockHash/, 'end blockHash mismatch');
await expectVerificationFailure((e) => { e.start.timestamp += 12; }, /start\.timestamp/, 'start timestamp mismatch');
await expectVerificationFailure((e) => { e.start.price0Cumulative = (BigInt(e.start.price0Cumulative) + 1n).toString(); }, /start\.price0Cumulative/, 'start cumulative mismatch');
await expectVerificationFailure((e) => { e.end.price0Cumulative = (BigInt(e.end.price0Cumulative) - 1n).toString(); }, /end\.price0Cumulative/, 'end cumulative mismatch');
await expectVerificationFailure((e) => { e.ethEur.rate = (BigInt(e.ethEur.rate) + 1n).toString(); }, /ethEur\.rate/, 'rate mismatch');
await expectVerificationFailure((e) => { e.ethEur.publishedAt = new Date((END_TS - 800 + 60) * 1000).toISOString(); }, /ethEur\.publishedAt/, 'publishedAt mismatch');
await expectVerificationFailure((e) => { e.ethEur.decimals = 9; }, /ethEur\.decimals/, 'decimals mismatch');
await expectVerificationFailure((e) => { e.ethEur.source = 'chainlink'; }, /ethEur\.source/, 'source mismatch');
await expectVerificationFailure((e) => { e.pair = `0x${'11'.repeat(20)}`; }, /pair/, 'pair mismatch');
await expectVerificationFailure((e) => { e.token0 = `0x${'11'.repeat(20)}`; }, /token0/, 'token0 mismatch');
await expectVerificationFailure((e) => { e.rounding = 'ceil'; }, /rounding/, 'rounding mismatch');
// Multiple independent mismatches are all reported, not just the first.
await assert.rejects(
  verifyEvidence(mockReader(), { ...JSON.parse(JSON.stringify(evidence)), start: { ...evidence.start, blockHash: `0x${'99'.repeat(32)}` }, ethEur: { ...evidence.ethEur, rate: '1' } }),
  (error) => {
    assert.match(error.message, /start\.blockHash/);
    assert.match(error.message, /ethEur\.rate/);
    return true;
  }
);
// A reorged chain (reader serves a different block hash) fails verification.
const reorgedReader = mockReader();
const originalGetBlock = reorgedReader.getBlock;
reorgedReader.getBlock = async (n) => ({ ...(await originalGetBlock(n)), hash: `0x${'77'.repeat(32)}` });
await assert.rejects(verifyEvidence(reorgedReader, evidence), /blockHash/);
// Stale feeds at the end block fail generation.
await assert.rejects(generateEvidence(mockReader({ staleFeeds: true }), { period: PERIOD, endBlockNumber: END_BLOCK }), /stale/);
// Wrong chain id fails closed.
await assert.rejects(generateEvidence(mockReader({ chainId: 11_155_111 }), { period: PERIOD, endBlockNumber: END_BLOCK }), /mainnet/);
// End block before the period end is rejected.
await assert.rejects(generateEvidence(mockReader(), { period: PERIOD, endBlockNumber: END_BLOCK - 1000 }), /precedes the end of period/);
// Malformed evidence files fail with a clear shape error, not a TypeError.
await assert.rejects(verifyEvidence(mockReader(), { start: {}, end: {} }), /does not match the expected shape/);
await assert.rejects(verifyEvidence(mockReader(), null), /JSON object/);
console.log('[model-b-price-evidence] PASS - verify rejects tampered fields and hostile chain states');

// ── findBlockAtOrBefore ──

assert.equal(await findBlockAtOrBefore(mockReader(), ts(END_BLOCK) - TWAP_WINDOW_SECONDS, END_BLOCK - 1), START_BLOCK);
assert.equal(await findBlockAtOrBefore(mockReader(), ts(START_BLOCK) + 5, END_BLOCK - 1), START_BLOCK); // rounds down to the earlier block
assert.equal(await findBlockAtOrBefore(mockReader(), ts(START_BLOCK) - 1, END_BLOCK - 1), START_BLOCK - 1);
console.log('[model-b-price-evidence] PASS - start-block binary search');

// ── buildEvidence shape ──

const built = buildEvidence({
  start: { blockNumber: 1, blockHash: `0x${'AB'.repeat(32)}`, timestamp: 100, price0Cumulative: 5n },
  end: { blockNumber: 2, blockHash: `0x${'CD'.repeat(32)}`, timestamp: 200, price0Cumulative: 6n },
  ethEur: { source: 's', publishedAt: '2026-10-01T00:00:00.000Z', rate: 1n, decimals: 8 },
});
assert.equal(built.start.blockHash, `0x${'ab'.repeat(32)}`);
assert.match(built.start.price0Cumulative, /^(0|[1-9][0-9]{0,77})$/);
assert.match(built.pair, /^0x[a-f0-9]{40}$/);
console.log('[model-b-price-evidence] PASS - buildEvidence schema shape');

// ── Fixture bridge: the committed backend fixture equals this tool's generate output ──

const fixturePath = new URL('../apps/benefits-network/backend/tests/fixtures/modelBPriceEvidence.sample.json', import.meta.url);
if (process.env.WRITE_MODEL_B_FIXTURE === '1') {
  fs.writeFileSync(fixturePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('[model-b-price-evidence] fixture regenerated from generateEvidence output');
}
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert.deepEqual(fixture, evidence, 'backend fixture must equal generateEvidence output (regenerate with WRITE_MODEL_B_FIXTURE=1)');
console.log('[model-b-price-evidence] PASS - backend fixture bridge');

console.log('[model-b-price-evidence] ALL TESTS PASSED');
