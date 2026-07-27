#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_DISCOVERY_UI_PORT || 3212);
const origin = `http://127.0.0.1:${port}`;
const sellerWallet = '0x1000000000000000000000000000000000000001';
const sellerSignature = `0x${'11'.repeat(65)}`;
const sellerAuthMessage = 'IFR Benefits Network deterministic seller UI authorization';

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

function installSellerWallet(context) {
  return context.addInitScript(({ account, signature }) => {
    const listeners = new Map();
    const signedMessages = [];
    let connected = false;
    Object.defineProperty(window, '__ifrSellerSignedMessages', { value: signedMessages });
    const provider = {
      isMetaMask: true,
      providers: [],
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts') {
          connected = true;
          return [account];
        }
        if (method === 'eth_accounts') return connected ? [account] : [];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'personal_sign' || method === 'eth_sign') {
          signedMessages.push(params?.[0]);
          return signature;
        }
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_requestPermissions') return null;
        if (method === 'wallet_getPermissions') {
          return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        }
        if (method === 'eth_getBalance') return '0x16345785d8a0000';
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
        if (method === 'eth_getCode') return '0x01';
        throw new Error(`Unsupported seller test wallet method: ${method}`);
      },
      on: (event, listener) => {
        const current = listeners.get(event) || [];
        current.push(listener);
        listeners.set(event, current);
      },
      removeListener: (event, listener) => {
        listeners.set(event, (listeners.get(event) || []).filter((item) => item !== listener));
      },
    };
    provider.providers = [provider];
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
    window.dispatchEvent(new Event('ethereum#initialized'));
  }, { account: sellerWallet, signature: sellerSignature });
}

function installPhantomNamespaceWallet(context) {
  const account = '0x2000000000000000000000000000000000000002';
  return context.addInitScript(({ walletAddress }) => {
    const listeners = new Map();
    const methods = [];
    let connected = false;
    const provider = {
      isPhantom: true,
      request: async ({ method }) => {
        methods.push(method);
        if (method === 'eth_requestAccounts') {
          connected = true;
          return [walletAddress];
        }
        if (method === 'eth_accounts') return connected ? [walletAddress] : [];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'wallet_requestPermissions') return null;
        if (method === 'wallet_getPermissions') {
          return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        }
        if (method === 'wallet_getCapabilities') return {};
        throw new Error(`Unsupported Phantom test wallet method: ${method}`);
      },
      on: (event, listener) => {
        const current = listeners.get(event) || [];
        current.push(listener);
        listeners.set(event, current);
      },
      removeListener: (event, listener) => {
        listeners.set(event, (listeners.get(event) || []).filter((item) => item !== listener));
      },
    };
    Object.defineProperty(window, '__ifrPhantomWalletMethods', { value: methods });
    Object.defineProperty(window, 'phantom', {
      configurable: true,
      value: { ethereum: provider },
    });
  }, { walletAddress: account });
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
    { expectedPathname: pathname, expectedHash: hash },
    { timeout: 90_000 }
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
    await page.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Accepted lock source', { exact: true }).count(),
      0,
      'rule controls must stay hidden until a seller profile is loaded'
    );
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
    const gatedSellerHashes = [
      '#seller-catalog',
      '#seller-rule-editor',
      '#seller-team',
      '#seller-session-history',
      '#seller-rewards',
    ];
    for (const gatedHash of gatedSellerHashes) {
      await page.goto(`${origin}/${gatedHash}`, { waitUntil: 'domcontentloaded' });
      await waitForAttribute(sellerModeButton, 'aria-pressed', 'true');
      const gatedTarget = page.locator(`[id="${gatedHash.slice(1)}"]`);
      await gatedTarget.waitFor({ state: 'attached' });
      assert.equal(
        await gatedTarget.count(),
        1,
        `${gatedHash} must retain a profile-gate anchor before seller setup`
      );
      const sellerProfileGate = page.locator('[data-seller-profile-gate]');
      await sellerProfileGate.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).waitFor();
      await page.waitForFunction(() => {
        const gate = document.querySelector('[data-seller-profile-gate]');
        if (!gate) return false;
        const bounds = gate.getBoundingClientRect();
        return bounds.top < window.innerHeight && bounds.bottom > 0;
      });
    }
    const sellerTasks = page.getByRole('navigation', { name: 'Seller tasks', exact: true });
    await sellerTasks.getByRole('link', { name: /Profile/ }).waitFor();
    assert.equal(await sellerTasks.getByRole('link', { name: /Products/ }).count(), 0, 'product task must stay hidden until a profile exists');
    assert.equal(await sellerTasks.getByRole('link', { name: 'Team', exact: true }).count(), 0, 'team task must stay hidden until a profile exists');

    for (const viewport of [{ width: 375, height: 812 }, { width: 820, height: 1180 }]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sellerTasks.getByRole('link', { name: /Profile/ }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        false,
        `seller layout must not overflow at ${viewport.width}px`
      );
    }

    const sellerContext = await browser.newContext({ serviceWorkers: 'block' });
    await installSellerWallet(sellerContext);
    const sellerLifecycle = {
      active: true,
      deactivateCalls: 0,
      reactivateCalls: 0,
    };
    const sellerSummary = {
      id: offer.business.id,
      slug: offer.business.slug,
      name: offer.business.name,
      description: offer.business.description,
      website: offer.business.website,
      logoUrl: offer.business.logoUrl,
      serviceArea: offer.business.serviceArea,
      categories: offer.business.categories,
      ownerAddress: sellerWallet,
      verifyUrl: `/b/${offer.business.slug}`,
      qrUrl: `/b/${offer.business.slug}`,
      discountPercent: offer.discountPercent,
      requiredLockIFR: offer.requiredLockIFR,
      tierLabel: null,
      createdAt: new Date().toISOString(),
      rulesCount: 1,
      productsCount: 1,
    };
    await sellerContext.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/ready') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }),
        });
      }
      if (url.pathname === '/api/businesses') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(discoveryResponse([])),
        });
      }
      if (url.pathname === '/api/seller/auth-message') {
        const action = url.searchParams.get('action');
        const mutating = action === 'business:delete' || action === 'business:reactivate';
        assert.ok(action === 'business:list' || mutating, `unexpected seller lifecycle action: ${action}`);
        assert.equal(url.searchParams.get('businessId'), mutating ? offer.business.id : 'seller');
        assert.equal(url.searchParams.has('scope'), mutating, 'only lifecycle mutations require an exact scope');
        assert.equal(url.searchParams.has('walletAddress'), mutating, 'only lifecycle mutations issue a single-use challenge');
        if (mutating) {
          assert.equal(url.searchParams.get('scope'), offer.business.id);
          assert.equal(url.searchParams.get('walletAddress')?.toLowerCase(), sellerWallet.toLowerCase());
        }
        const timestamp = String(Date.now());
        const message = `${sellerAuthMessage}:${action}`;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            action,
            businessId: url.searchParams.get('businessId'),
            scope: url.searchParams.get('scope'),
            timestamp,
            issuedAt: new Date(Number(timestamp)).toISOString(),
            expiresAt: new Date(Number(timestamp) + 60_000).toISOString(),
            nonce: mutating ? `nonce-${action}` : undefined,
            message,
          }),
        });
      }
      if (url.pathname === '/api/seller/businesses' && request.method() === 'GET') {
        assert.equal(request.headers()['x-ifr-wallet'], sellerWallet.toLowerCase());
        assert.equal(request.headers()['x-ifr-signature'], sellerSignature);
        assert.equal(request.headers()['x-ifr-nonce'], undefined, 'read-only profile listing must not send a mutation nonce');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            businesses: sellerLifecycle.active ? [sellerSummary] : [],
            inactiveBusinesses: sellerLifecycle.active ? [] : [sellerSummary],
          }),
        });
      }
      if (
        url.pathname === `/api/seller/businesses/${offer.business.id}` &&
        request.method() === 'DELETE'
      ) {
        assert.equal(request.headers()['x-ifr-wallet'], sellerWallet.toLowerCase());
        assert.equal(request.headers()['x-ifr-signature'], sellerSignature);
        assert.equal(request.headers()['x-ifr-nonce'], 'nonce-business:delete');
        sellerLifecycle.deactivateCalls += 1;
        sellerLifecycle.active = false;
        return route.fulfill({ status: 204, body: '' });
      }
      if (
        url.pathname === `/api/seller/businesses/${offer.business.id}/reactivate` &&
        request.method() === 'POST'
      ) {
        assert.equal(request.headers()['x-ifr-wallet'], sellerWallet.toLowerCase());
        assert.equal(request.headers()['x-ifr-signature'], sellerSignature);
        assert.equal(request.headers()['x-ifr-nonce'], 'nonce-business:reactivate');
        sellerLifecycle.reactivateCalls += 1;
        sellerLifecycle.active = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sellerSummary),
        });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Unexpected seller transition request: ${request.method()} ${url.pathname}` }),
      });
    });
    await sellerContext.route('https://assets.example.com/ifr-seller-logo.png', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    }));
    const sellerPage = await sellerContext.newPage();
    const sellerPageErrors = [];
    sellerPage.on('pageerror', (error) => sellerPageErrors.push(error.message));
    await sellerPage.goto(`${origin}/#seller-workspace`, { waitUntil: 'domcontentloaded' });
    await sellerPage.getByRole('heading', { name: 'Benefit rule manager', exact: true }).waitFor();
    await sellerPage.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await sellerPage.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
    await sellerPage.getByText('up to five active and 25 total seller profiles', { exact: false }).waitFor();
    await sellerPage.getByRole('button', { name: 'Load my seller profiles', exact: true }).click();
    await sellerPage.getByText('Loaded 1 seller profile.', { exact: true }).waitFor();
    assert.deepEqual(
      await sellerPage.evaluate(() => window.__ifrSellerSignedMessages),
      [`0x${Buffer.from(`${sellerAuthMessage}:business:list`, 'utf8').toString('hex')}`],
      'the wallet must sign the exact challenge returned for profile listing'
    );
    assert.equal(
      await sellerPage.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).count(),
      0,
      'profile gate must disappear after the owner loads a seller profile'
    );
    const loadedSellerTasks = sellerPage.getByRole('navigation', { name: 'Seller tasks', exact: true });
    await loadedSellerTasks.getByRole('link', { name: /Products/ }).waitFor();
    await loadedSellerTasks.getByRole('link', { name: 'Team', exact: true }).waitFor();
    for (const gatedHash of gatedSellerHashes) {
      assert.equal(
        await sellerPage.locator(gatedHash).count(),
        1,
        `${gatedHash} must expose its advanced tool after profile load`
      );
    }
    await sellerPage.getByLabel('Accepted lock source', { exact: true }).waitFor();

    await sellerPage.getByRole('button', { name: 'Deactivate', exact: true }).click();
    const deactivationDialog = sellerPage.getByRole('dialog', { name: `Take ${offer.business.name} offline?` });
    await deactivationDialog.waitFor();
    await deactivationDialog.getByText('public catalog and scanner will stop working immediately', { exact: false }).waitFor();
    await deactivationDialog.getByText('every checkout staff wallet will be paused', { exact: false }).waitFor();
    await deactivationDialog.getByRole('button', { name: 'Keep profile active', exact: true }).waitFor();
    assert.equal(
      await sellerPage.evaluate(() => document.activeElement?.textContent?.trim()),
      'Keep profile active',
      'the safe action must receive initial dialog focus'
    );
    await sellerPage.keyboard.press('Shift+Tab');
    assert.equal(
      await sellerPage.evaluate(() => document.activeElement?.textContent?.trim()),
      'Deactivate profile',
      'backward tabbing must remain inside the modal'
    );
    await sellerPage.keyboard.press('Tab');
    assert.equal(sellerLifecycle.deactivateCalls, 0, 'opening the warning must not deactivate the profile');
    await deactivationDialog.getByRole('button', { name: 'Keep profile active', exact: true }).click();
    await deactivationDialog.waitFor({ state: 'hidden' });
    assert.equal(sellerLifecycle.deactivateCalls, 0, 'cancelling the warning must preserve the active profile');
    await sellerPage.waitForFunction(
      () => document.activeElement?.textContent?.trim() === 'Deactivate'
    );
    assert.equal(
      await sellerPage.evaluate(() => document.activeElement?.textContent?.trim()),
      'Deactivate',
      'cancelling the modal must return focus to its trigger'
    );

    await sellerPage.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await deactivationDialog.getByRole('button', { name: 'Deactivate profile', exact: true }).click();
    await sellerPage.getByText('Seller profile deactivated. Catalog, scanner, products, rules and checkout staff are paused; the permanent seller URL remains reserved.', { exact: true }).waitFor();
    assert.equal(sellerLifecycle.deactivateCalls, 1, 'confirmed deactivation must reach the API exactly once');
    await sellerPage.getByText('Deactivated profiles', { exact: true }).waitFor();
    await sellerPage.getByText(`Reserved URL: shop.ifrunit.tech/s/${offer.business.slug}`, { exact: true }).waitFor();
    await sellerPage.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).waitFor();
    assert.equal(
      await sellerPage.evaluate(() => window.localStorage.getItem('ifr.shop.lastSellerBusinessId')),
      null,
      'deactivation must not leave an inactive profile selected for the next reload'
    );

    await sellerPage.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await sellerPage.getByText('Seller profile reactivated. Its permanent URL is restored. Products and rules remain paused, and each checkout staff wallet must be authorized again.', { exact: true }).waitFor();
    assert.equal(sellerLifecycle.reactivateCalls, 1, 'reactivation must reach the API exactly once');
    await sellerPage.getByRole('button', { name: 'Deactivate', exact: true }).waitFor();
    assert.equal(await sellerPage.getByText('Deactivated profiles', { exact: true }).count(), 0);
    assert.equal(
      await sellerPage.evaluate(() => window.localStorage.getItem('ifr.shop.lastSellerBusinessId')),
      offer.business.id,
      'reactivation must restore the active profile selection'
    );
    assert.deepEqual(
      await sellerPage.evaluate(() => window.__ifrSellerSignedMessages),
      [
        `0x${Buffer.from(`${sellerAuthMessage}:business:list`, 'utf8').toString('hex')}`,
        `0x${Buffer.from(`${sellerAuthMessage}:business:delete`, 'utf8').toString('hex')}`,
        `0x${Buffer.from(`${sellerAuthMessage}:business:reactivate`, 'utf8').toString('hex')}`,
      ],
      'seller lifecycle mutations must sign their exact one-time challenges'
    );
    assert.deepEqual(sellerPageErrors, []);
    await sellerContext.close();

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

    const phantomContext = await browser.newContext({
      ...devices['Galaxy S9+'],
      serviceWorkers: 'block',
    });
    await installPhantomNamespaceWallet(phantomContext);
    await phantomContext.route('**/api/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/api/ready')
        ? { status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }
        : discoveryResponse([])),
    }));
    const phantomPage = await phantomContext.newPage();
    await phantomPage.goto(origin, { waitUntil: 'domcontentloaded' });
    const phantomWalletControl = phantomPage.locator('[data-wallet-connect-control]').first();
    await waitForAttribute(phantomWalletControl, 'data-wallet-connectors-ready', 'true');
    assert.equal(
      await phantomWalletControl.getAttribute('data-wallet-connector-ids'),
      'phantom,coinbaseWalletSDK',
      'Phantom namespace provider must be offered once alongside the universal Coinbase fallback',
    );
    await phantomWalletControl.getByText('Phantom provider', { exact: true }).waitFor();
    await phantomWalletControl.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await phantomWalletControl.getByText('0x2000...0002', { exact: true }).waitFor();
    await phantomWalletControl.getByText('Phantom', { exact: true }).last().waitFor();
    assert.equal(
      await phantomPage.evaluate(() => window.__ifrPhantomWalletMethods.includes('eth_requestAccounts')),
      true,
      'Phantom namespace provider must receive the account request',
    );
    await phantomContext.close();

    await page.goto(`${origin}/privacy`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Privacy & data, stated plainly.', exact: true }).waitFor();
    await page.evaluate(async () => {
      window.localStorage.setItem('ifr.shop.test-local', 'remove-me');
      window.localStorage.setItem('wallet.provider.test', 'preserve-me');
      window.sessionStorage.setItem('ifr.shop.test-session', 'remove-me');
      window.sessionStorage.setItem('unrelated.session.test', 'preserve-me');
      await window.caches.open('ifr-benefits-test');
      await window.caches.open('unrelated-cache-test');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('ifr.shop.test-local', { exact: false }).waitFor();
    await page.getByText('ifr.shop.test-session', { exact: false }).waitFor();
    await page.getByText('ifr-benefits-test', { exact: false }).waitFor();
    const clearLocalData = page.getByRole('button', { name: 'Clear local IFR data', exact: true });
    await clearLocalData.click();
    const confirmClear = page.getByRole('button', { name: 'Yes, clear local data', exact: true });
    await confirmClear.waitFor();
    assert.equal(await confirmClear.evaluate((element) => document.activeElement === element), true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await clearLocalData.evaluate((element) => document.activeElement === element), true);
    await page.evaluate(() => window.localStorage.setItem('ifr.shop.added-after-snapshot', 'remove-me-too'));
    await clearLocalData.click();
    await confirmClear.waitFor();
    await confirmClear.click();
    const clearedStatus = page.getByText(/Cleared \d+ ifr\.shop\.\* storage keys? and \d+ ifr-benefits-\* caches? from this browser\./);
    await clearedStatus.waitFor();
    assert.equal(await clearedStatus.evaluate((element) => document.activeElement === element), true);
    const localDataResult = await page.evaluate(async () => ({
      appLocalKeys: Object.keys(window.localStorage).filter((key) => key.startsWith('ifr.shop.')),
      appSessionKeys: Object.keys(window.sessionStorage).filter((key) => key.startsWith('ifr.shop.')),
      appCaches: (await window.caches.keys()).filter((name) => name.startsWith('ifr-benefits-')),
      unrelatedLocal: window.localStorage.getItem('wallet.provider.test'),
      unrelatedSession: window.sessionStorage.getItem('unrelated.session.test'),
      unrelatedCachePresent: (await window.caches.keys()).includes('unrelated-cache-test'),
    }));
    assert.deepEqual(localDataResult.appLocalKeys, [], 'privacy control must remove all and only ifr.shop.* localStorage keys');
    assert.deepEqual(localDataResult.appSessionKeys, [], 'privacy control must remove all and only ifr.shop.* sessionStorage keys');
    assert.deepEqual(localDataResult.appCaches, [], 'privacy control must remove all and only ifr-benefits-* caches');
    assert.equal(localDataResult.unrelatedLocal, 'preserve-me', 'privacy control must preserve wallet-provider localStorage');
    assert.equal(localDataResult.unrelatedSession, 'preserve-me', 'privacy control must preserve unrelated sessionStorage');
    assert.equal(localDataResult.unrelatedCachePresent, true, 'privacy control must preserve unrelated caches');
    await page.getByRole('link', { name: 'Privacy & data', exact: true }).waitFor();

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
