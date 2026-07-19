#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_PASS_UI_PORT || 3210);
const origin = `http://127.0.0.1:${port}`;
const customerWallet = '0x1111111111111111111111111111111111111111';
const sellerWallet = '0x2222222222222222222222222222222222222222';
const passId = 'P'.repeat(32);
const controlToken = 'control-token-ui-e2e';
const businessId = 'business-ui-e2e';
const ruleId = 'rule-ui-e2e';
const sessionId = 'session-ui-e2e';
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
const dummySignature = `0x${'11'.repeat(65)}`;

const benefit = {
  label: 'Premium checkout',
  category: 'Retail',
  productName: 'IFR member purchase',
  discountPercent: 15,
  requiredLockIFR: 5000,
  dailyRedemptionLimit: 1,
  monthlyRedemptionLimit: 4,
  ttlSeconds: 300,
  tierLabel: 'Premium',
};

const business = {
  id: businessId,
  name: 'UI E2E Seller',
  description: 'Deterministic browser-flow fixture.',
  website: 'https://example.com',
  serviceArea: 'Online',
  categories: ['Retail'],
  discountPercent: benefit.discountPercent,
  requiredLockIFR: benefit.requiredLockIFR,
  tierLabel: benefit.tierLabel,
};

const rule = {
  id: ruleId,
  businessId,
  productId: null,
  ...benefit,
  active: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'private, no-store' },
    body: JSON.stringify(body),
  });
}

function sessionStatus(state) {
  return {
    status: state.checkout,
    reason: null,
    redeemedAt: state.checkout === 'REDEEMED' ? new Date().toISOString() : null,
    expiresAt,
    attestAttempts: state.checkout === 'PENDING' ? 0 : 1,
    businessId,
    benefitRuleId: ruleId,
    benefit,
    presentation: 'CUSTOMER_PASS',
  };
}

function controlStatus(state) {
  return {
    status: state.pass,
    expiresAt,
    checkout: state.pass === 'OPEN' ? null : {
      status: state.checkout,
      expiresAt,
      sellerName: business.name,
      benefit: {
        label: benefit.label,
        category: benefit.category,
        productName: benefit.productName,
        discountPercent: benefit.discountPercent,
        requiredLockIFR: benefit.requiredLockIFR,
      },
      reason: null,
    },
  };
}

function assertSellerHeaders(request, expectedNonce) {
  const headers = request.headers();
  assert.equal(headers['x-ifr-wallet']?.toLowerCase(), sellerWallet.toLowerCase());
  assert.equal(headers['x-ifr-signature'], dummySignature);
  assert.equal(headers['x-ifr-nonce'], expectedNonce);
  assert.ok(headers['x-ifr-timestamp'], 'seller timestamp header missing');
}

function installApiMock(context, state, calls) {
  return context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;
    calls.push(`${method} ${pathname}`);

    if (method === 'GET' && (pathname === '/api/health' || pathname === '/api/ready')) {
      return json(route, { status: 'ok', chainId: 1, database: 'ready' });
    }
    if (method === 'GET' && pathname === '/api/businesses') {
      return json(route, {
        offers: [], categories: [], serviceAreas: [],
        pagination: { page: 1, limit: 8, total: 0, totalPages: 0, hasNext: false },
      });
    }
    if (method === 'GET' && pathname === `/api/businesses/${businessId}`) {
      return json(route, business);
    }
    if (method === 'GET' && pathname === `/api/businesses/${businessId}/rules`) {
      return json(route, { rules: [rule] });
    }
    if (method === 'POST' && pathname === '/api/passes/challenge') {
      const body = request.postDataJSON();
      assert.equal(body.walletAddress.toLowerCase(), customerWallet.toLowerCase());
      return json(route, { message: 'Create IFR checkout pass', nonce: 'pass-create-nonce', expiresAt });
    }
    if (method === 'POST' && pathname === '/api/passes') {
      const body = request.postDataJSON();
      assert.equal(body.walletAddress.toLowerCase(), customerWallet.toLowerCase());
      assert.equal(body.nonce, 'pass-create-nonce');
      assert.equal(body.signature, dummySignature);
      state.pass = 'OPEN';
      return json(route, { passId, controlToken, expiresAt, qrUrl: `/p/${passId}` }, 201);
    }
    if (method === 'GET' && pathname === `/api/passes/${passId}/control`) {
      assert.equal(request.headers().authorization, `Bearer ${controlToken}`);
      return json(route, controlStatus(state));
    }
    if (method === 'GET' && pathname === `/api/passes/${passId}`) {
      return json(route, { available: state.pass === 'OPEN', expiresAt });
    }
    if (method === 'GET' && pathname === '/api/seller/auth-message') {
      const action = url.searchParams.get('action');
      const scope = url.searchParams.get('scope');
      const nonce = action === 'passes:bind' ? 'pass-bind-nonce' : 'session-redeem-nonce';
      if (action === 'passes:bind') assert.equal(scope, `${passId}:${ruleId}`);
      if (action === 'sessions:redeem') assert.equal(scope, sessionId);
      assert.equal(url.searchParams.get('walletAddress')?.toLowerCase(), sellerWallet.toLowerCase());
      return json(route, { message: `${action} ${scope}`, timestamp: new Date().toISOString(), nonce, expiresAt });
    }
    if (method === 'POST' && pathname === `/api/passes/${passId}/bind`) {
      assertSellerHeaders(request, 'pass-bind-nonce');
      const body = request.postDataJSON();
      assert.equal(body.businessId, businessId);
      assert.equal(body.benefitRuleId, ruleId);
      state.pass = 'BOUND';
      state.checkout = 'PENDING';
      return json(route, {
        sessionId,
        expiresAt,
        benefit,
        createdBy: {
          authorized: true,
          walletAddress: sellerWallet,
          role: 'OWNER',
          operatorId: null,
          label: null,
          expiresAt: null,
        },
      });
    }
    if (method === 'GET' && pathname === `/api/sessions/${sessionId}`) {
      return json(route, sessionStatus(state));
    }
    if (method === 'POST' && pathname === `/api/passes/${passId}/challenge`) {
      assert.equal(request.headers().authorization, `Bearer ${controlToken}`);
      return json(route, { message: 'Confirm UI E2E Seller and Premium checkout', timestamp: new Date().toISOString(), expiresAt });
    }
    if (method === 'POST' && pathname === `/api/passes/${passId}/confirm`) {
      assert.equal(request.headers().authorization, `Bearer ${controlToken}`);
      assert.equal(request.postDataJSON().signature, dummySignature);
      state.checkout = 'APPROVED';
      return json(route, { status: 'APPROVED', reason: null, lockedAmount: '10000', wallet: customerWallet });
    }
    if (method === 'POST' && pathname === `/api/sessions/${sessionId}/redeem`) {
      state.redeemAttempts += 1;
      if (state.checkout !== 'APPROVED') {
        return json(route, { error: 'Checkout is not approved or was already redeemed.' }, 409);
      }
      assertSellerHeaders(request, 'session-redeem-nonce');
      state.checkout = 'REDEEMED';
      return json(route, { status: 'REDEEMED' });
    }

    return json(route, { error: `Unexpected UI E2E request: ${method} ${pathname}` }, 500);
  });
}

function installWallet(context, account) {
  return context.addInitScript(({ account, signature }) => {
    const listeners = new Map();
    const provider = {
      isMetaMask: true,
      providers: [],
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'personal_sign' || method === 'eth_sign') return signature;
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_requestPermissions') return null;
        if (method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'eth_getBalance') return '0x16345785d8a0000';
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') return `0x${BigInt(10_000 * 1e9).toString(16).padStart(64, '0')}`;
        if (method === 'eth_getCode') return '0x01';
        throw new Error(`Unsupported test wallet method: ${method}`);
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
  }, { account, signature: dummySignature });
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

async function run() {
  const serverOutput = [];
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: frontend,
    env: {
      ...process.env,
      NEXT_PUBLIC_CHAIN_ID: '1',
      NEXT_PUBLIC_IFR_TOKEN_ADDRESS: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
      NEXT_PUBLIC_IFRLOCK_ADDRESS: '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb',
      BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const state = { pass: 'NONE', checkout: 'PENDING', redeemAttempts: 0 };
    const calls = [];
    const customerContext = await browser.newContext({ serviceWorkers: 'block' });
    const sellerContext = await browser.newContext({ serviceWorkers: 'block' });
    await Promise.all([
      installWallet(customerContext, customerWallet),
      installWallet(sellerContext, sellerWallet),
      installApiMock(customerContext, state, calls),
      installApiMock(sellerContext, state, calls),
    ]);

    const customer = await customerContext.newPage();
    const seller = await sellerContext.newPage();
    const pageErrors = [];
    for (const [name, page] of [['customer', customer], ['seller', seller]]) {
      page.on('pageerror', (error) => pageErrors.push(`${name}: ${error.message}`));
    }

    await customer.goto(`${origin}/#customer-pass`, { waitUntil: 'domcontentloaded' });
    await customer.getByText('MetaMask provider', { exact: true }).waitFor();
    await customer.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
    await customer.getByRole('button', { name: 'Disconnect', exact: true }).first().waitFor();
    const passPanel = customer.locator('#customer-pass');
    await passPanel.getByRole('button', { name: 'Create customer QR', exact: true }).click();
    await passPanel.getByText('Pass ready. Let the seller scan this QR, then review the exact offer here.').waitFor();
    assert.equal(state.pass, 'OPEN');
    const renderedPassUrl = (await passPanel.locator('p.font-mono').textContent())?.trim();
    assert.equal(renderedPassUrl, `${origin}/p/${passId}`, 'rendered QR payload must be the canonical pass URL');

    await seller.goto(`${origin}/b/${businessId}`, { waitUntil: 'domcontentloaded' });
    await seller.getByRole('heading', { name: business.name }).waitFor();
    await seller.getByRole('button', { name: 'Connect', exact: true }).click();
    await seller.getByText(`${sellerWallet.slice(0, 6)}...${sellerWallet.slice(-4)}`).first().waitFor();
    const passInput = seller.getByPlaceholder('Paste https://shop.ifrunit.tech/p/... or pass ID');
    await assert.doesNotReject(() => passInput.waitFor());
    await passInput.fill(`https://attacker.example/p/${passId}`);
    await seller.getByRole('button', { name: 'Bind selected rule', exact: true }).click();
    await seller.getByText('Scan or paste a valid IFR customer checkout pass first.').waitFor();
    assert.equal(state.pass, 'OPEN', 'foreign-origin pass links must be rejected before binding');
    await passInput.fill(renderedPassUrl);
    await seller.getByRole('button', { name: 'Bind selected rule', exact: true }).click();
    await seller.getByText('Rule bound securely', { exact: true }).waitFor();
    assert.equal(state.pass, 'BOUND');

    await passPanel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await passPanel.getByText(business.name).waitFor();
    await passPanel.getByText(benefit.productName).waitFor();
    await passPanel.getByText('15%').waitFor();
    await passPanel.getByText('5,000 IFR').waitFor();
    await passPanel.getByRole('button', { name: 'Confirm this seller and offer', exact: true }).click();
    await passPanel.getByText('IFR access approved. The seller can now redeem this checkout once.').waitFor();
    assert.equal(state.checkout, 'APPROVED');

    await seller.getByRole('heading', { name: 'Approved', exact: true }).waitFor({ timeout: 10_000 });
    const redeem = seller.getByRole('button', { name: 'Redeem', exact: true }).first();
    await redeem.click();
    await seller.getByText('REDEEMED', { exact: true }).first().waitFor();
    assert.equal(state.checkout, 'REDEEMED');
    assert.equal(await redeem.isDisabled(), true, 'redeem must be disabled after single use');
    await redeem.evaluate((button) => button.click());
    await seller.waitForTimeout(100);
    assert.equal(state.redeemAttempts, 1, 'disabled redeemed checkout must not submit a replay');

    for (const requiredCall of [
      'POST /api/passes/challenge',
      'POST /api/passes',
      `POST /api/passes/${passId}/bind`,
      `POST /api/passes/${passId}/challenge`,
      `POST /api/passes/${passId}/confirm`,
      `POST /api/sessions/${sessionId}/redeem`,
    ]) {
      assert.ok(calls.includes(requiredCall), `missing API transition: ${requiredCall}`);
    }
    assert.deepEqual(pageErrors, []);
    await Promise.all([customerContext.close(), sellerContext.close()]);
    console.log('[benefits-customer-pass-ui] PASS - create -> bind -> exact-offer confirm -> redeem once');
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
