import assert from 'node:assert/strict';
import { gaugePosition } from '../docs/assets/liquidity-gauge.mjs';

assert.equal(gaugePosition(0n), 0);
assert.equal(gaugePosition(500000000000000000n), 50);
assert.equal(gaugePosition(1000000000000000000n), 100);
assert.equal(gaugePosition(100000000000000000000000n), 100);
assert.equal(gaugePosition(250000000000000000n), 25);
assert.throws(() => gaugePosition(-1n));
assert.throws(() => gaugePosition(1));
console.log('PASS liquidity gauge bigint scale, endpoints, midpoint and cap');
