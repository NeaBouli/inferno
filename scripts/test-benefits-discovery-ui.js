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
  minIFRHeld: 500,
  lockSource: 'commitment_time_only',
  dailyRedemptionLimit: 1,
  monthlyRedemptionLimit: 10,
  business: {
    id: 'seller-ui-e2e',
    slug: 'ifr-test-cafe',
    name: 'IFR Test Cafe',
    description: 'Deterministic offer-discovery fixture.',
    website: 'https://example.com',
    logoUrl: 'https://assets.example.com/ifr-seller-logo.png',
    serviceArea: 'Online',
    categories: ['Coffee'],
  },
  product: {
    id: 'product-ui-e2e',
    name: 'IFR member coffee',
    description: 'A priced catalog fixture.',
    basePriceMinor: '1999',
    currency: 'EUR',
  },
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
      if (
        url.pathname === `/api/businesses/${offer.business.slug}` ||
        url.pathname === `/api/businesses/${offer.business.id}`
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...offer.business, discountPercent: 10, requiredLockIFR: 1000, tierLabel: null }),
        });
      }
      if (
        url.pathname === `/api/businesses/${offer.business.slug}/products` ||
        url.pathname === `/api/businesses/${offer.business.id}/products`
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            business: offer.business,
            products: [{
              ...offer.product,
              businessId: offer.business.id,
              category: offer.category,
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              benefitRules: [{
                id: offer.id,
                label: offer.label,
                discountPercent: offer.discountPercent,
                requiredLockIFR: offer.requiredLockIFR,
                minIFRHeld: offer.minIFRHeld,
                lockSource: offer.lockSource,
                dailyRedemptionLimit: offer.dailyRedemptionLimit,
                monthlyRedemptionLimit: offer.monthlyRedemptionLimit,
                ttlSeconds: 90,
              }],
            }],
          }),
        });
      }
      if (
        url.pathname === `/api/businesses/${offer.business.slug}/rules` ||
        url.pathname === `/api/businesses/${offer.business.id}/rules`
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rules: [{
              id: offer.id,
              businessId: offer.business.id,
              productId: offer.product.id,
              label: offer.label,
              category: offer.category,
              productName: offer.productName,
              discountPercent: offer.discountPercent,
              requiredLockIFR: offer.requiredLockIFR,
              minIFRHeld: offer.minIFRHeld,
              lockSource: offer.lockSource,
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
      if (url.pathname === '/api/passes/test-pass/control') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'BOUND',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            checkout: {
              status: 'PENDING',
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              businessId: offer.business.id,
              benefitRuleId: 'different-offer',
              sellerName: offer.business.name,
              benefit: {
                label: 'Different member offer',
                category: 'Coffee',
                productName: 'Different coffee',
                basePriceMinor: '1299',
                currency: 'USD',
                discountPercent: 5,
                requiredLockIFR: 500,
                minIFRHeld: 0,
                lockSource: 'ifrlock',
              },
              reason: null,
            },
          }),
        });
      }
      if (url.pathname === '/api/ready') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ready',
            chainId: 1,
            database: 'ok',
            rateLimitStore: 'ok',
          }),
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
    });
    await context.route('https://assets.example.com/ifr-seller-logo.png', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    }));

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
    await offersSection.getByText('Reference price: EUR 19.99', { exact: true }).waitFor();
    await offersSection.getByText('1,000 IFR in active TIME_ONLY commitments', { exact: true }).waitFor();
    await offersSection.getByText('500 IFR held', { exact: true }).waitFor();
    const discoveryLogo = offersSection.getByRole('img', { name: `${offer.business.name} logo`, exact: true });
    await discoveryLogo.waitFor();
    assert.equal(await discoveryLogo.getAttribute('referrerpolicy'), 'no-referrer');
    await discoveryLogo.evaluate((image) => image.dispatchEvent(new Event('error')));
    await offersSection.getByRole('img', { name: `${offer.business.name} logo placeholder`, exact: true }).waitFor();
    await offersSection.getByRole('link', { name: 'Seller catalog', exact: true }).click();
    await waitForLocation(page, `/s/${offer.business.slug}`);
    await page.getByText(offer.productName, { exact: true }).waitFor();
    await page.getByText('Reference price: EUR 19.99', { exact: true }).waitFor();
    await page.getByText('Verify at least 1,000 IFR in active TIME_ONLY commitments and 500 IFR held at checkout.', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('img', { name: `${offer.business.name} logo`, exact: true }).count(), 1);
    assert.equal(
      await page.getByText('No public offers yet', { exact: true }).count(),
      0,
      'a standalone active rule must not produce an empty seller catalog'
    );
    await page.getByRole('link', { name: 'Use this offer', exact: true }).click();
    await waitForLocation(page, '/', '#customer-pass');
    assert.equal(new URL(page.url()).searchParams.get('seller'), offer.business.slug);
    assert.equal(new URL(page.url()).searchParams.get('offer'), offer.id);
    const selectedOffer = page.locator('#customer-pass');
    await selectedOffer.getByText('Selected public offer', { exact: true }).waitFor();
    await selectedOffer.getByText(`${offer.productName} · ${offer.business.name}`, { exact: true }).waitFor();
    await selectedOffer.getByText('10% benefit · 1,000 IFR lock in active TIME_ONLY commitments · 500 IFR held', { exact: true }).waitFor();
    await selectedOffer.getByText('Offer verified. The seller still binds it and you approve the exact checkout snapshot.', { exact: true }).waitFor();
    await page.evaluate(() => window.history.pushState({}, '', '/?seller=invalid!&offer=bad#customer-pass'));
    await selectedOffer.getByText('This offer link is invalid. Browse the current public offers below.', { exact: true }).waitFor();
    assert.equal(await selectedOffer.getByText('Selected public offer', { exact: true }).count(), 0, 'invalid same-route context must clear the prior verified offer');

    await page.evaluate(({ businessId, offerId }) => {
      window.sessionStorage.setItem('ifr.shop.activeCustomerPass', JSON.stringify({
        passId: 'test-pass',
        controlToken: 'x'.repeat(48),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        qrUrl: '/p/test-pass',
        walletAddress: '0x0000000000000000000000000000000000000001',
      }));
      window.history.pushState({}, '', `/?seller=${businessId}&offer=${offerId}#customer-pass`);
    }, { businessId: offer.business.id, offerId: offer.id });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectedOffer.getByText('The seller bound a different offer than the public offer you selected.', { exact: false }).waitFor();
    await selectedOffer.getByText('USD 12.99', { exact: true }).waitFor();
    await selectedOffer.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.has('seller'), false);
    assert.equal(new URL(page.url()).searchParams.has('offer'), false);
    await page.evaluate(() => window.sessionStorage.removeItem('ifr.shop.activeCustomerPass'));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
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
    await page.getByLabel('Accepted lock source', { exact: true }).selectOption('either');
    await page.getByText('Either source never combines partial balances. PRICE_ONLY, TIME_OR_PRICE and TIME_AND_PRICE commitments do not qualify.', { exact: true }).waitFor();
    const integrationGenerator = page.locator('#integrate');
    const generatorCopy = integrationGenerator.getByRole('button', { name: 'Copy', exact: true });
    await integrationGenerator.getByRole('heading', { name: 'Create a seller entry point', exact: true }).waitFor();
    assert.equal(await generatorCopy.isDisabled(), true, 'generator must not copy placeholder IDs');
    const businessIdInput = integrationGenerator.getByLabel('Business ID', { exact: true });
    const ruleIdInput = integrationGenerator.getByLabel('Benefit rule ID', { exact: true });
    await businessIdInput.fill('invalid business');
    await integrationGenerator.locator('#integration-generator-validation').getByText('Business ID may contain only letters, numbers, hyphens and underscores.', { exact: true }).waitFor();
    assert.equal(await businessIdInput.getAttribute('aria-invalid'), 'true');
    assert.equal(await generatorCopy.isDisabled(), true, 'invalid Business ID must keep generator actions disabled');
    await businessIdInput.fill(offer.business.id);
    await ruleIdInput.fill(offer.id);
    await integrationGenerator.getByRole('button', { name: 'SDK / POS', exact: true }).click();
    await integrationGenerator.getByText('IFRBenefitsClient', { exact: false }).waitFor();
    await integrationGenerator.getByText(`businessId: "${offer.business.id}"`, { exact: false }).waitFor();
    await integrationGenerator.getByText(`benefitRuleId: "${offer.id}"`, { exact: false }).waitFor();
    assert.equal(await generatorCopy.isDisabled(), false, 'valid exact IDs must enable generator output');
    assert.equal((await integrationGenerator.locator('pre').innerText()).includes('selected-active-rule-id'), false, 'generated POS code must not retain a fake rule ID');
    assert.equal((await integrationGenerator.locator('pre').innerText()).includes('privateKey'), false, 'generated POS code must not embed a private key field');
    await ruleIdInput.fill('bad/rule');
    await integrationGenerator.locator('#integration-generator-validation').getByText('Benefit rule ID may contain only letters, numbers, hyphens and underscores.', { exact: true }).waitFor();
    assert.equal(await generatorCopy.isDisabled(), true, 'invalid rule ID must disable rule-bound generator output');
    await ruleIdInput.fill(offer.id);
    assert.equal(await generatorCopy.isDisabled(), false, 'correcting the rule ID must recover generator output');

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
        ? { status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }
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
