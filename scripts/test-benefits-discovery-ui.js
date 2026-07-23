#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_DISCOVERY_UI_PORT || 3212);
const origin = `http://127.0.0.1:${port}`;

const offer = {
  id: 'offer-ui-e2e',
  label: 'Member standard',
  category: 'Coffee',
  productName: 'IFR member coffee',
  discountPercent: 10,
  requiredLockIFR: 1000,
  dailyRedemptionLimit: 1,
  monthlyRedemptionLimit: 10,
  business: {
    id: 'seller-ui-e2e',
    name: 'IFR Test Cafe',
    description: 'Deterministic offer-discovery fixture.',
    website: 'https://example.com',
    serviceArea: 'Online',
    categories: ['Coffee'],
  },
  product: null,
};

function discoveryResponse(offers) {
  return {
    offers,
    categories: offers.length ? ['Coffee'] : [],
    serviceAreas: offers.length ? ['Online'] : [],
    pagination: {
      page: 1,
      limit: 8,
      total: offers.length,
      totalPages: offers.length ? 1 : 0,
      hasNext: false,
    },
  };
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before startup (${child.exitCode})`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for Benefits frontend');
}

async function waitForAttribute(locator, name, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute(name) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await locator.getAttribute(name), expected);
}

async function waitForLocation(page, pathname, hash = '') {
  await page.waitForFunction(
    ({ expectedPathname, expectedHash }) => (
      window.location.pathname === expectedPathname && window.location.hash === expectedHash
    ),
    { expectedPathname: pathname, expectedHash: hash }
  );
}

async function run() {
  const serverOutput = [];
  const server = spawn(
    process.execPath,
    [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
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
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let networkEmpty = false;

    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/businesses') {
        const filtered = Boolean(url.searchParams.get('query'));
        if (!filtered && !networkEmpty) await new Promise((resolve) => setTimeout(resolve, 600));
        const offers = networkEmpty || filtered ? [] : [offer];
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(discoveryResponse(offers)),
        });
      }
      if (url.pathname === `/api/businesses/${offer.business.id}/products`) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ business: offer.business, products: [] }),
        });
      }
      if (url.pathname === `/api/businesses/${offer.business.id}/rules`) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rules: [{
              id: offer.id,
              businessId: offer.business.id,
              productId: null,
              label: offer.label,
              category: offer.category,
              productName: offer.productName,
              discountPercent: offer.discountPercent,
              requiredLockIFR: offer.requiredLockIFR,
              dailyRedemptionLimit: offer.dailyRedemptionLimit,
              monthlyRedemptionLimit: offer.monthlyRedemptionLimit,
              ttlSeconds: 90,
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }],
          }),
        });
      }
      if (url.pathname === '/api/ready') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ready', chainId: 1, database: 'ok' }),
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });

    const offersSection = page.locator('#offers');
    await offersSection.getByText(offer.productName, { exact: true }).waitFor();
    await offersSection.getByRole('link', { name: 'Open seller catalog', exact: true }).click();
    await waitForLocation(page, `/s/${offer.business.id}`);
    await page.getByText('Other member benefits', { exact: true }).waitFor();
    await page.getByText(offer.productName, { exact: true }).waitFor();
    assert.equal(
      await page.getByText('No public offers yet', { exact: true }).count(),
      0,
      'a standalone active rule must not produce an empty seller catalog'
    );
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForLocation(page, '/');
    await offersSection.getByText(offer.productName, { exact: true }).waitFor();
    await offersSection.getByRole('searchbox', { name: 'Search offers', exact: true }).fill('missing');
    await offersSection.getByText('No offers match these filters', { exact: true }).waitFor();

    await offersSection.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await offersSection.getByText('Loading...', { exact: true }).waitFor();
    assert.equal(
      await offersSection.getByText('The first public seller offers are still being prepared.', { exact: true }).count(),
      0,
      'filter reset must not announce an empty network while the unfiltered request is pending'
    );
    await offersSection.getByText(offer.productName, { exact: true }).waitFor();

    networkEmpty = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await offersSection.getByText('The first public seller offers are still being prepared.', { exact: true }).waitFor();
    await offersSection.getByRole('button', { name: 'Become a seller', exact: true }).click();
    await waitForLocation(page, '/', '#seller-workspace');
    const sellerModeButton = page.getByRole('button', { name: /Seller Offer discounts/ });
    await sellerModeButton.waitFor();
    await waitForAttribute(sellerModeButton, 'aria-pressed', 'true');
    await page.getByRole('heading', { name: 'Benefit rule manager', exact: true }).waitFor();

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForLocation(page, '/');
    const customerModeButton = page.getByRole('button', { name: /Customer Unlock benefits/ });
    await customerModeButton.waitFor();
    await waitForAttribute(customerModeButton, 'aria-pressed', 'true');

    for (const viewport of [{ width: 375, height: 812 }, { width: 820, height: 1180 }]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await offersSection.getByRole('button', { name: 'Become a seller', exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        false,
        `discovery layout must not overflow at ${viewport.width}px`
      );
    }

    assert.deepEqual(pageErrors, []);
    await context.close();
    console.log('[benefits-discovery-ui] PASS - standalone catalog -> filter/reset -> true empty network -> seller handoff/back');
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
  console.error(error);
  process.exitCode = 1;
});
