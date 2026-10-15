const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Duplex } = require('node:stream');
const test = require('node:test');
const vm = require('node:vm');
const express = require('express');
const { Wallet, Signature, TypedDataEncoder } = require('ethers');
const { loadBallot, voteTypedData } = require('../src/forum/ballot');
const { createForumRouter, MAX_RATE_LIMIT_KEYS } = require('../src/forum/routes');

// Public Hardhat test key, with no provider. All HTTP below uses streams in memory.
const wallet = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const ballotId = 'FB-TEST-0001';
const baseUrl = `/api/forum/ballots/${ballotId}`;
const exampleDir = path.resolve(__dirname, 'fixtures/forum-ballots');

function fixture(t, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-forum-routes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ballotsDir = path.join(root, 'ballots');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(ballotsDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(exampleDir, `${ballotId}.json`), 'utf8'));
  manifest.window = { opensAt: 1000, closesAt: 10000 };
  const manifestFile = path.join(ballotsDir, `${ballotId}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.copyFileSync(path.join(exampleDir, `${ballotId}.md`), path.join(ballotsDir, `${ballotId}.md`));
  let now = 2000;
  const options = { env: { FORUM_ENABLED: '1', ...extraEnv }, ballotsDir, dataDir, clock: () => now };
  const app = express();
  app.use('/api/forum', createForumRouter(options));
  // Match index.js: the forum parser must run before this general-purpose parser.
  app.use(express.json());
  return { app, options, manifest, manifestFile, dataDir,
    ballot: loadBallot(ballotsDir, ballotId), setNow: (value) => { now = value; } };
}

function request(app, { method = 'GET', url = baseUrl, body, rawBody, headers = {}, ip = '192.0.2.1' } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
    });
    socket.remoteAddress = ip;
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.complete = true; // The full request is already available; no TCP parser follows.
    const bytes = Buffer.from(rawBody ?? (body === undefined ? '' : JSON.stringify(body)));
    req.headers = { host: 'forum.test', 'content-type': 'application/json',
      'content-length': String(bytes.length), ...headers };
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    res.on('error', reject);
    res.on('finish', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const payload = raw.slice(raw.indexOf('\r\n\r\n') + 4);
      let json;
      try { json = JSON.parse(payload); } catch { json = null; }
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.getHeaders(), json, payload });
    });
    app.handle(req, res);
    req.push(bytes);
    req.push(null);
  });
}

async function vote(ballot, choice = 'yes', issuedAt = 2000) {
  const { domain, types, value } = voteTypedData(ballot, choice, issuedAt);
  return { wallet: wallet.address, choice, issuedAt,
    signature: await wallet.signTypedData(domain, types, value) };
}

// Evaluate the real composition root without starting Telegram, timers, providers
// or a listening socket. Only the forum module and Express execute real handlers.
function indexApp(options) {
  let app;
  let forumImports = 0;
  const noop = () => {};
  const stub = new Proxy(noop, { get: () => noop });
  const pass = (_req, _res, next) => next();
  function expressFactory() {
    app = express();
    app.listen = noop;
    return app;
  }
  Object.assign(expressFactory, express);
  const env = { BOT_TOKEN: 'fixture-token', CLAUDE_API_KEY: 'fixture',
    IFR_LOCK_ADDRESS: 'fixture', ...options.env };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8'), {
    require(name) {
      if (name === 'express') return expressFactory;
      if (name === 'ethers') return require('ethers');
      if (name === 'dotenv') return { config: noop };
      if (name === 'telegraf') return { Telegraf: function Telegraf() { return stub; } };
      if (name === './middleware/verifyCors') return require('../src/middleware/verifyCors');
      if (name === './middleware/apiRateLimit') return () => pass;
      if (name === './forum/routes') {
        forumImports += 1;
        return { createForumRouter: () => createForumRouter(options) };
      }
      return stub;
    },
    process: { env, once: noop, exit: () => { throw new Error('Unexpected process exit'); } },
    setTimeout: noop,
  }, { filename: 'src/index.js' });
  return { app, forumImports };
}

test('GET manifest exposes the complete manifest, canonical hash and exact proposal text', async (t) => {
  const { app, ballot } = fixture(t);
  const res = await request(app);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, ballot);
  const votes = await request(app, { url: `${baseUrl}/votes` });
  assert.equal(votes.status, 200);
  assert.deepEqual(votes.json, { records: [], next: null });
});

test('POST creates a receipt, duplicates return the same receipt and GET publishes every vote', async (t) => {
  const { app, ballot, dataDir, setNow } = fixture(t);
  const body = await vote(ballot);
  const first = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body,
    headers: { 'user-agent': 'must-not-persist', 'x-private-header': 'must-not-persist' } });
  assert.equal(first.status, 201);
  const { domain, types, value } = voteTypedData(ballot, body.choice, body.issuedAt);
  assert.deepEqual(first.json, { receiptOrder: 1, receivedAt: 2000, ...body,
    ballotId, chainId: ballot.manifest.chainId, manifestHash: ballot.manifestHash,
    digest: TypedDataEncoder.hash(domain, types, value) });
  setNow(2001);
  const duplicate = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.json, first.json);
  const secondBody = await vote(ballot, 'no');
  const second = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body: secondBody });
  assert.equal(second.status, 201);
  assert.equal(second.json.receiptOrder, 2);
  assert.equal(second.json.receivedAt, 2001);
  const all = await request(app, { url: `${baseUrl}/votes` });
  assert.deepEqual(all.json, { records: [first.json, second.json], next: 2 });
  const persisted = fs.readFileSync(path.join(dataDir, `${ballotId}.jsonl`), 'utf8');
  assert.equal(persisted, [first.json, second.json].map((r) => `${JSON.stringify(r)}\n`).join(''));
  assert.doesNotMatch(persisted, /must-not-persist|192\.0\.2\.1|headers|user-agent/);
});

for (const enabled of [undefined, '0', 'true', ' 1 ']) {
  test(`real index leaves every forum endpoint unmounted when FORUM_ENABLED=${String(enabled)}`, async (t) => {
    const { options, dataDir } = fixture(t);
    delete options.env.FORUM_ENABLED;
    if (enabled !== undefined) options.env.FORUM_ENABLED = enabled;
    const { app, forumImports } = indexApp(options);
    assert.equal(forumImports, 0, 'disabled mode does not even import the forum router');
    for (const [method, url] of [['GET', baseUrl], ['GET', `${baseUrl}/votes`], ['POST', `${baseUrl}/votes`]]) {
      assert.equal((await request(app, { method, url, body: method === 'POST' ? {} : undefined })).status, 404);
    }
    assert.equal(fs.existsSync(dataDir), false);
  });
}

test('router factory also stays inert unless explicitly enabled', async (t) => {
  const { options, dataDir } = fixture(t);
  const app = express();
  app.use('/api/forum', createForumRouter({ ...options, env: {} }));
  assert.equal((await request(app)).status, 404);
  assert.equal(fs.existsSync(dataDir), false);
});

test('real index mounts enabled forum routes before its larger JSON parser', async (t) => {
  const { options, ballot } = fixture(t);
  const { app, forumImports } = indexApp(options);
  assert.equal(forumImports, 1);
  assert.equal((await request(app)).status, 200);
  const body = await vote(ballot);
  const accepted = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body });
  assert.equal(accepted.status, 201);
  const oversized = await request(app, { method: 'POST', url: `${baseUrl}/votes`,
    rawBody: JSON.stringify(body).padEnd(2049, ' ') });
  assert.equal(oversized.status, 400);
  assert.deepEqual(oversized.json, { error: 'Body too large' });
});

test('real index applies the existing exact-origin CORS policy to forum responses', async (t) => {
  const { options } = fixture(t);
  const { app } = indexApp(options);
  const allowed = await request(app, { headers: { origin: 'https://ifrunit.tech' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://ifrunit.tech');
  const denied = await request(app, { headers: { origin: 'https://ifrunit.tech.attacker.test' } });
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  const preflight = await request(app, { method: 'OPTIONS', url: `${baseUrl}/votes`,
    headers: { origin: 'https://ifrunit.tech', 'access-control-request-method': 'POST' } });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://ifrunit.tech');
});

test('default chain allowlist refuses other chains on all three endpoints', async (t) => {
  const { app, manifest, manifestFile, dataDir } = fixture(t);
  manifest.chainId = 31337;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  for (const [method, url] of [['GET', baseUrl], ['GET', `${baseUrl}/votes`], ['POST', `${baseUrl}/votes`]]) {
    const res = await request(app, { method, url, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: 'Chain not allowed' });
  }
  assert.equal(fs.existsSync(dataDir), false);
});

test('explicit comma-separated chain allowlist and empty allowlist are honored', async (t) => {
  const allowed = fixture(t, { FORUM_ALLOWED_CHAIN_IDS: '31337, 11155111' });
  assert.equal((await request(allowed.app)).status, 200);
  const denied = fixture(t, { FORUM_ALLOWED_CHAIN_IDS: '' });
  assert.deepEqual((await request(denied.app)).json, { error: 'Chain not allowed' });
  const invalid = fixture(t, { FORUM_ALLOWED_CHAIN_IDS: '11155111junk,1.1155111e7,*' });
  assert.deepEqual((await request(invalid.app)).json, { error: 'Chain not allowed' });
});

test('invalid ballot IDs, manifests and changed proposal text are rejected without path disclosure', async (t) => {
  const { app, options } = fixture(t);
  for (const url of ['/api/forum/ballots/FB-NO-SUCH-BALLOT', '/api/forum/ballots/FB-lower',
    '/api/forum/ballots/FB-..%2Foutside']) {
    const res = await request(app, { url });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: 'Invalid ballot' });
  }
  fs.appendFileSync(path.join(options.ballotsDir, `${ballotId}.md`), '\nchanged');
  assert.deepEqual((await request(app)).json, { error: 'Invalid ballot' });
});

const badVotes = [
  [{ choice: 'maybe' }, 'Unknown choice'], [{ issuedAt: '2000' }, 'Invalid issuedAt'],
  [{ issuedAt: 999 }, 'issuedAt outside window'], [{ issuedAt: 10000 }, 'issuedAt outside window'],
  [{ issuedAt: 2301 }, 'issuedAt too far in future'], [{ wallet: 'bad' }, 'Invalid wallet'],
  [{ wallet: '0x0000000000000000000000000000000000000001' }, 'Signer mismatch'],
  [{ signature: '0x1234' }, 'Invalid signature'],
];
for (const [changes, reason] of badVotes) {
  test(`POST rejects ${JSON.stringify(changes)} with a short 400 reason`, async (t) => {
    const { app, ballot, dataDir } = fixture(t);
    const body = { ...await vote(ballot), ...changes };
    const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: reason });
    assert.equal(fs.existsSync(dataDir), false);
  });
}

test('POST refuses early and closed ballots, including replay of an accepted signature after close', async (t) => {
  const { app, ballot, setNow } = fixture(t);
  const body = await vote(ballot);
  setNow(999);
  assert.deepEqual((await request(app, { method: 'POST', url: `${baseUrl}/votes`, body })).json,
    { error: 'Ballot not open' });
  setNow(2000);
  assert.equal((await request(app, { method: 'POST', url: `${baseUrl}/votes`, body })).status, 201);
  setNow(10000);
  const closed = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body });
  assert.equal(closed.status, 400);
  assert.deepEqual(closed.json, { error: 'Ballot not open' });
  assert.equal((await request(app, { url: `${baseUrl}/votes` })).json.records.length, 1);
});

test('POST requires exactly the four vote fields and valid JSON', async (t) => {
  const { app, ballot, dataDir } = fixture(t);
  const valid = await vote(ballot);
  for (const body of [{}, [], null, { ...valid, headers: {} },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'wallet'))]) {
    const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body });
    assert.equal(res.status, 400);
    assert.equal(typeof res.json.error, 'string');
  }
  const malformed = await request(app, { method: 'POST', url: `${baseUrl}/votes`, rawBody: '{' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.json, { error: 'Invalid JSON' });
  const wrongType = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body: valid,
    headers: { 'content-type': 'text/plain' } });
  assert.equal(wrongType.status, 400);
  assert.equal(fs.existsSync(dataDir), false);
});

test('2 kB JSON limit accepts 2048 bytes, rejects 2049 and counts UTF-8 bytes', async (t) => {
  const { app, ballot } = fixture(t);
  const body = JSON.stringify(await vote(ballot));
  const atLimit = await request(app, { method: 'POST', url: `${baseUrl}/votes`, rawBody: body.padEnd(2048, ' ') });
  assert.equal(atLimit.status, 201);
  for (const rawBody of [body.padEnd(2049, ' '), JSON.stringify({ title: 'Δ'.repeat(1100) })]) {
    const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`, rawBody });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: 'Body too large' });
  }
});

test('IP budget allows 20 requests/minute, ignores spoofed forwarding headers and resets', async (t) => {
  const { app, setNow } = fixture(t);
  for (let index = 0; index < 20; index += 1) {
    const res = await request(app, { headers: { 'x-forwarded-for': `198.51.100.${index}` } });
    assert.equal(res.status, 200);
  }
  const blocked = await request(app, { headers: { 'x-forwarded-for': '203.0.113.1' } });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json, { error: 'IP rate limit exceeded' });
  assert.equal(blocked.headers['retry-after'], '60');
  assert.equal((await request(app, { ip: '192.0.2.2' })).status, 200);
  setNow(2060);
  assert.equal((await request(app)).status, 200);
});

test('trusted proxy resolution gives each forwarded client its own IP budget', async (t) => {
  const { app } = fixture(t);
  app.set('trust proxy', 'loopback');
  const fromA = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.10' } };
  for (let index = 0; index < 20; index += 1) assert.equal((await request(app, fromA)).status, 200);
  assert.deepEqual((await request(app, fromA)).json, { error: 'IP rate limit exceeded' });
  assert.equal((await request(app, { ip: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.11' } })).status, 200);
});

test('wallet budget allows 10 verified votes/minute across IPs and address casing', async (t) => {
  const { app, ballot, setNow } = fixture(t);
  const body = await vote(ballot);
  for (let index = 0; index < 10; index += 1) {
    const address = index % 2 ? wallet.address.toLowerCase() : wallet.address;
    const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`,
      ip: `192.0.2.${index + 1}`, body: { ...body, wallet: address } });
    assert.equal(res.status, index === 0 ? 201 : 200);
  }
  const blocked = await request(app, { method: 'POST', url: `${baseUrl}/votes`, ip: '192.0.2.20', body });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json, { error: 'Wallet rate limit exceeded' });
  assert.equal(blocked.headers['retry-after'], '60');
  setNow(2060);
  assert.equal((await request(app, { method: 'POST', url: `${baseUrl}/votes`, body })).status, 200);
});

test('concurrent duplicate submissions produce one append and one receipt order', async (t) => {
  const { app, ballot } = fixture(t);
  const body = await vote(ballot);
  const results = await Promise.all(Array.from({ length: 6 }, () => request(app,
    { method: 'POST', url: `${baseUrl}/votes`, body })));
  assert.equal(results.filter((res) => res.status === 201).length, 1);
  assert.equal(results.filter((res) => res.status === 200).length, 5);
  assert.ok(results.every((res) => res.json.receiptOrder === 1));
  assert.equal((await request(app, { url: `${baseUrl}/votes` })).json.records.length, 1);
});

test('storage failure returns a short server error without exposing local paths', async (t) => {
  const { app, ballot, dataDir } = fixture(t);
  fs.writeFileSync(dataDir, 'a file cannot be a data directory');
  const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body: await vote(ballot) });
  assert.equal(res.status, 500);
  assert.deepEqual(res.json, { error: 'Vote store unavailable' });
  const read = await request(app, { url: `${baseUrl}/votes` });
  assert.equal(read.status, 500);
  assert.deepEqual(read.json, { error: 'Vote store unavailable' });
});

test('enabled collector without an absolute FORUM_DATA_DIR refuses to store votes (503)', async (t) => {
  const { options } = fixture(t);
  const appDir = path.resolve(__dirname, '..');
  for (const dataDir of [undefined, 'relative/path', appDir, path.join(appDir, 'data')]) {
    const app = express();
    app.use('/api/forum', createForumRouter({ ...options, dataDir }));
    const res = await request(app, { url: baseUrl });
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: 'Forum vote storage not configured' });
  }
});

test('POST canonicalizes both recovery parities and deduplicates alternate encodings', async (t) => {
  const { app, ballot } = fixture(t);
  const parities = new Set();
  let stored = 0;
  for (let issuedAt = 2000; issuedAt < 2020 && parities.size < 2; issuedAt += 1) {
    const body = await vote(ballot, 'yes', issuedAt);
    const sig = Signature.from(body.signature);
    if (parities.has(sig.yParity)) continue;
    parities.add(sig.yParity);
    const first = await request(app, { method: 'POST', url: `${baseUrl}/votes`,
      body: { ...body, signature: `${body.signature.slice(0, -2)}0${sig.yParity}` } });
    stored += 1;
    assert.equal(first.status, 201);
    assert.equal(first.json.signature, sig.serialized);
    const duplicate = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body });
    assert.equal(duplicate.status, 200);
    assert.deepEqual(duplicate.json, first.json);
  }
  assert.deepEqual([...parities].sort(), [0, 1]);
  assert.equal((await request(app, { url: `${baseUrl}/votes` })).json.records.length, stored);
});

test('GET votes pages in receipt order and returns an empty terminal cursor', async (t) => {
  const { app, ballot } = fixture(t);
  const records = [];
  for (const choice of ['yes', 'no', 'abstain']) {
    const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body: await vote(ballot, choice) });
    assert.equal(res.status, 201);
    records.push(res.json);
  }
  const first = await request(app, { url: `${baseUrl}/votes?limit=2` });
  assert.deepEqual(first.json, { records: records.slice(0, 2), next: 2 });
  const second = await request(app, { url: `${baseUrl}/votes?after=${first.json.next}&limit=1` });
  assert.deepEqual(second.json, { records: records.slice(2), next: 3 });
  const empty = await request(app, { url: `${baseUrl}/votes?after=${second.json.next}` });
  assert.deepEqual(empty.json, { records: [], next: null });
  assert.deepEqual((await request(app, { url: `${baseUrl}/votes?limit=1000` })).json,
    { records, next: 3 });
});

test('GET votes rejects invalid or repeated pagination parameters', async (t) => {
  const { app } = fixture(t);
  const queries = ['after=-1', 'after=1.5', 'after=9007199254740992', 'after=no',
    'after=', 'after=1&after=2', 'limit=0', 'limit=1001', 'limit=-1', 'limit=1.5',
    'limit=no', 'limit=', 'limit=1&limit=2', 'limit=%5B1%5D'];
  for (const query of queries) {
    const res = await request(app, { url: `${baseUrl}/votes?${query}` });
    assert.equal(res.status, 400, query);
    assert.deepEqual(res.json, { error: 'Invalid pagination' });
  }
});

test('manifest changes return 503 on all endpoints, with and without a process restart', async (t) => {
  const { app, options, manifest, manifestFile, ballot, dataDir } = fixture(t);
  assert.equal((await request(app, { method: 'POST', url: `${baseUrl}/votes`, body: await vote(ballot) })).status, 201);
  const file = path.join(dataDir, `${ballotId}.jsonl`);
  const original = fs.readFileSync(file);
  manifest.proposal.title += ' changed';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const restarted = express();
  restarted.use('/api/forum', createForumRouter(options));
  for (const instance of [app, restarted]) {
    for (const [method, url] of [['GET', baseUrl], ['GET', `${baseUrl}/votes`], ['POST', `${baseUrl}/votes`]]) {
      const res = await request(instance, { method, url, body: method === 'POST' ? await vote(ballot) : undefined });
      assert.equal(res.status, 503);
      assert.deepEqual(res.json, { error: 'Ballot manifest changed' });
    }
  }
  assert.deepEqual(fs.readFileSync(file), original);
});

test('foreign-owned directory returns 503 without chmod on GET and POST', async (t) => {
  const { app, ballot, dataDir } = fixture(t);
  const input = await vote(ballot);
  fs.mkdirSync(dataDir);
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (name, ...args) => {
    const info = stat(name, ...args);
    if (name === dataDir) Object.defineProperty(info, 'uid', { value: process.getuid() + 1 });
    return info;
  });
  t.mock.method(fs, 'chmodSync', () => assert.fail('foreign directory must never be chmodded'));
  for (const [method, url] of [['GET', baseUrl], ['GET', `${baseUrl}/votes`], ['POST', `${baseUrl}/votes`]]) {
    const res = await request(app, { method, url, body: method === 'POST' ? input : undefined });
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: 'Forum vote storage not configured' });
  }
});

test('JSONL symlinks return 503 without modifying the target', async (t) => {
  const { app, ballot, dataDir, options } = fixture(t);
  fs.mkdirSync(dataDir);
  const target = path.join(options.ballotsDir, 'symlink-target');
  fs.writeFileSync(target, 'untouched');
  fs.symlinkSync(target, path.join(dataDir, `${ballotId}.jsonl`));
  for (const method of ['GET', 'POST']) {
    const res = await request(app, { method, url: `${baseUrl}/votes`, body: method === 'POST' ? await vote(ballot) : undefined });
    assert.equal(res.status, 503);
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
});

test('POST never returns 201 when file fsync fails', async (t) => {
  const { app, ballot } = fixture(t);
  await request(app); // Hydrate before injecting an append failure.
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('fixture fsync failure'); });
  const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body: await vote(ballot) });
  assert.equal(res.status, 500);
  assert.deepEqual(res.json, { error: 'Vote store unavailable' });
  assert.equal((await request(app, { url: `${baseUrl}/votes` })).status, 500);
});

test('21st distinct wallet vote returns 429 across minute windows and restart; duplicate stays 200', async (t) => {
  const { app, options, ballot, setNow, dataDir } = fixture(t);
  for (let i = 0; i < 20; i += 1) {
    setNow(2000 + i * 60);
    const res = await request(app, { method: 'POST', url: `${baseUrl}/votes`, body: await vote(ballot, 'yes', 2000 + i) });
    assert.equal(res.status, 201);
  }
  const file = path.join(dataDir, `${ballotId}.jsonl`);
  const original = fs.readFileSync(file);
  setNow(4000);
  const restarted = express();
  restarted.use('/api/forum', createForumRouter(options));
  for (const instance of [app, restarted]) {
    const blocked = await request(instance, { method: 'POST', url: `${baseUrl}/votes`, body: await vote(ballot, 'no', 2020) });
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.json, { error: 'Wallet vote limit reached' });
    const duplicate = await request(instance, { method: 'POST', url: `${baseUrl}/votes`, body: await vote(ballot) });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json.receiptOrder, 1);
  }
  assert.deepEqual(fs.readFileSync(file), original);
});

for (const reason of ['IP rate limit exceeded', 'Wallet rate limit exceeded']) {
  test(`${reason}: map caps at 50000, keeps existing budgets, and sweeps expired keys`, (t) => {
    let now = 2000;
    let map;
    // Observe the middleware's actual map, without HTTP traffic or 50000 wallets/keys.
    const source = fs.readFileSync(path.resolve(__dirname, '../src/forum/routes.js'), 'utf8');
    const module = { exports: {} };
    class ObservedMap extends Map { constructor(...args) { super(...args); map = this; } }
    vm.runInNewContext(source, { require: (name) => name.startsWith('.') ? require(`../src/forum/${name.slice(2)}`) : require(name),
      module, __dirname: path.resolve(__dirname, '../src/forum'), Map: ObservedMap });
    const limit = module.exports.rateLimit({ clock: () => now, max: 2, key: (req) => req.id, reason });
    const invoke = (id) => {
      let status = 200;
      let body;
      const res = { set() {}, status(value) { status = value; return this; }, json(value) { body = value; } };
      limit({ id }, res, () => {});
      return { status, error: body?.error };
    };
    assert.equal(MAX_RATE_LIMIT_KEYS, 50000);
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS; i += 1) assert.equal(invoke(String(i)).status, 200);
    assert.equal(map.size, MAX_RATE_LIMIT_KEYS);
    assert.equal(invoke('new').status, 429);
    assert.equal(map.size, MAX_RATE_LIMIT_KEYS);
    assert.equal(invoke('0').status, 200, 'existing key retains its remaining budget');
    assert.equal(invoke('0').status, 429);
    assert.equal(invoke('new').error, reason);
    now += 60;
    assert.equal(invoke('new').status, 200);
    assert.equal(map.size, 1);
    assert.equal(invoke('0').status, 200);
    assert.equal(map.size, 2);
  });
}
