#!/usr/bin/env node

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { ethers } = require('ethers');

const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'apps', 'benefits-network', 'backend');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const databaseName = `fullstack-e2e-${process.pid}-${randomUUID()}.db`;
const databasePath = path.join(backend, 'prisma', databaseName);
const databaseUrl = `file:./${databaseName}`;
const zeroAddress = '0x0000000000000000000000000000000000000001';
const adminSecret = 'fullstack-e2e-admin-secret';
const childLogs = new Map();
const children = [];
let backendPort;
let frontendPort;
let backendOrigin;
let frontendOrigin;
let testEnv;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function configureRuntime() {
  backendPort = process.env.BENEFITS_FULLSTACK_BACKEND_PORT
    ? Number(process.env.BENEFITS_FULLSTACK_BACKEND_PORT)
    : await findFreePort();
  frontendPort = process.env.BENEFITS_FULLSTACK_FRONTEND_PORT
    ? Number(process.env.BENEFITS_FULLSTACK_FRONTEND_PORT)
    : await findFreePort();
  if (!process.env.BENEFITS_FULLSTACK_FRONTEND_PORT && frontendPort === backendPort) {
    frontendPort = await findFreePort();
  }
  assert.ok(Number.isInteger(backendPort) && backendPort > 0, 'Invalid full-stack backend port');
  assert.ok(Number.isInteger(frontendPort) && frontendPort > 0, 'Invalid full-stack frontend port');
  assert.notEqual(backendPort, frontendPort, 'Full-stack frontend and backend ports must differ');
  backendOrigin = `http://127.0.0.1:${backendPort}`;
  frontendOrigin = `http://127.0.0.1:${frontendPort}`;
  testEnv = {
    ...process.env,
    NODE_ENV: 'production',
    CHAIN_ID: '1',
    RPC_URL: 'http://127.0.0.1:1',
    IFRLOCK_ADDRESS: zeroAddress,
    IFR_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000002',
    COMMITMENT_VAULT_ADDRESS: '0x0000000000000000000000000000000000000003',
    ADMIN_SECRET: adminSecret,
    DATABASE_URL: databaseUrl,
    PORT: String(backendPort),
    ALLOWED_ORIGINS: frontendOrigin,
    BENEFITS_API_INTERNAL_URL: backendOrigin,
    NEXT_PUBLIC_API_URL: '',
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || testEnv,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout || ''}${result.stderr || ''}`
    );
  }
}

function applyMigrations() {
  const migrationsRoot = path.join(backend, 'prisma', 'migrations');
  const migrations = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(migrations.length > 0, 'No Benefits database migrations found');
  for (const migration of migrations) {
    const migrationFile = path.join(migrationsRoot, migration, 'migration.sql');
    run('sqlite3', [databasePath, `.read ${migrationFile}`], { cwd: backend });
  }
}

function start(name, command, args, options = {}) {
  const output = [];
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || testEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => {
    output.push(chunk.toString());
    if (output.length > 200) output.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  childLogs.set(name, output);
  children.push(child);
  return child;
}

async function stopChildren() {
  await Promise.all(children.reverse().map(async (child) => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }));
}

async function waitFor(url, child, name, startupPattern) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${name} exited during startup (${child.exitCode})\n${(childLogs.get(name) || []).join('')}`);
    }
    try {
      const response = await fetch(url);
      const output = (childLogs.get(name) || []).join('');
      if (response.ok && startupPattern.test(output)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not become ready\n${(childLogs.get(name) || []).join('')}`);
}

async function fetchJson(urlPath, options = {}) {
  const response = await fetch(`${frontendOrigin}${urlPath}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${urlPath}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function sellerAuth(wallet, action, businessId, scope) {
  const query = new URLSearchParams({ action, businessId });
  const mutatingActions = new Set(['business:create', 'products:create', 'rules:create']);
  if (mutatingActions.has(action)) {
    query.set('walletAddress', wallet.address);
    query.set('scope', scope || businessId);
  }
  const challenge = await fetchJson(`/api/seller/auth-message?${query.toString()}`);
  return {
    walletAddress: wallet.address,
    signature: await wallet.signMessage(challenge.message),
    timestamp: challenge.timestamp,
    nonce: challenge.nonce,
  };
}

function sellerHeaders(auth) {
  return {
    'x-ifr-wallet': auth.walletAddress,
    'x-ifr-signature': auth.signature,
    'x-ifr-timestamp': auth.timestamp,
    'x-ifr-nonce': auth.nonce,
  };
}

async function seedRealApi() {
  const wallet = ethers.Wallet.createRandom();
  const createAuth = await sellerAuth(wallet, 'business:create', 'new', 'new');
  const business = await fetchJson('/api/seller/businesses', {
    method: 'POST',
    body: JSON.stringify({
      name: 'IFR Full-Stack Cafe',
      description: 'Real API fixture for the composed Benefits browser gate.',
      website: 'https://ifrunit.tech/',
      serviceArea: 'Athens',
      categories: ['Coffee'],
      discountPercent: 14,
      requiredLockIFR: 1000,
      minIFRHeld: 0,
      lockSource: 'commitment_time_only',
      ttlSeconds: 300,
      tierLabel: 'Full-stack',
      ownerAddress: wallet.address,
      signature: createAuth.signature,
      timestamp: createAuth.timestamp,
      nonce: createAuth.nonce,
    }),
  });

  const productAuth = await sellerAuth(wallet, 'products:create', business.id);
  const product = await fetchJson(`/api/seller/businesses/${business.id}/products`, {
    method: 'POST',
    headers: sellerHeaders(productAuth),
    body: JSON.stringify({
      name: 'Full-stack member coffee',
      category: 'Coffee',
      description: 'Created through the real signed seller API.',
    }),
  });

  const ruleAuth = await sellerAuth(wallet, 'rules:create', business.id);
  const rule = await fetchJson(`/api/seller/businesses/${business.id}/rules`, {
    method: 'POST',
    headers: sellerHeaders(ruleAuth),
    body: JSON.stringify({
      productId: product.id,
      label: 'Full-stack 14%',
      category: 'Coffee',
      productName: product.name,
      discountPercent: 14,
      requiredLockIFR: 1000,
      minIFRHeld: 0,
      lockSource: 'commitment_time_only',
      dailyRedemptionLimit: 1,
      monthlyRedemptionLimit: 10,
      ttlSeconds: 300,
      active: true,
    }),
  });

  return { business, product, rule };
}

async function verifyBrowser(fixture) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const apiResponses = [];
    const pageErrors = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/api/')) {
        apiResponses.push({ url: response.url(), status: response.status() });
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(frontendOrigin, { waitUntil: 'domcontentloaded' });
    const offers = page.locator('#offers');
    await offers.getByText(fixture.product.name, { exact: true }).waitFor({ timeout: 15_000 });
    await offers.getByText(fixture.business.name, { exact: true }).waitFor();
    await offers.getByText('14% benefit', { exact: true }).waitFor();
    await offers.getByText('1,000 IFR in active TIME_ONLY commitments', { exact: true }).waitFor();
    await offers.getByRole('link', { name: 'Seller catalog', exact: true }).click();
    await page.waitForURL(`${frontendOrigin}/s/${fixture.business.id}`);
    await page.getByText(fixture.product.name, { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Use this offer', exact: true }).click();
    await page.waitForURL((url) => (
      url.pathname === '/' &&
      url.hash === '#customer-pass' &&
      url.searchParams.get('seller') === fixture.business.id &&
      url.searchParams.get('offer') === fixture.rule.id
    ));
    const pass = page.locator('#customer-pass');
    await pass.getByText('Selected public offer', { exact: true }).waitFor();
    await pass.getByText(
      `${fixture.product.name} · ${fixture.business.name}`,
      { exact: true }
    ).waitFor();
    await pass.getByText(
      '14% benefit · 1,000 IFR lock in active TIME_ONLY commitments',
      { exact: true }
    ).waitFor();

    assert.equal(pageErrors.length, 0, `Browser errors: ${pageErrors.join('; ')}`);
    assert.ok(
      apiResponses.some(({ url, status }) => (
        new URL(url).pathname === '/api/businesses' && status === 200
      )),
      'Browser did not load public offers through the real Next.js API rewrite'
    );
    assert.ok(
      apiResponses.some(({ url, status }) => (
        new URL(url).pathname === `/api/businesses/${fixture.business.id}/products` &&
        status === 200
      )),
      'Browser did not load the real seller catalog API'
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  let backendServer;
  let frontendServer;
  try {
    await configureRuntime();
    applyMigrations();
    run('npm', ['run', 'build'], { cwd: backend });
    run('npm', ['run', 'build'], { cwd: frontend });

    backendServer = start('backend', process.execPath, [path.join(backend, 'dist', 'index.js')], {
      cwd: backend,
    });
    await waitFor(
      `${backendOrigin}/api/ready`,
      backendServer,
      'backend',
      /IFR Benefits Network backend running on port/
    );

    frontendServer = start(
      'frontend',
      process.execPath,
      [
        path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(frontendPort),
      ],
      { cwd: frontend }
    );
    await waitFor(frontendOrigin, frontendServer, 'frontend', /Ready in|Local:/);

    const proxiedReady = await fetchJson('/api/ready');
    assert.deepEqual(proxiedReady, {
      status: 'ready',
      chainId: 1,
      database: 'ok',
      rateLimitStore: 'ok',
    });
    const fixture = await seedRealApi();
    await verifyBrowser(fixture);
    console.log('[benefits-fullstack-e2e] PASS');
  } finally {
    await stopChildren();
    fs.rmSync(databasePath, { force: true });
    fs.rmSync(`${databasePath}-journal`, { force: true });
    fs.rmSync(`${databasePath}-wal`, { force: true });
    fs.rmSync(`${databasePath}-shm`, { force: true });
  }
}

main().catch((error) => {
  console.error('[benefits-fullstack-e2e] FAIL');
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
