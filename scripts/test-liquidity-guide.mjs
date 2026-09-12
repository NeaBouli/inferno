import assert from 'node:assert/strict';
import { parseIFR, quote, units, readPool, IFR } from '../docs/assets/liquidity-calculator.mjs';
assert.equal(parseIFR('0.000000001'), 1n);
assert.equal(parseIFR('30000000'), 30000000000000000n);
for (const invalid of ['0', '-1', '1e9', '1,000', '1.0000000001', 'NaN', '', '01', 'Infinity']) assert.throws(() => parseIFR(invalid));
assert.equal(quote(3n, 2n, 1n), 2n);
assert.equal(quote(parseIFR('30000000'), 11899172061166225n, 253883142774894713n), 640086070198430009n);
assert.throws(() => quote(1n, 0n, 1n));
assert.equal(units(1n, 9), '0.000000001');
assert.equal(units(1000000000n, 9), '1.0');
let destroyed = 0;
const calls = [];
const config = { chain: 1n, timestamp: Math.floor(Date.now() / 1000), token: IFR, exempt: true, reserves: [100n, 20n] };
const mock = {
  FetchRequest: class {},
  JsonRpcProvider: class {
    async getNetwork() { return { chainId: config.chain }; }
    async getBlock() { return { number: 123, timestamp: config.timestamp }; }
    destroy() { destroyed++; }
  },
  Contract: class {
    async token0(opts) { calls.push(opts.blockTag); return config.token; }
    async token1(opts) { calls.push(opts.blockTag); return '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; }
    async getReserves(opts) { calls.push(opts.blockTag); return config.reserves; }
    async feeExempt(_pair, opts) { calls.push(opts.blockTag); return config.exempt; }
  },
};
assert.equal((await readPool(mock)).block, 123);
assert.deepEqual(calls, [123, 123, 123, 123]);
for (const [key, value] of [['chain', 10n], ['timestamp', 1], ['token', 'wrong'], ['exempt', false], ['reserves', [0n, 2n]]]) {
  const old = config[key]; config[key] = value;
  await assert.rejects(readPool(mock));
  config[key] = old;
}
assert.equal(destroyed, 6);
console.log('PASS: liquidity integer math, input validation, block binding, identity/network/exemption/stale/empty fail-closed and provider cleanup');
