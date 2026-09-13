import assert from 'node:assert/strict';
import { parseETH, capacity, depth, decimal } from '../docs/assets/liquidity-depth.mjs';
const E = 10n ** 18n;
assert.equal(parseETH('0.1'), E / 10n);
for (const bad of ['0', '-1', '1,000', 'NaN', '1e3', '0.0000000000000000001']) assert.throws(() => parseETH(bad));
assert.equal(parseETH('0.000000000000000001'), 1n);
assert.equal(depth(E / 10n, E, 1000000000n).required, 9870300000000000000n);
assert.equal(depth(E / 10n, 10n * E, 1000000000n).missing, 0n);
assert.equal(depth(E / 10n, 10n * E, 1000000000n).coverage, 100);
for (const r of [1n, 250000000000000000n, E, 1000000n * E]) {
  for (const b of [50n, 100n, 200n, 500n]) {
    const a = capacity(r, b);
    assert.ok(a * 997n * (10000n - b) <= r * 1000n * b);
    assert.ok((a + 1n) * 997n * (10000n - b) > r * 1000n * b);
  }
  const d = depth(E / 10n, r, 123456789123456n);
  assert.ok(d.required * 1000n * 100n >= E / 10n * 997n * 9900n);
  assert.ok(d.missingIFR * r >= d.missing * 123456789123456n);
}
assert.throws(() => capacity(0n, 100n));
assert.throws(() => capacity(E, 10000n));
assert.throws(() => depth(0n, E, 1n));
assert.equal(decimal(1n), '<0.000001');
assert.ok(depth(E, E, 1n).impactBps > depth(E / 10n, E, 1n).impactBps);
assert.ok(capacity(2n * E, 100n) >= 2n * capacity(E, 100n));
console.log('PASS depth math: threshold boundaries, fee adjustment, conservative rounding, input guards and monotonicity');
