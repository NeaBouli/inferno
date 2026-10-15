const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Wallet, Signature, TypedDataEncoder, getAddress } = require('ethers');
const { createVoteStore, MAX_RECORDS, MAX_WALLET_VOTES } = require('../src/forum/store');
const { loadBallot, manifestHash, voteTypedData } = require('../src/forum/ballot');

// Public Hardhat test keys only, with no provider.
const wallet = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const otherWallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ballotId = 'FB-TEST-0001';
const exampleDir = path.resolve(__dirname, 'fixtures/forum-ballots');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-forum-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'private');
  const ballot = loadBallot(exampleDir, ballotId);
  ballot.manifest.window = { opensAt: 1000, closesAt: 10000 };
  ballot.manifestHash = manifestHash(ballot.manifest);
  let now = 2000;
  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };
  const store = createVoteStore({ dataDir, clock: () => now, logger });
  return { root, dataDir, store, ballot, warnings, logger,
    file: path.join(dataDir, `${ballotId}.jsonl`), setNow: (value) => { now = value; } };
}

async function vote(ballot, choice = 'yes', issuedAt = 2000, signer = wallet) {
  const { domain, types, value } = voteTypedData(ballot, choice, issuedAt);
  return { wallet: signer.address.toLowerCase(), choice, issuedAt,
    signature: await signer.signTypedData(domain, types, value) };
}

function digest(ballot, input) {
  const { domain, types, value } = voteTypedData(ballot, input.choice, input.issuedAt);
  return TypedDataEncoder.hash(domain, types, value);
}

test('store persists only bound receipt fields with checksum addresses and private modes', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  assert.deepEqual(store.read(ballot), { records: [], next: null });
  assert.equal(fs.existsSync(dataDir), false, 'read does not create a data directory');
  const input = { ...await vote(ballot), ip: '192.0.2.1', headers: { secret: 'excluded' }, userAgent: 'excluded' };
  const { record, duplicate } = store.append(ballot, input);
  assert.equal(duplicate, false);
  assert.deepEqual(record, {
    ballotId, chainId: 11155111, manifestHash: ballot.manifestHash, digest: digest(ballot, input),
    receiptOrder: 1, receivedAt: 2000, wallet: wallet.address,
    choice: 'yes', issuedAt: 2000, signature: input.signature,
  });
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify(record)}\n`);
  assert.deepEqual(store.read(ballot), { records: [record], next: 1 });
});

test('digest duplicates survive restarts and normalize 27/28, 0/1 and compact signatures', async (t) => {
  const { dataDir, store, ballot, file, setNow } = fixture(t);
  const parities = new Set();
  for (let issuedAt = 2000; issuedAt < 2020 && parities.size < 2; issuedAt += 1) {
    const input = await vote(ballot, 'yes', issuedAt);
    const signature = Signature.from(input.signature);
    if (parities.has(signature.yParity)) continue;
    parities.add(signature.yParity);
    const first = store.append(ballot, { ...input,
      signature: `${signature.serialized.slice(0, -2)}0${signature.yParity}` });
    assert.equal(first.record.signature, signature.serialized);
    const bytes = fs.readFileSync(file);
    setNow(3000);
    for (const instance of [store, createVoteStore({ dataDir, clock: () => 4000 })]) {
      for (const encoded of [signature.serialized, signature.compactSerialized,
        `0x${signature.serialized.slice(2).toUpperCase()}`]) {
        assert.deepEqual(instance.append(ballot, { ...input, signature: encoded }),
          { record: first.record, duplicate: true });
        assert.deepEqual(fs.readFileSync(file), bytes);
      }
    }
  }
  assert.deepEqual([...parities].sort(), [0, 1]);
  assert.equal(store.read(ballot).records.length, parities.size);
});

test('same digest signed by different wallets stores both; choice and issuedAt distinguish votes', async (t) => {
  const { store, ballot, dataDir, setNow } = fixture(t);
  const first = store.append(ballot, await vote(ballot)).record;
  const other = store.append(ballot, await vote(ballot, 'yes', 2000, otherWallet)).record;
  assert.equal(first.digest, other.digest);
  setNow(2001);
  const second = store.append(ballot, await vote(ballot, 'no')).record;
  const third = store.append(ballot, await vote(ballot, 'yes', 2001)).record;
  assert.notEqual(first.digest, second.digest);
  assert.notEqual(first.digest, third.digest);
  assert.deepEqual(store.read(ballot).records, [first, other, second, third]);
  assert.deepEqual(createVoteStore({ dataDir }).read(ballot).records, [first, other, second, third]);
});

test('first access hydrates once; later appends and pages never read the log again', async (t) => {
  const { store, ballot, dataDir, file } = fixture(t);
  const first = store.append(ballot, await vote(ballot)).record;
  const readFile = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, 'readFileSync', (...args) => { reads += 1; return readFile(...args); });
  const restarted = createVoteStore({ dataDir });
  assert.equal(restarted.read(ballot).records.length, 1);
  assert.equal(reads, 1);
  const second = restarted.append(ballot, await vote(ballot, 'no')).record;
  const third = restarted.append(ballot, await vote(ballot, 'abstain')).record;
  assert.equal(restarted.append(ballot, await vote(ballot)).duplicate, true);
  assert.deepEqual(restarted.read(ballot, { limit: 2 }), { records: [first, second], next: 2 });
  assert.deepEqual(restarted.read(ballot, { after: 2, limit: 1 }), { records: [third], next: 3 });
  assert.deepEqual(restarted.read(ballot, { after: 3 }), { records: [], next: null });
  assert.deepEqual(restarted.read(ballot, { after: Number.MAX_SAFE_INTEGER }), { records: [], next: null });
  assert.equal(reads, 1);
  assert.equal(fs.statSync(file).size > 0, true);
});

test('pagination defaults to 1000 and accepts limit boundaries without gaps', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  const first = store.append(ballot, await vote(ballot)).record;
  // Synthetic public receipt addresses exercise pagination without creating signing keys.
  const lines = Array.from({ length: 1001 }, (_, i) => JSON.stringify({ ...first,
    receiptOrder: i + 1, wallet: getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`) }));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const restarted = createVoteStore({ dataDir });
  const page = restarted.read(ballot);
  assert.equal(page.records.length, 1000);
  assert.equal(page.next, 1000);
  assert.equal(restarted.read(ballot, { after: page.next, limit: 1 }).next, 1001);
  for (const options of [{ after: -1 }, { after: 1.1 }, { after: '1' },
    { limit: 0 }, { limit: 1001 }, { limit: 1.5 }]) {
    assert.throws(() => restarted.read(ballot, options), /Invalid pagination/);
  }
});

test('append fsyncs the descriptor after writing and before close', async (t) => {
  const { store, ballot, file } = fixture(t);
  const input = await vote(ballot);
  store.check(ballot);
  const events = [];
  for (const name of ['appendFileSync', 'fsyncSync', 'closeSync']) {
    const original = fs[name];
    t.mock.method(fs, name, (...args) => { events.push([name, args[0]]); return original(...args); });
  }
  const result = store.append(ballot, input);
  assert.equal(result.duplicate, false);
  assert.deepEqual(events.map(([name]) => name), ['appendFileSync', 'fsyncSync', 'closeSync']);
  assert.equal(new Set(events.map(([, fd]) => fd)).size, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify(result.record)}\n`);
});

test('fsync failure is never acknowledged and leaves the in-memory ballot failed closed', async (t) => {
  const { store, ballot } = fixture(t);
  store.check(ballot);
  const input = await vote(ballot);
  let closed = false;
  const close = fs.closeSync;
  t.mock.method(fs, 'closeSync', (fd) => { closed = true; close(fd); });
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('fixture sync failure'); });
  assert.throws(() => store.append(ballot, input), /sync failure/);
  assert.equal(closed, true);
  assert.throws(() => store.read(ballot), /sync failure/);
});

test('load truncates only trailing partial bytes, fsyncs and logs only their count', async (t) => {
  const { dataDir, store, ballot, file, warnings, logger } = fixture(t);
  const first = store.append(ballot, await vote(ballot)).record;
  const good = fs.readFileSync(file);
  const partial = Buffer.from('{"wallet":"private-tail-Δ');
  fs.appendFileSync(file, partial);
  const restarted = createVoteStore({ dataDir, logger });
  const sync = fs.fsyncSync;
  let syncs = 0;
  t.mock.method(fs, 'fsyncSync', (fd) => { syncs += 1; sync(fd); });
  assert.deepEqual(restarted.read(ballot), { records: [first], next: 1 });
  assert.equal(syncs, 1);
  assert.deepEqual(fs.readFileSync(file), good);
  assert.deepEqual(warnings, [`Truncated incomplete forum vote bytes: ${partial.length}`]);
  assert.equal(restarted.append(ballot, await vote(ballot, 'no')).record.receiptOrder, 2);
});

test('a file consisting entirely of an unacknowledged partial line recovers as empty', (t) => {
  const { dataDir, ballot, file, logger, warnings } = fixture(t);
  fs.mkdirSync(dataDir);
  fs.writeFileSync(file, '{');
  assert.deepEqual(createVoteStore({ dataDir, logger }).read(ballot), { records: [], next: null });
  assert.equal(fs.statSync(file).size, 0);
  assert.deepEqual(warnings, ['Truncated incomplete forum vote bytes: 1']);
});

test('all complete-line corruption fails closed and leaves even a partial tail untouched', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  const input = await vote(ballot);
  const first = store.append(ballot, input).record;
  const corrupt = ['{bad json}\n', '\n', `${JSON.stringify({ ...first, receiptOrder: 2 })}\n`,
    `${JSON.stringify({ ...first, digest: `0x${'00'.repeat(32)}` })}\n`,
    `${JSON.stringify({ ...first, chainId: 1 })}\n`,
    `${JSON.stringify({ ...first, ballotId: 'FB-OTHER' })}\n`,
    `${JSON.stringify(first)}\n${JSON.stringify({ ...first, receiptOrder: 2 })}\n`,
    Buffer.from([0xff, 0x0a])];
  for (const bytes of corrupt) {
    fs.writeFileSync(file, bytes);
    fs.appendFileSync(file, '{partial');
    const before = fs.readFileSync(file);
    const restarted = createVoteStore({ dataDir });
    assert.throws(() => restarted.read(ballot));
    assert.throws(() => restarted.append(ballot, input));
    assert.deepEqual(fs.readFileSync(file), before);
  }
});

test('changed manifest fails closed during hydration and against an already hydrated index', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  const input = await vote(ballot);
  store.append(ballot, input);
  const changed = { ...ballot, manifest: { ...ballot.manifest, proposal: { ...ballot.manifest.proposal, title: 'changed' } } };
  changed.manifestHash = manifestHash(changed.manifest);
  const bytes = fs.readFileSync(file);
  for (const instance of [store, createVoteStore({ dataDir })]) {
    assert.throws(() => instance.read(changed), { code: 'FORUM_MANIFEST_CHANGED', message: 'Ballot manifest changed' });
    assert.throws(() => instance.append(changed, input), /Ballot manifest changed/);
  }
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('store restores private permissions only for owned logs and directories', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  store.append(ballot, await vote(ballot));
  fs.chmodSync(dataDir, 0o755);
  fs.chmodSync(file, 0o644);
  store.append(ballot, await vote(ballot, 'no'));
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('data directory must be absolute and outside the app, including aliases and traversal', async (t) => {
  const { root, ballot } = fixture(t);
  const input = await vote(ballot);
  const app = path.resolve(__dirname, '..');
  const alias = path.join(root, 'app-alias');
  fs.symlinkSync(app, alias, 'dir');
  for (const dataDir of [undefined, '', 'relative', app, path.join(app, 'data'),
    path.join(app, '../telegram-bot/data'), path.join(alias, 'data')]) {
    const instance = createVoteStore({ dataDir });
    assert.throws(() => instance.read(ballot), { code: 'FORUM_STORAGE_UNSAFE' });
    assert.throws(() => instance.append(ballot, input), { code: 'FORUM_STORAGE_UNSAFE' });
  }
  // A sibling sharing the app's basename prefix is still outside the app.
  const sibling = path.join(root, 'telegram-bot-data');
  assert.equal(createVoteStore({ dataDir: sibling }).append(ballot, input).duplicate, false);
});

test('foreign-owned directory is refused without chmod or append, even after hydration', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  store.append(ballot, await vote(ballot));
  const input = await vote(ballot, 'no');
  const stat = fs.statSync;
  const size = stat(file).size;
  t.mock.method(fs, 'statSync', (target, ...args) => {
    const info = stat(target, ...args);
    if (target === dataDir) Object.defineProperty(info, 'uid', { value: process.getuid() + 1 });
    return info;
  });
  t.mock.method(fs, 'chmodSync', () => assert.fail('must not chmod a foreign directory'));
  for (const instance of [store, createVoteStore({ dataDir })]) {
    assert.throws(() => instance.read(ballot), { code: 'FORUM_STORAGE_UNSAFE' });
    assert.throws(() => instance.append(ballot, input), { code: 'FORUM_STORAGE_UNSAFE' });
  }
  assert.equal(stat(file).size, size);
});

test('JSONL symlinks are refused on hydration and append with O_NOFOLLOW', async (t) => {
  const { root, dataDir, store, ballot, file } = fixture(t);
  const input = await vote(ballot);
  store.check(ballot);
  fs.mkdirSync(dataDir);
  const target = path.join(root, 'target');
  fs.writeFileSync(target, 'untouched');
  fs.symlinkSync(target, file);
  const open = fs.openSync;
  const flagsSeen = [];
  t.mock.method(fs, 'openSync', (name, flags, ...args) => {
    if (name === file) flagsSeen.push(flags);
    return open(name, flags, ...args);
  });
  assert.throws(() => createVoteStore({ dataDir }).read(ballot), { code: 'FORUM_STORAGE_UNSAFE' });
  assert.throws(() => store.append(ballot, input), { code: 'FORUM_STORAGE_UNSAFE' });
  assert.equal(flagsSeen.length, 2);
  assert.ok(flagsSeen.every((flags) => (flags & fs.constants.O_NOFOLLOW) !== 0));
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
});

test('store refuses path traversal for reads and appends', async (t) => {
  const { store, ballot } = fixture(t);
  const input = await vote(ballot);
  for (const id of ['../outside', 'FB-a', 'FB-A\n', 'FB-A\r', '', null]) {
    const invalid = { ...ballot, manifest: { ...ballot.manifest, ballotId: id } };
    assert.throws(() => store.read(invalid), /Invalid ballot id/);
    assert.throws(() => store.append(invalid, input), /Invalid ballot id/);
  }
});

test('20 votes per wallet per ballot persist across restarts; duplicates stay idempotent', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  const first = await vote(ballot);
  for (let i = 0; i < MAX_WALLET_VOTES; i += 1) store.append(ballot, await vote(ballot, 'yes', 2000 + i));
  const bytes = fs.readFileSync(file);
  for (const instance of [store, createVoteStore({ dataDir })]) {
    assert.equal(instance.append(ballot, first).duplicate, true);
    assert.throws(() => instance.append(ballot, { ...first, issuedAt: 2020 }),
      { code: 'FORUM_WALLET_LIMIT', message: 'Wallet vote limit reached' });
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  assert.equal(store.append(ballot, await vote(ballot, 'yes', 2000, otherWallet)).duplicate, false);
  const other = { ...ballot, manifest: { ...ballot.manifest, ballotId: 'FB-OTHER' } };
  other.manifestHash = manifestHash(other.manifest);
  assert.equal(store.append(other, await vote(other)).record.receiptOrder, 1);
});

test('100000-record cap rejects new votes but still returns duplicates', async (t) => {
  const { dataDir, store, ballot, file } = fixture(t);
  const input = await vote(ballot);
  const first = store.append(ballot, input).record;
  const lines = Array.from({ length: MAX_RECORDS - 1 }, (_, i) => JSON.stringify({ ...first,
    receiptOrder: i + 2, wallet: getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`) }));
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
  const size = fs.statSync(file).size;
  const restarted = createVoteStore({ dataDir });
  restarted.check(ballot);
  assert.deepEqual(restarted.append(ballot, input), { record: first, duplicate: true });
  assert.throws(() => restarted.append(ballot, { ...input, choice: 'no' }),
    { code: 'FORUM_RECORD_LIMIT', message: 'Ballot record limit reached' });
  assert.equal(fs.statSync(file).size, size);
});
