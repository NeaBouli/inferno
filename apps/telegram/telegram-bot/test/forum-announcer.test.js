const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Wallet } = require('ethers');
const { loadBallot, voteTypedData } = require('../src/forum/ballot');
const { createVoteStore } = require('../src/forum/store');
const { tallyBallot } = require('../src/forum/tally');
const { createForumAnnouncer } = require('../src/forum/announcer');
const topicRouter = require('../src/services/topicRouter');

const ballotId = 'FB-TEST-0001';
const fixtureDir = path.resolve(__dirname, 'fixtures/forum-ballots');
// Public Hardhat test key, never connected to a provider.
const wallet = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

function fixture(t, { title, extraEnv } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-forum-announcer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ballotsDir = path.join(root, 'ballots');
  const resultsDir = path.join(root, 'forum-results');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(ballotsDir);
  fs.mkdirSync(resultsDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, `${ballotId}.json`), 'utf8'));
  manifest.window = { opensAt: 1000, closesAt: 1000 + 19 * 3600 };
  if (title !== undefined) manifest.proposal.title = title;
  const manifestFile = path.join(ballotsDir, `${ballotId}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.copyFileSync(path.join(fixtureDir, `${ballotId}.md`), path.join(ballotsDir, `${ballotId}.md`));
  const ballot = loadBallot(ballotsDir, ballotId);
  let now = 999;
  const messages = [];
  const routes = [];
  const logs = [];
  const telegram = { async sendMessage(...args) {
    messages.push(args);
    return { message_id: messages.length };
  } };
  const send = topicRouter.sendToGroup;
  t.mock.method(topicRouter, 'sendToGroup', (...args) => {
    routes.push(args);
    return send(...args);
  });
  const scheduled = new Map();
  const timer = {
    setInterval(callback, milliseconds) {
      const token = {};
      scheduled.set(token, { callback, milliseconds });
      return token;
    },
    clearInterval(token) { scheduled.delete(token); },
  };
  const options = { telegram, ballotsDir, resultsDir, dataDir,
    env: { FORUM_ENABLED: '1', TELEGRAM_GROUP_ID: '-100123', ...extraEnv },
    clock: () => now, timer,
    logger: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } };
  function create() {
    const announcer = createForumAnnouncer(options);
    t.after(() => announcer.stop());
    return announcer;
  }
  const store = createVoteStore({ dataDir, clock: () => now });
  async function append(choice = 'yes') {
    const issuedAt = now;
    const { domain, types, value } = voteTypedData(ballot, choice, issuedAt);
    return store.append(ballot, { wallet: wallet.address, choice, issuedAt,
      signature: await wallet.signTypedData(domain, types, value) }).record;
  }
  const resultFile = path.join(resultsDir, `${ballotId}.json`);
  async function publishResult(overrides = {}) {
    const result = await tallyBallot({ ballot, votes: store.read(ballot).records, reader: {
      chainId: async () => BigInt(manifest.chainId),
      blockHash: async () => manifest.snapshot.blockHash,
      totalLocked: async () => 100000000000000000000000000000000n,
      lockedBalance: async () => 1234567890123456789000000001n,
    } });
    fs.writeFileSync(resultFile, JSON.stringify({ ...result, ...overrides }));
    return result;
  }
  return { options, ballot, manifest, manifestFile, dataDir, resultFile, messages, routes,
    scheduled, logs, store, append, publishResult, create,
    setNow: (value) => { now = value; },
    journalFile: path.join(dataDir, 'announcements.json') };
}

test('open, each checkpoint, close and reviewed result are sent once across restarts', async (t) => {
  const f = fixture(t);
  let announcer = f.create();
  await announcer.start();
  assert.equal(f.messages.length, 0);
  assert.equal(fs.existsSync(f.dataDir), false);
  assert.equal([...f.scheduled.values()][0].milliseconds, 60000);
  const { opensAt, closesAt } = f.manifest.window;
  f.setNow(opensAt);
  await [...f.scheduled.values()][0].callback();
  assert.equal(f.messages.length, 1);
  const open = f.messages[0][1];
  for (const expected of [f.manifest.proposal.title, ballotId,
    `https://ifrunit.tech/wiki/forum-ballot.html?ballot=${ballotId}`,
    f.manifest.proposal.textHash, 'Snapshot height: 0', '1970-01-01 19:16:40 UTC',
    'advisory; the Council decides']) assert.ok(open.includes(expected), expected);
  await f.append();
  announcer.stop();
  assert.equal(f.scheduled.size, 0);
  announcer = f.create();
  await announcer.start();
  assert.equal(f.messages.length, 1);
  for (const hours of [6, 12, 18]) {
    f.setNow(opensAt + hours * 3600);
    await announcer.poll();
    await announcer.poll();
    announcer.stop();
    announcer = f.create();
    await announcer.start();
  }
  assert.equal(f.messages.length, 4);
  f.setNow(closesAt);
  await announcer.poll();
  const head = f.store.read(f.ballot).head;
  assert.match(f.messages[4][1], /Final count: 1/);
  assert.ok(f.messages[4][1].includes(`Final chain head: ${head}\ntally follows`));
  const result = await f.publishResult();
  announcer.stop();
  announcer = f.create();
  await announcer.start();
  await announcer.poll();
  assert.equal(f.messages.length, 6);
  const text = f.messages[5][1];
  for (const expected of ['Outcome: failed', 'Yes: 1234567890123456789.000000001 IFR',
    'No: 0.000000000 IFR', 'Abstain: 0.000000000 IFR',
    'Quorum passed: false', 'Threshold passed: true', result.voteSetHash, 'advisory']) {
    assert.ok(text.includes(expected), expected);
  }
  announcer.stop();
  await f.create().start();
  assert.equal(f.messages.length, 6);
  assert.ok(f.routes.every(([telegram, group, category, , ...extra]) =>
    telegram === f.options.telegram && group === '-100123' && category === 'vote' && extra.length === 0));
  assert.ok(f.messages.every(([, , options]) => options.message_thread_id === 23 && !Object.hasOwn(options, 'parse_mode')));
  const journal = JSON.parse(fs.readFileSync(f.journalFile, 'utf8'));
  assert.equal(Object.keys(journal.events).length, 6);
  assert.ok(Object.values(journal.events).every((status) => status === 'sent'));
  assert.equal(fs.statSync(f.journalFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.dataDir).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(f.dataDir).filter((file) => file.endsWith('.tmp')), []);
});

test('checkpoint cadence is anchored to opening, honors configuration, and stops at close', async (t) => {
  const f = fixture(t, { extraEnv: { FORUM_CHECKPOINT_HOURS: '2' } });
  const announcer = f.create();
  const { opensAt, closesAt } = f.manifest.window;
  f.setNow(opensAt);
  await announcer.poll();
  f.setNow(opensAt + 2 * 3600 - 1);
  await announcer.poll();
  assert.equal(f.messages.length, 1);
  await f.append();
  f.setNow(opensAt + 2 * 3600);
  await announcer.poll();
  assert.equal(f.messages.length, 2);
  assert.ok(f.messages[1][1].includes(`Count: 1\nChain head: ${f.store.read(f.ballot).head}`));
  f.setNow(opensAt + 4 * 3600);
  await f.append('no');
  await announcer.poll();
  assert.equal(f.messages.length, 3);
  assert.ok(f.messages[2][1].includes(`Count: 2\nChain head: ${f.store.read(f.ballot).head}`));
  f.setNow(closesAt);
  await announcer.poll();
  f.setNow(closesAt + 12 * 3600);
  await announcer.poll();
  assert.equal(f.messages.length, 4);
  assert.equal(f.messages.filter(([, text]) => text.startsWith('Forum ballot checkpoint')).length, 2);
});

test('a result must match manifestHash and chainHead and is never posted before close', async (t) => {
  const f = fixture(t);
  const announcer = f.create();
  f.setNow(f.manifest.window.opensAt);
  await f.append();
  await f.publishResult();
  await announcer.poll();
  assert.equal(f.messages.length, 1);
  f.setNow(f.manifest.window.closesAt);
  for (const overrides of [{ chainHead: `0x${'11'.repeat(32)}` },
    { manifestHash: `0x${'22'.repeat(32)}` }, { schema: 'wrong' }, { ballotId: 'FB-OTHER' }]) {
    await f.publishResult(overrides);
    await announcer.poll();
    assert.equal(f.messages.length, 2);
  }
  await f.publishResult();
  await announcer.poll();
  assert.equal(f.messages.length, 3);
  assert.match(f.messages[2][1], /^Forum ballot result/);
});

test('titles are limited to 120 Unicode characters and messages have no parse mode', async (t) => {
  const title = '[x](https://example.invalid)\n*<b>' + '🔥'.repeat(140);
  const f = fixture(t, { title });
  f.setNow(f.manifest.window.opensAt);
  await f.create().poll();
  const [, text, options] = f.messages[0];
  const displayed = text.split('\n')[1];
  assert.equal(Array.from(displayed).length, 120);
  assert.equal(displayed, Array.from(title.replace('\n', ' ')).slice(0, 120).join(''));
  assert.equal(Object.hasOwn(options, 'parse_mode'), false);
  assert.equal(text.includes('\uFFFD'), false);
});

for (const value of [undefined, '0', 'true', ' 1 ']) {
  test(`announcer is inert when FORUM_ENABLED=${String(value)}`, async (t) => {
    const f = fixture(t, { extraEnv: { FORUM_ENABLED: value } });
    f.setNow(f.manifest.window.closesAt);
    const announcer = f.create();
    await announcer.start();
    await announcer.poll();
    assert.equal(f.messages.length, 0);
    assert.equal(f.scheduled.size, 0);
    assert.equal(fs.existsSync(f.dataDir), false);
  });
}

test('only allowed chains and valid bundled manifests are announced', async (t) => {
  const f = fixture(t, { extraEnv: { FORUM_ALLOWED_CHAIN_IDS: '1,31337' } });
  f.setNow(f.manifest.window.opensAt);
  await f.create().poll();
  assert.equal(f.messages.length, 0);
  assert.equal(fs.existsSync(f.dataDir), false);
  f.options.env.FORUM_ALLOWED_CHAIN_IDS = '1, 11155111';
  await f.create().poll();
  assert.equal(f.messages.length, 1);
});

test('an empty chain closes with the manifest hash and missed checkpoints are not backfilled', async (t) => {
  const f = fixture(t);
  f.setNow(f.manifest.window.closesAt);
  await f.create().poll();
  assert.equal(f.messages.length, 1);
  assert.ok(f.messages[0][1].includes(`Final count: 0\nFinal chain head: ${f.ballot.manifestHash}`));
});

test('overlapping polls and duplicate starts cannot duplicate sends or timers', async (t) => {
  const f = fixture(t);
  f.setNow(f.manifest.window.opensAt);
  let release;
  const original = f.options.telegram.sendMessage;
  f.options.telegram.sendMessage = async (...args) => {
    await new Promise((resolve) => { release = resolve; });
    return original(...args);
  };
  const announcer = f.create();
  const first = announcer.start();
  announcer.start();
  const second = announcer.poll();
  assert.equal(f.scheduled.size, 1);
  assert.equal(first, second);
  const reserved = JSON.parse(fs.readFileSync(f.journalFile, 'utf8'));
  assert.deepEqual(Object.values(reserved.events), ['pending']);
  release();
  await Promise.all([first, second]);
  assert.equal(f.messages.length, 1);
});

test('ambiguous delivery stays reserved across restart and never exposes transport errors', async (t) => {
  const f = fixture(t);
  f.setNow(f.manifest.window.opensAt);
  let attempts = 0;
  f.options.telegram.sendMessage = async () => {
    attempts += 1;
    throw new Error('token-bearing-url-must-never-be-logged');
  };
  await f.create().poll();
  await f.create().poll();
  assert.equal(attempts, 1);
  assert.deepEqual(Object.values(JSON.parse(fs.readFileSync(f.journalFile)).events), ['pending']);
  assert.equal(JSON.stringify(f.logs).includes('token-bearing'), false);
});

test('corrupted journals and chains fail closed before sending', async (t) => {
  const f = fixture(t);
  f.setNow(f.manifest.window.opensAt);
  fs.mkdirSync(f.dataDir);
  fs.writeFileSync(f.journalFile, '{');
  await f.create().poll();
  assert.equal(f.messages.length, 0);
  fs.unlinkSync(f.journalFile);
  await f.append();
  const file = path.join(f.dataDir, `${ballotId}.jsonl`);
  const record = f.store.read(f.ballot).records[0];
  fs.writeFileSync(file, `${JSON.stringify({ ...record, prevHash: `0x${'00'.repeat(32)}` })}\n`);
  await f.create().poll();
  assert.equal(f.messages.length, 0);
  assert.equal(fs.existsSync(f.journalFile), false);
});

test('atomic journal failure prevents send and cleans up temporary files', async (t) => {
  const f = fixture(t);
  f.setNow(f.manifest.window.opensAt);
  t.mock.method(fs, 'renameSync', () => { throw new Error('rename failed'); });
  await f.create().poll();
  assert.equal(f.messages.length, 0);
  assert.deepEqual(fs.readdirSync(f.dataDir), []);
});

test('invalid data paths, journal symlinks and checkpoint intervals fail closed', async (t) => {
  const f = fixture(t);
  f.setNow(f.manifest.window.opensAt);
  for (const options of [{ dataDir: 'relative' },
    { env: { ...f.options.env, FORUM_CHECKPOINT_HOURS: '0' } },
    { env: { ...f.options.env, FORUM_CHECKPOINT_HOURS: 'nonsense' } },
    { env: { ...f.options.env, TELEGRAM_GROUP_ID: '' } }]) {
    await createForumAnnouncer({ ...f.options, ...options }).poll();
  }
  assert.equal(f.messages.length, 0);
  assert.equal(fs.existsSync(f.dataDir), false);
  fs.mkdirSync(f.dataDir);
  const target = path.join(f.options.resultsDir, 'untouched');
  fs.writeFileSync(target, 'untouched');
  fs.symlinkSync(target, f.journalFile);
  await f.create().poll();
  assert.equal(f.messages.length, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
});

test('index starts and imports the forum announcer only with FORUM_ENABLED exactly 1', () => {
  for (const enabled of [undefined, '0', 'true', '1']) {
    const callbacks = [];
    const started = [];
    let imports = 0;
    const noop = () => Promise.resolve();
    const stub = new Proxy(noop, { get: () => noop });
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8'), {
      require(name) {
        if (name === 'dotenv') return { config() {} };
        if (name === 'telegraf') return { Telegraf: function () { return stub; } };
        if (name === 'express') return Object.assign(() => stub, { json: noop });
        if (name === './forum/routes') return { createForumRouter: noop };
        if (name === './forum/announcer') {
          imports += 1;
          return { startForumAnnouncer: (bot) => started.push(bot) };
        }
        return stub;
      },
      process: { env: { BOT_TOKEN: 'fixture-token', FORUM_ENABLED: enabled }, once() {} },
      setTimeout: (callback) => callbacks.push(callback),
    });
    callbacks.shift()();
    callbacks.shift()();
    assert.equal(imports, enabled === '1' ? 1 : 0);
    assert.deepEqual(started, enabled === '1' ? [stub] : []);
  }
});
