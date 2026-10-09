#!/usr/bin/env node

// Deterministic touch-target gate for the Benefits landing, guide, customer,
// seller and history surfaces. Every visible interactive control must measure
// at least 44x44 CSS px, controls must not clip their text or overlap each
// other and the document must not overflow horizontally. The API and wallet
// are mocked so each state is reproducible; screenshots are written to
// BENEFITS_TOUCH_SCREENSHOT_DIR (default /tmp/inferno-t151).

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { ethers } = require('ethers');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_TOUCH_PORT || 3230);
const origin = `http://127.0.0.1:${port}`;
const screenshotDir = process.env.BENEFITS_TOUCH_SCREENSHOT_DIR || '/tmp/inferno-t151';
const MIN_TARGET = 44;
// Touch viewports use the Android tablet UA from the physical SM-T835 evidence
// so mobile-only controls (wallet-app launch links) render and get measured.
const ANDROID_TABLET_UA = 'Mozilla/5.0 (Linux; Android 10; SM-T835) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VIEWPORTS = [
  { width: 390, height: 844, mobile: true },
  { width: 711, height: 970, mobile: true },
  { width: 820, height: 1180, mobile: true },
  { width: 1180, height: 820, mobile: true },
  { width: 1440, height: 1000, mobile: false },
];

// Deterministic throwaway test key (no funds, never used outside this script) so the device-local
// receipt carries a real EIP-191 signature that the 'Verify receipt' control can check offline.
const customerSigner = new ethers.Wallet(`0x${'42'.repeat(32)}`);
const customerWallet = customerSigner.address;
const dummySignature = `0x${'11'.repeat(65)}`;
const businessId = 'business-touch-e2e';
const ruleId = 'rule-touch-e2e';
const { receiptProof } = require('./lib/benefits-receipt-fixture.cjs');
const productId = 'product-touch-e2e';
const sessionId = 'session-touch-e2e';
const passId = 'T'.repeat(32);
const now = new Date().toISOString();
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

const business = {
  id: businessId,
  slug: 'touch-e2e-seller',
  name: 'Touch E2E Seller',
  description: 'Deterministic touch-target fixture.',
  website: 'https://example.com',
  logoUrl: null,
  serviceArea: 'Online',
  categories: ['Retail'],
  discountPercent: 15,
  requiredLockIFR: 5000,
  tierLabel: 'Premium',
};
const benefit = {
  label: 'Premium checkout',
  category: 'Retail',
  productName: 'IFR member purchase',
  basePriceMinor: '2500',
  currency: 'EUR',
  discountPercent: 15,
  requiredLockIFR: 5000,
  minIFRHeld: 0,
  lockSource: 'either',
  dailyRedemptionLimit: 0,
  monthlyRedemptionLimit: 0,
  ttlSeconds: 300,
  tierLabel: 'Premium',
};
const rule = {
  id: ruleId, businessId, productId, ...benefit, active: true, createdAt: now, updatedAt: now,
};
const product = {
  id: productId,
  businessId,
  name: benefit.productName,
  category: 'Retail',
  description: 'Fixture product.',
  basePriceMinor: '2500',
  currency: 'EUR',
  active: true,
  createdAt: now,
  updatedAt: now,
  benefitRules: [{
    id: ruleId,
    label: benefit.label,
    discountPercent: benefit.discountPercent,
    requiredLockIFR: benefit.requiredLockIFR,
    minIFRHeld: 0,
    lockSource: 'either',
    dailyRedemptionLimit: 0,
    monthlyRedemptionLimit: 0,
    ttlSeconds: 300,
  }],
};
const offer = {
  id: ruleId,
  label: benefit.label,
  category: 'Retail',
  productName: benefit.productName,
  discountPercent: 15,
  requiredLockIFR: 5000,
  minIFRHeld: 0,
  lockSource: 'either',
  dailyRedemptionLimit: 0,
  monthlyRedemptionLimit: 0,
  business,
  product: { id: productId, name: benefit.productName, description: null, basePriceMinor: '2500', currency: 'EUR' },
};
// Owner decision B (T-231b): "My benefits" is device-local only. The receipt holds the exact signed
// proof v2 text (with the full wallet) and its signature, as saved after a REDEEMED proof.
const localHistoryItem = {
  sessionId,
  businessId,
  sellerName: business.name,
  status: 'REDEEMED',
  discountPercent: 15,
  requiredLockIFR: 5000,
  minIFRHeld: 0,
  lockSource: 'either',
  ruleLabel: benefit.label,
  productName: benefit.productName,
  basePriceMinor: '2500',
  currency: 'EUR',
  expiresAt,
  redeemedAt: now,
  walletLabel: `${customerWallet.slice(0, 6)}...${customerWallet.slice(-4)}`,
  savedAt: now,
};
const receipt = receiptProof(localHistoryItem, { wallet: customerWallet, ruleId, audience: new URL(origin).host, chainId: 1 });
const receiptMessage = receipt.message;
const localHistory = [{ ...localHistoryItem, proof: { ...receipt, signature: null } }];

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'private, no-store' },
    body: JSON.stringify(body),
  });
}

function installApiMock(context) {
  return context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;
    if (method === 'GET' && (pathname === '/api/health' || pathname === '/api/ready')) {
      return json(route, { status: 'ok', chainId: 1, database: 'ready' });
    }
    if (method === 'GET' && pathname === '/api/businesses') {
      return json(route, {
        offers: [offer], categories: ['Retail'], serviceAreas: ['Online'],
        pagination: { page: 1, limit: 8, total: 1, totalPages: 1, hasNext: false },
      });
    }
    if (method === 'GET' && [businessId, business.slug].some((id) => pathname === `/api/businesses/${id}`)) {
      return json(route, business);
    }
    if (method === 'GET' && [businessId, business.slug].some((id) => pathname === `/api/businesses/${id}/rules`)) {
      return json(route, { rules: [rule] });
    }
    if (method === 'GET' && [businessId, business.slug].some((id) => pathname === `/api/businesses/${id}/products`)) {
      return json(route, { business, products: [product] });
    }
    if (method === 'GET' && pathname === `/api/sessions/${sessionId}`) {
      return json(route, {
        status: 'REDEEMED', reason: null, redeemedAt: now, expiresAt, attestAttempts: 1,
        businessId, benefitRuleId: ruleId, benefit, presentation: 'SELLER_QR',
      });
    }
    if (method === 'GET' && pathname === `/api/passes/${passId}`) {
      return json(route, { available: true, expiresAt });
    }
    if (pathname.startsWith('/api/customer/history')) {
      // Server-side customer history was removed (owner decision B); mirror the backend 410.
      return json(route, { error: 'Customer history is stored only on the customer device.', storage: 'device-local' }, 410);
    }
    return json(route, { error: `Unexpected touch-target request: ${method} ${pathname}` }, 500);
  });
}

function installWallet(context) {
  return context.addInitScript(({ account, signature }) => {
    let connected = false;
    const provider = {
      isMetaMask: true,
      providers: [],
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts') {
          connected = true;
          return [account];
        }
        if (method === 'eth_accounts') return connected ? [account] : [];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'personal_sign' || method === 'eth_sign') return signature;
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_requestPermissions') return null;
        if (method === 'wallet_getPermissions') return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        if (method === 'eth_getBalance') return '0x16345785d8a0000';
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') return `0x${BigInt(10_000 * 1e9).toString(16).padStart(64, '0')}`;
        if (method === 'eth_getCode') return '0x01';
        throw new Error(`Unsupported test wallet method: ${method}`);
      },
      on: () => {},
      removeListener: () => {},
    };
    provider.providers = [provider];
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
    window.dispatchEvent(new Event('ethereum#initialized'));
  }, { account: customerWallet, signature: dummySignature });
}

// Collects every visible interactive control and reports undersized targets,
// clipped labels, overlapping targets and horizontal document overflow.
function measureControls(minTarget) {
  const selector = [
    'a[href]', 'button', 'select', 'textarea', 'summary', '[role="button"]', '[role="tab"]',
    'input:not([type="hidden"])',
  ].join(',');
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    // Content of a closed <details> is not rendered; only its summary is.
    const details = element.closest('details');
    if (details && !details.open && !element.closest('summary')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  // Inline links inside running text are exempt from the target size rule
  // (WCAG 2.5.8 "inline" exception); standalone links are not.
  const isInlineTextLink = (element) => {
    if (element.tagName !== 'A' || getComputedStyle(element).display !== 'inline') return false;
    const parent = element.parentElement;
    if (!parent) return false;
    const text = parent.textContent.replace(element.textContent, '').trim();
    return text.length > 0;
  };
  const label = (element) => {
    const text = (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || element.getAttribute('name') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 48);
    return `${element.tagName.toLowerCase()}${element.type ? `[${element.type}]` : ''} "${text}"`;
  };
  const isFixed = (element) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  };

  const failures = [];
  const measured = [];
  for (const element of document.querySelectorAll(selector)) {
    if (!isVisible(element) || isInlineTextLink(element)) continue;
    let target = element;
    // Checkbox, radio and visually hidden file inputs are operated through
    // their wrapping or associated label.
    if (element.tagName === 'INPUT' && ['checkbox', 'radio', 'file'].includes(element.type)) {
      target = element.closest('label') || (element.id && document.querySelector(`label[for="${element.id}"]`)) || element;
    }
    const rect = target.getBoundingClientRect();
    const width = Math.round(rect.width * 100) / 100;
    const height = Math.round(rect.height * 100) / 100;
    if (width + 0.5 < minTarget || height + 0.5 < minTarget) {
      failures.push(`target ${label(element)} is ${width}x${height}px`);
    }
    if (element.tagName !== 'INPUT' && element.tagName !== 'SELECT' && element.tagName !== 'TEXTAREA'
      && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible') {
      failures.push(`label clipped in ${label(element)} (${element.scrollWidth}>${element.clientWidth})`);
    }
    measured.push({
      element: target,
      label: label(element),
      fixed: isFixed(target),
      box: { left: rect.left + scrollX, top: rect.top + scrollY, right: rect.right + scrollX, bottom: rect.bottom + scrollY },
    });
  }
  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = measured[i];
      const b = measured[j];
      if (a.fixed || b.fixed || a.element.contains(b.element) || b.element.contains(a.element)) continue;
      const overlapX = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const overlapY = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (overlapX > 1 && overlapY > 1) failures.push(`targets overlap: ${a.label} / ${b.label}`);
    }
  }
  // The shell clips horizontal overflow, so scrollWidth alone cannot prove
  // that content fits: also name every element that crosses the viewport edge
  // outside an intentional scroll container or fixed overlay.
  const doc = document.documentElement;
  const inScrollerOrOverlay = (element) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.position === 'fixed') return true;
      if (node !== element && ['auto', 'scroll', 'hidden'].includes(style.overflowX)) return true;
    }
    return false;
  };
  const offenders = [...document.body.querySelectorAll('*')]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.right > doc.clientWidth + 1 || rect.left < -1)
        && isVisible(element) && !inScrollerOrOverlay(element);
    })
    .filter((element, index, all) => !all.includes(element.parentElement))
    .slice(0, 3)
    .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 80)}`);
  if (doc.scrollWidth > doc.clientWidth + 1 || offenders.length > 0) {
    failures.push(`horizontal overflow (${doc.scrollWidth}>${doc.clientWidth}) at ${offenders.join(' | ')}`);
  }
  return { failures, count: measured.length };
}

async function connectWallet(page, scope = page) {
  await scope.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).first().waitFor();
}

// Each state renders one affected surface in a representative, populated state.
const STATES = [
  {
    name: 'landing-customer',
    async open(page) {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'My benefits' }).waitFor();
      await page.getByText(business.name).first().waitFor();
      await page.locator('button[data-wallet-action="connect"]:enabled').first().waitFor();
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'landing-customer-history',
    async open(page) {
      await page.goto(`${origin}/#my-benefits`, { waitUntil: 'domcontentloaded' });
      await connectWallet(page);
      const history = page.locator('#my-benefits');
      await history.getByTestId('device-history-notice').waitFor();
      await history.getByTestId('device-receipt').first().waitFor();
      await history.getByRole('button', { name: 'Verify receipt', exact: true }).click();
      await history.getByText('Signed terms verified on this device', { exact: false }).waitFor();
      await history.getByRole('button', { name: 'Clear', exact: true }).waitFor();
      await history.getByRole('button', { name: 'Scan QR', exact: false }).or(history.getByRole('link', { name: 'Scan QR' })).first().waitFor();
    },
  },
  {
    name: 'landing-seller',
    async open(page) {
      await page.goto(`${origin}/?mode=seller`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Benefit rule manager' }).waitFor({ timeout: 60_000 });
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'landing-seller-restore',
    async open(page) {
      await page.goto(`${origin}/?mode=seller`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Benefit rule manager' }).waitFor({ timeout: 60_000 });
      await page.waitForLoadState('networkidle');
      await page.getByText('Open an existing seller setup', { exact: true }).click();
      await page.getByPlaceholder('Business ID, seller URL or backup JSON').waitFor();
    },
  },
  {
    name: 'guide',
    async open(page) {
      await page.goto(`${origin}/guide`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').first().waitFor();
    },
  },
  {
    name: 'scan-fallback',
    async open(page) {
      await page.goto(`${origin}/scan`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').first().waitFor();
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'customer-session-evidence',
    async open(page) {
      await page.goto(`${origin}/r/${sessionId}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('REDEEMED evidence').waitFor();
    },
  },
  {
    name: 'seller-console',
    async open(page) {
      await page.goto(`${origin}/b/${businessId}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: business.name }).first().waitFor();
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'seller-catalog',
    async open(page) {
      await page.goto(`${origin}/s/${businessId}`, { waitUntil: 'domcontentloaded' });
      await page.getByText(benefit.productName).first().waitFor();
    },
  },
  {
    name: 'customer-pass-handoff',
    async open(page) {
      await page.goto(`${origin}/p/${passId}`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').first().waitFor();
      await page.waitForLoadState('networkidle');
    },
  },
];

async function waitForServer(child) {
  const deadline = Date.now() + 90_000;
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
  localHistory[0].proof.signature = await customerSigner.signMessage(receiptMessage);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: frontend,
    env: {
      ...process.env,
      NEXT_PUBLIC_CHAIN_ID: '1',
      NEXT_PUBLIC_IFR_TOKEN_ADDRESS: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
      NEXT_PUBLIC_IFRLOCK_ADDRESS: '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb',
      BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });

  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    await waitForServer(server);
    const only = process.env.BENEFITS_TOUCH_STATE;
    for (const viewport of VIEWPORTS) {
      for (const state of STATES) {
        if (only && state.name !== only) continue;
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          ...(viewport.mobile ? { userAgent: ANDROID_TABLET_UA } : {}),
        });
        await context.addInitScript((items) => {
          window.localStorage.setItem('ifr.shop.customerProofHistory.v1', JSON.stringify(items));
        }, localHistory);
        await context.route('**/sw.js', (route) => route.abort());
        await installApiMock(context);
        await installWallet(context);
        const page = await context.newPage();
        const label = `${state.name}@${viewport.width}x${viewport.height}`;
        try {
          await state.open(page);
          await page.evaluate(() => document.fonts.ready);
          const result = await page.evaluate(measureControls, MIN_TARGET);
          assert.ok(result.count > 0, `${label}: no interactive controls measured`);
          for (const failure of result.failures) failures.push(`${label}: ${failure}`);
          await page.screenshot({ path: path.join(screenshotDir, `${state.name}-${viewport.width}x${viewport.height}.png`), fullPage: true });
          console.log(`[benefits-touch-targets] ${label} controls=${result.count} failures=${result.failures.length}`);
        } catch (error) {
          failures.push(`${label}: state failed: ${error?.message || error}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
  if (failures.length > 0) {
    console.error(`[benefits-touch-targets] FAIL ${failures.length} finding(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    if (/error/i.test(serverLog) && process.env.BENEFITS_TOUCH_DEBUG) console.error(serverLog);
    process.exitCode = 1;
    return;
  }
  console.log(`[benefits-touch-targets] PASS screenshots=${screenshotDir}`);
}

run().catch((error) => {
  console.error(`[benefits-touch-targets] FAIL: ${error?.stack || error}`);
  process.exitCode = 1;
});
