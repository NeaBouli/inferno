#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_SELLER_LOADER_PORT || 3215);
const origin = `http://127.0.0.1:${port}`;

function findSellerChunk() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(frontend, '.next', 'react-loadable-manifest.json'), 'utf8')
  );
  const entry = Object.entries(manifest).find(([key]) => key.includes('SellerRuleBuilder'));
  assert.ok(entry, 'Seller workspace is missing from the dynamic-import manifest');
  const chunk = entry[1].files.find((file) => file.endsWith('.js'));
  assert.ok(chunk, 'Seller workspace has no JavaScript chunk');
  return `/${chunk}`;
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before startup (${child.exitCode})`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for Benefits frontend');
}

async function run() {
  const sellerChunk = findSellerChunk();
  const serverOutput = [];
  const server = spawn(
    process.execPath,
    [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: frontend,
      env: { ...process.env, BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ...devices['iPad Pro 11'], serviceWorkers: 'block' });
    const page = await context.newPage();
    let sellerChunkAttempts = 0;
    let navigations = 0;

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    await page.route(`**${sellerChunk}`, async (route) => {
      sellerChunkAttempts += 1;
      if (sellerChunkAttempts === 1) {
        await new Promise((resolve) => setTimeout(resolve, 12_500));
        return route.abort('timedout');
      }
      return route.continue();
    });

    await page.goto(`${origin}/#seller-catalog`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.getByRole('heading', { name: 'Benefit rule manager', exact: true }).waitFor({
      timeout: 35_000,
    });
    await page.waitForFunction(() => {
      const gate = document.querySelector('[data-seller-profile-gate]');
      if (!gate) return false;
      const bounds = gate.getBoundingClientRect();
      return bounds.top < window.innerHeight && bounds.bottom > 0;
    }, null, { timeout: 35_000 });

    assert.ok(sellerChunkAttempts >= 2, 'seller chunk must be requested again after recovery');
    assert.ok(navigations >= 2, 'seller loader must perform one recovery navigation');
    assert.equal(new URL(page.url()).hash, '#seller-catalog', 'seller recovery must preserve the requested task hash');
    assert.equal(
      new URL(page.url()).searchParams.has('_app_refresh'),
      false,
      'successful seller load must remove the temporary recovery query'
    );
    assert.equal(
      await page.getByText('Application error: a client-side exception has occurred', { exact: false }).count(),
      0,
      'recoverable seller chunk delay must not expose the global application error'
    );
    assert.equal(
      await page.locator('[aria-label="Loading seller workspace"]').count(),
      0,
      'seller loading placeholder must not remain after recovery'
    );

    await context.close();
    console.log('[benefits-seller-loader] PASS - delayed seller chunk recovered on iPad');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (process.exitCode) process.stderr.write(serverOutput.join(''));
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
