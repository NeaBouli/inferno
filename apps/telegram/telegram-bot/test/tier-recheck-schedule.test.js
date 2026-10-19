const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8');

// Exercise the real startup code with stubbed services and manually fired timers.
// No polling, sockets, chain calls or real waiting.
function fixture(value, restore = async () => {}, recheck = async () => {}) {
  const callbacks = [];
  const intervals = [];
  const errors = [];
  let rechecks = 0;
  const noop = () => Promise.resolve();
  const stub = new Proxy(noop, { get: () => noop });
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === 'telegraf') return { Telegraf: function () { return stub; } };
      if (name === 'express') return Object.assign(() => stub, { json: noop });
      if (name === './services/logger') return { info() {}, warn() {}, error: (...args) => errors.push(args) };
      if (name === './services/verificationStore') return {
        autoRestoreAll: restore,
        recheckAllTiers: async () => { rechecks += 1; await recheck(); },
      };
      return stub;
    },
    process: { env: { BOT_TOKEN: 'fixture-token', TIER_RECHECK_INTERVAL_MS: value }, once() {} },
    setTimeout: (callback) => callbacks.push(callback),
    setInterval(callback, milliseconds) {
      const interval = { callback, milliseconds, unrefCalls: 0 };
      intervals.push(interval);
      return { unref() { interval.unrefCalls += 1; } };
    },
  });
  return {
    intervals, errors,
    rechecks: () => rechecks,
    start() {
      callbacks.shift()();
      return callbacks.shift()();
    },
  };
}

const MINUTE = 60 * 1000;
for (const [value, expected] of [
  [undefined, 30 * MINUTE], ['', 30 * MINUTE], ['1800000', 30 * MINUTE],
  ['600000', 10 * MINUTE], ['300000', 5 * MINUTE], ['1', 5 * MINUTE],
  ['-1', 5 * MINUTE], ['00', 5 * MINUTE], ['0.0', 5 * MINUTE], [' 0 ', 5 * MINUTE],
  ['invalid', 30 * MINUTE], ['NaN', 30 * MINUTE], ['Infinity', 30 * MINUTE],
  ['2147483648', 30 * MINUTE], ['0', null],
]) {
  test(`tier recheck interval ${JSON.stringify(value)} resolves to ${expected}`, async () => {
    const f = fixture(value);
    await f.start();
    if (expected === null) {
      assert.equal(f.intervals.length, 0, 'only the exact string "0" disables rechecks');
    } else {
      assert.equal(f.intervals.length, 1);
      const timer = f.intervals[0];
      assert.equal(timer.milliseconds, expected);
      assert.equal(timer.unrefCalls, 1, 'timer must not keep the process alive');
      assert.equal(f.rechecks(), 0, 'the first recheck waits for the interval');
      await timer.callback();
      assert.equal(f.rechecks(), 1);
    }
  });
}

test('tier timer starts only after initial auto-restore settles', async () => {
  let finish;
  const f = fixture(undefined, () => new Promise((resolve) => { finish = resolve; }));
  const starting = f.start();
  assert.equal(f.intervals.length, 0);
  finish();
  await starting;
  assert.equal(f.intervals.length, 1);
});

test('an initial auto-restore error is logged and does not disable periodic recovery', async () => {
  const f = fixture(undefined, async () => { throw new Error('fixture: restore failed'); });
  await f.start();
  assert.equal(f.errors.length, 1);
  assert.equal(f.intervals.length, 1);
  await f.intervals[0].callback();
  assert.equal(f.rechecks(), 1);
});

test('a rejected timer callback is logged and later ticks still run', async () => {
  const f = fixture(undefined, undefined, async () => { throw new Error('fixture: recheck failed'); });
  await f.start();
  await f.intervals[0].callback();
  await f.intervals[0].callback();
  assert.equal(f.rechecks(), 2);
  assert.equal(f.errors.length, 2);
});
