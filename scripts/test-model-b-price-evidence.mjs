#!/usr/bin/env node
/**
 * Tests for scripts/model-b-price-evidence.mjs (T-290). Wired into CI via
 * `npm run test:model-b-price-evidence` (.github/workflows/contracts.yml).
 *
 * Sections:
 *  - pure math with differential vectors computed independently (Python decimal/int
 *    arithmetic, see comments) for UniswapV2OracleLibrary.currentCumulativePrices parity,
 *    uint32/uint256 wraps, IFR9/WETH18 normalization and ETH/EUR floor division;
 *  - Codex review finding 1: canonical EIP-1898 snapshot (pinning, probe, mid/final-read reorg,
 *    vanished hash, finality, inconsistent headers);
 *  - finding 2: credential-safe diagnostics (transport + CLI stdout/stderr with sentinels);
 *  - finding 3: verify requires the expected period and the deterministic start block;
 *  - finding 4: pair/factory/token/feed identity, malformed rounds, read proofs;
 *  - fixture bridge: the backend fixture equals generate output (schema test in jest).
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
import {
  ABIS,
  CHAINLINK_ETH_USD,
  CHAINLINK_EUR_USD,
  EvidenceError,
  IFR_TOKEN_ADDRESS,
  PAIR_ADDRESS,
  PINNING_PROBE_HASH,
  RATE_DECIMALS,
  REVIEWED_SOURCE_ID,
  TWAP_WINDOW_SECONDS,
  UNISWAP_V2_FACTORY,
  VerificationError,
  WETH_ADDRESS,
  assertSettlementWindow,
  assertValidChainlinkRound,
  buildEvidence,
  canonicalEvidenceDigest,
  classifyRpcError,
  computeEthEurRate,
  consumerBoundViolations,
  currentCumulativePrice0,
  ethEurSourceLabel,
  generateEvidence,
  makeChainReader,
  makeHttpTransport,
  parseArgs,
  renderError,
  settlementPeriodEndSeconds,
  verifyEvidence,
} from './model-b-price-evidence.mjs';

const SCRIPT = fileURLToPath(new URL('./model-b-price-evidence.mjs', import.meta.url));
const Q112 = 2n ** 112n;
const pass = (what) => console.log(`[model-b-price-evidence] PASS - ${what}`);

async function rejectsWith(promise, code, pattern, label) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof EvidenceError, `${label}: expected EvidenceError, got ${error}`);
    assert.equal(error.code, code, `${label}: expected ${code}, got ${error.code} (${error.detail})`);
    if (pattern) assert.match(error.message, pattern, label);
    return true;
  }, label);
}

// ── Differential math vectors (independent: Python int/Decimal, not this module) ──
// python3: Q=2**112; el=((t%2**32)-(tl%2**32))%2**32; (last + (r1*Q//r0)*el) % 2**256

assert.equal(
  currentCumulativePrice0({ price0CumulativeLast: 0x1234567890abcdefn, reserve0: 17_732_250_426_124_888n, reserve1: 385_399_916_033_610_356n, blockTimestampLast: 1790900000, blockTimestamp: 1790901017 }),
  114769959116337788297656821147505162599n
);
// uint32 elapsed wrap: last stored ts 2^32-100, block ts 2^32+50 -> elapsed 150.
assert.equal(
  currentCumulativePrice0({ price0CumulativeLast: 5n * Q112, reserve0: 3n, reserve1: 7n, blockTimestampLast: 2n ** 32n - 100n, blockTimestamp: 2n ** 32n + 50n }),
  1843265384779863808128326196873134030n
);
// uint256 accumulator wrap.
assert.equal(
  currentCumulativePrice0({ price0CumulativeLast: 2n ** 256n - 12345n, reserve0: 5n * 10n ** 9n, reserve1: 3n * 10n ** 18n, blockTimestampLast: 1000, blockTimestamp: 1007 }),
  21807646805846276039828084582724403199987655n
);
// IFR9/WETH18 normalization: 10,000 IFR (1e13 base) vs 1 WETH (1e18 wei) => price0 is exactly
// 1e5 wei per IFR base unit, i.e. 1 IFR (1e9 base) = 1e14 wei = 0.0001 ETH; a 7-day delta divides
// back to exactly that price (no inversion of the average is ever needed or done).
{
  const c0 = 0n;
  const c1 = currentCumulativePrice0({ price0CumulativeLast: c0, reserve0: 10n ** 13n, reserve1: 10n ** 18n, blockTimestampLast: 0, blockTimestamp: TWAP_WINDOW_SECONDS });
  assert.equal(c1, 10n ** 5n * Q112 * BigInt(TWAP_WINDOW_SECONDS));
  assert.equal((c1 - c0) / (BigInt(TWAP_WINDOW_SECONDS) * Q112) * 10n ** 9n, 10n ** 14n);
}
// Maximal uint112 reserves: quotient (2^112 - 1) * 2^112 still fits uint224; no accrual without elapsed time.
assert.equal(currentCumulativePrice0({ price0CumulativeLast: 9n, reserve0: 1n, reserve1: Q112 - 1n, blockTimestampLast: 50, blockTimestamp: 50 }), 9n);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 0n, reserve1: 1n, blockTimestampLast: 0, blockTimestamp: 1 }), /reserves must be positive/);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: 0n, blockTimestampLast: 0, blockTimestamp: 1 }), /reserves must be positive/);
assert.throws(() => currentCumulativePrice0({ price0CumulativeLast: 0n, reserve0: 1n, reserve1: Q112, blockTimestampLast: 0, blockTimestamp: 1 }), /uint112/);
pass('differential cumulative-price vectors incl. uint32/uint256 wrap and IFR9/WETH18 normalization');

// python3 Decimal: floor(3456.78901234 / 1.08765432 * 1e8) = 317820556474
assert.equal(computeEthEurRate({ ethUsdAnswer: 345_678_901_234n, eurUsdAnswer: 108_765_432n }), 317_820_556_474n);
assert.equal(computeEthEurRate({ ethUsdAnswer: 271_227_435_732n, eurUsdAnswer: 112_307_000n }), 241_505_369_862n);
assert.equal(computeEthEurRate({ ethUsdAnswer: 100_000_000n, eurUsdAnswer: 300_000_000n }), 33_333_333n); // floor, never rounds up
assert.throws(() => computeEthEurRate({ ethUsdAnswer: 0n, eurUsdAnswer: 112_307_000n }), /positive/);
assert.throws(() => computeEthEurRate({ ethUsdAnswer: 1n, eurUsdAnswer: -1n }), /positive/);
pass('ETH/EUR floor division (differential vectors)');

assert.equal(assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS }), TWAP_WINDOW_SECONDS);
assert.throws(() => assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS - 1 }), /TWAP window/);
assert.throws(() => assertSettlementWindow({ startTimestamp: 1000, endTimestamp: 1000 + TWAP_WINDOW_SECONDS + 3601 }), /TWAP window/);
pass('TWAP window bounds');

// ── Finding 4 (pure): malformed / zero / stale rounds ──

const goodRound = { roundId: 100n, answer: 271_227_435_732n, startedAt: 1790900500n, updatedAt: 1790900500n, answeredInRound: 100n, blockTimestamp: 1790901000, heartbeatSeconds: 3600 };
assertValidChainlinkRound(goodRound);
assertValidChainlinkRound({ ...goodRound, updatedAt: 1790901000n - 3600n, startedAt: 1790901000n - 3600n }); // exactly at heartbeat
for (const [patch, pattern] of [
  [{ roundId: 0n, answeredInRound: 0n }, /roundId is zero.*answeredInRound is zero/], // red before the fix: accepted
  [{ answeredInRound: 0n }, /answeredInRound is zero/],
  [{ answeredInRound: 99n }, /incomplete round/],
  [{ answer: 0n }, /non-positive/],
  [{ answer: -5n }, /non-positive/],
  [{ updatedAt: 0n, startedAt: 0n }, /updatedAt is zero/],
  [{ startedAt: 0n }, /startedAt is zero/],
  [{ startedAt: 1790900600n }, /startedAt is after updatedAt/],
  [{ updatedAt: 1790901001n, startedAt: 1790901001n }, /after the pinned block/],
  [{ updatedAt: 1790901000n - 3601n, startedAt: 1790901000n - 3601n }, /stale/],
]) {
  assert.throws(() => assertValidChainlinkRound({ ...goodRound, ...patch }), pattern);
}
pass('Chainlink round guards (zero/malformed/incomplete/stale/future/non-positive)');

// ── Deterministic mock chain served over JSON-RPC semantics ──
// 12s blocks ending at END_BLOCK; constant pair accrual; feeds with fixed freshness. Fork "b"
// hashes model a competing history so reorgs can be injected at any read.

const PERIOD = '2026-09';
const PERIOD_END = settlementPeriodEndSeconds(PERIOD); // 2026-10-01T00:00:00Z
const END_BLOCK = 26_100_000;
const END_TS = PERIOD_END + 1800;
const START_BLOCK = END_BLOCK - TWAP_WINDOW_SECONDS / 12;
const HEAD = END_BLOCK + 200;
const FINALIZED = END_BLOCK + 100;
const ts = (n) => END_TS - 12 * (END_BLOCK - n);
const R0 = 17_732_250_426_124_888n;
const R1 = 385_399_916_033_610_356n;
const QUOTIENT = (R1 * Q112) / R0;
const T0 = ts(1);
const C0 = 123_456_789n * Q112;
const ETH_USD_ANSWER = 271_227_435_732n;
const EUR_USD_ANSWER = 112_307_000n;
const AGG_ETH = '0x7d4e742018fb52e48b08be73d041c18b21de6fb5';
const AGG_EUR = '0x02f878a94a1ae1b15705acd65b5519a46fe3517e';
const CODE = '0x6080604052';
const hex = (n) => `0x${BigInt(n).toString(16)}`;
const hashOf = (n, fork = 'a') => `0x${n.toString(16).padStart(8, '0')}${(fork === 'a' ? 'ab' : 'cd').repeat(28)}`;

function pairStateAt(n) {
  const blockTs = ts(n);
  return { reserve0: R0, reserve1: R1, blockTimestampLast: blockTs - 17, price0CumulativeLast: C0 + QUOTIENT * BigInt(blockTs - 17 - T0) };
}
const cumulativeAt = (n) => C0 + QUOTIENT * BigInt(ts(n) - T0);

function rpcError(code, message) { return { error: { code, message } }; }

/** JSON-RPC handler: returns { result } or { error } exactly like a node would. */
function mockChain(opts = {}) {
  const canonicalFork = new Map();
  const log = [];
  let stateReads = 0;
  const chain = { log, canonicalFork, reorg(n) { canonicalFork.set(n, 'b'); } };
  const forkOf = (n) => canonicalFork.get(n) ?? 'a';
  const header = (n, fork) => ({ number: hex(n), hash: hashOf(n, fork), parentHash: hashOf(n - 1, fork === 'a' ? 'a' : forkOf(n - 1)), timestamp: hex(ts(n)) });
  const resolveHash = (h) => {
    if (typeof h !== 'string' || h.length !== 66) return null;
    const n = parseInt(h.slice(2, 10), 16);
    const tail = h.slice(10).toLowerCase();
    const fork = tail === 'ab'.repeat(28) ? 'a' : tail === 'cd'.repeat(28) ? 'b' : null;
    return fork && n >= 1 && n <= HEAD ? { n, fork } : null;
  };
  const feedState = (feed, n) => {
    const isEth = feed === CHAINLINK_ETH_USD.address.toLowerCase();
    const updatedAt = BigInt(ts(n) - (isEth ? 500 : 800));
    const base = { roundId: 100_000n + BigInt(n), answer: isEth ? ETH_USD_ANSWER : EUR_USD_ANSWER, startedAt: updatedAt, updatedAt, answeredInRound: 100_000n + BigInt(n), decimals: 8n, description: isEth ? 'ETH / USD' : 'EUR / USD', aggregator: isEth ? AGG_ETH : AGG_EUR };
    return { ...base, ...(opts.feed?.(isEth ? 'ETH/USD' : 'EUR/USD', n, base) ?? {}) };
  };
  const call = (to, data, n, fork) => {
    const target = to.toLowerCase();
    const pairState = { ...pairStateAt(n), token0: IFR_TOKEN_ADDRESS, token1: WETH_ADDRESS, factory: UNISWAP_V2_FACTORY, ...(fork === 'b' ? { reserve1: R1 * 2n } : {}), ...(opts.pair?.(n) ?? {}) };
    const enc = (iface, fn, values) => ({ result: iface.encodeFunctionResult(fn, values) });
    if (target === PAIR_ADDRESS.toLowerCase()) {
      const fn = ABIS.PAIR_IFACE.parseTransaction({ data }).name;
      if (fn === 'getReserves') return enc(ABIS.PAIR_IFACE, fn, [pairState.reserve0, pairState.reserve1, pairState.blockTimestampLast]);
      return enc(ABIS.PAIR_IFACE, fn, [pairState[fn]]);
    }
    if (target === UNISWAP_V2_FACTORY.toLowerCase()) return enc(ABIS.FACTORY_IFACE, 'getPair', [opts.getPair ?? PAIR_ADDRESS]);
    if (target === IFR_TOKEN_ADDRESS.toLowerCase()) return enc(ABIS.ERC20_IFACE, 'decimals', [opts.ifrDecimals ?? 9]);
    if (target === WETH_ADDRESS.toLowerCase()) return enc(ABIS.ERC20_IFACE, 'decimals', [18]);
    if (target === CHAINLINK_ETH_USD.address.toLowerCase() || target === CHAINLINK_EUR_USD.address.toLowerCase()) {
      const fn = ABIS.FEED_IFACE.parseTransaction({ data }).name;
      const s = feedState(target, n);
      if (fn === 'latestRoundData') return enc(ABIS.FEED_IFACE, fn, [s.roundId, s.answer, s.startedAt, s.updatedAt, s.answeredInRound]);
      return enc(ABIS.FEED_IFACE, fn, [s[fn]]);
    }
    return rpcError(3, 'execution reverted');
  };
  chain.handle = (method, params) => {
    log.push({ method, params });
    const intercepted = opts.intercept?.(method, params, chain);
    if (intercepted) return intercepted;
    switch (method) {
      case 'eth_chainId': return { result: hex(opts.chainId ?? 1) };
      case 'eth_getBlockByNumber': {
        const n = params[0] === 'finalized' ? (opts.finalized ?? FINALIZED) : Number(BigInt(params[0]));
        if (n > HEAD) return { result: null };
        return { result: header(n, forkOf(n)) };
      }
      case 'eth_getBlockByHash': {
        const r = resolveHash(params[0]);
        return { result: r ? header(r.n, r.fork) : null };
      }
      case 'eth_call':
      case 'eth_getCode': {
        const tag = method === 'eth_call' ? params[1] : params[1];
        if (!tag || typeof tag !== 'object' || typeof tag.blockHash !== 'string') {
          if (opts.acceptNumericTags) return { result: '0x' };
          return rpcError(-32602, 'invalid argument 1: hex string without 0x prefix');
        }
        if (tag.requireCanonical !== true) return rpcError(-32602, 'invalid params: requireCanonical missing');
        let r = resolveHash(tag.blockHash);
        if (!r && opts.ignorePinning) r = { n: HEAD, fork: 'a' };
        if (!r) return rpcError(-32000, `header for hash not found: ${tag.blockHash}`);
        if (forkOf(r.n) !== r.fork && !opts.ignoreRequireCanonical) return rpcError(-32000, `hash ${tag.blockHash} is not currently canonical`);
        stateReads += 1;
        opts.onStateRead?.(stateReads, chain);
        if (method === 'eth_getCode') {
          const address = params[0].toLowerCase();
          return { result: opts.code?.(address, r.n) ?? CODE };
        }
        return call(params[0].to, params[0].data, r.n, r.fork);
      }
      default: return rpcError(-32601, 'method not found');
    }
  };
  chain.transport = { request: async (method, params) => {
    const response = chain.handle(method, params);
    if (response.error) throw classifyRpcError(method, response.error);
    return response.result;
  } };
  chain.reader = makeChainReader(chain.transport);
  return chain;
}

// ── Generate + verify on the canonical mock chain ──

const generated = await generateEvidence(mockChain().reader, { period: PERIOD, endBlockNumber: END_BLOCK });
const evidence = generated.evidence;
assert.equal(evidence.reviewedSourceId, REVIEWED_SOURCE_ID);
assert.equal(evidence.pair, PAIR_ADDRESS.toLowerCase());
assert.equal(evidence.token0, IFR_TOKEN_ADDRESS.toLowerCase());
assert.equal(evidence.start.blockNumber, START_BLOCK);
assert.equal(evidence.start.blockHash, hashOf(START_BLOCK));
assert.equal(evidence.end.blockNumber, END_BLOCK);
assert.equal(evidence.end.timestamp - evidence.start.timestamp, TWAP_WINDOW_SECONDS);
assert.equal(BigInt(evidence.start.price0Cumulative), cumulativeAt(START_BLOCK));
assert.equal(BigInt(evidence.end.price0Cumulative), cumulativeAt(END_BLOCK));
assert.equal(evidence.ethEur.rate, '241505369862');
assert.equal(evidence.ethEur.decimals, RATE_DECIMALS);
assert.equal(evidence.ethEur.publishedAt, new Date((END_TS - 800) * 1000).toISOString());
assert.equal(evidence.ethEur.source, ethEurSourceLabel());
assert.deepEqual(consumerBoundViolations(evidence, PERIOD), []);
pass('generateEvidence on the canonical mock chain');

const verified = await verifyEvidence(mockChain().reader, evidence, { period: PERIOD });
assert.equal(verified.checks.length, 7);
assert.equal(verified.receipt.evidenceDigest, canonicalEvidenceDigest(evidence));
pass('verifyEvidence on the canonical mock chain');

// ── Finding 1: canonical EIP-1898 snapshot ──

{
  const chain = mockChain();
  await generateEvidence(chain.reader, { period: PERIOD, endBlockNumber: END_BLOCK });
  const stateReads = chain.log.filter((e) => e.method === 'eth_call' || e.method === 'eth_getCode');
  assert.ok(stateReads.length > 30);
  for (const entry of stateReads) {
    assert.equal(typeof entry.params[1], 'object', 'every state read uses an EIP-1898 block object');
    assert.equal(entry.params[1].requireCanonical, true);
    assert.ok([hashOf(START_BLOCK), hashOf(END_BLOCK), PINNING_PROBE_HASH].includes(entry.params[1].blockHash));
  }
  const lastState = chain.log.findLastIndex((e) => e.method === 'eth_call');
  const recheck = chain.log.slice(lastState + 1).filter((e) => e.method === 'eth_getBlockByNumber').map((e) => e.params[0]);
  assert.deepEqual(recheck, [hex(START_BLOCK), hex(END_BLOCK), 'finalized'], 'number->hash re-checked after the final read');
}
// RPC ignores EIP-1898 (answers a read pinned to a nonexistent hash) -> fail closed.
await rejectsWith(generateEvidence(mockChain({ ignorePinning: true }).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'PINNING_UNSUPPORTED', /ignores EIP-1898/, 'pinning ignored');
// RPC rejects the blockHash object -> fail closed.
await rejectsWith(generateEvidence(mockChain({
  intercept: (m, p) => ((m === 'eth_call' || m === 'eth_getCode') && typeof p[1] === 'object' ? rpcError(-32602, 'invalid argument 1: json: cannot unmarshal object') : undefined),
}).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'PINNING_UNSUPPORTED', null, 'pinning unsupported');
// Mid-read reorg of the end block: pinned requireCanonical reads now fail -> REORG_DETECTED.
await rejectsWith(generateEvidence(mockChain({ onStateRead: (i, c) => { if (i === 20) c.reorg(END_BLOCK); } }).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'REORG_DETECTED', null, 'mid-read reorg');
// RPC silently ignores requireCanonical, reorg after the final state read -> final number->hash re-check catches it.
{
  // Count the successful state reads of a clean run, then reorg the start block right after the last one.
  const probe = mockChain();
  await generateEvidence(probe.reader, { period: PERIOD, endBlockNumber: END_BLOCK });
  const total = probe.log.filter((e) => (e.method === 'eth_call' || e.method === 'eth_getCode') && e.params[1].blockHash !== PINNING_PROBE_HASH).length;
  const chain = mockChain({ ignoreRequireCanonical: true, onStateRead: (i, c) => { if (i === total) c.reorg(START_BLOCK); } });
  await rejectsWith(generateEvidence(chain.reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'REORG_DETECTED', /block 26049600 changed hash during the snapshot/, 'final-read reorg');
}
// Pinned hash vanishes (node no longer knows it) -> fail closed.
await rejectsWith(generateEvidence(mockChain({
  intercept: (m, p) => (m === 'eth_call' && p[1]?.blockHash === hashOf(END_BLOCK) ? rpcError(-32000, 'header for hash not found') : undefined),
}).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'BLOCK_UNAVAILABLE', null, 'vanished hash');
// Non-archive node -> ARCHIVE_UNAVAILABLE.
await rejectsWith(generateEvidence(mockChain({
  intercept: (m, p) => (m === 'eth_call' && p[1]?.blockHash === hashOf(START_BLOCK) ? rpcError(-32000, 'missing trie node abc (path ) state is unavailable') : undefined),
}).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'ARCHIVE_UNAVAILABLE', null, 'archive');
// End block not finalized.
await rejectsWith(generateEvidence(mockChain({ finalized: END_BLOCK - 1 }).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'NOT_FINALIZED', null, 'finality');
// Header for a different number than requested (inconsistent response).
await rejectsWith(generateEvidence(mockChain({
  intercept: (m, p) => (m === 'eth_getBlockByNumber' && p[0] === hex(END_BLOCK) ? { result: { number: hex(END_BLOCK + 1), hash: hashOf(END_BLOCK + 1), parentHash: hashOf(END_BLOCK), timestamp: hex(ts(END_BLOCK + 1)) } } : undefined),
}).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'RPC_INVALID_RESPONSE', null, 'inconsistent header');
// Hash lookup disagrees with number lookup.
await rejectsWith(generateEvidence(mockChain({
  intercept: (m, p) => (m === 'eth_getBlockByHash' && p[0] === hashOf(END_BLOCK) ? { result: null } : undefined),
}).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'BLOCK_UNAVAILABLE', null, 'hash lookup');
// Wrong chain.
await rejectsWith(generateEvidence(mockChain({ chainId: 11_155_111 }).reader, { period: PERIOD, endBlockNumber: END_BLOCK }), 'WRONG_CHAIN', null, 'chain id');
// Verify against a reorged end block fails closed too (evidence hash no longer canonical).
{
  const chain = mockChain();
  chain.reorg(END_BLOCK);
  await assert.rejects(verifyEvidence(chain.reader, evidence, { period: PERIOD }), (error) => error instanceof VerificationError && /end\.blockHash/.test(error.message));
}
pass('finding 1: EIP-1898 pinning, probe, mid/final-read reorg, vanished hash, finality, inconsistent headers');

// ── Finding 2: credential-safe diagnostics ──

const SENTINELS = ['SENTINELUSER7f3a', 'SENTINELPASS9c1e', 'SENTINELPATHd4b2', 'SENTINELQUERY0a8f'];
const sentinelUrl = (base) => `${base.replace('://', `://${SENTINELS[0]}:${SENTINELS[1]}@`)}/v3/${SENTINELS[2]}?apikey=${SENTINELS[3]}`;
const assertNoSentinel = (text, label) => {
  for (const s of SENTINELS) assert.ok(!text.includes(s), `${label}: output leaks sentinel ${s}:\n${text}`);
  assert.ok(!/127\.0\.0\.1|localhost/.test(text), `${label}: output leaks the RPC host:\n${text}`);
};
const leakText = `upstream https://${SENTINELS[0]}:${SENTINELS[1]}@127.0.0.1/v3/${SENTINELS[2]}?apikey=${SENTINELS[3]} failed`;

{
  const transportWith = (fetchImpl) => makeHttpTransport(sentinelUrl('https://127.0.0.1:9'), { fetchImpl });
  const cases = [
    ['HTTP 500 with sentinel body', async () => new Response(leakText, { status: 500 }), 'RPC_HTTP_ERROR'],
    ['HTTP 403', async () => new Response(leakText, { status: 403 }), 'RPC_HTTP_ERROR'],
    ['fetch throws with sentinel', async () => { const e = new TypeError(`fetch failed ${leakText}`); e.cause = new Error(leakText); throw e; }, 'RPC_NETWORK_ERROR'],
    ['timeout', async () => { const e = new Error(leakText); e.name = 'TimeoutError'; throw e; }, 'RPC_TIMEOUT'],
    ['non-JSON body', async () => new Response(leakText, { status: 200 }), 'RPC_INVALID_RESPONSE'],
    ['JSON-RPC error echoing URL', async (u, init) => new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -32000, message: leakText } }), { status: 200 }), 'RPC_ERROR_RESPONSE'],
    ['JSON-RPC archive error echoing URL', async (u, init) => new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -32000, message: `missing trie node ${leakText}` } }), { status: 200 }), 'ARCHIVE_UNAVAILABLE'],
  ];
  for (const [label, impl, code] of cases) {
    let seen;
    const transport = transportWith(async (u, init) => { seen = { u, init }; return impl(u, init); });
    await assert.rejects(transport.request('eth_chainId', []), (error) => {
      assert.ok(error instanceof EvidenceError, label);
      assert.equal(error.code, code, label);
      assertNoSentinel(`${error.message}\n${error.stack}\n${renderError(error).text}`, label);
      return true;
    });
    // Credentials travel only in the Authorization header, never in the request URL.
    assert.ok(!seen.u.includes(SENTINELS[0]) && !seen.u.includes(SENTINELS[1]), `${label}: userinfo stripped from URL`);
    assert.equal(Buffer.from(seen.init.headers.authorization.slice(6), 'base64').toString(), `${SENTINELS[0]}:${SENTINELS[1]}`);
    assert.equal(seen.init.redirect, 'error');
  }
  // Unknown (non-EvidenceError) errors are rendered without their text.
  assertNoSentinel(renderError(new Error(leakText)).text, 'unknown error');
  // Argument parsing never echoes values.
  for (const argv of [['generate', sentinelUrl('https://x')], ['verify', `--${SENTINELS[2]}`, 'v'], [SENTINELS[0]], ['generate', '--rpc']]) {
    assert.throws(() => parseArgs(argv), (error) => { assertNoSentinel(error.message, 'parseArgs'); return error.code === 'USAGE'; });
  }
  assert.throws(() => makeHttpTransport(`ftp://${SENTINELS[0]}:${SENTINELS[1]}@h/${SENTINELS[2]}`), (error) => { assertNoSentinel(error.message, 'protocol'); return error.code === 'USAGE'; });
  assert.throws(() => makeHttpTransport(`not a url ${SENTINELS[2]}`), (error) => { assertNoSentinel(error.message, 'invalid url'); return error.code === 'USAGE'; });
}
pass('finding 2: transport/usage diagnostics map to constant categories without credentials');

// CLI end-to-end over a local HTTP JSON-RPC server: stdout + stderr never contain sentinels.
function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr, all: `${stdout}\n${stderr}` }));
  });
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-b-evidence-'));
  try {
    const chain = mockChain();
    let authSeen = '';
    let mode = 'ok';
    const { server, base } = await startServer((req, res, body) => {
      authSeen = req.headers.authorization ?? '';
      if (mode === 'http500') { res.writeHead(500); res.end(leakText); return; }
      if (mode === 'rpcerror') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, error: { code: -32000, message: leakText } })); return; }
      if (mode === 'redirect') { res.writeHead(302, { location: `${base}/${SENTINELS[2]}` }); res.end(); return; }
      const { id, method, params } = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, ...chain.handle(method, params) }));
    });
    try {
      const url = sentinelUrl(base);
      const out = path.join(tmp, 'evidence.json');
      const receiptFile = path.join(tmp, 'receipt.json');
      const gen = await runCli(['generate', '--rpc', url, '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', out, '--receipt', receiptFile]);
      assert.equal(gen.code, 0, gen.all);
      assertNoSentinel(gen.all, 'cli generate');
      assert.equal(Buffer.from(authSeen.slice(6), 'base64').toString(), `${SENTINELS[0]}:${SENTINELS[1]}`);
      assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), evidence);
      const receiptText = fs.readFileSync(receiptFile, 'utf8');
      assertNoSentinel(receiptText, 'receipt');
      const ver = await runCli(['verify', '--period', PERIOD, '--file', out, '--receipt', path.join(tmp, 'verify-receipt.json')], { MODEL_B_EVIDENCE_RPC_URL: url });
      assert.equal(ver.code, 0, ver.all);
      assertNoSentinel(ver.all, 'cli verify');
      assert.match(ver.stderr, /exact file sha256 [0-9a-f]{64}/);
      // Verify without --period is a usage error (finding 3).
      const noPeriod = await runCli(['verify', '--rpc', url, '--file', out]);
      assert.equal(noPeriod.code, 2);
      assertNoSentinel(noPeriod.all, 'cli verify no period');
      // Wrong period is rejected (finding 3).
      const wrongPeriod = await runCli(['verify', '--rpc', url, '--period', '2026-08', '--file', out]);
      assert.equal(wrongPeriod.code, 1);
      assert.match(wrongPeriod.stderr, /VERIFICATION_MISMATCH/);
      assertNoSentinel(wrongPeriod.all, 'cli wrong period');
      // Existing output files are never overwritten.
      const again = await runCli(['generate', '--rpc', url, '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', out]);
      assert.equal(again.code, 1);
      assert.match(again.stderr, /OUTPUT_FILE/);

      for (const failure of ['http500', 'rpcerror', 'redirect']) {
        mode = failure;
        const r = await runCli(['generate', '--rpc', url, '--period', PERIOD, '--end-block', String(END_BLOCK)]);
        assert.equal(r.code, 1, `${failure}: ${r.all}`);
        assert.match(r.stderr, /^Error \[RPC_[A-Z_]+\]/, failure);
        assertNoSentinel(r.all, `cli ${failure}`);
      }
      mode = 'ok';
    } finally {
      server.close();
    }
    // Connection refused on a closed port.
    const closed = await startServer(() => {});
    const closedBase = closed.base;
    await new Promise((r) => closed.server.close(r));
    const refused = await runCli(['generate', '--rpc', sentinelUrl(closedBase), '--period', PERIOD, '--end-block', String(END_BLOCK)]);
    assert.equal(refused.code, 1, refused.all);
    assert.match(refused.stderr, /RPC_NETWORK_ERROR/);
    assertNoSentinel(refused.all, 'cli refused');
    // Usage failures with sentinels in argument values.
    for (const args of [
      ['generate', sentinelUrl('https://h')],
      ['generate', `--${SENTINELS[2]}`, 'x'],
      ['generate', '--rpc', `ftp://${SENTINELS[0]}:${SENTINELS[1]}@h/${SENTINELS[2]}`, '--period', PERIOD, '--end-block', '5'],
      ['generate', '--rpc', `bad ${SENTINELS[2]}`, '--period', PERIOD, '--end-block', '5'],
      ['generate', '--rpc', sentinelUrl('https://h'), '--period', SENTINELS[3], '--end-block', '5'],
      ['generate', '--rpc', sentinelUrl('https://h'), '--period', PERIOD, '--end-block', SENTINELS[3]],
      ['verify', '--rpc', sentinelUrl('https://h'), '--period', PERIOD, '--file', path.join(tmp, SENTINELS[2])],
    ]) {
      const r = await runCli(args);
      assert.ok(r.code === 1 || r.code === 2, r.all);
      assertNoSentinel(r.all, `cli usage ${args[1]}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
pass('finding 2: CLI stdout/stderr and receipts never contain RPC credentials (sentinels)');

// ── Finding 2 follow-up: chain-sourced and file-supplied strings are never echoed ──
// Hostile ABI description(), evidence string values and unknown key names carry ANSI escapes,
// control characters, a fake credential sentinel and excessive length. Every output path
// (thrown message, rendered stderr, stdout, receipt) must refuse with constant text only.

const HOSTILE_MARK = 'HOSTILEDESC5e7b';
const HOSTILE = `\u001b[31m\u001b]0;pwn\u0007${HOSTILE_MARK}\r\n\u0000Error [OK]: verified https://${SENTINELS[0]}:${SENTINELS[1]}@evil/${SENTINELS[2]}?k=${SENTINELS[3]}${'A'.repeat(6000)}`;
const assertClean = (text, label) => {
  assertNoSentinel(text, label);
  assert.ok(!text.includes(HOSTILE_MARK), `${label}: hostile chain/file string echoed:\n${text.slice(0, 400)}`);
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text), `${label}: control characters in output`);
  assert.ok(!text.includes('AAAAAAAAAA'), `${label}: unbounded hostile payload in output`);
};
{
  const hostileChain = (extra = {}) => mockChain({ feed: (label) => (label === 'EUR/USD' ? { description: HOSTILE } : null), ...extra });
  await assert.rejects(generateEvidence(hostileChain().reader, { period: PERIOD, endBlockNumber: END_BLOCK }), (error) => {
    assert.equal(error.code, 'IDENTITY_MISMATCH');
    assertClean(`${error.message}\n${renderError(error).text}`, 'hostile description (generate)');
    assert.match(error.message, /EUR\/USD description at end block 26100000 differs from the pinned "EUR \/ USD"/);
    return true;
  });
  await assert.rejects(verifyEvidence(hostileChain().reader, evidence, { period: PERIOD }), (error) => {
    assertClean(`${error.message}\n${renderError(error).text}`, 'hostile description (verify)');
    return error.code === 'IDENTITY_MISMATCH';
  });
  // Hostile evidence-file strings (within schema length bounds) and hostile unknown key names.
  const shortHostile = (n) => `\u001b[2J${HOSTILE_MARK}${SENTINELS[3]}\u0007`.slice(0, n);
  const fileCases = [
    ['reviewedSourceId', (e) => { e.reviewedSourceId = shortHostile(80); }],
    ['ethEur.source', (e) => { e.ethEur.source = shortHostile(120); }],
    ['unknown top-level key', (e) => { e[HOSTILE.slice(0, 200)] = HOSTILE; }],
    ['unknown nested key', (e) => { e.end[`${HOSTILE_MARK}\u001b[0m`] = 1; }],
  ];
  for (const [label, mutate] of fileCases) {
    const tampered = JSON.parse(JSON.stringify(evidence));
    mutate(tampered);
    await assert.rejects(verifyEvidence(mockChain().reader, tampered, { period: PERIOD }), (error) => {
      assert.ok(error instanceof EvidenceError, label);
      assertClean(`${error.message}\n${renderError(error).text}`, `hostile file ${label}`);
      return true;
    });
  }
  // Rendering is bounded and printable even for an unexpected detail.
  assertClean(renderError(new EvidenceError('INTERNAL', `x${'\u001b'.repeat(3)}`)).text.replace(/\?/g, ''), 'safeText');

  // CLI: hostile chain over JSON-RPC and hostile evidence files -> refusal with clean outputs.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-b-hostile-'));
  const chain = hostileChain();
  const clean = mockChain();
  let useHostile = true;
  const { server, base } = await startServer((req, res, body) => {
    const { id, method, params } = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, ...(useHostile ? chain : clean).handle(method, params) }));
  });
  try {
    const url = sentinelUrl(base);
    const out = path.join(tmp, 'e.json');
    const receipt = path.join(tmp, 'r.json');
    const g = await runCli(['generate', '--rpc', url, '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', out, '--receipt', receipt]);
    assert.equal(g.code, 1, g.all);
    assert.match(g.stderr, /^Error \[IDENTITY_MISMATCH\]/);
    assertClean(g.all, 'cli hostile description');
    assert.ok(!fs.existsSync(out) && !fs.existsSync(receipt), 'no evidence/receipt written on refusal');
    useHostile = false;
    for (const [label, mutate] of fileCases) {
      const tampered = JSON.parse(JSON.stringify(evidence));
      mutate(tampered);
      const file = path.join(tmp, `${label.replace(/\W/g, '_')}.json`);
      fs.writeFileSync(file, JSON.stringify(tampered));
      const v = await runCli(['verify', '--rpc', url, '--period', PERIOD, '--file', file, '--receipt', path.join(tmp, `${label.replace(/\W/g, '_')}.r.json`)]);
      assert.equal(v.code, 1, `${label}: ${v.all}`);
      assert.match(v.stderr, /^Error \[(EVIDENCE_FILE|VERIFICATION_MISMATCH)\]/, label);
      assertClean(v.all, `cli hostile file ${label}`);
    }
    // A clean run's receipt never stores a raw chain string (description only after exact match).
    const ok = await runCli(['generate', '--rpc', url, '--period', PERIOD, '--end-block', String(END_BLOCK), '--out', path.join(tmp, 'ok.json'), '--receipt', path.join(tmp, 'ok.r.json')]);
    assert.equal(ok.code, 0, ok.all);
    const reads = JSON.parse(fs.readFileSync(path.join(tmp, 'ok.r.json'), 'utf8')).reads;
    const desc = reads.find((r) => r.function === 'description()');
    assert.ok(desc.result && /^0x[0-9a-f]{64}$/.test(desc.result.utf8Keccak256), 'description recorded as keccak256 only');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
pass('finding 2 follow-up: hostile description/evidence strings/key names never echoed (ANSI, control chars, length, sentinel)');

// ── Finding 3: verify needs the expected period and the deterministic start ──

async function expectMismatch(mutate, pattern, label, { period = PERIOD, chain = mockChain() } = {}) {
  const tampered = JSON.parse(JSON.stringify(evidence));
  mutate(tampered);
  await assert.rejects(verifyEvidence(chain.reader, tampered, { period }), (error) => {
    assert.ok(error instanceof VerificationError, `${label}: expected VerificationError, got ${error?.code} ${error?.message}`);
    assert.match(error.message, pattern, label);
    return true;
  });
}

await rejectsWith(verifyEvidence(mockChain().reader, evidence), 'USAGE', /expected settlement period/, 'verify without period');
// Truthful but non-deterministic start: the real block START_BLOCK - 1 with its true hash,
// timestamp and cumulative; the window (7d + 12s) is within tolerance, so the consumer bounds
// accept it — only the deterministic start recomputation rejects it.
{
  const older = JSON.parse(JSON.stringify(evidence));
  older.start = { blockNumber: START_BLOCK - 1, blockHash: hashOf(START_BLOCK - 1), timestamp: ts(START_BLOCK - 1), price0Cumulative: cumulativeAt(START_BLOCK - 1).toString() };
  assert.deepEqual(consumerBoundViolations(older, PERIOD), [], 'truthful older start passes consumer bounds');
  await expectMismatch((e) => { e.start = older.start; }, /start\.blockNumber differs from the canonical chain derivation 26049600/, 'truthful noncanonical start');
  // A truthful start 59 minutes earlier, still inside the 1h tolerance, is rejected the same way.
  const n = START_BLOCK - 295;
  await expectMismatch((e) => { e.start = { blockNumber: n, blockHash: hashOf(n), timestamp: ts(n), price0Cumulative: cumulativeAt(n).toString() }; }, /start\.blockNumber/, 'truthful start within tolerance');
}
// Wrong expected period (same truthful evidence).
await expectMismatch(() => {}, /more than 72h after the end of period 2026-08/, 'wrong period', { period: '2026-08' });
await expectMismatch(() => {}, /precedes the end of period 2026-10/, 'future period', { period: '2026-10' });
// Every supplied field is distrusted.
await expectMismatch((e) => { e.start.blockHash = `0x${'99'.repeat(32)}`; }, /start\.blockHash/, 'start hash');
await expectMismatch((e) => { e.end.blockHash = `0x${'99'.repeat(32)}`; }, /end\.blockHash/, 'end hash');
await expectMismatch((e) => { e.end.blockHash = e.end.blockHash.toUpperCase().replace('0X', '0x'); }, /end\.blockHash/, 'non-canonical hash casing');
await expectMismatch((e) => { e.start.timestamp -= 12; }, /start\.timestamp/, 'start timestamp');
await expectMismatch((e) => { e.start.timestamp += 12; }, /TWAP window/, 'start timestamp shrinking the window');
await expectMismatch((e) => { e.start.price0Cumulative = (BigInt(e.start.price0Cumulative) + 1n).toString(); }, /start\.price0Cumulative/, 'start cumulative');
await expectMismatch((e) => { e.end.price0Cumulative = (BigInt(e.end.price0Cumulative) - 1n).toString(); }, /end\.price0Cumulative/, 'end cumulative');
await expectMismatch((e) => { e.ethEur.rate = (BigInt(e.ethEur.rate) + 1n).toString(); }, /ethEur\.rate/, 'rate');
await expectMismatch((e) => { e.ethEur.publishedAt = new Date((END_TS - 740) * 1000).toISOString(); }, /ethEur\.publishedAt/, 'publishedAt');
await expectMismatch((e) => { e.ethEur.decimals = 9; }, /ethEur\.decimals/, 'decimals');
await expectMismatch((e) => { e.ethEur.source = 'chainlink'; }, /ethEur\.source/, 'source');
await expectMismatch((e) => { e.reviewedSourceId = 'other-source'; }, /reviewedSourceId/, 'source id');
await expectMismatch((e) => { e.pair = `0x${'11'.repeat(20)}`; }, /pair/, 'pair');
await expectMismatch((e) => { e.token0 = `0x${'11'.repeat(20)}`; }, /token0/, 'token0');
await rejectsWith(verifyEvidence(mockChain().reader, { ...evidence, extra: 1 }, { period: PERIOD }), 'EVIDENCE_FILE', /unexpected field/, 'extra field');
await rejectsWith(verifyEvidence(mockChain().reader, { ...evidence, rounding: 'ceil' }, { period: PERIOD }), 'EVIDENCE_FILE', /rounding/, 'rounding');
await rejectsWith(verifyEvidence(mockChain().reader, { start: {}, end: {} }, { period: PERIOD }), 'EVIDENCE_FILE', null, 'malformed');
await rejectsWith(verifyEvidence(mockChain().reader, null, { period: PERIOD }), 'EVIDENCE_FILE', /JSON object/, 'null');
pass('finding 3: verify enforces expected period, deterministic start and distrusts every field');

// ── Finding 4: identity pinning and read proofs ──

const gen = (opts) => generateEvidence(mockChain(opts).reader, { period: PERIOD, endBlockNumber: END_BLOCK });
await rejectsWith(gen({ pair: () => ({ factory: `0x${'22'.repeat(20)}` }) }), 'IDENTITY_MISMATCH', /pair factory/, 'factory');
await rejectsWith(gen({ getPair: `0x${'33'.repeat(20)}` }), 'IDENTITY_MISMATCH', /getPair/, 'getPair');
await rejectsWith(gen({ pair: () => ({ token0: WETH_ADDRESS, token1: IFR_TOKEN_ADDRESS }) }), 'IDENTITY_MISMATCH', /token0/, 'token order reversed');
await rejectsWith(gen({ pair: (n) => (n === START_BLOCK ? { token1: `0x${'44'.repeat(20)}` } : {}) }), 'IDENTITY_MISMATCH', /token1 at start block/, 'token1 at start');
await rejectsWith(gen({ ifrDecimals: 18 }), 'IDENTITY_MISMATCH', /IFR decimals/, 'IFR decimals');
await rejectsWith(gen({ code: (a, n) => (a === PAIR_ADDRESS.toLowerCase() && n === START_BLOCK ? '0x' : undefined) }), 'IDENTITY_MISMATCH', /pair .* has no code at start block/, 'pair code');
await rejectsWith(gen({ code: (a) => (a === CHAINLINK_EUR_USD.address.toLowerCase() ? '0x' : undefined) }), 'IDENTITY_MISMATCH', /EUR\/USD proxy/, 'feed proxy code');
await rejectsWith(gen({ code: (a) => (a === AGG_ETH ? '0x' : undefined) }), 'IDENTITY_MISMATCH', /ETH\/USD aggregator/, 'aggregator code');
await rejectsWith(gen({ feed: (label) => (label === 'ETH/USD' ? { aggregator: `0x${'00'.repeat(20)}` } : null) }), 'IDENTITY_MISMATCH', /no aggregator/, 'zero aggregator');
await rejectsWith(gen({ feed: (label) => (label === 'EUR/USD' ? { description: 'GBP / USD' } : null) }), 'IDENTITY_MISMATCH', /EUR\/USD description/, 'description');
await rejectsWith(gen({ feed: (label) => (label === 'ETH/USD' ? { decimals: 18n } : null) }), 'IDENTITY_MISMATCH', /ETH\/USD decimals/, 'feed decimals');
await rejectsWith(gen({ feed: (label) => (label === 'ETH/USD' ? { roundId: 0n, answeredInRound: 0n } : null) }), 'FEED_ROUND_REJECTED', /roundId is zero/, 'zero round');
await rejectsWith(gen({ feed: (label, n, b) => (label === 'EUR/USD' ? { updatedAt: b.updatedAt - 86_400n, startedAt: b.updatedAt - 86_400n } : null) }), 'FEED_ROUND_REJECTED', /EUR\/USD .*stale/, 'EUR stale');
await rejectsWith(gen({ feed: (label, n) => (label === 'ETH/USD' ? { updatedAt: BigInt(ts(n) + 1), startedAt: BigInt(ts(n) + 1) } : null) }), 'FEED_ROUND_REJECTED', /after the pinned block/, 'future round');
await rejectsWith(gen({ pair: () => ({ reserve0: 0n }) }), 'PAIR_STATE_REJECTED', /positive/, 'zero reserves');
{
  const { receipt } = generated;
  assert.equal(receipt.chainId, 1);
  assert.equal(receipt.snapshot.start.hash, hashOf(START_BLOCK));
  assert.equal(receipt.snapshot.end.hash, hashOf(END_BLOCK));
  assert.equal(receipt.snapshot.startSelection.nextBlock.number, START_BLOCK + 1);
  assert.equal(receipt.evidenceDigest, canonicalEvidenceDigest(evidence));
  const ethFeed = receipt.feeds.find((f) => f.label === 'ETH/USD');
  assert.deepEqual([ethFeed.roundId, ethFeed.answer, ethFeed.decimals, ethFeed.aggregator, ethFeed.description], [String(100_000 + END_BLOCK), ETH_USD_ANSWER.toString(), 8, AGG_ETH, 'ETH / USD']);
  const selectors = new Set(receipt.reads.filter((r) => r.method === 'eth_call').map((r) => `${r.block}:${r.target}:${r.selector}`));
  for (const expected of [
    `start:${PAIR_ADDRESS.toLowerCase()}:0xc45a0155`, // factory()
    `end:${UNISWAP_V2_FACTORY.toLowerCase()}:0xe6a43905`, // getPair(address,address)
    `end:${PAIR_ADDRESS.toLowerCase()}:0x5909c0d5`, // price0CumulativeLast()
    `end:${CHAINLINK_EUR_USD.address.toLowerCase()}:0xfeaf968c`, // latestRoundData()
    `end:${IFR_TOKEN_ADDRESS.toLowerCase()}:0x313ce567`, // decimals()
  ]) assert.ok(selectors.has(expected), `receipt proves ${expected}`);
  for (const read of receipt.reads) {
    assert.equal(read.requireCanonical, true);
    assert.equal(read.blockHash, read.block === 'start' ? hashOf(START_BLOCK) : hashOf(END_BLOCK));
  }
  assert.ok(!/https?:\/\//.test(JSON.stringify(receipt.reads)), 'receipt reads carry no endpoint');
}
pass('finding 4: pair/factory/token/feed identity, malformed rounds, credential-free read proofs');

// ── RPC error classification ──
assert.equal(classifyRpcError('eth_call', { code: -32000, message: 'hash 0xab is not currently canonical' }).code, 'REORG_DETECTED');
assert.equal(classifyRpcError('eth_call', { code: -32000, message: 'header for hash not found' }).code, 'BLOCK_UNAVAILABLE');
assert.equal(classifyRpcError('eth_call', { code: -32000, message: 'historical state abc is not available' }).code, 'ARCHIVE_UNAVAILABLE');
assert.equal(classifyRpcError('eth_call', { code: -32602, message: 'whatever' }).code, 'PINNING_UNSUPPORTED');
assert.equal(classifyRpcError('eth_call', { code: 3, message: 'execution reverted' }).code, 'CALL_REVERTED');
assert.equal(classifyRpcError('eth_call', { code: -32005, message: leakText }).code, 'RPC_ERROR_RESPONSE');
pass('RPC error classification');

// ── buildEvidence shape ──
const built = buildEvidence({
  start: { blockNumber: 1, blockHash: `0x${'AB'.repeat(32)}`, timestamp: 100, price0Cumulative: 5n },
  end: { blockNumber: 2, blockHash: `0x${'CD'.repeat(32)}`, timestamp: 200, price0Cumulative: 6n },
  ethEur: { source: 's', publishedAt: '2026-10-01T00:00:00.000Z', rate: 1n, decimals: 8 },
});
assert.equal(built.start.blockHash, `0x${'ab'.repeat(32)}`);
assert.match(built.pair, /^0x[a-f0-9]{40}$/);
pass('buildEvidence schema shape');

// ── Fixture bridge: the committed backend fixture equals this tool's generate output ──
const fixturePath = new URL('../apps/benefits-network/backend/tests/fixtures/modelBPriceEvidence.sample.json', import.meta.url);
if (process.env.WRITE_MODEL_B_FIXTURE === '1') {
  fs.writeFileSync(fixturePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('[model-b-price-evidence] fixture regenerated from generateEvidence output');
}
assert.deepEqual(JSON.parse(fs.readFileSync(fixturePath, 'utf8')), evidence, 'backend fixture must equal generateEvidence output (regenerate with WRITE_MODEL_B_FIXTURE=1)');
pass('backend fixture bridge');

console.log('[model-b-price-evidence] ALL TESTS PASSED');
