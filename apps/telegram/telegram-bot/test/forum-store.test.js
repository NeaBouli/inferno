const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Wallet } = require('ethers');
const { createVoteStore, MAX_RECORDS } = require('../src/forum/store');

// Public Hardhat test key, with no provider.
const wallet = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const ballotId = 'FB-TEST-0001';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-forum-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'private');
  let now = 2000;
  const store = createVoteStore({ dataDir, clock: () => now });
  return { dataDir, store, setNow: (value) => { now = value; } };
}

async function vote(choice = 'yes', issuedAt = 2000) {
  return { wallet: wallet.address.toLowerCase(), choice, issuedAt,
    signature: await wallet.signMessage(`forum-store fixture ${choice} ${issuedAt}`) };
}

test('store persists only receipt fields with checksum addresses and private modes', async (t) => {
  const { dataDir, store } = fixture(t);
  assert.deepEqual(store.read(ballotId), []);
  assert.equal(fs.existsSync(dataDir), false, 'read does not create a data directory');
  const input = { ...await vote(), ip: '192.0.2.1', headers: { secret: 'excluded' }, userAgent: 'excluded' };
  const { record, duplicate } = store.append(ballotId, input);
  assert.equal(duplicate, false);
  assert.deepEqual(record, {
    receiptOrder: 1, receivedAt: 2000, wallet: wallet.address,
    choice: 'yes', issuedAt: 2000, signature: input.signature,
  });
  const file = path.join(dataDir, `${ballotId}.jsonl`);
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify(record)}\n`);
  assert.deepEqual(store.read(ballotId), [record]);
});

test('duplicate signature is idempotent across restarts and never rewrites receipts', async (t) => {
  const { dataDir, store, setNow } = fixture(t);
  const input = await vote();
  const first = store.append(ballotId, input);
  const file = path.join(dataDir, `${ballotId}.jsonl`);
  const bytes = fs.readFileSync(file);
  setNow(3000);
  const restarted = createVoteStore({ dataDir, clock: () => 4000 });
  for (const instance of [store, restarted]) {
    const again = instance.append(ballotId, input);
    assert.equal(again.duplicate, true);
    assert.deepEqual(again.record, first.record);
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  assert.equal(store.append(ballotId, { ...input, signature: `0x${input.signature.slice(2).toUpperCase()}` }).duplicate, true);
});

test('all repeats and exact issuedAt ties remain in receipt order', async (t) => {
  const { dataDir, store, setNow } = fixture(t);
  const first = store.append(ballotId, await vote('yes', 2000)).record;
  setNow(2001);
  const second = store.append(ballotId, await vote('no', 2000)).record;
  setNow(2002);
  const third = store.append(ballotId, await vote('abstain', 1999)).record;
  assert.deepEqual(store.read(ballotId), [first, second, third]);
  assert.deepEqual([first, second, third].map((record) => record.receiptOrder), [1, 2, 3]);
  assert.deepEqual(createVoteStore({ dataDir }).read(ballotId), [first, second, third]);
  assert.deepEqual(store.read('FB-OTHER'), []);
  assert.equal(store.append('FB-OTHER', await vote()).record.receiptOrder, 1);
});

test('store restores private permissions on an existing log and directory', async (t) => {
  const { dataDir, store } = fixture(t);
  store.append(ballotId, await vote());
  const file = path.join(dataDir, `${ballotId}.jsonl`);
  fs.chmodSync(dataDir, 0o755);
  fs.chmodSync(file, 0o644);
  store.append(ballotId, await vote('no'));
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('store refuses path traversal for reads and appends', async (t) => {
  const { store } = fixture(t);
  const input = await vote();
  for (const id of ['../outside', 'FB-a', 'FB-A\n', 'FB-A\r', '', null]) {
    assert.throws(() => store.read(id), /Invalid ballot id/);
    assert.throws(() => store.append(id, input), /Invalid ballot id/);
  }
});

test('corrupt, torn or out-of-order logs fail closed without an append', async (t) => {
  const { dataDir, store } = fixture(t);
  const input = await vote();
  store.append(ballotId, input);
  const file = path.join(dataDir, `${ballotId}.jsonl`);
  for (const text of ['{', '{bad json}\n', '{"receiptOrder":2}\n']) {
    fs.writeFileSync(file, text);
    assert.throws(() => store.read(ballotId));
    assert.throws(() => store.append(ballotId, input));
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});

test('100000-record cap rejects new signatures but still returns duplicates', async (t) => {
  const { dataDir, store } = fixture(t);
  const input = await vote();
  const first = store.append(ballotId, input).record;
  const file = path.join(dataDir, `${ballotId}.jsonl`);
  const lines = Array.from({ length: MAX_RECORDS - 1 }, (_, index) => JSON.stringify({
    ...first, receiptOrder: index + 2,
    signature: `0x${(index + 1).toString(16).padStart(130, '0')}`,
  }));
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
  const size = fs.statSync(file).size;
  assert.equal(store.read(ballotId).length, 100000);
  assert.deepEqual(store.append(ballotId, input), { record: first, duplicate: true });
  assert.throws(() => store.append(ballotId, { ...input, signature: `0x${'ff'.repeat(65)}` }),
    { code: 'FORUM_RECORD_LIMIT', message: 'Ballot record limit reached' });
  assert.equal(fs.statSync(file).size, size);
});
