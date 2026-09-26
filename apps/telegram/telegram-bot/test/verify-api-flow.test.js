const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ethers } = require('ethers');

// End-to-end guards for the Telegram identity cluster. Each test boots
// src/index.js in an isolated child process (stubs in
// test/fixtures/bot-flow-preload.js): no Telegram traffic, no chain access,
// deterministic tiers, dummy wallets only.

const botRoot = path.resolve(__dirname, '..');
const indexPath = path.join(botRoot, 'src', 'index.js');
const preloadPath = path.join(__dirname, 'fixtures', 'bot-flow-preload.js');

// Deterministic dummy wallets — never used on any network.
const walletA = new ethers.Wallet(`0x${'11'.repeat(32)}`);
const walletB = new ethers.Wallet(`0x${'22'.repeat(32)}`);

let nextId = 1;

function rpc(child, msg) {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const onMessage = (m) => {
      if (m && m.id === id) {
        child.off('message', onMessage);
        if (m.type === 'error') reject(new Error(m.error));
        else resolve(m);
      }
    };
    child.on('message', onMessage);
    child.send({ ...msg, id });
  });
}

async function boot(t, extraEnv = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-flow-'));
  const child = fork(indexPath, [], {
    env: {
      ...process.env,
      BOT_TOKEN: 'fixture-token',
      NODE_ENV: 'test',
      WALLET_MAP_PATH: path.join(tempDir, 'wallet-map.json'),
      ...extraEnv,
    },
    execArgv: ['--require', preloadPath],
    silent: true,
  });
  let childErr = '';
  child.stderr.on('data', (d) => { childErr += d; });

  const ready = new Promise((resolve, reject) => {
    child.once('message', (msg) => {
      if (msg && msg.type === 'ready') resolve(msg);
      else reject(new Error(`unexpected first message: ${JSON.stringify(msg)}`));
    });
    child.once('exit', (code) => reject(new Error(`child exited (${code}): ${childErr}`)));
  });
  const { port } = await ready;

  t.after(() => new Promise((resolve) => {
    const done = () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      resolve();
    };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    try { child.disconnect(); } catch { child.kill('SIGKILL'); }
  }));

  return { child, port };
}

async function postVerify(port, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('protected-topic gate is registered before command handlers (CWA-40)', async (t) => {
  const { child } = await boot(t);
  const { list } = await rpc(child, { type: 'registrations' });
  const gateIndex = list.findIndex((r) => r.kind === 'on' && r.event === 'message');
  assert.ok(gateIndex >= 0, 'message gate registered');
  for (const name of ['lock', 'rules', 'ask', 'verify', 'burns']) {
    const cmdIndex = list.findIndex((r) => r.kind === 'command' && r.name === name);
    assert.ok(cmdIndex > gateIndex, `gate runs before /${name} handler`);
  }
});

// Negative: a command posted in a protected topic must be deleted at the gate
// before its handler can produce protected output (CWA-40).
test('command in protected topic is deleted before the handler replies (CWA-40)', async (t) => {
  const { child } = await boot(t);
  await rpc(child, { type: 'bindUser', userId: '6001', wallet: walletA.address, tier: 'community' });
  await rpc(child, { type: 'setTier', wallet: walletA.address, tier: 'community' });

  const { calls } = await rpc(child, {
    type: 'dispatch',
    update: { text: '/rules', userId: 6001, chatId: -1001, threadId: 58 },
  });
  assert.equal(calls.deleted, 1, 'protected message deleted at the gate');
  assert.equal(calls.replies.length, 0, 'command handler never produced output');
  const dm = calls.telegram.find((c) => c.method === 'sendMessage');
  assert.ok(dm && dm.args[0] === 6001 && dm.args[1].includes('Access denied'), 'denial DM sent');

  // Unverified user is rejected with the /verify hint.
  const unverified = await rpc(child, {
    type: 'dispatch',
    update: { text: '/rules', userId: 6003, chatId: -1001, threadId: 58 },
  });
  assert.equal(unverified.calls.deleted, 1);
  const dm2 = unverified.calls.telegram.find((c) => c.method === 'sendMessage');
  assert.ok(dm2 && dm2.args[1].includes('Use /verify'), 'verify hint sent');
});

// Negative: a stale stored tier must neither grant nor keep access — the gate
// re-derives the tier live on every protected message (CWA-44).
test('stale stored tier is not an authorization source (CWA-44)', async (t) => {
  const { child } = await boot(t);
  // Stored metadata claims signer; live chain state says community.
  await rpc(child, { type: 'bindUser', userId: '6002', wallet: walletB.address, tier: 'signer' });
  await rpc(child, { type: 'setTier', wallet: walletB.address, tier: 'community' });

  const blocked = await rpc(child, {
    type: 'dispatch',
    update: { text: '/rules', userId: 6002, chatId: -1001, threadId: 58 },
  });
  assert.equal(blocked.calls.deleted, 1, 'stale stored signer tier does not pass the gate');
  assert.equal(blocked.calls.replies.length, 0);

  // Live state promotes the wallet to signer: access is granted immediately.
  await rpc(child, { type: 'setTier', wallet: walletB.address, tier: 'signer' });
  const allowed = await rpc(child, {
    type: 'dispatch',
    update: { text: '/rules', userId: 6002, chatId: -1001, threadId: 58 },
  });
  assert.equal(allowed.calls.deleted, 0, 'no deletion once the live tier grants access');
  assert.ok(
    allowed.calls.replies.some((text) => /rules/i.test(text)),
    'command handler ran after the gate passed'
  );
});

// Negative: a nonce is single-use — replaying the exact same valid request
// must be rejected (CWA-31/CWA-32).
test('valid signature binds once; replayed nonce is rejected', async (t) => {
  const { child, port } = await boot(t);
  const { nonce } = await rpc(child, { type: 'makeNonce', userId: '5001' });
  const signature = await walletA.signMessage(nonce);
  const body = { nonce, signature, wallet: walletA.address };

  const first = await postVerify(port, body);
  assert.equal(first.status, 200);
  assert.equal(first.json.success, true);
  const bound = await rpc(child, { type: 'isVerified', userId: '5001' });
  assert.equal(bound.value, true, 'binding stored after valid signature');

  const replay = await postVerify(port, body);
  assert.equal(replay.status, 400, 'replayed nonce rejected');
  assert.match(replay.json.error, /Invalid or expired/);
});

test('unknown nonce and signature mismatch are rejected', async (t) => {
  const { child, port } = await boot(t);
  const bogusSig = await walletA.signMessage('IFR-DEADBEEFDEADBEEF');
  const unknown = await postVerify(port, {
    nonce: 'IFR-DEADBEEFDEADBEEF', signature: bogusSig, wallet: walletA.address,
  });
  assert.equal(unknown.status, 400);

  const { nonce } = await rpc(child, { type: 'makeNonce', userId: '5005' });
  const sigByA = await walletA.signMessage(nonce);
  const mismatch = await postVerify(port, { nonce, signature: sigByA, wallet: walletB.address });
  assert.equal(mismatch.status, 401, 'signature must match the claimed wallet');
  const bound = await rpc(child, { type: 'isVerified', userId: '5005' });
  assert.equal(bound.value, false, 'no binding on signature mismatch');

  // Fail closed: the failed attempt burned the nonce — a retry with the now
  // correctly paired signature is rejected and needs a fresh code.
  const retry = await postVerify(port, { nonce, signature: sigByA, wallet: walletA.address });
  assert.equal(retry.status, 400, 'nonce burned after the failed attempt');
  const stillUnbound = await rpc(child, { type: 'isVerified', userId: '5005' });
  assert.equal(stillUnbound.value, false);
});

// Negative: one wallet must not bind a second Telegram account (CWA-33).
test('second account with the same wallet gets 409 (CWA-33)', async (t) => {
  const { child, port } = await boot(t);

  const firstNonce = await rpc(child, { type: 'makeNonce', userId: '5002' });
  const firstSig = await walletA.signMessage(firstNonce.nonce);
  const first = await postVerify(port, {
    nonce: firstNonce.nonce, signature: firstSig, wallet: walletA.address,
  });
  assert.equal(first.status, 200);

  const secondNonce = await rpc(child, { type: 'makeNonce', userId: '5003' });
  const secondSig = await walletA.signMessage(secondNonce.nonce);
  const conflict = await postVerify(port, {
    nonce: secondNonce.nonce, signature: secondSig, wallet: walletA.address,
  });
  assert.equal(conflict.status, 409, 'wallet already bound elsewhere');
  const stillBound = await rpc(child, { type: 'isVerified', userId: '5002' });
  assert.equal(stillBound.value, true, 'original binding untouched');
  const notBound = await rpc(child, { type: 'isVerified', userId: '5003' });
  assert.equal(notBound.value, false, 'no second binding created');
});

// Negative: the signature endpoint is throttled per client IP (CWA-31).
// Default boot (no VERIFY_TRUST_PROXY): the loopback test peer is not in the
// trusted Docker pool, so all requests share the socket-peer bucket.
test('verify API answers 429 after the per-IP budget is exhausted', async (t) => {
  const { port } = await boot(t);
  const statuses = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await postVerify(port, {});
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 10), new Array(10).fill(400), 'first 10 requests pass the limiter');
  assert.deepEqual(statuses.slice(10), [429, 429], 'requests beyond the budget are throttled');
});

// Negative: the nonce is claimed atomically before any await — firing parallel
// requests with the same valid nonce lets exactly one through (CWA-31/CWA-32).
test('parallel replay: exactly one concurrent request claims the nonce', async (t) => {
  const { child, port } = await boot(t);
  const { nonce } = await rpc(child, { type: 'makeNonce', userId: '5010' });
  const signature = await walletA.signMessage(nonce);
  const body = { nonce, signature, wallet: walletA.address };

  const results = await Promise.all(Array.from({ length: 6 }, () => postVerify(port, body)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, 'exactly one request binds');
  assert.equal(results.filter((r) => r.status === 400).length, 5, 'parallel replays fail closed');
  const bound = await rpc(child, { type: 'isVerified', userId: '5010' });
  assert.equal(bound.value, true);
});

// Negative: a downstream failure after the claim (tier lookup down) must fail
// closed — the nonce stays burned and no binding is written (CWA-31/CWA-44).
test('downstream tier failure burns the nonce and binds nothing', async (t) => {
  const { child, port } = await boot(t);
  const { nonce } = await rpc(child, { type: 'makeNonce', userId: '5011' });
  const signature = await walletA.signMessage(nonce);
  const body = { nonce, signature, wallet: walletA.address };

  await rpc(child, { type: 'failNextTier' });
  const failed = await postVerify(port, body);
  assert.equal(failed.status, 500, 'tier failure surfaces as an error');

  const retry = await postVerify(port, body);
  assert.equal(retry.status, 400, 'burned nonce requires a fresh code from /verify');
  const bound = await rpc(child, { type: 'isVerified', userId: '5011' });
  assert.equal(bound.value, false, 'no binding after downstream failure');
});

// Proxy topology (production): internet → Traefik (one trusted hop) → API.
// When the immediate peer is trusted, the limiter keys on the forwarded client
// IP, so each client keeps its own budget (CWA-31 review).
test('trusted proxy hop: per-client budgets via X-Forwarded-For', async (t) => {
  const { port } = await boot(t, { VERIFY_TRUST_PROXY: 'loopback' });
  for (let i = 0; i < 10; i += 1) {
    const res = await postVerify(port, {}, { 'x-forwarded-for': '203.0.113.10' });
    assert.equal(res.status, 400, `client A request ${i + 1} within budget`);
  }
  const blocked = await postVerify(port, {}, { 'x-forwarded-for': '203.0.113.10' });
  assert.equal(blocked.status, 429, 'client A budget exhausted');
  const other = await postVerify(port, {}, { 'x-forwarded-for': '203.0.113.20' });
  assert.equal(other.status, 400, 'client B has its own budget through the proxy');
});

// Direct exposure: an attacker connecting directly (untrusted peer) must not
// spoof req.ip — a rotating forwarding header never resets the bucket.
test('direct attacker-supplied X-Forwarded-For is ignored (spoof resistance)', async (t) => {
  const { port } = await boot(t, { VERIFY_TRUST_PROXY: 'none' });
  const statuses = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await postVerify(port, {}, { 'x-forwarded-for': `198.51.100.${i + 1}` });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 10), new Array(10).fill(400), 'requests keyed on the real peer');
  assert.deepEqual(statuses.slice(10), [429, 429], 'rotating XFF does not reset the budget');
});
