#!/usr/bin/env node
/**
 * T-231b (owner decision B) visual evidence + layout assertions for the changed Benefits screens:
 *   - device-local customer history ("My benefits"), scrolled through under the fixed launcher;
 *   - customer seller-QR checkout: idle / signing / success (REDEEMED in one request) / failure;
 *   - seller checkout console: signed open checkout / redeemed / expired, without a redeem button;
 *   - F3 (PR #238): customer-presented checkout pass (components/CustomerCheckoutPass.tsx on /#customer-pass)
 *     in the states open / bound (offer review) / proof-signing / proof-redeemed / refusal / expired, with
 *     long-label fixtures (80-char label, 160-char product name; worded and unbroken) under the real
 *     fixed overlays (Copilot launcher, any fixed toast/status layer).
 * Widths 375, 390, 820, 1440. Per capture: 0 px horizontal overflow, no clipped text, no overlapping
 * text boxes, no text or control under the fixed launcher. All API traffic is mocked (dummy data).
 *
 * Usage: BENEFITS_VISUAL_OUT=<dir> node scripts/test-benefits-owner-b-visual.js
 *        (requires `npm run build` in apps/benefits-network/frontend first)
 *        BENEFITS_VISUAL_SCREENS=pass (comma list of history,customer,seller,pass; default all)
 *        BENEFITS_VISUAL_PRE_FIX=1 reproduces the pre-fix history padding (expected to fail).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const { privateKeyToAccount } = require(path.join(frontend, 'node_modules', 'viem', '_cjs', 'accounts', 'index.js'));
const port = Number(process.env.BENEFITS_VISUAL_PORT || 3293);
const origin = `http://127.0.0.1:${port}`;
const outDir = process.env.BENEFITS_VISUAL_OUT || path.join(root, '.t231b-visual');
const preFix = process.env.BENEFITS_VISUAL_PRE_FIX === '1';
const widths = [375, 390, 820, 1440];
const screens = new Set((process.env.BENEFITS_VISUAL_SCREENS || 'history,customer,seller,pass').split(',').map((item) => item.trim()));

const customerWallet = '0x1111111111111111111111111111111111111111';
const sellerWallet = '0x2222222222222222222222222222222222222222';
const businessId = 'demo-shop';
const ruleId = 'rule-demo';
const sessionId = 'session-demo-1';
const dummySignature = `0x${'11'.repeat(65)}`;
const benefit = {
  benefitRuleId: ruleId, label: 'Espresso deal', category: 'Coffee', productName: 'Espresso (dummy)',
  basePriceMinor: '350', currency: 'EUR', discountPercent: 10, requiredLockIFR: 1000, minIFRHeld: 0,
  lockSource: 'ifrlock', ttlSeconds: 300, dailyRedemptionLimit: 0, monthlyRedemptionLimit: 0, tierLabel: 'Espresso deal',
};
const business = {
  id: businessId, slug: 'demo-coffee', name: 'Demo Coffee Bar (dummy data)', description: 'Dummy fixture.',
  website: 'https://example.com', serviceArea: 'Online', categories: ['Coffee'], ownerAddress: sellerWallet,
  discountPercent: 10, requiredLockIFR: 1000, tierLabel: 'Espresso deal',
};
const rule = { id: ruleId, businessId, productId: null, ...benefit, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

// ── F3 customer-pass fixtures (dummy data) ──
const passId = 'pass-demo-1';
const passControlToken = 'c'.repeat(43);
const exactLength = (text, length) => text.repeat(Math.ceil(length / text.length)).slice(0, length).trimEnd().padEnd(length, 'x');
const PASS_FIXTURES = {
  'long-words': {
    sellerName: exactLength('Demo Neighbourhood Coffee Roastery and Bakery (dummy data) ', 72),
    label: exactLength('Seasonal espresso tasting flight with oat milk upgrade for members ', 80),
    productName: exactLength('Single-origin Ethiopian Yirgacheffe espresso flight, three cups, served with house-baked almond biscotti and a refill ', 160),
  },
  'long-unbroken': {
    sellerName: exactLength('DemoNeighbourhoodCoffeeRoasteryAndBakery', 72),
    label: exactLength('SeasonalEspressoTastingFlightOatMilk', 80),
    productName: exactLength('SingleOriginEthiopianYirgacheffeEspressoFlightWithBiscotti', 160),
  },
};
const PASS_REFUSAL_REASON = 'Not eligible yet: the locked IFR for this wallet is below the amount this offer requires. Lock more IFR and ask the seller for a new checkout.';

function passControl(state) {
  const fixture = PASS_FIXTURES[state.pass.fixture];
  const checkout = state.pass.checkout ? {
    status: state.pass.checkout,
    expiresAt: state.pass.checkout === 'EXPIRED' ? new Date(Date.now() - 60_000).toISOString() : state.expiresAt,
    businessId,
    benefitRuleId: ruleId,
    sellerName: fixture.sellerName,
    sellerLogoUrl: null,
    benefit: {
      label: fixture.label, category: 'Coffee', productName: fixture.productName, basePriceMinor: '350', currency: 'EUR',
      discountPercent: 10, requiredLockIFR: 1000, minIFRHeld: 250, lockSource: 'ifrlock',
    },
    reason: state.pass.checkout === 'REJECTED' ? PASS_REFUSAL_REASON : null,
  } : null;
  return {
    status: state.pass.status,
    expiresAt: state.pass.status === 'EXPIRED' ? new Date(Date.now() - 60_000).toISOString() : state.expiresAt,
    checkout,
  };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(body) });
}

function sessionStatus(state) {
  return {
    status: state.checkout,
    reason: state.checkout === 'EXPIRED' ? 'Session expired.' : null,
    redeemedAt: state.checkout === 'REDEEMED' ? state.redeemedAt : null,
    expiresAt: state.expiresAt,
    attestAttempts: state.checkout === 'REDEEMED' ? 1 : 0,
    businessId,
    benefitRuleId: ruleId,
    benefit,
    presentation: 'SELLER_QR',
  };
}

function installApi(context, state) {
  return context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();
    state.calls.push(`${method} ${pathname}`);
    if (pathname === '/api/health' || pathname === '/api/ready') return json(route, { status: 'ok', chainId: 1 });
    if (method === 'GET' && pathname === '/api/businesses') {
      return json(route, { offers: [], categories: [], serviceAreas: [], pagination: { page: 1, limit: 8, total: 0, totalPages: 0, hasNext: false } });
    }
    if (method === 'GET' && (pathname === `/api/businesses/${businessId}` || pathname === `/api/businesses/${business.slug}`)) return json(route, business);
    if (method === 'GET' && pathname.endsWith('/rules')) return json(route, { rules: [rule] });
    if (method === 'GET' && pathname === `/api/sessions/${sessionId}`) return json(route, sessionStatus(state));
    if (method === 'POST' && pathname === `/api/sessions/${sessionId}/challenge`) {
      assert.equal(request.postDataJSON().walletAddress.toLowerCase(), customerWallet, 'the full wallet travels in the body');
      return json(route, { message: `IFR Benefits Network - Checkout Proof\nWallet: ${customerWallet}\nSession: ${sessionId}` });
    }
    if (method === 'POST' && pathname === '/api/attest') {
      const body = request.postDataJSON();
      assert.equal(body.walletAddress.toLowerCase(), customerWallet);
      if (state.attestOutcome === 'REJECTED') {
        return json(route, {
          status: 'REJECTED', wallet: customerWallet, eligible: false, attemptsRemaining: 3,
          reason: 'Insufficient lock: 10 IFR in IFRLock < 1000 IFR required. Lock more IFR in IFRLock and retry this QR session.',
        });
      }
      state.checkout = 'REDEEMED';
      state.redeemedAt = new Date().toISOString();
      return json(route, {
        status: 'REDEEMED', wallet: customerWallet, eligible: true, redeemedAt: state.redeemedAt, benefit,
        proof: { version: 'ifr-benefits/checkout-proof/2', sessionId, businessId, termsDigest: `sha256:${'a'.repeat(64)}`, message: 'x', selfRedemption: false },
      });
    }
    if (method === 'POST' && pathname === `/api/sessions/${sessionId}/redeem`) {
      state.redeemCalls += 1;
      return json(route, { error: 'Separate seller redemption was removed.' }, 410);
    }
    if (method === 'GET' && pathname === '/api/seller/auth-message') {
      const action = url.searchParams.get('action');
      state.sellerActions.push(action);
      return json(route, { message: `${action} ${url.searchParams.get('scope') || ''}`, timestamp: String(Date.now()), nonce: 'n'.repeat(64), expiresAt: new Date(Date.now() + 300_000).toISOString() });
    }
    if (method === 'GET' && pathname === `/api/seller/businesses/${businessId}/operator-status`) {
      return json(route, { authorized: true, walletAddress: sellerWallet, role: 'OWNER', operatorId: null, label: 'Business owner', expiresAt: null });
    }
    if (method === 'POST' && pathname === '/api/sessions') {
      assert.equal(request.headers()['x-ifr-wallet']?.toLowerCase(), sellerWallet, 'the checkout is opened with a seller signature');
      state.checkout = 'PENDING';
      return json(route, {
        sessionId, expiresAt: state.expiresAt, qrUrl: `/r/${sessionId}`, ...benefit,
        createdBy: { authorized: true, walletAddress: sellerWallet, role: 'OWNER', operatorId: null, label: 'Business owner', expiresAt: null },
      }, 201);
    }
    if (state.pass) {
      if (method === 'POST' && pathname === '/api/passes') {
        state.pass.status = 'OPEN';
        return json(route, { passId, controlToken: passControlToken, expiresAt: state.expiresAt, qrUrl: `/p/${passId}` }, 201);
      }
      if (method === 'GET' && pathname === `/api/passes/${passId}/control`) return json(route, passControl(state));
      if (method === 'POST' && pathname === `/api/passes/${passId}/challenge`) {
        assert.equal(request.postDataJSON().walletAddress.toLowerCase(), customerWallet, 'the pass proof wallet travels in the body');
        return json(route, { message: `IFR Benefits Network - Checkout Proof\nWallet: ${customerWallet}\nSession: ${sessionId}` });
      }
      if (method === 'POST' && pathname === `/api/passes/${passId}/confirm`) {
        if (state.pass.outcome === 'REJECTED') {
          state.pass.checkout = 'REJECTED';
          return json(route, { status: 'REJECTED', eligible: false, attemptsRemaining: 2, reason: PASS_REFUSAL_REASON });
        }
        state.pass.checkout = 'REDEEMED';
        state.checkout = 'REDEEMED';
        state.redeemedAt = new Date().toISOString();
        return json(route, {
          status: 'REDEEMED', eligible: true, redeemedAt: state.redeemedAt, benefit,
          proof: { version: 'ifr-benefits/checkout-proof/2', sessionId, businessId, termsDigest: `sha256:${'a'.repeat(64)}`, message: 'x', selfRedemption: false },
        });
      }
    }
    return json(route, { error: `Unexpected request ${method} ${pathname}` }, 500);
  });
}

function installWallet(context, account, holdSigning) {
  return context.addInitScript(({ account, signature, holdSigning }) => {
    let connected = false;
    window.__releaseSign = null;
    const provider = {
      isMetaMask: true,
      providers: [],
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts') { connected = true; return [account]; }
        if (method === 'eth_accounts') return connected ? [account] : [];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'personal_sign' || method === 'eth_sign') {
          if (holdSigning) await new Promise((resolve) => { window.__releaseSign = resolve; });
          return signature;
        }
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_requestPermissions') return null;
        if (method === 'wallet_getPermissions') return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        if (method === 'eth_getBalance') return '0x16345785d8a0000';
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
        if (method === 'eth_getCode') return '0x01';
        throw new Error(`Unsupported test wallet method: ${method}`);
      },
      on: () => {},
      removeListener: () => {},
    };
    provider.providers = [provider];
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
    window.dispatchEvent(new Event('ethereum#initialized'));
  }, { account, signature: dummySignature, holdSigning });
}

/** Layout assertions inside `scopeSelector` for the current viewport position. */
async function layoutFindings(page, scopeSelector, label) {
  return page.evaluate(({ scopeSelector, label }) => {
    const findings = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overflow = document.documentElement.scrollWidth - vw;
    if (overflow > 0) findings.push(`${label}: horizontal overflow ${overflow}px`);
    const scope = document.querySelector(scopeSelector);
    if (!scope) return [`${label}: scope ${scopeSelector} missing`];
    // Fixed/sticky chrome (header, launcher) overlays scrolled content by design; it is checked
    // separately against the launcher band, not as overlapping content text.
    const inFixedChrome = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') return true;
      }
      return false;
    };
    const visible = (el) => {
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
    };
    const textRects = [];
    const leaves = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
      if (inFixedChrome(node.parentElement)) continue;
      if (node.parentElement.closest('svg')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > vh) continue;
        textRects.push({ rect, el: node.parentElement, text: node.textContent.trim().slice(0, 40) });
      }
      if (!leaves.includes(node.parentElement)) leaves.push(node.parentElement);
    }
    for (const el of leaves) {
      const style = getComputedStyle(el);
      const clips = ['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis';
      if (clips && el.scrollWidth > el.clientWidth + 1) findings.push(`${label}: clipped text "${el.textContent.trim().slice(0, 40)}"`);
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 0.5 || rect.left < -0.5) findings.push(`${label}: text outside viewport "${el.textContent.trim().slice(0, 40)}"`);
    }
    const hit = (a, b, tolerance = 1) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
    for (let i = 0; i < textRects.length; i += 1) {
      for (let j = i + 1; j < textRects.length; j += 1) {
        const a = textRects[i];
        const b = textRects[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        if (hit(a.rect, b.rect, 2)) findings.push(`${label}: overlapping text "${a.text}" / "${b.text}"`);
      }
    }
    const launcher = document.querySelector('.shop-copilot-button');
    if (launcher && visible(launcher)) {
      const lr = launcher.getBoundingClientRect();
      for (const item of textRects) {
        if (hit(item.rect, lr, 0)) findings.push(`${label}: text under launcher "${item.text}"`);
      }
      for (const control of scope.querySelectorAll('button, a')) {
        if (!visible(control) || inFixedChrome(control)) continue;
        const cr = control.getBoundingClientRect();
        if (cr.width && cr.bottom > 0 && cr.top < vh && hit(cr, lr, 0)) findings.push(`${label}: control under launcher "${control.textContent.trim().slice(0, 30)}"`);
      }
    }
    return findings;
  }, { scopeSelector, label });
}

/**
 * F3 assertions inside the customer pass section at the current scroll position: every element stays
 * inside the section (no element overflow), primary action and status text are not covered by any fixed
 * overlay (Copilot launcher, toast/status layers), and the long labels are complete and not clipped.
 */
async function passFindings(page, label, fixture) {
  return page.evaluate(({ label, fixture }) => {
    const findings = [];
    const section = document.querySelector('#customer-pass');
    if (!section) return [`${label}: #customer-pass missing`];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sr = section.getBoundingClientRect();
    const visible = (el) => {
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
    };
    for (const el of section.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right > sr.right + 1 || rect.left < sr.left - 1) {
        findings.push(`${label}: element overflow <${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 40)}"`);
      }
      const style = getComputedStyle(el);
      if (['hidden', 'clip'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1 && !el.closest('svg')) {
        findings.push(`${label}: clipped content <${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 40)}"`);
      }
    }
    // Real fixed overlays: the Copilot launcher and any fixed toast/status layer that is not a full-screen dialog.
    const overlays = [...document.querySelectorAll('body *')].filter((el) => {
      if (!visible(el) || section.contains(el)) return false;
      if (getComputedStyle(el).position !== 'fixed') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.width * rect.height < vw * vh * 0.5;
    });
    const primary = [...section.querySelectorAll('button')].filter(visible);
    const status = [
      section.querySelector('span.rounded-full'),
      ...section.querySelectorAll('[aria-live], [role="alert"]'),
      ...[...section.querySelectorAll('strong')].filter((el) => ['REDEEMED', 'REJECTED', 'PENDING', 'EXPIRED'].includes(el.textContent.trim())),
    ].filter((el) => el && visible(el) && el.textContent.trim());
    const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
    for (const target of [...primary, ...status]) {
      const rects = target.tagName === 'BUTTON' ? [target.getBoundingClientRect()] : (() => {
        const range = document.createRange();
        range.selectNodeContents(target);
        return [...range.getClientRects()];
      })();
      for (const rect of rects) {
        if (rect.bottom < 0 || rect.top > vh) continue;
        for (const overlay of overlays) {
          if (hit(rect, overlay.getBoundingClientRect())) {
            const name = overlay.className && typeof overlay.className === 'string' ? overlay.className.split(' ')[0] : overlay.tagName.toLowerCase();
            findings.push(`${label}: ${target.tagName === 'BUTTON' ? 'primary action' : 'status text'} "${target.textContent.trim().slice(0, 40)}" under fixed overlay .${name}`);
          }
        }
      }
    }
    if (fixture) {
      const strongs = [...section.querySelectorAll('strong')];
      for (const [field, text] of [['label', fixture.label], ['productName', fixture.productName], ['sellerName', fixture.sellerName]]) {
        const el = strongs.find((candidate) => candidate.textContent.trim() === text);
        if (!el) { findings.push(`${label}: ${field} not rendered in full`); continue; }
        const rect = el.getBoundingClientRect();
        if (rect.right > sr.right + 1 || rect.left < sr.left - 1 || rect.right > vw + 0.5) findings.push(`${label}: ${field} outside the pass card`);
        if (el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(getComputedStyle(el).overflowX)) findings.push(`${label}: ${field} clipped`);
      }
    }
    return findings;
  }, { label, fixture });
}

async function historyItems() {
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const terms = {
    benefitRuleId: 'rule-demo', label: 'Espresso deal', productName: 'Espresso', basePriceMinor: '350', currency: 'EUR',
    requiredLockIFR: 1000, minIFRHeld: 0, lockSource: 'ifrlock', discountPercent: 10,
  };
  const termsDigest = `sha256:${require('node:crypto').createHash('sha256').update(JSON.stringify(terms)).digest('hex')}`;
  const message = [
    'IFR Benefits Network - Checkout Proof', 'Version: ifr-benefits/checkout-proof/2',
    'Purpose: Redeem this one checkout with verified IFR benefit eligibility', `Wallet: ${account.address}`,
    // F1: receipts verify only for this deployment's audience (page host) and chain (frontend CHAIN_ID).
    `Audience: ${new URL(origin).host}`, 'Chain ID: 1', 'Shop: demo-shop', 'Session: demo-session-1',
    `Nonce: ${'cd'.repeat(32)}`, 'Expires: 2026-10-06T10:00:00.000Z', 'Benefit Rule: rule-demo', 'Benefit: Espresso deal',
    'Product: Espresso', 'Reference Price: EUR 350 minor units', 'Required Lock IFR: 1000', 'Minimum Held IFR: 0',
    'Lock Source: ifrlock', 'Discount Percent: 10', `Terms Digest: ${termsDigest}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  return [
    {
      sessionId: 'demo-session-1', businessId: 'demo-shop', sellerName: 'Demo Coffee Bar (dummy data)', status: 'REDEEMED',
      discountPercent: 10, requiredLockIFR: 1000, minIFRHeld: 0, lockSource: 'ifrlock', ruleLabel: 'Espresso deal',
      productName: 'Espresso', basePriceMinor: '350', currency: 'EUR', expiresAt: '2026-10-06T10:00:00.000Z',
      redeemedAt: '2026-10-06T09:58:00.000Z', walletLabel: `${account.address.slice(0, 6)}...${account.address.slice(-4)}`,
      savedAt: '2026-10-06T09:58:01.000Z', proof: { version: 'ifr-benefits/checkout-proof/2', termsDigest, message, signature },
    },
    {
      sessionId: 'demo-session-0', businessId: 'demo-shop', sellerName: 'Demo Bakery With A Rather Long Shop Name (dummy)', status: 'EXPIRED',
      discountPercent: 5, requiredLockIFR: 500, minIFRHeld: 100, lockSource: 'either', ruleLabel: 'Bread',
      productName: 'Sourdough loaf', basePriceMinor: null, currency: null, expiresAt: '2026-10-05T10:00:00.000Z',
      redeemedAt: null, walletLabel: 'not verified', savedAt: '2026-10-05T09:58:01.000Z', proof: null,
    },
  ];
}

async function waitForServer(child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited (${child.exitCode})`);
    try { if ((await fetch(`${origin}/privacy`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for the Benefits frontend');
}

async function newContext(browser, width, wallet, holdSigning = false) {
  const context = await browser.newContext({ viewport: { width, height: width >= 820 ? 1000 : 844 }, serviceWorkers: 'block' });
  if (wallet) await installWallet(context, wallet, holdSigning);
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'html{scroll-behavior:auto!important}';
      document.head.appendChild(style);
    });
  });
  if (preFix) {
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.shop-launcher-band-clearance{padding-right:1.25rem!important}.shop-launcher-band-clearance-compact.p-6{padding-right:1.5rem!important}.shop-launcher-band-clearance-compact.grid{padding-right:0!important}';
        document.head.appendChild(style);
      });
    });
  }
  return context;
}

// Every mocked endpoint (dummy data; no real backend, wallet or chain is reached).
const MOCKS = [
  'GET /api/health, /api/ready -> ok',
  'GET /api/businesses, /api/businesses/:id, /api/businesses/:id/rules -> demo seller and rule',
  'GET /api/sessions/:id -> checkout status from the scenario state',
  'POST /api/sessions/:id/challenge, POST /api/attest -> seller-QR proof (REDEEMED or REJECTED)',
  'POST /api/sessions/:id/redeem -> 410 (must never be called)',
  'GET /api/seller/auth-message, GET /api/seller/businesses/:id/operator-status, POST /api/sessions -> seller console',
  'POST /api/passes -> pass-demo-1 (OPEN)',
  'GET /api/passes/:id/control -> pass status from the scenario (OPEN | BOUND+PENDING | BOUND+REDEEMED | BOUND+REJECTED | EXPIRED)',
  'POST /api/passes/:id/challenge -> proof text; POST /api/passes/:id/confirm -> REDEEMED or REJECTED (refusal reason)',
  'window.ethereum -> injected test wallet 0x1111...1111 / 0x2222...2222 with a fixed dummy signature (signing can be held)',
  'serviceWorkers blocked; BENEFITS_API_INTERNAL_URL=http://127.0.0.1:9 (no server-side API reachable)',
];

function buildIdentity() {
  const run = (args) => { try { return require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
  const buildIdFile = path.join(frontend, '.next', 'BUILD_ID');
  return {
    sha: run(['rev-parse', 'HEAD']),
    frontendClean: run(['status', '--porcelain', '--', 'apps/benefits-network/frontend', 'scripts/test-benefits-owner-b-visual.js']) === '',
    nextBuildId: fs.existsSync(buildIdFile) ? fs.readFileSync(buildIdFile, 'utf8').trim() : 'missing',
    nextBuiltAt: fs.existsSync(buildIdFile) ? fs.statSync(buildIdFile).mtime.toISOString() : null,
  };
}

function writeEvidenceIndex(build, captures, findings) {
  const passCaptures = captures.filter((capture) => capture.screen.startsWith('Customer checkout pass'));
  if (!passCaptures.length) return;
  const passFindings = findings.filter((finding) => finding.startsWith('pass-'));
  const categories = {};
  for (const finding of passFindings) {
    const match = finding.match(/^pass-(.+?)-(long-[a-z]+)@(\d+)(-launcher)?[^:]*: (.*?)(?: "|$)/);
    if (!match) continue;
    const key = `${match[5].replace(/ <\w+>$/, '')} | ${match[1]} / ${match[2]}${match[4] ? ' (viewport at primary action)' : ' (scroll-through)'}`;
    categories[key] = categories[key] || new Set();
    categories[key].add(match[3]);
  }
  const lines = [
    '# T-231b F3 evidence - customer-presented checkout pass',
    '',
    `Build SHA: \`${build.sha}\` (frontend and harness clean at that SHA: ${build.frontendClean ? 'yes' : 'NO'}); Next.js BUILD_ID \`${build.nextBuildId}\` built ${build.nextBuiltAt}.`,
    `Harness: \`scripts/test-benefits-owner-b-visual.js\` (BENEFITS_VISUAL_SCREENS=${[...screens].join(',')}). Widths: ${widths.join(', ')} px.`,
    `Result: **${passFindings.length ? 'FAIL' : 'PASS'}** - ${passCaptures.length} captures, ${passFindings.length} pass findings.`,
    '',
    '## Mocks (dummy data only)',
    ...MOCKS.map((mock) => `- ${mock}`),
    '',
    '## Fixtures',
    ...Object.entries(PASS_FIXTURES).map(([name, fixture]) => `- ${name}: label ${fixture.label.length} chars, product name ${fixture.productName.length} chars, seller name ${fixture.sellerName.length} chars`),
    '',
    '## Assertions',
    '- no horizontal page overflow; no element of #customer-pass outside the card; no clipped text; no overlapping text',
    '- primary actions (all visible buttons) and status text (status pill, checkout status, aria-live/alert messages) not under any fixed overlay (Copilot launcher .shop-copilot-button; any fixed toast/status layer - none exists in the Benefits frontend)',
    '- no text or control under the launcher while the card is scrolled through in 60 px steps',
    '- label, product name and seller name rendered in full, inside the card, not clipped',
    '',
    '## Findings by assertion, state / fixture (widths)',
    ...(Object.keys(categories).length ? Object.entries(categories).sort().map(([key, set]) => `- ${key}: ${[...set].join(', ')}`) : ['- none']),
    '',
    '## Captures',
    '| state | fixture | width | view | overlays present | file |',
    '|---|---|---|---|---|---|',
    ...passCaptures.map((capture) => `| ${capture.state} | ${capture.fixture} | ${capture.width} | ${capture.view} | ${[...new Set(capture.overlays)].join(' ')} | [${capture.file}](${capture.file}) |`),
    '',
    'Full finding list: assertions.json.',
    '',
  ];
  fs.writeFileSync(path.join(outDir, 'INDEX.md'), lines.join('\n'));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: frontend,
    env: { ...process.env, BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const findings = [];
  const captures = [];
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch();
    const items = await historyItems();

    for (const width of widths) {
      // ── Device-local history: scroll through the card under the fixed launcher ──
      if (screens.has('history')) {
        const context = await newContext(browser, width, null);
        await context.addInitScript((data) => window.localStorage.setItem('ifr.shop.customerProofHistory.v1', JSON.stringify(data)), items);
        const state = { calls: [], sellerActions: [], redeemCalls: 0, checkout: 'PENDING', expiresAt: new Date(Date.now() + 300_000).toISOString() };
        await installApi(context, state);
        const page = await context.newPage();
        await page.goto(`${origin}/#my-benefits`, { waitUntil: 'networkidle' });
        const card = page.getByTestId('device-history');
        await card.scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: 'Verify receipt' }).click();
        await page.getByText('Signed terms verified on this device').waitFor();
        const box = await card.boundingBox();
        const top = await page.evaluate(() => window.scrollY);
        for (let offset = -400; offset <= box.height; offset += 60) {
          await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.max(0, top + box.y + offset - 200));
          findings.push(...await layoutFindings(page, '[data-testid="device-history"]', `history@${width}+${offset}`));
        }
        assert.ok(!state.calls.some((call) => call.includes('/customer/history')), 'device history must not call the server history');
        // Full-page render clipped to the card: the sticky header and the fixed launcher are drawn once
        // at their page positions instead of being stitched into an element screenshot.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        const cardBox = await card.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
        });
        const file = `history-${width}.png`;
        await page.screenshot({ path: path.join(outDir, file), fullPage: true, clip: { x: 0, y: Math.max(0, cardBox.y - 16), width, height: cardBox.height + 32 } });
        captures.push({ file, screen: 'Device-local history (My benefits)', state: 'verified receipt + unverified local notes', width });
        await context.close();
      }

      // ── Customer seller-QR checkout ──
      for (const scenario of screens.has('customer') ? ['idle', 'signing', 'success', 'failure'] : []) {
        const context = await newContext(browser, width, customerWallet, scenario === 'signing');
        const state = {
          calls: [], sellerActions: [], redeemCalls: 0, checkout: 'PENDING',
          attestOutcome: scenario === 'failure' ? 'REJECTED' : 'REDEEMED',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
        await installApi(context, state);
        const page = await context.newPage();
        await page.goto(`${origin}/r/${sessionId}`, { waitUntil: 'networkidle' });
        await page.getByText('MetaMask provider', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
        await page.getByRole('button', { name: 'Disconnect', exact: true }).first().waitFor();
        const sign = page.getByRole('button', { name: /Sign and verify|Retry verification|Verifying/ });
        await sign.waitFor();
        if (scenario !== 'idle') {
          await sign.click();
          if (scenario === 'signing') {
            await page.getByRole('button', { name: 'Verifying...' }).waitFor();
          } else if (scenario === 'success') {
            await page.getByText('Redeemed - show seller').first().waitFor();
            assert.equal(state.calls.filter((call) => call === 'POST /api/attest').length, 1, 'one request signs and redeems');
          } else {
            await page.getByText('Not eligible').first().waitFor();
            assert.equal(state.checkout, 'PENDING', 'a failed proof leaves the checkout open');
          }
        }
        assert.equal(state.redeemCalls, 0);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        findings.push(...await layoutFindings(page, 'main', `customer-${scenario}@${width}-top`));
        // Capture the state-bearing area: readiness card + sign button centred in the viewport.
        await page.getByRole('button', { name: /Sign and verify|Retry verification|Verifying/ }).evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
        await page.waitForTimeout(400);
        findings.push(...await layoutFindings(page, 'main', `customer-${scenario}@${width}-state`));
        const file = `customer-${scenario}-${width}.png`;
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
        captures.push({ file, screen: 'Customer seller-QR checkout (/r/:sessionId)', state: scenario, width });
        if (scenario === 'signing') await page.evaluate(() => window.__releaseSign && window.__releaseSign());
        await context.close();
      }

      // ── Seller checkout console ──
      for (const scenario of screens.has('seller') ? ['open', 'redeemed', 'expired'] : []) {
        const context = await newContext(browser, width, sellerWallet);
        const state = {
          calls: [], sellerActions: [], redeemCalls: 0, checkout: 'NONE',
          expiresAt: new Date(Date.now() + (scenario === 'expired' ? 2_000 : 300_000)).toISOString(),
        };
        await installApi(context, state);
        const page = await context.newPage();
        await page.goto(`${origin}/b/${businessId}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: business.name }).first().waitFor();
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByText(`${sellerWallet.slice(0, 6)}...${sellerWallet.slice(-4)}`).first().waitFor();
        await page.getByRole('button', { name: /^Create QR( session)?$/ }).first().click();
        await page.getByText('Checkout session saved on this device.').first().waitFor();
        assert.ok(state.sellerActions.includes('sessions:create'), 'the checkout is opened with a seller signature');
        if (scenario === 'redeemed') {
          state.checkout = 'REDEEMED';
          state.redeemedAt = new Date().toISOString();
          await page.getByRole('heading', { level: 3, name: 'Redeemed - apply the discount', exact: true }).waitFor({ timeout: 15_000 });
        } else if (scenario === 'expired') {
          state.checkout = 'EXPIRED';
          await page.getByText('EXPIRED', { exact: true }).first().waitFor({ timeout: 15_000 });
        } else {
          await page.getByText('PENDING', { exact: true }).first().waitFor({ timeout: 15_000 });
        }
        assert.equal(await page.getByRole('button', { name: /^Redeem/ }).count(), 0, 'no separate seller redeem button');
        assert.ok(!state.sellerActions.includes('sessions:redeem'), 'no seller redeem signature is requested');
        assert.equal(state.redeemCalls, 0);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        findings.push(...await layoutFindings(page, 'main', `seller-${scenario}@${width}-top`));
        // Capture the checkout status area (QR / status / result card).
        const stateText = scenario === 'redeemed' ? 'Redeemed - apply the discount' : scenario === 'expired' ? 'EXPIRED' : 'PENDING';
        await page.getByText(stateText, { exact: true }).last().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(400);
        findings.push(...await layoutFindings(page, 'main', `seller-${scenario}@${width}-state`));
        const file = `seller-${scenario}-${width}.png`;
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
        captures.push({ file, screen: 'Seller checkout console (/b/:businessId)', state: scenario, width });
        await context.close();
      }

      // ── F3: customer-presented checkout pass (CustomerCheckoutPass on /#customer-pass) ──
      const passCases = screens.has('pass') ? [
        ...['open', 'bound', 'proof-signing', 'proof-redeemed', 'refusal', 'expired'].map((scenario) => [scenario, 'long-words']),
        ['bound', 'long-unbroken'],
      ] : [];
      for (const [scenario, fixtureName] of passCases) {
        const fixture = PASS_FIXTURES[fixtureName];
        const context = await newContext(browser, width, customerWallet, scenario === 'proof-signing');
        const state = {
          calls: [], sellerActions: [], redeemCalls: 0, checkout: 'PENDING',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          pass: { status: 'NONE', checkout: null, fixture: fixtureName, outcome: scenario === 'refusal' ? 'REJECTED' : 'REDEEMED' },
        };
        await installApi(context, state);
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(`${origin}/#customer-pass`, { waitUntil: 'networkidle' });
        await page.getByText('MetaMask provider', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
        await page.getByRole('button', { name: 'Disconnect', exact: true }).first().waitFor();
        const panel = page.locator('#customer-pass');
        await panel.getByRole('button', { name: 'Create customer QR', exact: true }).click();
        await panel.getByText('Pass ready. Let the seller scan this QR, then review the exact offer here.').waitFor();
        const refresh = () => panel.getByRole('button', { name: 'Refresh', exact: true }).click();
        if (scenario === 'expired') {
          state.pass.status = 'EXPIRED';
          state.pass.checkout = 'EXPIRED';
          await refresh();
          await panel.getByText('Pass refreshed: EXPIRED').waitFor();
        } else if (scenario !== 'open') {
          state.pass.status = 'BOUND';
          state.pass.checkout = 'PENDING';
          await refresh();
          const confirmButton = panel.getByRole('button', { name: 'Confirm this seller and offer', exact: true });
          await confirmButton.waitFor();
          if (scenario === 'proof-signing') {
            await confirmButton.click();
            await panel.getByRole('button', { name: 'Confirming...', exact: true }).waitFor();
          } else if (scenario === 'proof-redeemed') {
            await confirmButton.click();
            await panel.getByText('Checkout redeemed once. Show this screen to the seller; their console shows the same result.').waitFor();
            await panel.getByText('REDEEMED', { exact: true }).first().waitFor();
          } else if (scenario === 'refusal') {
            await confirmButton.click();
            await panel.getByText(PASS_REFUSAL_REASON).waitFor();
            await panel.getByText('REJECTED', { exact: true }).first().waitFor();
            assert.notEqual(state.checkout, 'REDEEMED', 'a refused proof does not redeem');
          }
        }
        assert.equal(state.redeemCalls, 0, 'no separate seller redemption');
        const labelBase = `pass-${scenario}-${fixtureName}@${width}`;
        const labelFixture = scenario === 'open' ? null : fixture;
        // Scroll through the whole pass card in steps, so every part passes the fixed launcher band.
        const sectionBox = await panel.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { y: rect.top + window.scrollY, height: rect.height };
        });
        const viewportHeight = page.viewportSize().height;
        const stops = [];
        for (let y = Math.max(0, sectionBox.y - viewportHeight + 60); y <= sectionBox.y + sectionBox.height; y += 60) stops.push(y);
        for (const y of stops) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
          findings.push(...await layoutFindings(page, '#customer-pass', `${labelBase}+${y}`));
          findings.push(...await passFindings(page, `${labelBase}+${y}`, labelFixture));
        }
        if (pageErrors.length) findings.push(`${labelBase}: page errors ${pageErrors.join(' | ').slice(0, 200)}`);
        // Evidence: (1) the full card, (2) the viewport with the primary action / status at the launcher band.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(200);
        const card = await panel.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { y: rect.top + window.scrollY, height: rect.height };
        });
        const cardFile = `pass-${scenario}-${fixtureName}-${width}.png`;
        await page.screenshot({ path: path.join(outDir, cardFile), fullPage: true, clip: { x: 0, y: Math.max(0, card.y - 16), width, height: card.height + 32 } });
        const anchor = panel.getByRole('button', { name: /Confirm this seller and offer|Confirming\.\.\.|New pass|Cancel & new pass/ }).first();
        await anchor.evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
        await page.evaluate(() => window.scrollBy({ top: 24, behavior: 'instant' }));
        await page.waitForTimeout(200);
        findings.push(...await passFindings(page, `${labelBase}-launcher`, labelFixture));
        const launcherFile = `pass-${scenario}-${fixtureName}-${width}-launcher.png`;
        await page.screenshot({ path: path.join(outDir, launcherFile) });
        const overlays = await page.evaluate(() => [...document.querySelectorAll('body *')]
          .filter((el) => getComputedStyle(el).position === 'fixed' && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
          .map((el) => (typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : el.tagName.toLowerCase())));
        captures.push({ file: cardFile, screen: 'Customer checkout pass (/#customer-pass)', state: scenario, fixture: fixtureName, width, view: 'card', overlays });
        captures.push({ file: launcherFile, screen: 'Customer checkout pass (/#customer-pass)', state: scenario, fixture: fixtureName, width, view: 'viewport at primary action', overlays });
        if (scenario === 'proof-signing') await page.evaluate(() => window.__releaseSign && window.__releaseSign());
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
  const build = buildIdentity();
  fs.writeFileSync(path.join(outDir, 'assertions.json'), `${JSON.stringify({ build, preFix, widths, screens: [...screens], captures, findings }, null, 2)}\n`);
  writeEvidenceIndex(build, captures, findings);
  if (findings.length) {
    console.error(findings.slice(0, 40).join('\n'));
    console.error(`[benefits-owner-b-visual] FAIL - ${findings.length} layout findings`);
    process.exit(1);
  }
  console.log(`[benefits-owner-b-visual] PASS - ${captures.length} captures, 0 findings`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
