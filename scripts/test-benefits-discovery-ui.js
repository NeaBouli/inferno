#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium, devices } = require('playwright');

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

    const walletControl = page.locator('[data-wallet-connect-control]').first();
    await walletControl.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
    await waitForAttribute(walletControl, 'data-wallet-connectors-ready', 'true');
    assert.equal(await walletControl.getAttribute('data-wallet-connector-ids'), 'coinbaseWalletSDK');
    assert.equal(
      await walletControl.getByRole('button', { name: 'Browser wallet', exact: true }).count(),
      0,
      'a browser without an injected provider must not offer the unusable injected connector',
    );
    assert.equal(
      await walletControl.getByText('Choose wallet connection', { exact: true }).count(),
      0,
      'a single available Coinbase fallback must not render an unnecessary choice menu',
    );

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
    await waitForAttribute(sellerModeButton, 'aria-pressed', 'true');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAttribute(sellerModeButton, 'aria-pressed', 'true');

    await customerModeButton.click();
    await waitForAttribute(customerModeButton, 'aria-pressed', 'true');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAttribute(customerModeButton, 'aria-pressed', 'true');

    await page.goto(`${origin}/?mode=seller`, { waitUntil: 'domcontentloaded' });
    await waitForAttribute(sellerModeButton, 'aria-pressed', 'true');
    await customerModeButton.click();
    assert.equal(new URL(page.url()).searchParams.has('mode'), false, 'manual role choice must clear the mode override');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAttribute(customerModeButton, 'aria-pressed', 'true');

    await page.goto(`${origin}/#seller-workspace`, { waitUntil: 'domcontentloaded' });
    await waitForAttribute(sellerModeButton, 'aria-pressed', 'true');
    await customerModeButton.click();
    assert.equal(new URL(page.url()).hash, '', 'manual role choice must clear a role-specific hash override');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAttribute(customerModeButton, 'aria-pressed', 'true');

    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${origin}/#seller-catalog`, { waitUntil: 'domcontentloaded' });
    await waitForAttribute(sellerModeButton, 'aria-pressed', 'true');
    const sellerTasks = page.getByRole('navigation', { name: 'Seller tasks', exact: true });
    await sellerTasks.getByRole('link', { name: /Products/ }).waitFor();
    assert.equal(await page.locator('#seller-catalog').count(), 1, 'seller task deep link must render its target');
    assert.equal(await sellerTasks.getByRole('link', { name: 'Team', exact: true }).count(), 0, 'team task must stay hidden until a profile exists');

    for (const viewport of [{ width: 375, height: 812 }, { width: 820, height: 1180 }]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sellerTasks.getByRole('link', { name: /Products/ }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        false,
        `seller layout must not overflow at ${viewport.width}px`
      );
    }

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-pwa-install-listeners-ready="true"]').waitFor();
    await page.evaluate(() => {
      window.__benefitsInstallPrompted = false;
      const event = new Event('beforeinstallprompt');
      event.prompt = async () => { window.__benefitsInstallPrompted = true; };
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(event);
    });
    await page.getByRole('button', { name: 'Install app', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__benefitsInstallPrompted), true, 'desktop install button must invoke the captured PWA prompt');
    await page.getByText('Install accepted.', { exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.getByRole('button', { name: 'App installed', exact: true }).waitFor();

    const ipadContext = await browser.newContext({ ...devices['iPad Pro 11'], serviceWorkers: 'block' });
    await ipadContext.route('**/api/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/api/ready')
        ? { status: 'ready', chainId: 1, database: 'ok' }
        : discoveryResponse([])),
    }));
    const ipadPage = await ipadContext.newPage();
    await ipadPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await ipadPage.locator('[data-pwa-install-listeners-ready="true"]').waitFor();
    assert.equal(await ipadPage.locator('[data-ios-install-steps="visible"]').count(), 0, 'iOS details should stay compact until requested');
    const iosInstallButton = ipadPage.getByRole('button', { name: 'Show iPad / iPhone install steps', exact: true });
    assert.equal(await iosInstallButton.getAttribute('aria-expanded'), 'false');
    await iosInstallButton.click();
    await ipadPage.locator('[data-ios-install-steps="visible"]').waitFor();
    await ipadPage.getByText('Tap the Share icon in the browser toolbar.', { exact: true }).waitFor();
    await ipadPage.getByText(/iOS requires this browser action and does not allow websites to start installation directly/).waitFor();
    const iosHideButton = ipadPage.getByRole('button', { name: 'Hide iPad / iPhone steps', exact: true });
    assert.equal(await iosHideButton.getAttribute('aria-expanded'), 'true');
    assert.equal(await iosHideButton.getAttribute('aria-controls'), 'ios-pwa-install-steps');
    await iosHideButton.click();
    assert.equal(await ipadPage.locator('[data-ios-install-steps="visible"]').count(), 0, 'iOS install help must collapse again');
    assert.equal(
      await ipadPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      false,
      'iPad install help must not cause horizontal overflow',
    );
    await ipadContext.close();

    assert.deepEqual(pageErrors, []);
    await context.close();
    console.log('[benefits-discovery-ui] PASS - catalog/filter/empty network -> seller handoff -> persistent role overrides');
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
