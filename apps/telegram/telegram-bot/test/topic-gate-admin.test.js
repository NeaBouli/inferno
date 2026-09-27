'use strict';

// CWA-38: the protected-topic admin bypass must come only from explicitly
// configured ADMIN_USER_IDS. With the env unset, the former hardcoded
// fallback identity (579949616) must be denied like any other user.
// The real src/index.js boots in an isolated child process under stubs
// (test/fixtures/topic-gate-preload.js) — no network, no polling.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PRELOAD = path.join(__dirname, 'fixtures', 'topic-gate-preload.js');
const FORMER_HARDCODED_ADMIN = 579949616;
const PROTECTED_THREAD = 58; // Core Dev

function bootBot(scenarioEnv) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-gate-'));
  const env = { ...process.env };
  delete env.ADMIN_USER_IDS;
  Object.assign(env, {
    NODE_ENV: 'test',
    BOT_TOKEN: 'fixture-token',
    WALLET_MAP_PATH: path.join(tempDir, 'wallet-map.json'),
  }, scenarioEnv);

  const child = childProcess.fork(PRELOAD, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.resume();
  child.stderr.resume();

  let nextId = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    child.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'ready' && msg.id === undefined) return resolve();
      if (msg.id === undefined) return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.type === 'error') entry.reject(new Error(msg.error));
      else entry.resolve(msg);
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`preload exited early: ${code}`)));
  });

  function request(type, payload = {}) {
    const id = nextId + 1;
    nextId = id;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.send({ type, id, ...payload });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`IPC timeout for ${type}`));
      }, 10000).unref();
    });
  }

  async function close() {
    try { child.disconnect(); } catch { /* already gone */ }
    child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  return { ready, request, close };
}

function protectedMessage(userId) {
  return { text: 'hello core devs', chatId: -100999, threadId: PROTECTED_THREAD, userId };
}

test('unset ADMIN_USER_IDS denies the former hardcoded identity (fail closed)', async () => {
  const bot = bootBot();
  try {
    await bot.ready;
    const result = await bot.request('dispatch', { update: protectedMessage(FORMER_HARDCODED_ADMIN) });
    assert.equal(result.calls.deleted, 1, 'unconfigured env must not grant the hardcoded admin bypass');
  } finally {
    await bot.close();
  }
});

test('channel_post sync is wired through the trusted-source handler', async () => {
  const bot = bootBot();
  try {
    await bot.ready;
    const { list } = await bot.request('registrations');
    assert.ok(
      list.some((r) => r.kind === 'on' && r.event === 'channel_post'),
      'index.js must register a channel_post handler'
    );
  } finally {
    await bot.close();
  }
});

test('configured ADMIN_USER_IDS keep their bypass; other users stay denied', async () => {
  const bot = bootBot({ ADMIN_USER_IDS: '222, not-a-number, 333' });
  try {
    await bot.ready;
    const adminA = await bot.request('dispatch', { update: protectedMessage(222) });
    assert.equal(adminA.calls.deleted, 0, 'configured admin 222 must pass the gate');
    const adminB = await bot.request('dispatch', { update: protectedMessage(333) });
    assert.equal(adminB.calls.deleted, 0, 'configured admin 333 must pass the gate');
    const stranger = await bot.request('dispatch', { update: protectedMessage(444) });
    assert.equal(stranger.calls.deleted, 1, 'unlisted user must be denied');
    const former = await bot.request('dispatch', { update: protectedMessage(FORMER_HARDCODED_ADMIN) });
    assert.equal(former.calls.deleted, 1, 'hardcoded identity not in the configured list must be denied');
  } finally {
    await bot.close();
  }
});
