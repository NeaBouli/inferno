import assert from 'node:assert/strict';
import { parseIFR, quote, units, readPool, IFR, ETH_USD_FEED, ETH_USD_MAX_AGE, ethUsd } from '../docs/assets/liquidity-calculator.mjs';
assert.equal(parseIFR('0.000000001'), 1n);
assert.equal(parseIFR('30000000'), 30000000000000000n);
for (const invalid of ['0', '-1', '1e9', '1,000', '1.0000000001', 'NaN', '', '01', 'Infinity']) assert.throws(() => parseIFR(invalid));
assert.equal(quote(3n, 2n, 1n), 2n);
assert.equal(quote(parseIFR('30000000'), 11899172061166225n, 253883142774894713n), 640086070198430009n);
assert.throws(() => quote(1n, 0n, 1n));
assert.equal(units(1n, 9), '0.000000001');
assert.equal(units(1000000000n, 9), '1.0');
let destroyed = 0;
let calls = [];
const now = Math.floor(Date.now() / 1000);
const FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const round = (over = {}) => { const r = { id: 110680464442257320000n, answer: 250012345678n, started: BigInt(now - 60), updated: BigInt(now - 60), answered: 110680464442257320000n, ...over }; return [r.id, r.answer, r.started, r.updated, r.answered]; };
const base = () => ({ chain: 1n, timestamp: now, token: IFR, exempt: true, reserves: [100n, 20n], round: round(), decimals: 8n, feed: null });
let config = base();
let pending = [];
const mock = {
  FetchRequest: class {},
  JsonRpcProvider: class {
    async getNetwork() { return { chainId: config.chain }; }
    async getBlock(tag) { calls.push(['block', tag]); return { number: 123, timestamp: config.timestamp }; }
    destroy() { destroyed++; pending.splice(0).forEach(reject => reject(new Error('destroyed'))); }
  },
  Contract: class {
    constructor(address) { this.address = address; }
    async token0(opts) { calls.push(['token0', opts.blockTag]); return config.token; }
    async token1(opts) { calls.push(['token1', opts.blockTag]); return '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; }
    async getReserves(opts) { calls.push(['getReserves', opts.blockTag]); return config.reserves; }
    async feeExempt(_pair, opts) { calls.push(['feeExempt', opts.blockTag]); return config.exempt; }
    async latestRoundData(opts) {
      assert.equal(this.address, FEED);
      calls.push(['latestRoundData', opts.blockTag]);
      if (config.feed === 'revert') throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
      if (config.feed === 'hang') return new Promise((_, reject) => pending.push(reject));
      return config.round;
    }
    async decimals(opts) { calls.push(['decimals', opts.blockTag]); return config.decimals; }
  },
};
// Chainlink standard feed: 8 decimals, 1 hour heartbeat + 5 minutes tolerance at the snapshot block.
assert.equal(ETH_USD_FEED, FEED);
assert.equal(ETH_USD_MAX_AGE, 3900);
assert.deepEqual(ethUsd(round(), 8n, now), { price: 250012345678n, updatedAt: now - 60 });
assert.deepEqual(ethUsd(round({ answer: 2500012345n }), 6n, now), { price: 250001234500n, updatedAt: now - 60 }, '6 decimals scale exactly');
assert.equal(ethUsd(round({ answer: 2500n }), 0n, now).price, 250000000000n, '0 decimals scale exactly');
assert.equal(ethUsd(round({ answer: 2n ** 255n - 1n }), 8n, now).price, 2n ** 255n - 1n, 'no Number precision loss');
assert.equal(ethUsd(round({ updated: BigInt(now - 3900) }), 8n, now).updatedAt, now - 3900, 'boundary age accepted');
assert.equal(ethUsd(round({ updated: BigInt(now) }), 8n, now).updatedAt, now, 'same-second round accepted');
const invalid = {
  'zero answer': [round({ answer: 0n }), 8n], 'negative answer': [round({ answer: -1n }), 8n], 'zero round': [round({ id: 0n, answered: 0n }), 8n],
  'zero updatedAt': [round({ updated: 0n }), 8n], 'future updatedAt': [round({ updated: BigInt(now + 1) }), 8n], 'stale round': [round({ updated: BigInt(now - 3901) }), 8n],
  'answeredInRound < roundId': [round({ answered: 110680464442257319999n }), 8n], 'decimals 9': [round(), 9n], 'decimals 18': [round(), 18n], 'decimals 255': [round(), 255n],
  'number decimals': [round(), 8], 'number answer': [[1n, 2500, 1n, BigInt(now), 1n], 8n], 'short tuple': [[1n, 2n], 8n], 'missing round': [undefined, 8n], 'string field': [[1n, '2500', 1n, BigInt(now), 1n], 8n],
};
for (const [label, [r, d]] of Object.entries(invalid)) assert.throws(() => ethUsd(r, d, now), undefined, label);
assert.throws(() => ethUsd(round(), 8n, now + 0.5), undefined, 'non-integer block time');
for (const d of [9n, 18n, 255n, -1n]) assert.throws(() => ethUsd(round(), d, now), /Unsupported ETH\/USD decimals/, 'explicit decimals guard ' + d);
// Valid read: every call, including the feed and block timestamp, is bound to the captured block.
const good = await readPool(mock);
assert.deepEqual([good.block, good.ethUsd, good.ethUsdUpdatedAt], [123, 250012345678n, now - 60]);
assert.deepEqual(calls.map(c => c[0]).sort(), ['block', 'decimals', 'feeExempt', 'getReserves', 'latestRoundData', 'token0', 'token1']);
assert.deepEqual(calls.filter(c => c[0] !== 'block').map(c => c[1]), [123, 123, 123, 123, 123, 123], 'same blockTag for pair, token, fee and feed reads');
assert.deepEqual(calls.find(c => c[0] === 'block'), ['block', 'latest'], 'block captured once; its timestamp is the staleness clock');
destroyed = 0;
for (const [key, value] of [['chain', 10n], ['timestamp', 1], ['token', 'wrong'], ['exempt', false], ['reserves', [0n, 2n]]]) {
  config = { ...base(), [key]: value };
  await assert.rejects(readPool(mock));
}
assert.equal(destroyed, 5);
// Feed failures hide USD only: reserves, block and identity checks still come from the same accepted snapshot.
const feedFailures = { reverted: { feed: 'revert' }, malformed: { round: [1n, 2n] }, 'malformed decimals': { decimals: 'x' }, stale: { round: round({ updated: BigInt(now - 4000) }) }, future: { round: round({ updated: BigInt(now + 5) }) }, 'zero answer': { round: round({ answer: 0n }) }, 'answeredInRound < roundId': { round: round({ answered: 1n }) }, unsupported: { decimals: 18n } };
for (const [label, over] of Object.entries(feedFailures)) {
  config = { ...base(), ...over };
  const result = await readPool(mock);
  assert.deepEqual([result.ethUsd, result.ethUsdUpdatedAt, result.eth, result.ifr, result.block], [null, null, 20n, 100n, 123], label);
}
// A hanging feed read is cancelled with the whole snapshot when the caller aborts (15 s gauge timeout).
config = { ...base(), feed: 'hang' };
const controller = new AbortController();
const hanging = readPool(mock, controller.signal);
await new Promise(resolve => setTimeout(resolve, 0));
controller.abort();
await assert.rejects(hanging);
console.log('PASS: liquidity integer math, input validation, block binding (pair/token/fee/feed), identity/network/exemption/stale/empty fail-closed, provider cleanup; Chainlink ETH/USD 8/6/0-decimal exact scaling and zero/negative/future/stale/answeredInRound/decimals/malformed/reverted/aborted rejection without dropping reserves');
