import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';

// CWA-12: server-level fail-closed budget gate. The deliberately tiny budget
// cannot reserve the real prompt, so the test proves the request is rejected
// before any paid or external model call.

const appRoot = new URL('../', import.meta.url);

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const child = spawn(
  process.execPath,
  ['--import', 'tsx', 'server/index.ts'],
  {
    cwd: appRoot.pathname,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      ANTHROPIC_API_KEY: 'budget-test-not-a-real-key',
      COPILOT_DAILY_BUDGET_USD: '0.01',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);
let childStderr = '';
child.stderr.on('data', (chunk) => { childStderr += chunk; });

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
      lastError = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error('server did not start in time');
}

async function chat() {
  const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], mode: 'explorer', surface: 'standalone' }),
  });
  const body = await response.json();
  return { status: response.status, headers: response.headers, body };
}

try {
  await waitForServer();

  // Health contract untouched (CWA-11).
  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.deepStrictEqual(health, { status: 'ok' });

  // The request cannot reserve its conservative UTF-8-byte upper bound.
  // A 429 (rather than a network/API error) proves no Anthropic call occurred.
  for (const attempt of [1, 2]) {
    const res = await chat();
    assert.equal(res.status, 429, `attempt ${attempt}: exhausted budget → 429`);
    assert.equal(res.body.code, 'budget_exhausted', 'stable machine-readable code');
    assert.equal(typeof res.body.reply, 'string');
    assert.ok(!/\d|\$/.test(res.body.reply), 'reply exposes no dollar totals or numbers');
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'reply'], 'no config fields leak');
    const retryAfter = Number(res.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 86_400, 'Retry-After bounds the next UTC reset');
  }
  console.log('PASS: chat budget gate — exhaustion, Retry-After, no model call when closed');
} catch (error) {
  if (childStderr) console.error(childStderr);
  throw error;
} finally {
  child.kill('SIGKILL');
}
