#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { chromium, devices } = require('playwright');

const baseUrl = (process.env.BENEFITS_BASE_URL || 'https://shop.ifrunit.tech').replace(/\/$/, '');
const screenshotDir = process.env.SCREENSHOT_DIR || '';
const shouldScreenshot = Boolean(screenshotDir);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

function log(message) {
  console.log(`[benefits-smoke] ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function joinUrl(route) {
  return `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
}

async function fetchJson(route) {
  const response = await fetch(joinUrl(route), { headers: { accept: 'application/json' } });
  const text = await response.text();
  assert(response.ok, `${route} returned HTTP ${response.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

async function fetchOk(route, expectedContentType) {
  const response = await fetch(joinUrl(route));
  assert(response.ok, `${route} returned HTTP ${response.status}`);
  if (expectedContentType) {
    const contentType = response.headers.get('content-type') || '';
    assert(
      contentType.includes(expectedContentType),
      `${route} content-type ${contentType || '<missing>'} does not include ${expectedContentType}`
    );
  }
  return response;
}

async function expectSha256(route, expectedHash) {
  const response = await fetchOk(route);
  const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  assert(digest === expectedHash, `${route} does not match the official IFR brand asset`);
}

async function verifyHttpSurface() {
  const rootHead = await fetch(joinUrl('/'), { method: 'HEAD' });
  assert(rootHead.ok, `/ HEAD returned HTTP ${rootHead.status}`);
  assert(
    rootHead.headers.get('cross-origin-opener-policy') !== 'same-origin',
    'Shop must not use Cross-Origin-Opener-Policy: same-origin because Coinbase Wallet needs popup communication'
  );
  log('Coinbase Wallet popup policy OK');

  const health = await fetchJson('/api/health');
  assert(health.status === 'ok', `/api/health status is ${health.status}`);
  assert(Number(health.chainId) === 1, `/api/health chainId is ${health.chainId}, expected 1`);
  log('API health OK');

  const ready = await fetchJson('/api/ready');
  assert(ready.status === 'ready', `/api/ready status is ${ready.status}`);
  assert(ready.database === 'ok', `/api/ready database is ${ready.database}`);
  assert(Number(ready.chainId) === 1, `/api/ready chainId is ${ready.chainId}, expected 1`);
  log('API readiness OK');

  const discovery = await fetchJson('/api/businesses?limit=1&page=1');
  assert(Array.isArray(discovery.offers), 'public offer discovery must return offers');
  assert(Array.isArray(discovery.categories), 'public offer discovery must return categories');
  assert(discovery.pagination?.limit === 1, 'public offer discovery must honor bounded pagination');
  assert(typeof discovery.pagination?.total === 'number', 'public offer discovery total is missing');
  log('Public offer discovery OK');

  const manifest = await fetchJson('/manifest.json');
  assert(manifest.name === 'IFR Benefits Network', 'manifest name mismatch');
  assert(manifest.display === 'standalone', 'manifest display must be standalone');
  assert(manifest.start_url === '/', 'manifest start_url must be /');
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest must expose PWA icons');
  assert(manifest.icons[0].src === '/icons/ifr-official-192-v8.png', 'manifest 192 icon mismatch');
  assert(manifest.icons[1].src === '/icons/ifr-official-512-v8.png', 'manifest 512 icon mismatch');
  assert(manifest.icons.every((icon) => icon.purpose === 'any'), 'official icons must not claim maskable safe-zone support');
  log('PWA manifest OK');

  await expectSha256('/icons/ifr-icon-32-v2.png', 'cd4f5ca2b84ee3c188c1a9940e51febd966b0796fe078a4489b413b680ff54e8');
  await expectSha256('/icons/ifr-icon-180-v2.png', '66efa6b6551151367639f4f92eb9c9766b295b12c3792c2e65bf47a0a446af76');
  await expectSha256('/icons/ifr-icon-192-v2.png', 'c2e06aa93d6ba47f30d0ccd14d2a8d9a16c04841e56cb7f4f2bb783e86fdf203');
  await expectSha256('/icons/ifr-icon-512-v2.png', '6f029513ff76f3482418da9792e6f9f3545f0cc18b88740fe1f61db50fbe87f1');
  await expectSha256('/icons/ifr-official-64-v8.png', 'f2b2d517ee789567fb6ee7a22d3836ff72926339d541cf02d2a07d823f3f79c6');
  await expectSha256('/icons/ifr-official-180-v8.png', 'e2cd8e32eac1af850c9716364c8470a0750c7a144f088326f278f416c54b28eb');
  await expectSha256('/icons/ifr-official-192-v8.png', '9f4b3e3f2c625c7f49631dc8f4bbb8504b5c8caba61499ae3dfaa2137aa7bfec');
  await expectSha256('/icons/ifr-official-256-v8.png', '0ba7fd158e41d18eb3324bfba0c829204ba39d1e30c26dffd46cf3248e6cfbaa');
  await expectSha256('/icons/ifr-official-512-v8.png', 'cde5b7cecf07c9db46c93b1e1a2c5e17ec3a99705c6442d2f600cbd939c5d2d9');
  await expectSha256('/icons/favicon-v8.ico', '407edc84c35403f81d39a461bf4f5d5a7d89cffb25b16a0968e02cdb7bbc08c8');
  await expectSha256('/favicon.ico', '407edc84c35403f81d39a461bf4f5d5a7d89cffb25b16a0968e02cdb7bbc08c8');
  await expectSha256('/icons/icon-192.png', 'c2e06aa93d6ba47f30d0ccd14d2a8d9a16c04841e56cb7f4f2bb783e86fdf203');
  await expectSha256('/icons/icon-512.png', '6f029513ff76f3482418da9792e6f9f3545f0cc18b88740fe1f61db50fbe87f1');
  await fetchOk('/favicon.ico', 'image/x-icon');
  const serviceWorker = await fetchOk('/sw.js', 'javascript');
  assert((await serviceWorker.text()).includes("ifr-benefits-v10"), 'service worker cache version mismatch');
  log('PWA assets OK');

  const auth = await fetchJson('/api/seller/auth-message?action=business:list&businessId=seller');
  assert(auth.message.includes('IFR Benefits Network - Seller Authorization'), 'seller auth message header mismatch');
  assert(auth.message.includes('Only sign this message inside shop.ifrunit.tech.'), 'seller auth safety line missing');
  assert(auth.timestamp && auth.expiresAt, 'seller auth challenge missing timestamp/expiry');
  log('Seller auth challenge OK');

  const unsignedSession = await fetch(joinUrl('/api/sessions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ businessId: 'smoke-read-only-missing-business' }),
  });
  assert(unsignedSession.status === 401, `unsigned session creation returned HTTP ${unsignedSession.status}`);
  log('Unsigned session creation blocked OK');
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: timeoutMs });
}

async function expectNoHorizontalOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert(
    widths.content <= widths.viewport + 1,
    `${label} has horizontal overflow: content ${widths.content}px, viewport ${widths.viewport}px`
  );
}

async function verifyMobileWalletLaunches(page) {
  await expectText(page, 'Open in wallet app');
  const expectedHosts = {
    metamask: 'metamask.app.link',
    trust: 'link.trustwallet.com',
    okx: 'web3.okx.com',
    phantom: 'phantom.app',
  };

  for (const [wallet, host] of Object.entries(expectedHosts)) {
    const link = page.locator(`[data-wallet-launch="${wallet}"]`);
    await link.waitFor({ timeout: timeoutMs });
    const href = await link.getAttribute('href');
    assert(href, `${wallet} wallet launch is missing href`);
    const parsed = new URL(href);
    assert(parsed.protocol === 'https:', `${wallet} wallet launch is not HTTPS`);
    assert(parsed.hostname === host, `${wallet} wallet launch host is ${parsed.hostname}, expected ${host}`);
    assert(href.includes('shop.ifrunit.tech'), `${wallet} wallet launch is not bound to the canonical Shop origin`);
    assert(!href.includes('smoke='), `${wallet} wallet launch leaks the smoke query parameter`);
  }
}

async function verifyWalletAssetRequest() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    const requestLog = [];
    Object.defineProperty(window, '__ifrWalletRequestLog', { value: requestLog, writable: false });
    window.__ifrWalletAssetMode = 'success';
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: async ({ method, params }) => {
          requestLog.push({ method, params });
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'eth_accounts') return [];
          if (method === 'wallet_switchEthereumChain') {
            if (window.__ifrWalletAssetMode === 'reject') {
              throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
            }
            return null;
          }
          if (method === 'wallet_watchAsset') {
            if (window.__ifrWalletAssetMode === 'decline') return false;
            if (window.__ifrWalletAssetMode === 'unsupported') {
              throw Object.assign(new Error('Method not found.'), { code: -32601 });
            }
            return true;
          }
          return null;
        },
        on: () => {},
        removeListener: () => {},
      },
    });
  });
  const page = await context.newPage();

  try {
    await gotoAppPage(page, '/');
    await expectText(page, 'Injected Ethereum provider');
    await page.locator('[data-wallet-action="watch-ifr"]').click();
    await expectText(page, 'Wallet accepted the IFR token-import request.');
    const requests = await page.evaluate(() => window.__ifrWalletRequestLog || []);
    const switchChainIndex = requests.findIndex((request) => request.method === 'wallet_switchEthereumChain');
    const watchAssetIndex = requests.findIndex((request) => request.method === 'wallet_watchAsset');
    assert(switchChainIndex >= 0, 'Add IFR action did not request Ethereum Mainnet');
    assert(
      requests[switchChainIndex].params?.[0]?.chainId === '0x1',
      'wallet_switchEthereumChain must target Ethereum Mainnet'
    );
    assert(watchAssetIndex > switchChainIndex, 'wallet_watchAsset ran before the Mainnet switch request');
    const watchAsset = requests.find((request) => request.method === 'wallet_watchAsset');
    assert(watchAsset, 'Add IFR action did not call wallet_watchAsset');
    assert(watchAsset.params?.type === 'ERC20', 'wallet_watchAsset type must be ERC20');
    assert(
      watchAsset.params?.options?.address === '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
      'wallet_watchAsset IFR address mismatch'
    );
    assert(watchAsset.params?.options?.symbol === 'IFR', 'wallet_watchAsset symbol mismatch');
    assert(watchAsset.params?.options?.decimals === 9, 'wallet_watchAsset decimals mismatch');
    assert(
      watchAsset.params?.options?.image === 'https://ifrunit.tech/assets/ifr_icon_256.png',
      'wallet_watchAsset official icon mismatch'
    );

    await page.evaluate(() => { window.__ifrWalletAssetMode = 'decline'; });
    await page.locator('[data-wallet-action="watch-ifr"]').click();
    await expectText(page, 'Token import cancelled in the wallet.');
    await page.evaluate(() => { window.__ifrWalletAssetMode = 'unsupported'; });
    await page.locator('[data-wallet-action="watch-ifr"]').click();
    await expectText(page, 'This wallet does not support automatic token import.');
    await page.evaluate(() => { window.__ifrWalletAssetMode = 'reject'; });
    await page.locator('[data-wallet-action="watch-ifr"]').click();
    await expectText(page, 'Token import cancelled in the wallet.');
    log('Wallet token import payload OK');
  } finally {
    await context.close();
    await browser.close();
  }
}

async function gotoAppPage(page, route) {
  await page.goto(`${baseUrl}${route}?smoke=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
}

function isIgnorableConsoleError(text) {
  return (
    text.includes('status of 404') ||
    text === 'Error checking Cross-Origin-Opener-Policy: Failed to fetch' ||
    (text.includes('Analytics SDK') && text.includes('Failed to fetch')) ||
    (text.includes('Sender: Failed to send batch') && text.includes('Failed to fetch')) ||
    (text.includes('Failed to fetch RSC payload') && text.includes('Falling back to browser navigation'))
  );
}

async function verifyPage(contextOptions, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  let expectDiscovery503 = false;
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    const expectedDiscoveryError = expectDiscovery503 && text.includes('status of 503');
    if (message.type() === 'error' && !expectedDiscoveryError && !isIgnorableConsoleError(text)) {
      errors.push(`console: ${text}`);
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 500 && !response.url().includes('query=force-error')) {
      errors.push(`HTTP ${status}: ${response.url()}`);
    }
  });

  let releaseSlowDiscovery;
  const slowDiscoveryGate = new Promise((resolve) => { releaseSlowDiscovery = resolve; });
  let resolveSlowDiscoveryDone;
  const slowDiscoveryDone = new Promise((resolve) => { resolveSlowDiscoveryDone = resolve; });
  let forcedErrorAttempts = 0;

  await page.route('**/api/businesses?**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const search = (requestUrl.searchParams.get('query') || '').toLowerCase();
    const category = requestUrl.searchParams.get('category') || '';
    const allOffers = [
      {
        id: 'smoke-discovery-coffee',
        label: 'Coffee member',
        category: 'Coffee',
        productName: 'Reserve espresso',
        discountPercent: 15,
        requiredLockIFR: 1000,
        dailyRedemptionLimit: 1,
        monthlyRedemptionLimit: 10,
        business: {
          id: 'smoke-catalog',
          name: 'Smoke Coffee',
          description: 'Neighborhood roaster for IFR members.',
          website: 'https://seller.example.com/members',
          categories: ['Food & drink', 'Events'],
        },
        product: { id: 'smoke-product', name: 'Reserve espresso', description: 'A customer-facing catalog item.' },
      },
      {
        id: 'smoke-discovery-service',
        label: 'Private member session',
        category: 'Services',
        productName: 'Private consultation',
        discountPercent: 10,
        requiredLockIFR: 2500,
        dailyRedemptionLimit: 0,
        monthlyRedemptionLimit: 0,
        business: {
          id: 'smoke-services',
          name: 'Smoke Studio',
          description: 'Private sessions for verified IFR members.',
          website: null,
          categories: ['Services'],
        },
        product: null,
      },
    ];
    if (search === 'race-old') await slowDiscoveryGate;
    if (search === 'force-error' && forcedErrorAttempts++ === 0) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Discovery temporarily unavailable.' }),
      });
      return;
    }
    const offers = search === 'race-old'
      ? [allOffers[0]]
      : search === 'race-new' || search === 'force-error'
        ? [allOffers[1]]
        : allOffers.filter((offer) => {
      const matchesCategory = !category || offer.category === category;
      const searchable = `${offer.business.name} ${offer.business.description || ''} ${offer.business.categories.join(' ')} ${offer.productName} ${offer.label} ${offer.category}`.toLowerCase();
      return matchesCategory && (!search || searchable.includes(search));
        });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        offers,
        categories: ['Coffee', 'Services'],
        pagination: { page: 1, limit: 8, total: offers.length, totalPages: offers.length ? 1 : 0, hasNext: false },
      }),
    });
    if (search === 'race-old') resolveSlowDiscoveryDone();
  });

  try {
    await gotoAppPage(page, '/');
    const officialIcon = page.getByRole('img', { name: 'Official Inferno Protocol IFR icon' });
    assert(await officialIcon.count() === 1, `${label} must render exactly one official IFR header icon`);
    assert(
      await officialIcon.getAttribute('src') === '/icons/ifr-official-256-v8.png',
      `${label} header does not use the current official IFR icon`
    );
    assert(
      await page.locator('link[rel="icon"][href="/icons/ifr-official-64-v8.png"]').count() === 1,
      `${label} must expose the official IFR PNG favicon`
    );
    assert(
      await page.locator('link[rel="shortcut icon"][href="/icons/favicon-v8.ico"]').count() === 1,
      `${label} must expose the versioned official IFR shortcut favicon`
    );
    assert(
      await page.locator('link[rel="shortcut icon"]').count() === 1,
      `${label} must not expose a competing shortcut favicon`
    );
    await expectText(page, 'Locked IFR. Benefits at checkout.');
    await expectText(page, 'Live member offers');
    await expectText(page, 'Find an IFR benefit');
    await expectText(page, 'Smoke Coffee');
    await expectText(page, 'Neighborhood roaster for IFR members.');
    await expectText(page, 'Food & drink');
    await expectText(page, 'Reserve espresso');
    await expectText(page, '15% benefit');
    const offerDiscovery = page.locator('#offers');
    await offerDiscovery.getByLabel('Category').selectOption('Services');
    await expectText(page, 'Private consultation');
    await page.getByText('Reserve espresso', { exact: true }).waitFor({ state: 'hidden', timeout: timeoutMs });
    await offerDiscovery.getByLabel('Category').selectOption('');
    await offerDiscovery.getByLabel('Search offers').fill('nothing matches this');
    await expectText(page, 'No matching active offers');
    await offerDiscovery.getByLabel('Search offers').fill('');
    await expectText(page, 'Reserve espresso');
    const staleRequestStarted = page.waitForRequest((request) => request.url().includes('query=race-old'));
    await offerDiscovery.getByLabel('Search offers').fill('race-old');
    await staleRequestStarted;
    await offerDiscovery.getByLabel('Search offers').fill('race-new');
    await expectText(page, 'Private consultation');
    releaseSlowDiscovery();
    await slowDiscoveryDone;
    await page.getByText('Reserve espresso', { exact: true }).waitFor({ state: 'hidden', timeout: timeoutMs });
    await expectText(page, 'Private consultation');
    expectDiscovery503 = true;
    await offerDiscovery.getByLabel('Search offers').fill('force-error');
    await expectText(page, 'Discovery temporarily unavailable.');
    expectDiscovery503 = false;
    await offerDiscovery.getByRole('button', { name: 'Try again' }).click();
    await expectText(page, 'Private consultation');
    await offerDiscovery.getByLabel('Search offers').fill('');
    await expectText(page, 'System readiness');
    await expectText(page, 'Live shop diagnostics');
    await expectText(page, 'API + database');
    await expectText(page, 'Ethereum Mainnet');
    await expectText(page, 'Wallet coverage');
    await expectText(page, 'Mobile app');
    await expectText(page, 'Install once. Use as customer or seller.');
    await expectText(page, 'Wallet starter kit');
    await expectText(page, 'Bring or create your IFR wallet safely.');
    await expectText(page, 'Non-custodial');
    await expectText(page, 'Protect recovery');
    await expectText(page, 'IFR liquidity can be thin.');
    if (label === 'ipad') {
      await expectText(page, 'iPad/iPhone steps');
      await expectText(page, 'iOS does not show a real in-page install prompt');
    } else {
      await expectText(page, 'Install help');
    }
    await expectText(page, 'Wallet entry');
    await expectText(page, 'Wallet diagnostics');
    await expectText(page, 'No injected provider');
    await expectText(page, 'WalletConnect modal is not configured yet');
    await expectText(page, 'Copy evidence');
    await expectText(page, 'Share evidence');
    await expectText(page, 'Copy link');
    if (label === 'ipad' || label === 'android') {
      await verifyMobileWalletLaunches(page);
    }
    await expectNoHorizontalOverflow(page, `${label} home`);
    await expectText(page, 'Checkout readiness');
    await expectText(page, 'Current tier');
    await expectText(page, 'Lock transaction path');
    await expectText(page, 'IFR amount to lock');
    await expectText(page, 'Allowance');
    await expectText(page, 'Recommended next step');
    await expectText(page, 'Quick tier amounts');
    await expectText(page, 'Silver / 5,000 IFR');
    await expectText(page, 'Unlock all');
    await expectText(page, 'Recent customer proofs');
    await expectText(page, 'No customer proofs saved on this device yet');
    await page.evaluate(() => {
      window.localStorage.setItem(
        'ifr.shop.customerProofHistory.v1',
        JSON.stringify([
          {
            sessionId: 'smoke-customer-session',
            businessId: 'smoke-business',
            sellerName: 'Smoke Coffee',
            status: 'APPROVED',
            discountPercent: 12,
            requiredLockIFR: 1000,
            ruleLabel: 'Smoke Bronze',
            productName: 'Counter checkout',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            redeemedAt: null,
            walletLabel: '0x1234...abcd',
            savedAt: new Date().toISOString(),
          },
        ])
      );
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await expectText(page, 'Recent customer proofs');
    await expectText(page, 'Smoke Coffee');
    await expectText(page, 'Counter checkout / 12% / 1,000 IFR');
    await expectText(page, '0x1234...abcd');
    await expectText(page, 'Reopen proof');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expectText(page, 'No customer proofs saved on this device yet');
    if (shouldScreenshot) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, `benefits-home-${label}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: /Seller Offer discounts/i }).click();
    await expectText(page, 'Create a seller entry point');
    await expectText(page, 'Seller categories');
    const codeGenerator = page.locator('#integrate');
    await codeGenerator.getByLabel('Business ID').fill('shop/"unsafe');
    await codeGenerator.getByRole('button', { name: 'link', exact: true }).click();
    await expectText(page, 'shop%2F%22unsafe');
    await codeGenerator.getByRole('button', { name: 'api', exact: true }).click();
    await expectText(page, 'Action: sessions:create');
    await expectText(page, 'Required signed headers');
    await expectText(page, 'x-ifr-nonce');
    await codeGenerator.getByRole('button', { name: 'pos', exact: true }).click();
    await expectText(page, 'createIFRCheckout');
    await expectText(page, 'customerUrl');
    await expectText(page, 'Server-side POS JavaScript');
    await expectText(page, 'Seller readiness');
    await expectText(page, 'New benefit rule');
    await expectText(page, 'Uses per wallet / UTC day');
    await expectText(page, 'Uses per wallet / UTC month');
    await expectText(page, 'Per wallet: 1 / UTC day and 10 / UTC month');
    await expectText(page, 'Save new rule');
    await page.getByRole('heading', { name: 'Connect seller wallet' }).first().waitFor({ timeout: timeoutMs });
    await expectText(page, 'Active benefit rule loaded');
    await expectText(page, 'Load profiles');
    await expectText(page, 'Create profile');
    await expectText(page, 'Create a seller profile');
    await expectText(page, 'Public description');
    await expectText(page, 'Seller website');
    await expectText(page, 'Business categories');
    await page.getByPlaceholder('Add another category').waitFor({ timeout: timeoutMs });
    await page.getByPlaceholder('cuid...').fill('smoke-manual-business');
    await expectText(page, 'Load existing seller profile');
    await expectText(page, 'Load existing profile');
    await expectText(page, 'Seller catalog');
    await expectText(page, 'Products and services');
    await expectText(page, 'Load catalog');
    await expectText(page, 'Customer view');
    await expectText(page, 'Catalog binding');
    await expectText(page, 'Counter team');
    await expectText(page, 'Delegate checkout access');
    await expectText(page, 'Load team');
    await expectText(page, 'Add operator');
    await expectText(page, 'Share with the counter team');
    await expectText(page, 'Staff scanner QR');
    await expectText(page, 'Show this QR at the counter.');
    await expectText(page, 'Share kit');
    await expectText(page, 'Seller recovery');
    await expectText(page, 'Move this seller setup to another device');
    await expectText(page, 'Copy backup');
    await expectText(page, 'Restore setup');
    await expectText(page, 'Session history');
    await expectText(page, 'proof links and restore receipts');
    await expectText(page, 'Seller activity');
    await expectText(page, 'Inferno Protocol');
    if (shouldScreenshot) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, `benefits-seller-${label}.png`),
        fullPage: true,
      });
    }

    await gotoAppPage(page, '/guide');
    await expectText(page, 'IFR Benefits Network Guide');
    await expectText(page, 'Customer path');
    await expectText(page, 'Lock IFR in the shop app when needed');
    await expectText(page, 'The Benefits Network is non-custodial');
    await expectText(page, 'Recovery and phishing safety');
    await expectText(page, 'Seller path');

    await gotoAppPage(page, '/b/smoke-missing-business');
    await expectText(page, 'Seller scanner');
    await expectText(page, 'Business console');
    await expectText(page, 'Checkout readiness');
    await expectText(page, 'Session recovery');
    await expectText(page, 'Restore last QR');
    await expectText(page, 'Restore pasted');
    await page
      .getByPlaceholder('Paste session ID, customer link or checkout receipt')
      .fill('smoke-session-id');
    await expectText(page, 'Load business');
    await expectText(page, 'Seller profile loaded');
    await expectText(page, 'Copy customer link');
    await expectText(page, 'Checkout receipt');
    await expectText(page, 'Copy receipt');
    await expectText(page, 'Checkout wallet');
    await expectText(page, 'Connect owner or checkout operator');
    await expectText(page, 'Open customer catalog');
    if (shouldScreenshot) {
      await page.screenshot({
        path: path.join(screenshotDir, `benefits-scanner-${label}.png`),
        fullPage: true,
      });
    }

    await page.route('**/api/businesses/smoke-catalog/products', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          business: {
            id: 'smoke-catalog',
            name: 'Smoke Coffee',
            description: 'Neighborhood roaster for IFR members.',
            website: 'https://seller.example.com/members',
            categories: ['Food & drink', 'Events'],
          },
          products: [{
            id: 'smoke-product',
            businessId: 'smoke-catalog',
            name: 'Reserve espresso',
            category: 'Coffee',
            description: 'A customer-facing catalog item.',
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            benefitRules: [{
              id: 'smoke-rule',
              label: 'Coffee member',
              discountPercent: 15,
              requiredLockIFR: 1000,
              ttlSeconds: 90,
              dailyRedemptionLimit: 1,
              monthlyRedemptionLimit: 10,
            }],
          }],
        }),
      });
    });
    await gotoAppPage(page, '/s/smoke-catalog');
    await expectText(page, 'IFR member benefits');
    await expectText(page, 'Smoke Coffee');
    await expectText(page, 'Neighborhood roaster for IFR members.');
    await expectText(page, 'Food & drink');
    await expectText(page, 'Reserve espresso');
    await expectText(page, '15% benefit');
    await expectText(page, '1,000 locked IFR');
    await expectText(page, 'Per wallet: 1 / UTC day and 10 / UTC month');
    await expectText(page, 'Seller starts a one-time QR checkout');
    const sellerWebsite = page.getByRole('link', { name: 'Seller website' });
    assert(await sellerWebsite.getAttribute('href') === 'https://seller.example.com/members', 'seller website href mismatch');
    assert(await sellerWebsite.getAttribute('rel') === 'noopener', 'seller website must use rel="noopener"');
    if (shouldScreenshot) {
      await page.screenshot({
        path: path.join(screenshotDir, `benefits-catalog-${label}.png`),
        fullPage: true,
      });
    }

    await gotoAppPage(page, '/r/smoke-missing-session');
    await expectText(page, 'Customer proof');
    await expectText(page, 'Proof readiness');
    await expectText(page, 'Load verification');
    await expectText(page, 'QR session loaded');
    await expectText(page, 'Refresh status');
    await expectText(page, 'Customer recovery');
    await expectText(page, 'Need more locked IFR?');
    await expectText(page, 'Customer proof receipt');
    await expectText(page, 'Copy proof');
    await expectText(page, 'Share proof');

    assert(errors.length === 0, `${label} browser errors:\n${errors.join('\n')}`);

    if (shouldScreenshot) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, `benefits-smoke-${label}.png`),
        fullPage: true,
      });
    }
    log(`${label} browser smoke OK`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  log(`Target ${baseUrl}`);
  await verifyHttpSurface();
  await verifyWalletAssetRequest();
  await verifyPage({ viewport: { width: 1440, height: 1100 } }, 'desktop');
  await verifyPage(devices['iPad Pro 11'], 'ipad');
  await verifyPage(devices['Pixel 7'], 'android');
  log('PASS');
}

main().catch((error) => {
  console.error(`[benefits-smoke] FAIL: ${error.message}`);
  process.exit(1);
});
