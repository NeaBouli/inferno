#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_OFFLINE_PORT || 3212);
const origin = `http://127.0.0.1:${port}`;

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
  const serverOutput = [];
  const server = spawn(process.execPath, [
    path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'),
    'start', '--hostname', '127.0.0.1', '--port', String(port),
  ], {
    cwd: frontend,
    env: { ...process.env, BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(origin, { waitUntil: 'networkidle' });
    const cacheState = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }
      const cache = await caches.open('ifr-benefits-v21');
      const keys = await cache.keys();
      return keys.map((request) => new URL(request.url).pathname);
    });
    assert.ok(cacheState.includes('/'), 'offline cache must contain the root app shell');
    assert.ok(cacheState.some((url) => url.startsWith('/_next/static/') && url.endsWith('.js')), 'offline cache must contain Next.js JavaScript');
    assert.ok(cacheState.some((url) => url.startsWith('/_next/static/') && url.endsWith('.css')), 'offline cache must contain Next.js CSS');

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Locked IFR. Benefits at checkout.' }).waitFor();
    const sellerMode = page.getByRole('button', { name: /Seller Offer discounts/ });
    await sellerMode.click();
    await page.getByRole('link', { name: 'Open seller tools', exact: true }).waitFor();
    assert.equal(await sellerMode.getAttribute('aria-pressed'), 'true', 'offline app shell must remain interactive');

    for (const pathname of ['/b/offline-seller', '/s/offline-seller']) {
      await context.setOffline(false);
      await page.goto(origin, { waitUntil: 'networkidle' });
      assert.ok(
        await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        `installed app must control the client before testing offline ${pathname}`
      );
      await context.setOffline(true);
      await page.goto(`${origin}${pathname}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: "You're offline" }).waitFor();
      await page.getByRole('link', { name: 'Open the offline app' }).waitFor();
      assert.equal(
        await page.getByText('Internal Server Error', { exact: true }).count(),
        0,
        `offline ${pathname} must not expose a raw server error`
      );
      assert.equal(
        new URL(page.url()).pathname,
        pathname,
        `offline fallback must preserve the requested ${pathname} address`
      );
    }

    assert.deepEqual(pageErrors, []);
    await context.close();
    console.log(
      '[benefits-offline-shell] PASS - cached Next assets reload into an interactive offline role chooser from root and seller deep links'
    );
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (process.exitCode) process.stderr.write(serverOutput.join(''));
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
