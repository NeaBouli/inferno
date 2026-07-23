#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { utils: ethersUtils } = require('ethers');
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
  for (const [header, expected] of [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['referrer-policy', 'no-referrer'],
  ]) {
    assert(rootHead.headers.get(header) === expected, `Shop ${header} must be ${expected}`);
  }
  assert(rootHead.headers.get('permissions-policy')?.includes('camera=(self)'), 'Shop camera policy must allow only this origin');
  assert(rootHead.headers.get('strict-transport-security')?.includes('max-age=63072000'), 'Shop HSTS policy is missing');
  assert(!rootHead.headers.has('x-powered-by'), 'Shop must not disclose the Next.js powered-by header');
  assert(
    rootHead.headers.get('cross-origin-opener-policy') !== 'same-origin',
    'Shop must not use Cross-Origin-Opener-Policy: same-origin because Coinbase Wallet needs popup communication'
  );
  const apiHead = await fetch(joinUrl('/api/health'), { method: 'HEAD' });
  assert(apiHead.ok, `/api/health HEAD returned HTTP ${apiHead.status}`);
  assert(apiHead.headers.get('x-content-type-options') === 'nosniff', 'Benefits API must send nosniff');
  assert(apiHead.headers.get('x-frame-options') === 'DENY', 'Benefits API must deny framing');
  assert(apiHead.headers.get('referrer-policy') === 'no-referrer', 'Benefits API must suppress referrers');
  assert(!apiHead.headers.has('x-powered-by'), 'Benefits API must not disclose Express or Next.js');
  log('Response security and Coinbase Wallet popup policy OK');

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
  assert(Array.isArray(discovery.serviceAreas), 'public offer discovery must return service areas');
  assert(discovery.pagination?.limit === 1, 'public offer discovery must honor bounded pagination');
  assert(typeof discovery.pagination?.total === 'number', 'public offer discovery total is missing');
  log('Public offer discovery OK');

  const manifest = await fetchJson('/manifest.json');
  assert(manifest.name === 'IFR Benefits Network', 'manifest name mismatch');
  assert(manifest.display === 'standalone', 'manifest display must be standalone');
  assert(manifest.start_url === '/', 'manifest start_url must be /');
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest must expose PWA icons');
  assert(manifest.icons[0].src === '/icons/ifr-token-192-v11.png', 'manifest 192 icon mismatch');
  assert(manifest.icons[1].src === '/icons/ifr-token-512-v11.png', 'manifest 512 icon mismatch');
  assert(manifest.icons.every((icon) => icon.purpose === 'any'), 'official icons must not claim maskable safe-zone support');
  log('PWA manifest OK');

  await expectSha256('/icons/ifr-icon-32-v2.png', 'cd4f5ca2b84ee3c188c1a9940e51febd966b0796fe078a4489b413b680ff54e8');
  await expectSha256('/icons/ifr-icon-180-v2.png', '66efa6b6551151367639f4f92eb9c9766b295b12c3792c2e65bf47a0a446af76');
  await expectSha256('/icons/ifr-icon-192-v2.png', 'c2e06aa93d6ba47f30d0ccd14d2a8d9a16c04841e56cb7f4f2bb783e86fdf203');
  await expectSha256('/icons/ifr-icon-512-v2.png', '6f029513ff76f3482418da9792e6f9f3545f0cc18b88740fe1f61db50fbe87f1');
  await expectSha256('/icons/ifr-token-64-v11.png', '81b6502f5d9e8ccf610edbce49c8a28333edf3740fe1748fd39160d5fe8e4bf0');
  await expectSha256('/icons/ifr-token-180-v11.png', '66efa6b6551151367639f4f92eb9c9766b295b12c3792c2e65bf47a0a446af76');
  await expectSha256('/icons/ifr-token-192-v11.png', 'c2e06aa93d6ba47f30d0ccd14d2a8d9a16c04841e56cb7f4f2bb783e86fdf203');
  await expectSha256('/icons/ifr-token-256-v11.png', 'e16d4ed9e2fdd6907ad718e57700ae3931fbef1843a05f578413b08c947f3d48');
  await expectSha256('/icons/ifr-token-512-v11.png', '6f029513ff76f3482418da9792e6f9f3545f0cc18b88740fe1f61db50fbe87f1');
  await expectSha256('/icons/favicon-v11.ico', 'a3aed7b164e483413f361b08fbdd16465bc84a140109bdd552ec4e242f5c5d3c');
  await expectSha256('/favicon.ico', 'a3aed7b164e483413f361b08fbdd16465bc84a140109bdd552ec4e242f5c5d3c');
  await expectSha256('/icons/icon-192.png', 'c2e06aa93d6ba47f30d0ccd14d2a8d9a16c04841e56cb7f4f2bb783e86fdf203');
  await expectSha256('/icons/icon-512.png', '6f029513ff76f3482418da9792e6f9f3545f0cc18b88740fe1f61db50fbe87f1');
  await fetchOk('/favicon.ico', 'image/x-icon');
  const serviceWorker = await fetchOk('/sw.js', 'javascript');
  assert((await serviceWorker.text()).includes("ifr-benefits-v14"), 'service worker cache version mismatch');
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

function eligibilityDiscoveryResponse() {
  const business = {
    id: 'smoke-eligibility-catalog',
    name: 'Eligibility Coffee',
    description: 'Wallet-local eligibility preview.',
    website: null,
    serviceArea: 'Online',
    categories: ['Coffee'],
  };
  return {
    offers: [
      {
        id: 'smoke-eligibility-ready',
        label: 'Member cup',
        category: 'Coffee',
        productName: 'Member espresso',
        discountPercent: 10,
        requiredLockIFR: 1000,
        dailyRedemptionLimit: 1,
        monthlyRedemptionLimit: 10,
        business,
        product: null,
      },
      {
        id: 'smoke-eligibility-more',
        label: 'Premium roast',
        category: 'Coffee',
        productName: 'Premium reserve',
        discountPercent: 15,
        requiredLockIFR: 2500,
        dailyRedemptionLimit: 1,
        monthlyRedemptionLimit: 4,
        business,
        product: null,
      },
    ],
    categories: ['Coffee'],
    serviceAreas: ['Online'],
    pagination: { page: 1, limit: 8, total: 2, totalPages: 1, hasNext: false },
  };
}

async function installEligibilityRoutes(page) {
  await page.route('**/api/businesses?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(eligibilityDiscoveryResponse()),
    });
  });
  await page.route('**/api/businesses/smoke-eligibility-catalog/products', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        business: eligibilityDiscoveryResponse().offers[0].business,
        products: [{
          id: 'smoke-eligibility-product',
          businessId: 'smoke-eligibility-catalog',
          name: 'Premium reserve',
          category: 'Coffee',
          description: 'A deterministic eligibility catalog item.',
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          benefitRules: [{
            id: 'smoke-eligibility-rule',
            label: 'Premium roast',
            discountPercent: 15,
            requiredLockIFR: 2500,
            ttlSeconds: 90,
            dailyRedemptionLimit: 1,
            monthlyRedemptionLimit: 4,
          }],
        }],
      }),
    });
  });
}

async function installEligibilityRpc(page, { rpcError = false, lockedRaw = '1500125000000' } = {}) {
  const multicall = new ethersUtils.Interface([
    'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
  ]);
  const lockedResult = ethersUtils.defaultAbiCoder.encode(['uint256'], [lockedRaw]);
  const rpcMethods = [];
  await page.route('https://eth.merkle.io/', async (route) => {
    const payload = route.request().postDataJSON();
    rpcMethods.push(payload.method);
    if (rpcError) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'Eligibility RPC unavailable.' } }),
      });
      return;
    }
    const callData = payload.params?.[0]?.data || '';
    const result = callData.startsWith(multicall.getSighash('aggregate3'))
      ? multicall.encodeFunctionResult('aggregate3', [
          multicall.decodeFunctionData('aggregate3', callData).calls.map(() => [true, lockedResult]),
        ])
      : lockedResult;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }),
    });
  });
  return rpcMethods;
}

async function addEligibilityWallet(context, { rpcError = false } = {}) {
  await context.addInitScript(({ shouldFail }) => {
    const listeners = new Map();
    const methods = [];
    let currentChainId = '0x1';
    let walletAddress = '0x2222222222222222222222222222222222222222';
    const lockedRaw = BigInt('1500125000000');
    Object.defineProperty(window, '__ifrSetEligibilityChain', {
      configurable: false,
      value: (chainId) => {
        currentChainId = chainId;
        const listener = listeners.get('chainChanged');
        if (listener) listener(chainId);
      },
    });
    Object.defineProperty(window, '__ifrEligibilityWalletMethods', {
      configurable: false,
      value: methods,
    });
    Object.defineProperty(window, '__ifrSetEligibilityWallet', {
      configurable: false,
      value: (nextWalletAddress) => {
        walletAddress = nextWalletAddress;
        const listener = listeners.get('accountsChanged');
        if (listener) listener(nextWalletAddress ? [nextWalletAddress] : []);
      },
    });
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        isMetaMask: true,
        request: async ({ method }) => {
          methods.push(method);
          if (method === 'eth_chainId') return currentChainId;
          if (method === 'net_version') return String(Number.parseInt(currentChainId, 16));
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [walletAddress];
          if (method === 'personal_sign') return `0x${'44'.repeat(64)}1b`;
          if (method === 'eth_call') {
            if (shouldFail) throw Object.assign(new Error('Eligibility RPC unavailable.'), { code: -32000 });
            return `0x${lockedRaw.toString(16).padStart(64, '0')}`;
          }
          if (method === 'eth_getBalance') return '0x0';
          if (method === 'eth_blockNumber') return '0x1';
          if (method === 'eth_getCode') return '0x01';
          if (method === 'wallet_switchEthereumChain') return null;
          if (method === 'wallet_getCapabilities') return {};
          return null;
        },
        on: (event, listener) => listeners.set(event, listener),
        removeListener: (event) => listeners.delete(event),
      },
    });
  }, { shouldFail: rpcError });
}

async function verifyCustomerWalletHistory() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await addEligibilityWallet(context);
  const page = await context.newPage();
  const expectedWallet = '0x2222222222222222222222222222222222222222';
  let challengeCount = 0;
  let authorizationCount = 0;
  let historyRequestCount = 0;
  const historyRequests = [];

  await page.route('**/api/customer/history**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/customer/history/challenge') {
      challengeCount += 1;
      const body = request.postDataJSON();
      assert(body.walletAddress.toLowerCase() === expectedWallet, 'customer history challenge used the wrong wallet');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: `IFR Benefits Network - Customer History Authorization\nNonce: smoke-customer-${challengeCount}`,
          nonce: `${String(challengeCount).padStart(64, '0')}`,
          expiresAt: '2026-07-19T09:10:00.000Z',
        }),
      });
      return;
    }
    if (url.pathname === '/api/customer/history/authorize') {
      authorizationCount += 1;
      const body = request.postDataJSON();
      assert(body.walletAddress.toLowerCase() === expectedWallet, 'customer history authorization used the wrong wallet');
      assert(Boolean(body.signature), 'customer history authorization omitted the wallet signature');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accessToken: `customer-access-token-${authorizationCount}`, expiresAt: '2026-07-19T09:15:00.000Z' }),
      });
      return;
    }
    if (url.pathname === '/api/customer/history' && request.method() === 'GET') {
      historyRequestCount += 1;
      historyRequests.push({
        authorization: request.headers().authorization,
        cursor: url.searchParams.get('cursor'),
        snapshot: url.searchParams.get('snapshot'),
      });
      if (historyRequestCount === 2) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Customer history access expired' }),
        });
        return;
      }
      if (historyRequestCount === 4) await new Promise((resolve) => setTimeout(resolve, 300));
      const older = Boolean(url.searchParams.get('cursor'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: older ? [{
            id: 'customer-benefit-older',
            status: 'APPROVED',
            reason: null,
            expiresAt: '2026-07-18T09:10:00.000Z',
            createdAt: '2026-07-18T09:00:00.000Z',
            updatedAt: '2026-07-18T09:01:00.000Z',
            redeemedAt: null,
            seller: { id: 'smoke-seller-older', name: 'Older IFR Studio' },
            benefit: {
              benefitRuleId: 'older-rule', label: 'Studio access', category: 'Services',
              productName: 'Member session', discountPercent: 10, requiredLockIFR: 2500,
              dailyRedemptionLimit: 0, monthlyRedemptionLimit: 0,
            },
          }] : [{
            id: 'customer-benefit-redeemed',
            status: 'REDEEMED',
            reason: null,
            expiresAt: '2026-07-19T09:10:00.000Z',
            createdAt: '2026-07-19T09:00:00.000Z',
            updatedAt: '2026-07-19T09:05:00.000Z',
            redeemedAt: '2026-07-19T09:05:00.000Z',
            seller: { id: 'smoke-seller-coffee', name: 'IFR Coffee House' },
            benefit: {
              benefitRuleId: 'coffee-rule', label: 'Premium coffee', category: 'Coffee',
              productName: 'Reserve espresso', discountPercent: 15, requiredLockIFR: 1000,
              dailyRedemptionLimit: 1, monthlyRedemptionLimit: 4,
            },
          }],
          pagination: older
            ? { limit: 20, hasMore: false, nextCursor: null, snapshot: '2026-07-19T09:06:00.000Z' }
            : { limit: 20, hasMore: true, nextCursor: 'customer-benefit-redeemed', snapshot: '2026-07-19T09:06:00.000Z' },
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not mocked' }) });
  });
  await installEligibilityRoutes(page);
  await installEligibilityRpc(page);

  try {
    await gotoAppPage(page, '/');
    await connectEligibilityWallet(page);
    await expectText(page, 'Connected: 0x2222...2222');
    await page.getByRole('button', { name: 'Load wallet history', exact: true }).click();
    await expectText(page, 'IFR Coffee House');
    await expectText(page, 'Loaded 1 verified benefit for this wallet.');
    assert(challengeCount === 1 && authorizationCount === 1, 'initial customer history load did not use one signed access exchange');
    assert(historyRequests[0].authorization === 'Bearer customer-access-token-1', 'customer history omitted its memory-only access token');

    await page.getByRole('button', { name: 'Load older benefits', exact: true }).click();
    await expectText(page, 'Older IFR Studio');
    await expectText(page, 'Loaded 1 older benefit.');
    assert(challengeCount === 2 && authorizationCount === 2, 'expired customer history access was not reauthorized once');
    assert(historyRequests[1].cursor === 'customer-benefit-redeemed', 'older customer history used the wrong cursor');
    assert(historyRequests[1].snapshot === '2026-07-19T09:06:00.000Z', 'older customer history lost the fixed snapshot');
    assert(historyRequests[2].authorization === 'Bearer customer-access-token-2', 'reauthorized history did not use the refreshed token');
    if (shouldScreenshot) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.getByRole('heading', { name: 'My benefits', exact: true })
        .locator('xpath=ancestor::section[1]')
        .screenshot({
          animations: 'disabled',
          path: path.join(screenshotDir, 'benefits-customer-wallet-history.png'),
        });
    }

    await page.evaluate(() => window.__ifrSetEligibilityWallet('0x3333333333333333333333333333333333333333'));
    await expectText(page, 'Connected: 0x3333...3333');
    assert(await page.getByText('IFR Coffee House', { exact: true }).count() === 0, 'wallet switch exposed the previous customer history');

    await page.evaluate((walletAddress) => window.__ifrSetEligibilityWallet(walletAddress), expectedWallet);
    await expectText(page, 'Connected: 0x2222...2222');
    await page.getByRole('button', { name: 'Load wallet history', exact: true }).click();
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__ifrSetEligibilityWallet('0x3333333333333333333333333333333333333333'));
    await page.waitForTimeout(400);
    assert(await page.getByText('IFR Coffee House', { exact: true }).count() === 0, 'stale customer history rendered after a wallet switch');
    assert(
      await page.getByRole('button', { name: 'Load wallet history', exact: true }).isEnabled(),
      'wallet switch left customer history stuck in a loading state'
    );
    assert(await page.getByText(expectedWallet, { exact: false }).count() === 0, 'customer history UI exposed a full wallet address');
    log('Signed cross-device customer history OK');
  } finally {
    await context.close();
    await browser.close();
  }
}

async function connectEligibilityWallet(page) {
  await page.waitForLoadState('networkidle', { timeout: timeoutMs });
  const connectButton = page.getByRole('button', { name: 'Connect wallet', exact: true }).first();
  if (await connectButton.isVisible()) await connectButton.click();
}

async function verifyOfferEligibility() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await addEligibilityWallet(context);
  const page = await context.newPage();
  const writes = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
  });
  await installEligibilityRoutes(page);
  const rpcMethods = await installEligibilityRpc(page);

  try {
    await gotoAppPage(page, '/');
    await expectText(page, 'Member espresso');
    await connectEligibilityWallet(page);
    await expectText(page, 'Eligible with this wallet');
    await expectText(page, 'Lock 999.875 more IFR');
    assert(
      await page.locator('[data-offer-eligibility="ready"]').count() === 2,
      'both offer cards must share the successful IFRLock read'
    );
    await expectNoHorizontalOverflow(page, 'connected eligibility home');
    if (shouldScreenshot) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.locator('#offers').screenshot({
        animations: 'disabled',
        path: path.join(screenshotDir, 'benefits-offer-eligibility-connected.png'),
      });
    }

    await gotoAppPage(page, '/s/smoke-eligibility-catalog');
    await expectText(page, 'Premium reserve');
    await expectText(page, 'Lock 999.875 more IFR');
    await expectNoHorizontalOverflow(page, 'connected eligibility catalog');
    if (shouldScreenshot) {
      await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: path.join(screenshotDir, 'benefits-catalog-eligibility-connected.png'),
      });
    }
    await page.evaluate(() => window.__ifrSetEligibilityChain('0xaa36a7'));
    await expectText(page, 'Switch to Ethereum Mainnet');
    assert(
      await page.getByText('Eligible with this wallet', { exact: true }).count() === 0,
      'wrong-chain state must not retain an Eligible result'
    );
    assert(writes.length === 0, `eligibility preview triggered unexpected API writes: ${writes.join(', ')}`);
    assert(rpcMethods.length > 0 && rpcMethods.every((method) => method === 'eth_call'), 'eligibility preview used a state-changing JSON-RPC method');
    const walletMethods = await page.evaluate(() => window.__ifrEligibilityWalletMethods || []);
    const readOnlyWalletMethods = new Set([
      'wallet_requestPermissions',
      'eth_requestAccounts',
      'eth_accounts',
      'eth_chainId',
      'net_version',
      'wallet_getCapabilities',
      'eth_call',
      'eth_getBalance',
      'eth_blockNumber',
      'eth_getCode',
    ]);
    const unexpectedWalletMethods = walletMethods.filter((method) => !readOnlyWalletMethods.has(method));
    assert(unexpectedWalletMethods.length === 0, `eligibility preview used a non-read-only wallet method: ${unexpectedWalletMethods.join(', ')}`);
  } finally {
    await context.close();
  }

  const exactContext = await browser.newContext({ serviceWorkers: 'block' });
  await addEligibilityWallet(exactContext);
  const exactPage = await exactContext.newPage();
  await installEligibilityRoutes(exactPage);
  await installEligibilityRpc(exactPage, { lockedRaw: '1000000000000' });
  try {
    await gotoAppPage(exactPage, '/');
    await expectText(exactPage, 'Member espresso');
    await connectEligibilityWallet(exactPage);
    await expectText(exactPage, 'Eligible with this wallet');
    assert(
      await exactPage.getByText('Eligible with this wallet', { exact: true }).count() === 1,
      'exact requiredRaw equality must be eligible'
    );
  } finally {
    await exactContext.close();
  }

  const belowContext = await browser.newContext({ serviceWorkers: 'block' });
  await addEligibilityWallet(belowContext);
  const belowPage = await belowContext.newPage();
  await installEligibilityRoutes(belowPage);
  await installEligibilityRpc(belowPage, { lockedRaw: '999999999999' });
  try {
    await gotoAppPage(belowPage, '/');
    await expectText(belowPage, 'Member espresso');
    await connectEligibilityWallet(belowPage);
    await expectText(belowPage, 'Lock 0.001 more IFR');
    assert(
      await belowPage.getByText('Eligible with this wallet', { exact: true }).count() === 0,
      'requiredRaw minus one unit must not be eligible'
    );
  } finally {
    await belowContext.close();
  }

  const errorContext = await browser.newContext({ serviceWorkers: 'block' });
  await addEligibilityWallet(errorContext, { rpcError: true });
  const errorPage = await errorContext.newPage();
  await installEligibilityRoutes(errorPage);
  await installEligibilityRpc(errorPage, { rpcError: true });
  try {
    await gotoAppPage(errorPage, '/');
    await expectText(errorPage, 'Member espresso');
    await connectEligibilityWallet(errorPage);
    await expectText(errorPage, 'Eligibility unavailable');
    assert(
      await errorPage.getByText('Eligible with this wallet', { exact: true }).count() === 0,
      'RPC failure must never render Eligible'
    );
    log('Per-offer IFRLock eligibility fail-closed states OK');
  } finally {
    await errorContext.close();
    await browser.close();
  }
}

async function verifyRuleTemplateAuthorization() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const sellerWallet = '0x1111111111111111111111111111111111111111';
  const businessId = 'smoke-template-business';
  const productId = 'smoke-template-product';
  const mutatingRequests = [];
  const challengeRequests = [];
  let historyRequestCount = 0;

  await context.addInitScript(({ walletAddress }) => {
    const listeners = new Map();
    let activeWalletAddress = walletAddress;
    window.__setSmokeSellerWallet = (nextWalletAddress) => {
      activeWalletAddress = nextWalletAddress;
      const listener = listeners.get('accountsChanged');
      if (listener) listener([nextWalletAddress]);
    };
    window.__disconnectSmokeSellerWallet = () => {
      activeWalletAddress = '';
      const listener = listeners.get('accountsChanged');
      if (listener) listener([]);
    };
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        isMetaMask: true,
        request: async ({ method }) => {
          if (method === 'eth_chainId') return '0x1';
          if (method === 'net_version') return '1';
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [activeWalletAddress];
          if (method === 'personal_sign') return `0x${'11'.repeat(64)}1b`;
          if (method === 'eth_call') return `0x${'00'.repeat(32)}`;
          if (method === 'eth_getBalance') return '0x0';
          if (method === 'eth_blockNumber') return '0x1';
          if (method === 'eth_getCode') return '0x';
          if (method === 'eth_estimateGas') return '0x5208';
          if (method === 'wallet_switchEthereumChain') return null;
          if (method === 'wallet_getCapabilities') return {};
          return null;
        },
        on: (event, listener) => listeners.set(event, listener),
        removeListener: (event) => listeners.delete(event),
      },
    });
  }, { walletAddress: sellerWallet });

  const page = await context.newPage();
  await page.route('**/api/businesses?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        offers: [],
        categories: [],
        serviceAreas: [],
        pagination: { page: 1, limit: 8, total: 0, totalPages: 0, hasNext: false },
      }),
    });
  });
  await page.route('**/api/seller/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method !== 'GET') {
      mutatingRequests.push({
        url: url.pathname,
        method,
        headers: request.headers(),
        body: request.postData() ? request.postDataJSON() : null,
      });
    }
    if (url.pathname === '/api/seller/auth-message') {
      const action = url.searchParams.get('action') || '';
      const targetBusinessId = url.searchParams.get('businessId') || '';
      const scope = url.searchParams.get('scope');
      challengeRequests.push({ action, businessId: targetBusinessId, scope });
      const timestamp = String(Date.now());
      const nonce = scope ? `nonce-${action}` : undefined;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: [
            'IFR Benefits Network - Seller Authorization',
            `Action: ${action}`,
            `Business: ${targetBusinessId}`,
            `Timestamp: ${timestamp}`,
            ...(scope && nonce ? [`Scope: ${scope}`, `Nonce: ${nonce}`] : []),
            'Only sign this message inside shop.ifrunit.tech.',
          ].join('\n'),
          timestamp,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          nonce,
        }),
      });
      return;
    }
    if (url.pathname === `/api/seller/businesses/${businessId}/products` && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          products: [{
            id: productId,
            businessId,
            name: 'Bound catalog service',
            category: 'Coffee',
            description: 'Stable product binding for the template authorization smoke.',
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            _count: { benefitRules: 0 },
          }],
        }),
      });
      return;
    }
    if (url.pathname === `/api/seller/businesses/${businessId}/sessions` && method === 'GET') {
      historyRequestCount += 1;
      if (historyRequestCount > 1) await new Promise((resolve) => setTimeout(resolve, 300));
      if (historyRequestCount === 4) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Seller authorization expired' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: url.searchParams.get('cursor') ? [
            {
              id: 'session-older-csv',
              status: 'EXPIRED',
              recoveredAddress: null,
              lockAmountRaw: null,
              reason: 'QR session expired',
              expiresAt: '2026-07-18T08:35:00.000Z',
              createdAt: '2026-07-18T08:31:00.000Z',
              updatedAt: '2026-07-18T08:35:00.000Z',
              redeemedAt: null,
              attestAttempts: 0,
              benefitRuleId: null,
              label: 'Older benefit',
              category: 'Coffee',
              productName: 'Older product',
              discountPercent: 5,
              requiredLockIFR: 500,
              dailyRedemptionLimit: 1,
              monthlyRedemptionLimit: 1,
            },
          ] : [
            {
              id: 'session-redeemed-csv',
              status: 'REDEEMED',
              recoveredAddress: '0x2222222222222222222222222222222222222222',
              lockAmountRaw: '1500.000000000',
              reason: null,
              expiresAt: '2026-07-19T08:30:00.000Z',
              createdAt: '2026-07-19T08:28:00.000Z',
              updatedAt: '2026-07-19T08:29:00.000Z',
              redeemedAt: '2026-07-19T08:29:30.000Z',
              attestAttempts: 1,
              benefitRuleId: 'rule-csv-1',
              label: '=HYPERLINK("https://evil.test","open")',
              category: 'Coffee',
              productName: 'Coffee, "Premium"\nMembership',
              discountPercent: 15,
              requiredLockIFR: 1000,
              dailyRedemptionLimit: 1,
              monthlyRedemptionLimit: 4,
            },
            {
              id: 'session-rejected-csv',
              status: 'REJECTED',
              recoveredAddress: null,
              lockAmountRaw: null,
              reason: '+SUM(1,1)',
              expiresAt: '2026-07-19T08:35:00.000Z',
              createdAt: '2026-07-19T08:31:00.000Z',
              updatedAt: '2026-07-19T08:32:00.000Z',
              redeemedAt: null,
              attestAttempts: 2,
              benefitRuleId: null,
              label: null,
              category: null,
              productName: null,
              discountPercent: 5,
              requiredLockIFR: 500,
              dailyRedemptionLimit: 1,
              monthlyRedemptionLimit: 1,
            },
          ],
          metrics: {
            generatedAt: '2026-07-19T08:36:00.000Z',
            todayStartedAt: '2026-07-19T00:00:00.000Z',
            today: { checks: 2, approved: 0, redeemed: 1, rejected: 1 },
            allTime: { checks: 2, approved: 0, redeemed: 1, rejected: 1 },
            openChecks: 0,
            approvalRatePercent: 50,
          },
          pagination: url.searchParams.get('cursor')
            ? { limit: 50, hasMore: false, nextCursor: null, snapshot: '2026-07-19T08:36:00.000Z' }
            : { limit: 50, hasMore: true, nextCursor: 'session-rejected-csv', snapshot: '2026-07-19T08:36:00.000Z' },
        }),
      });
      return;
    }
    if (url.pathname === `/api/seller/businesses/${businessId}/rules` && method === 'POST') {
      const body = request.postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'smoke-template-rule',
          businessId,
          productId,
          label: body.label,
          category: body.category,
          productName: body.productName,
          discountPercent: body.discountPercent,
          requiredLockIFR: body.requiredLockIFR,
          dailyRedemptionLimit: body.dailyRedemptionLimit,
          monthlyRedemptionLimit: body.monthlyRedemptionLimit,
          ttlSeconds: body.ttlSeconds,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not mocked' }) });
  });

  try {
    await gotoAppPage(page, '/');
    await page.waitForLoadState('networkidle', { timeout: timeoutMs });
    await page.getByRole('button', { name: /Seller Offer discounts/i }).click();
    const ruleManager = page
      .getByRole('heading', { name: 'Benefit rule manager', exact: true })
      .locator('xpath=ancestor::section[1]');
    await ruleManager.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expectText(page, '0x1111...1111');
    await page.getByPlaceholder('cuid...').last().fill(businessId);
    await page.getByRole('button', { name: 'Load catalog', exact: true }).click();
    await expectText(page, 'Bound catalog service');
    await page.getByRole('button', { name: 'Use in rule', exact: true }).click();
    assert(await page.getByLabel('Catalog binding').inputValue() === productId, 'catalog product was not selected');

    for (const [templateName, templateLabel] of [
      ['Welcome benefit', 'Welcome'],
      ['Member standard', 'Member'],
      ['Premium access', 'Premium'],
      ['Event pass', 'Event pass'],
    ]) {
      await page.getByRole('button', { name: new RegExp(`^${templateName}`) }).click();
      assert(mutatingRequests.length === 0, `${templateName} triggered a write before Save`);
      assert(await page.getByLabel('Catalog binding').inputValue() === productId, `${templateName} changed the catalog binding`);
      await expectText(page, `${templateLabel} / Coffee / Bound catalog service`);
    }

    await page.getByRole('button', { name: /^Premium access/ }).click();
    const saveRequest = page.waitForRequest((request) => (
      request.method() === 'POST' && new URL(request.url()).pathname === `/api/seller/businesses/${businessId}/rules`
    ));
    await page.getByRole('button', { name: 'Save new rule', exact: true }).click();
    await saveRequest;
    await expectText(page, 'Rule saved.');
    assert(mutatingRequests.length === 1, 'signed Save must produce exactly one rule write');
    const saved = mutatingRequests[0];
    assert(saved.body.productId === productId, 'signed Save did not preserve the catalog product ID');
    assert(saved.body.category === 'Coffee', 'signed Save did not preserve the catalog category');
    assert(saved.body.productName === 'Bound catalog service', 'signed Save did not preserve the catalog product name');
    assert(saved.body.discountPercent === 15 && saved.body.requiredLockIFR === 5000, 'signed Save did not preserve template values');
    assert(saved.headers['x-ifr-wallet'] === sellerWallet, 'signed Save is missing the seller wallet header');
    assert(Boolean(saved.headers['x-ifr-signature']), 'signed Save is missing the seller signature header');
    assert(Boolean(saved.headers['x-ifr-timestamp']), 'signed Save is missing the seller timestamp header');
    assert(saved.headers['x-ifr-nonce'] === 'nonce-rules:create', 'signed Save is missing the resource-bound nonce');
    assert(
      challengeRequests.some((challenge) => (
        challenge.action === 'rules:create' && challenge.businessId === businessId && challenge.scope === businessId
      )),
      'signed Save did not request the resource-bound rules:create challenge'
    );
    assert(await page.locator('[role="status"][aria-live="polite"]').count() > 0, 'template/save status is not announced');

    const historyRequestPromise = page.waitForRequest((request) => (
      request.method() === 'GET' && new URL(request.url()).pathname === `/api/seller/businesses/${businessId}/sessions`
    ));
    await page.getByRole('button', { name: 'Load recent 50', exact: true }).click();
    const historyRequest = await historyRequestPromise;
    assert(new URL(historyRequest.url()).searchParams.get('limit') === '50', 'recent export must request the bounded 50-row history');
    await expectText(page, 'Loaded 2 recent sessions and seller activity.');
    assert(
      challengeRequests.some((challenge) => challenge.action === 'sessions:list' && challenge.businessId === businessId),
      'history export did not use the owner-signed sessions:list read'
    );
    assert(mutatingRequests.length === 1, 'loading/exporting history must not produce another seller API mutation');
    const sessionHistory = page.locator('#seller-session-history');
    assert(
      await sessionHistory.getByText('session-redeemed-csv', { exact: false }).count() === 1,
      'loaded owner history did not render the redeemed session'
    );
    assert(
      await sessionHistory.getByText('0x2222...2222', { exact: false }).count() === 1,
      'rendered history must mask the customer wallet'
    );
    assert(
      await sessionHistory.getByText('0x2222222222222222222222222222222222222222', { exact: false }).count() === 0,
      'rendered history leaked the full customer wallet'
    );

    const olderHistoryRequestPromise = page.waitForRequest((request) => (
      request.method() === 'GET' &&
      new URL(request.url()).pathname === `/api/seller/businesses/${businessId}/sessions` &&
      new URL(request.url()).searchParams.has('cursor')
    ));
    await page.getByRole('button', { name: 'Load 50 older checks', exact: true }).click();
    const olderHistoryRequest = await olderHistoryRequestPromise;
    assert(new URL(olderHistoryRequest.url()).searchParams.get('cursor') === 'session-rejected-csv', 'older history used the wrong cursor');
    assert(new URL(olderHistoryRequest.url()).searchParams.get('snapshot') === '2026-07-19T08:36:00.000Z', 'older history did not preserve its snapshot');
    await expectText(page, 'Loaded 1 older session.');
    assert(await sessionHistory.getByText('session-older-csv', { exact: false }).count() === 1, 'older history page was not appended');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download full CSV', exact: true }).click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    assert(downloadedPath, 'recent session CSV download path is unavailable');
    const csv = fs.readFileSync(downloadedPath, 'utf8');
    assert(csv.charCodeAt(0) === 0xfeff, 'downloaded CSV must include a UTF-8 BOM for spreadsheet compatibility');
    assert(csv.includes('"session-redeemed-csv","REDEEMED"'), 'CSV is missing the redeemed session snapshot');
    assert(csv.includes('"session-older-csv","EXPIRED"'), 'CSV is missing the older paginated session');
    assert(csv.includes('"0x2222...2222"'), 'CSV must contain only the masked customer wallet');
    assert(!csv.includes('0x2222222222222222222222222222222222222222'), 'CSV leaked the full customer wallet');
    assert(csv.includes('"\'=HYPERLINK(""https://evil.test"",""open"")"'), 'CSV did not neutralize formula-prefixed rule text');
    assert(csv.includes('"Coffee, ""Premium""\nMembership"'), 'CSV did not quote commas, quotes and newlines');
    assert(csv.includes('"\'+SUM(1,1)"'), 'CSV did not neutralize formula-prefixed rejection text');
    assert(!/signature|nonce|admin secret|\/r\//i.test(csv), 'CSV contains forbidden authorization or proof-link data');
    assert(download.suggestedFilename().startsWith('ifr-benefits-ifr-partner-shop-history-'), 'CSV filename is not seller-scoped');
    await expectText(page, 'Downloaded 3 sessions with masked customer wallets.');
    assert(
      challengeRequests.filter((challenge) => challenge.action === 'sessions:list').length >= 4,
      'full history export did not refresh an expired read authorization'
    );
    assert(mutatingRequests.length === 1, 'downloading history must remain local and read-only');
    if (shouldScreenshot) {
      await sessionHistory.scrollIntoViewIfNeeded();
      await sessionHistory.screenshot({
        animations: 'disabled',
        path: path.join(screenshotDir, 'benefits-session-export-owner.png'),
      });
    }

    const businessIdInput = page.getByPlaceholder('cuid...').last();
    await businessIdInput.fill('business-other-owner');
    assert(
      await sessionHistory.getByText('session-redeemed-csv', { exact: false }).count() === 0,
      'business switch exposed the previous business history'
    );
    assert(
      await page.getByRole('button', { name: 'Copy loaded CSV', exact: true }).isDisabled(),
      'business switch left the previous business loaded export enabled'
    );
    await businessIdInput.fill(businessId);

    await page.getByRole('button', { name: 'Load recent 50', exact: true }).click();
    await expectText(page, 'Loaded 2 recent sessions and seller activity.');
    assert(
      await sessionHistory.getByText('session-redeemed-csv', { exact: false }).count() === 1,
      'history was not reloaded before the account-switch regression'
    );

    const replacementWallet = '0x3333333333333333333333333333333333333333';
    await page.evaluate((walletAddress) => window.__setSmokeSellerWallet(walletAddress), replacementWallet);
    await expectText(page, '0x3333...3333');
    assert(
      await sessionHistory.getByText('session-redeemed-csv', { exact: false }).count() === 0,
      'account switch exposed the previous owner history'
    );
    assert(await page.getByRole('button', { name: 'Copy loaded CSV', exact: true }).isDisabled(), 'account switch left the previous owner loaded export enabled');

    await page.evaluate((walletAddress) => window.__setSmokeSellerWallet(walletAddress), sellerWallet);
    await expectText(page, '0x1111...1111');
    await page.getByRole('button', { name: 'Load recent 50', exact: true }).click();
    await expectText(page, 'Loaded 2 recent sessions and seller activity.');
    assert(
      await sessionHistory.getByText('session-redeemed-csv', { exact: false }).count() === 1,
      'history was not reloaded before the disconnect regression'
    );
    await page.evaluate(() => window.__disconnectSmokeSellerWallet());
    await expectText(page, 'Connect seller wallet');
    assert(
      await sessionHistory.getByText('session-redeemed-csv', { exact: false }).count() === 0,
      'wallet disconnect exposed the previous owner history'
    );
    assert(await page.getByRole('button', { name: 'Download full CSV', exact: true }).isDisabled(), 'wallet disconnect left full export enabled');
    assert(await page.getByRole('button', { name: 'Copy loaded CSV', exact: true }).isDisabled(), 'wallet disconnect left copy export enabled');

    await page.evaluate((walletAddress) => window.__setSmokeSellerWallet(walletAddress), sellerWallet);
    await expectText(page, '0x1111...1111');
    const staleHistoryRequest = page.waitForRequest((request) => (
      request.method() === 'GET' && new URL(request.url()).pathname === `/api/seller/businesses/${businessId}/sessions`
    ));
    await page.getByRole('button', { name: 'Load recent 50', exact: true }).click();
    await staleHistoryRequest;
    await page.evaluate((walletAddress) => window.__setSmokeSellerWallet(walletAddress), replacementWallet);
    await expectText(page, '0x3333...3333');
    await page.waitForTimeout(400);
    assert(
      await sessionHistory.getByText('session-redeemed-csv', { exact: false }).count() === 0,
      'stale history response was rendered after an account switch'
    );
    assert(await page.getByRole('button', { name: 'Copy loaded CSV', exact: true }).isDisabled(), 'stale history response re-enabled copy export for another wallet');
    assert(mutatingRequests.length === 1, 'account-switch history checks must remain read-only');
    log('Rule templates and owner-only masked reconciliation export OK');
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
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [],
        getUserMedia: async () => {
          throw new DOMException('Camera permission denied by smoke harness', 'NotAllowedError');
        },
      },
    });
  });
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
    const serviceArea = requestUrl.searchParams.get('serviceArea') || '';
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
          serviceArea: 'Athens / Attica',
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
          serviceArea: 'Online',
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
      const matchesServiceArea = !serviceArea || offer.business.serviceArea === serviceArea;
      const searchable = `${offer.business.name} ${offer.business.description || ''} ${offer.business.categories.join(' ')} ${offer.productName} ${offer.label} ${offer.category}`.toLowerCase();
      return matchesCategory && matchesServiceArea && (!search || searchable.includes(search));
        });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        offers,
        categories: ['Coffee', 'Services'],
        serviceAreas: ['Athens / Attica', 'Online'],
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
      await officialIcon.getAttribute('src') === '/icons/ifr-token-256-v11.png',
      `${label} header does not use the current official IFR icon`
    );
    assert(
      await page.locator('link[rel="icon"][href="/icons/ifr-token-64-v11.png"]').count() === 1,
      `${label} must expose the canonical IFR PNG favicon`
    );
    assert(
      await page.locator('link[rel="shortcut icon"][href="/icons/favicon-v11.ico"]').count() === 1,
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
    await expectText(page, 'Available in Athens / Attica');
    await expectText(page, 'Food & drink');
    await expectText(page, 'Reserve espresso');
    await expectText(page, '15% benefit');
    const offerDiscovery = page.locator('#offers');
    await offerDiscovery.getByLabel('Available in').selectOption('Online');
    await expectText(page, 'Private consultation');
    await page.getByText('Reserve espresso', { exact: true }).waitFor({ state: 'hidden', timeout: timeoutMs });
    await offerDiscovery.getByLabel('Available in').selectOption('');
    await offerDiscovery.getByLabel('Category').selectOption('Services');
    await expectText(page, 'Private consultation');
    await page.getByText('Reserve espresso', { exact: true }).waitFor({ state: 'hidden', timeout: timeoutMs });
    await offerDiscovery.getByLabel('Category').selectOption('');
    await offerDiscovery.getByLabel('Search offers').fill('nothing matches this');
    await expectText(page, 'No offers match these filters');
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
    await expectText(page, 'My benefits');
    await expectText(page, 'No customer proofs saved on this device yet');
    await expectText(page, 'Customer checkout pass');
    await expectText(page, 'Show your QR. Approve the exact offer.');
    await expectText(page, 'Connect wallet first');
    await expectText(page, 'Create checkout QR');
    await expectText(page, 'Scan seller QR');
    const copilotButton = page.getByTestId('open-copilot');
    await copilotButton.click();
    const copilotPanel = page.locator('#shop-copilot-panel');
    await copilotPanel.waitFor({ state: 'visible', timeout: timeoutMs });
    assert(
      await copilotPanel.locator('iframe').getAttribute('src') === 'https://copilot-api.ifrunit.tech?embedded=1&surface=benefits',
      `${label} IFR Copilot iframe must use the canonical API origin`
    );
    await copilotPanel.getByRole('button', { name: 'Close IFR Copilot' }).click();
    await copilotPanel.waitFor({ state: 'hidden', timeout: timeoutMs });
    assert(
      await copilotPanel.locator('iframe').count() === 0,
      `${label} IFR Copilot iframe must be removed when the panel closes`
    );
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
    await expectText(page, 'My benefits');
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
    await expectText(page, 'Quick rule templates');
    await expectText(page, 'Draft only');
    const templateHelpFits = await page.locator('#seller-rule-template-help').evaluate((element) => (
      element.scrollWidth <= element.clientWidth + 1
    ));
    if (!templateHelpFits) throw new Error(`[${label}] rule template help text overflows horizontally`);
    await page.getByRole('button', { name: /Premium access Higher lock threshold 15% \/ 5,000 IFR/i }).click();
    await expectText(page, 'Premium access applied to the draft. Review the values before saving.');
    await expectText(page, '15% off when 5,000 IFR is locked');
    await expectText(page, 'Premium / Services / Premium member access');
    await expectText(page, 'Per wallet: 1 / UTC day and 4 / UTC month');
    if (shouldScreenshot) {
      const ruleTemplates = page.locator('#seller-rule-templates');
      await ruleTemplates.scrollIntoViewIfNeeded();
      const originalViewport = page.viewportSize();
      const templateBounds = await ruleTemplates.boundingBox();
      const expandViewport = Boolean(
        originalViewport && templateBounds && templateBounds.height > originalViewport.height
      );
      if (expandViewport && originalViewport && templateBounds) {
        await page.setViewportSize({
          width: originalViewport.width,
          height: Math.ceil(templateBounds.height + 40),
        });
        await ruleTemplates.scrollIntoViewIfNeeded();
      }
      const stickyHeader = page.locator('.shop-header');
      await stickyHeader.evaluate((element) => {
        element.dataset.smokeVisibility = element.style.visibility;
        element.style.visibility = 'hidden';
      });
      try {
        const bounds = await ruleTemplates.boundingBox();
        if (!bounds) throw new Error(`[${label}] rule template bounds are unavailable`);
        await page.screenshot({
          animations: 'disabled',
          clip: {
            x: Math.max(0, bounds.x),
            y: Math.max(0, bounds.y),
            width: bounds.width,
            height: bounds.height,
          },
          scale: 'css',
          path: path.join(screenshotDir, `benefits-rule-templates-${label}.png`),
        });
      } finally {
        await stickyHeader.evaluate((element) => {
          element.style.visibility = element.dataset.smokeVisibility || '';
          delete element.dataset.smokeVisibility;
        });
        if (expandViewport && originalViewport) await page.setViewportSize(originalViewport);
      }
    }
    await page.getByRole('heading', { name: 'Connect seller wallet' }).first().waitFor({ timeout: timeoutMs });
    await expectText(page, 'Active benefit rule loaded');
    await expectText(page, 'Load profiles');
    await expectText(page, 'Create profile');
    await expectText(page, 'Create a seller profile');
    await expectText(page, 'Public description');
    await expectText(page, 'Seller website');
    await expectText(page, 'City, region or Online');
    await expectText(page, 'This exact text is stored and shown publicly.');
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
    await expectText(page, 'Create customer QR');
    await expectText(page, 'Present your QR and confirm');
    await expectText(page, 'Customer path');
    await expectText(page, 'Lock IFR in the shop app when needed');
    await expectText(page, 'The Benefits Network is non-custodial');
    await expectText(page, 'Recovery and phishing safety');
    await expectText(page, 'Seller path');

    const smokePassId = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    await page.route(`**/api/passes/${smokePassId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: true, expiresAt: new Date(Date.now() + 120000).toISOString() }),
      });
    });
    await gotoAppPage(page, `/p/${smokePassId}`);
    await expectText(page, 'Seller handoff');
    await expectText(page, 'Customer checkout pass');
    await expectText(page, 'Open seller checkout');
    await expectNoHorizontalOverflow(page, `${label} customer pass handoff`);

    await gotoAppPage(page, '/scan');
    await expectText(page, 'Customer checkout');
    await expectText(page, 'Scan seller QR');
    await expectText(page, 'Camera stays off until you start it.');
    await expectText(page, 'Open proof manually');
    await expectText(page, 'Only IFR Benefits proofs open.');
    await expectNoHorizontalOverflow(page, `${label} customer QR scanner`);
    const qrImageInput = page.getByTestId('qr-image-input');
    assert(await qrImageInput.getAttribute('accept') === 'image/*', `${label} QR image fallback must accept images only`);
    await page.waitForTimeout(1000);
    await page.getByTestId('start-camera').click();
    const cameraStatus = page.getByTestId('camera-status');
    await cameraStatus.waitFor({ state: 'visible', timeout: timeoutMs });
    await page.waitForTimeout(3000);
    const cameraText = await cameraStatus.innerText();
    const stopCamera = page.getByTestId('stop-camera');
    const cameraActive = await stopCamera.isVisible().catch(() => false);
    assert(
      cameraActive || /No browser camera was found|Camera access was blocked|camera is already in use|The camera could not start/.test(cameraText),
      `${label} scanner must either activate or show a safe camera fallback; status=${JSON.stringify(cameraText)}`
    );
    if (cameraActive) await stopCamera.click();
    const proofInput = page.getByTestId('manual-proof-input');
    await proofInput.fill('https://evil.example/r/cm1234567890abcdefghijkl');
    await page.getByTestId('open-proof').click();
    await expectText(page, 'Only proof links from shop.ifrunit.tech are accepted.');
    assert(new URL(page.url()).pathname === '/scan', `${label} foreign QR link must stay on /scan`);
    if (shouldScreenshot) {
      await page.screenshot({
        path: path.join(screenshotDir, `benefits-customer-qr-${label}.png`),
        fullPage: true,
      });
    }
    const validSessionId = 'cm1234567890abcdefghijkl';
    await proofInput.fill(`https://shop.ifrunit.tech/r/${validSessionId}`);
    await Promise.all([
      page.waitForURL((url) => url.pathname === `/r/${validSessionId}`, { timeout: timeoutMs }),
      page.getByTestId('open-proof').click(),
    ]);
    assert(
      new URL(page.url()).pathname === `/r/${validSessionId}`,
      `${label} canonical proof link must normalize to the local customer route`
    );

    await gotoAppPage(page, '/b/smoke-missing-business');
    await expectText(page, 'Seller scanner');
    await expectText(page, 'Business console');
    await expectText(page, 'Checkout readiness');
    await expectText(page, 'Customer-presented QR');
    await expectText(page, 'Scan customer QR');
    await expectText(page, 'Bind selected rule');
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
            serviceArea: 'Athens / Attica',
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
    await expectText(page, 'Available in Athens / Attica');
    await expectText(page, 'Food & drink');
    await expectText(page, 'Reserve espresso');
    await expectText(page, '15% benefit');
    await expectText(page, '1,000 locked IFR');
    await expectText(page, 'Connect wallet to check');
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
  await verifyOfferEligibility();
  await verifyCustomerWalletHistory();
  await verifyRuleTemplateAuthorization();
  await verifyPage({ viewport: { width: 1440, height: 1100 } }, 'desktop');
  await verifyPage(devices['iPad Pro 11'], 'ipad');
  await verifyPage(devices['Pixel 7'], 'android');
  log('PASS');
}

main().catch((error) => {
  console.error(`[benefits-smoke] FAIL: ${error.message}`);
  process.exit(1);
});
