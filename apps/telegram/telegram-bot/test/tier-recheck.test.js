const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Isolated persistence and a stubbed tier source: no chain or Telegram access.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-tier-recheck-'));
process.env.WALLET_MAP_PATH = path.join(tempDir, 'wallet-map.json');
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

const readerPath = require.resolve('../src/services/onChainReader');
const reader = { determineTier: async () => 'community' };
require.cache[readerPath] = {
  id: readerPath, filename: readerPath, loaded: true, exports: reader,
};
const store = require('../src/services/verificationStore');

const WALLET_A = `0x${'11'.repeat(20)}`;
const WALLET_B = `0x${'22'.repeat(20)}`;

function fixture(t) {
  const users = [];
  t.after(() => users.forEach((id) => store.unverify(id)));
  const tierLookup = t.mock.method(reader, 'determineTier', async () => 'community');
  return {
    tierLookup,
    bind(id, wallet, tier) {
      users.push(id);
      store.setVerified(id, wallet, tier);
    },
  };
}

for (const tier of ['signer', 'council']) {
  test(`recheck downgrades a former ${tier} and removes elevated topic access`, async (t) => {
    const f = fixture(t);
    f.bind('3001', WALLET_A, tier);
    const original = { ...store.getUser('3001') };
    assert.equal(store.hasTopicAccess('3001', 58), true);
    assert.equal(store.hasTopicAccess('3001', 21), true);
    const log = t.mock.method(console, 'log', () => {});

    await store.recheckAllTiers();

    assert.equal(f.tierLookup.mock.callCount(), 1);
    assert.deepEqual(f.tierLookup.mock.calls[0].arguments, [WALLET_A]);
    assert.deepEqual(store.getUser('3001'), { ...original, tier: 'community' });
    for (const topic of [58, 21, 11, 23]) {
      assert.equal(store.hasTopicAccess('3001', topic), false);
    }
    const output = log.mock.calls.flatMap((call) => call.arguments).join(' ');
    assert.match(output, new RegExp(`3001.*${tier}\\s*->\\s*community`));
    assert.equal(output.includes(WALLET_A), false, 'info logs must not include the wallet');
  });
}

test('recheck also applies upgrades and preserves unchanged verification metadata', async (t) => {
  const f = fixture(t);
  f.bind('3001', WALLET_A, 'community');
  f.bind('3002', WALLET_B, 'builder');
  const unchanged = { ...store.getUser('3002') };
  f.tierLookup.mock.mockImplementation(async (wallet) => wallet === WALLET_A ? 'signer' : 'builder');

  await store.recheckAllTiers();

  assert.equal(store.getTierForUser('3001'), 'signer');
  assert.equal(store.hasTopicAccess('3001', 58), true);
  assert.deepEqual(store.getUser('3002'), unchanged);
  assert.equal(f.tierLookup.mock.callCount(), 2);
});

test('tier lookup failure removes verification, preserves the wallet map and continues', async (t) => {
  const f = fixture(t);
  f.bind('3001', WALLET_A, 'signer');
  f.bind('3002', WALLET_B, 'council');
  const persisted = fs.readFileSync(process.env.WALLET_MAP_PATH, 'utf8');
  f.tierLookup.mock.mockImplementation(async (wallet) => {
    if (wallet === WALLET_A) throw new Error('fixture: tier lookup failed');
    return 'community';
  });

  await store.recheckAllTiers();

  assert.equal(store.isVerified('3001'), false);
  assert.equal(store.getUser('3001'), null);
  assert.equal(store.getWallet('3001'), null);
  for (const topic of [58, 21, 11]) assert.equal(store.hasTopicAccess('3001', topic), false);
  assert.equal(store.getTierForUser('3002'), 'community', 'one failure must not stop other rechecks');
  assert.equal(fs.readFileSync(process.env.WALLET_MAP_PATH, 'utf8'), persisted);
  assert.throws(() => store.setVerified('3003', WALLET_A, 'signer'), { code: 'WALLET_CONFLICT' });

  f.tierLookup.mock.mockImplementation(async () => 'builder');
  assert.equal(await store.reverifyFromMap('3001'), true);
  assert.equal(store.getTierForUser('3001'), 'builder');
  assert.equal(store.hasTopicAccess('3001', 58), false);
  assert.equal(store.hasTopicAccess('3001', 11), true);
});

test('a later successful recheck restores a failed user only at the freshly derived tier', async (t) => {
  const f = fixture(t);
  f.bind('3001', WALLET_A, 'signer');
  f.tierLookup.mock.mockImplementation(async () => { throw new Error('fixture: rpc down'); });
  await store.recheckAllTiers();
  assert.equal(store.isVerified('3001'), false);

  f.tierLookup.mock.mockImplementation(async () => 'community');
  await store.recheckAllTiers();

  assert.equal(store.isVerified('3001'), true);
  assert.equal(store.getWallet('3001'), WALLET_A);
  assert.equal(store.getTierForUser('3001'), 'community');
  assert.equal(store.hasTopicAccess('3001', 58), false);
});

test('overlapping rechecks are skipped and a completed run releases the guard', { timeout: 2000 }, async (t) => {
  const f = fixture(t);
  f.bind('3001', WALLET_A, 'signer');
  let release;
  f.tierLookup.mock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const first = store.recheckAllTiers();
  try {
    await store.recheckAllTiers();
    assert.equal(f.tierLookup.mock.callCount(), 1, 'no second tier lookup while the first is pending');
  } finally {
    release('community');
    await first;
  }
  f.tierLookup.mock.mockImplementation(async () => 'council');
  await store.recheckAllTiers();
  assert.equal(f.tierLookup.mock.callCount(), 2);
  assert.equal(store.getTierForUser('3001'), 'council');
});

for (const fail of [false, true]) {
  test(`an in-flight recheck cannot undo unverify (lookup ${fail ? 'fails' : 'succeeds'})`, async (t) => {
    const f = fixture(t);
    f.bind('3001', WALLET_A, 'signer');
    let finish;
    f.tierLookup.mock.mockImplementation(() => new Promise((resolve, reject) => {
      finish = () => fail ? reject(new Error('fixture: rpc down')) : resolve('signer');
    }));
    const pending = store.recheckAllTiers();
    store.unverify('3001');
    finish();
    await pending;
    assert.equal(store.isVerified('3001'), false);
    assert.equal(JSON.parse(fs.readFileSync(process.env.WALLET_MAP_PATH, 'utf8'))['3001'], undefined);
  });

  test(`an in-flight recheck cannot overwrite a newer wallet binding (lookup ${fail ? 'fails' : 'succeeds'})`, async (t) => {
    const f = fixture(t);
    f.bind('3001', WALLET_A, 'signer');
    let finish;
    f.tierLookup.mock.mockImplementation(() => new Promise((resolve, reject) => {
      finish = () => fail ? reject(new Error('fixture: rpc down')) : resolve('signer');
    }));
    const pending = store.recheckAllTiers();
    store.setVerified('3001', WALLET_B, 'community');
    const rebound = { ...store.getUser('3001') };
    finish();
    await pending;
    assert.deepEqual(store.getUser('3001'), rebound);
    assert.equal(store.hasTopicAccess('3001', 58), false);
  });
}

test('a changed binding later in the batch is never checked against its old wallet', async (t) => {
  const f = fixture(t);
  f.bind('3001', WALLET_A, 'signer');
  f.bind('3002', WALLET_B, 'council');
  let finish;
  f.tierLookup.mock.mockImplementation((wallet) => {
    if (wallet === WALLET_A) return new Promise((resolve) => { finish = resolve; });
    throw new Error('a replaced mapping must not be checked');
  });
  const pending = store.recheckAllTiers();
  store.unverify('3002');
  store.setVerified('3002', WALLET_B, 'builder');
  finish('community');
  await pending;
  assert.equal(f.tierLookup.mock.callCount(), 1);
  assert.equal(store.getTierForUser('3002'), 'builder');
});

for (const configured of [undefined, '/custom/verify/wallets.json']) {
  test(`wallet-map path honors ${configured ? 'the env override' : 'the persistent default'}`, () => {
    const reads = [];
    const filename = require.resolve('../src/services/verificationStore');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require(name) {
        if (name === 'fs') return { existsSync: (file) => { reads.push(file); return false; } };
        return require(name);
      },
      process: { env: { WALLET_MAP_PATH: configured } },
      module: { exports: {} },
      setInterval: () => ({ unref() {} }),
    });
    assert.deepEqual(reads, [configured || '/data/verify/wallet-map.json']);
  });
}
