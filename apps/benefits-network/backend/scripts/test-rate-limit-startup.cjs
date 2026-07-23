#!/usr/bin/env node

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve startup-test port');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(100);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const unavailable = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', unavailable);
    socket.once('timeout', unavailable);
  });
}

async function main() {
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'index.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      CHAIN_ID: '1',
      RPC_URL: 'https://mock-rpc.example.com',
      IFR_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000002',
      IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
      COMMITMENT_VAULT_ADDRESS: '0x0000000000000000000000000000000000000003',
      ADMIN_SECRET: 'startup-test-secret',
      DATABASE_URL: 'file:./test.db',
      RATE_LIMIT_STORE: 'redis',
      RATE_LIMIT_REDIS_URL: 'redis://127.0.0.1:1',
      BACKEND_REPLICA_COUNT: '1',
    },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let listenerObserved = false;
  let keepProbing = true;
  const probe = (async () => {
    while (keepProbing) {
      if (await canConnect(port)) listenerObserved = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 12_000);
  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  keepProbing = false;
  await probe;
  clearTimeout(timeout);

  assert.equal(listenerObserved, false, 'HTTP listener opened before Redis startup succeeded');
  assert.equal(result.signal, null, `Startup test timed out (${result.signal})`);
  assert.equal(result.code, 1, `Expected fail-closed exit code 1, received ${result.code}`);
  assert.match(output, /Backend startup refused: rate limit Redis unavailable/);
  console.log('[rate-limit-startup] PASS');
}

main().catch((error) => {
  console.error('[rate-limit-startup] FAIL');
  console.error(error);
  process.exit(1);
});
