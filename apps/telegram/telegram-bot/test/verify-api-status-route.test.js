const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Guards CWA-34: the unauthenticated GET /api/verify/status/:userId route must
// not disclose wallet or tier data. src/index.js is booted in an isolated child
// process (Telegraf stubbed via test/fixtures/verify-api-preload.js), so no bot
// polling starts and the test runner's timers, fetch and servers are untouched.

const botRoot = path.resolve(__dirname, '..');
const preload = path.join(__dirname, 'fixtures/verify-api-preload.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-verify-api-'));

const USER_ID = '424242';
const WALLET = '0x1111111111111111111111111111111111111111';
const TIER = 'signer';

let child;
let baseUrl;

test.before(async () => {
  child = fork(path.join(botRoot, 'src/index.js'), [], {
    cwd: tempDir,
    execArgv: ['--require', preload],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    env: {
      PATH: process.env.PATH,
      BOT_TOKEN: 'test-token',
      CLAUDE_API_KEY: 'test-key',
      IFR_LOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
      WALLET_MAP_PATH: path.join(tempDir, 'wallet_map.json'),
      VERIFY_PORT: '0',
      FIXTURE_USER_ID: USER_ID,
      FIXTURE_WALLET: WALLET,
      FIXTURE_TIER: TIER,
    },
  });

  const msg = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', (code) => reject(new Error(`verify API child exited early (code ${code})`)));
  });
  if (msg.error) throw new Error(`verify API failed to listen: ${msg.error}`);
  baseUrl = `http://127.0.0.1:${msg.port}`;
});

test.after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL'); // index.js traps SIGTERM for bot.stop()
    await exited;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('former status route is unavailable and leaks no wallet or tier', async () => {
  const res = await fetch(`${baseUrl}/api/verify/status/${USER_ID}`);
  const body = await res.text();

  assert.equal(res.status, 404);
  assert.ok(!body.toLowerCase().includes(WALLET.toLowerCase()), 'wallet disclosed');
  assert.ok(!body.includes(TIER), 'tier disclosed');
  assert.ok(!/"verified"/.test(body), 'verification status disclosed');
});

test('signature-authenticated verify endpoint remains available', async () => {
  const res = await fetch(`${baseUrl}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { success: false, error: 'Missing fields' });
});
