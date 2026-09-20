import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';

// CWA-11 regression gate: the public GET /api/health response must stay
// exactly { "status": "ok" } — no key-presence or deploy-version fields.

const appRoot = new URL('../', import.meta.url);
const serverSource = await readFile(new URL('../server/index.ts', import.meta.url), 'utf8');

// 1) Static contract: the route handler must not reference disclosed state.
const routeMatch = serverSource.match(/app\.get\("\/api\/health"[\s\S]*?\n\}\);/);
assert.ok(routeMatch, 'server/index.ts must define GET /api/health');
const routeSource = routeMatch[0];
for (const forbidden of [
  'apiKeySet',
  'etherscanKeySet',
  'version',
  'ANTHROPIC_API_KEY',
  'ETHERSCAN_API_KEY',
  'process.env',
]) {
  assert.ok(
    !routeSource.includes(forbidden),
    `/api/health handler must not reference ${forbidden}`,
  );
}

// 2) Runtime contract: with both keys set, the JSON body is exactly { status: "ok" }.
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port: freePort } = probe.address();
    probe.close(() => resolve(freePort));
  });
});

const child = spawn(
  process.execPath,
  ['--import', 'tsx', 'server/index.ts'],
  {
    cwd: appRoot.pathname,
    env: {
      ...process.env,
      PORT: String(port),
      ANTHROPIC_API_KEY: 'health-shape-test',
      ETHERSCAN_API_KEY: 'health-shape-test',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);
let childStderr = '';
child.stderr.on('data', (chunk) => { childStderr += chunk; });

async function fetchHealth() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return response;
      lastError = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error('server did not start in time');
}

try {
  const response = await fetchHealth();
  const body = await response.json();
  assert.deepStrictEqual(
    body,
    { status: 'ok' },
    'public /api/health body must be exactly { "status": "ok" }',
  );
} catch (error) {
  if (childStderr) console.error(childStderr);
  throw error;
} finally {
  child.kill('SIGKILL');
}

console.log('AI Copilot health-shape regression passed.');
