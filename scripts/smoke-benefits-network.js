#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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

async function verifyHttpSurface() {
  const health = await fetchJson('/api/health');
  assert(health.status === 'ok', `/api/health status is ${health.status}`);
  assert(Number(health.chainId) === 1, `/api/health chainId is ${health.chainId}, expected 1`);
  log('API health OK');

  const ready = await fetchJson('/api/ready');
  assert(ready.status === 'ready', `/api/ready status is ${ready.status}`);
  assert(ready.database === 'ok', `/api/ready database is ${ready.database}`);
  assert(Number(ready.chainId) === 1, `/api/ready chainId is ${ready.chainId}, expected 1`);
  log('API readiness OK');

  const manifest = await fetchJson('/manifest.json');
  assert(manifest.name === 'IFRp Shop Benefits Network', 'manifest name mismatch');
  assert(manifest.display === 'standalone', 'manifest display must be standalone');
  assert(manifest.start_url === '/', 'manifest start_url must be /');
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest must expose PWA icons');
  log('PWA manifest OK');

  await fetchOk('/icons/icon-192.png', 'image/png');
  await fetchOk('/icons/icon-512.png', 'image/png');
  await fetchOk('/sw.js', 'javascript');
  log('PWA assets OK');

  const auth = await fetchJson('/api/seller/auth-message?action=business:list&businessId=seller');
  assert(auth.message.includes('IFR Benefits Network - Seller Authorization'), 'seller auth message header mismatch');
  assert(auth.message.includes('Only sign this message inside shop.ifrunit.tech.'), 'seller auth safety line missing');
  assert(auth.timestamp && auth.expiresAt, 'seller auth challenge missing timestamp/expiry');
  log('Seller auth challenge OK');
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: timeoutMs });
}

function isIgnorableConsoleError(text) {
  return (
    text.includes('status of 404') ||
    (text.includes('Analytics SDK') && text.includes('Failed to fetch'))
  );
}

async function verifyPage(contextOptions, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isIgnorableConsoleError(text)) {
      errors.push(`console: ${text}`);
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 500) errors.push(`HTTP ${status}: ${response.url()}`);
  });

  try {
    await page.goto(`${baseUrl}/?smoke=${Date.now()}`, { waitUntil: 'networkidle', timeout: timeoutMs });
    await expectText(page, 'The shop layer for locked IFR access.');
    await expectText(page, 'Mobile app');
    await expectText(page, 'Install once. Use as customer or seller.');
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
    await expectText(page, 'Checkout readiness');
    await expectText(page, 'Current tier');
    await expectText(page, 'Lock transaction path');
    await expectText(page, 'IFR amount to lock');
    await expectText(page, 'Allowance');
    await expectText(page, 'Unlock all');
    await expectText(page, 'Create a seller entry point');
    await expectText(page, 'Seller categories');
    await page.getByRole('button', { name: /Seller Offer discounts/i }).click();
    await expectText(page, 'Seller readiness');
    await page.getByRole('heading', { name: 'Connect seller wallet' }).first().waitFor({ timeout: timeoutMs });
    await expectText(page, 'Active benefit rule loaded');
    await expectText(page, 'Load profiles');
    await expectText(page, 'Create profile');
    await page.getByLabel('Business ID').first().fill('smoke-manual-business');
    await expectText(page, 'Share with the counter team');
    await expectText(page, 'Staff scanner QR');
    await expectText(page, 'Show this QR at the counter.');
    await expectText(page, 'Share kit');

    await page.goto(`${baseUrl}/guide?smoke=${Date.now()}`, { waitUntil: 'networkidle', timeout: timeoutMs });
    await expectText(page, 'IFRp Benefits Network Guide');
    await expectText(page, 'Customer path');
    await expectText(page, 'Seller path');

    await page.goto(`${baseUrl}/b/smoke-missing-business?smoke=${Date.now()}`, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });
    await expectText(page, 'Seller scanner');
    await expectText(page, 'Business console');
    await expectText(page, 'Checkout readiness');
    await expectText(page, 'Load business');
    await expectText(page, 'Seller profile loaded');
    await expectText(page, 'Copy customer link');
    await expectText(page, 'Checkout receipt');
    await expectText(page, 'Copy receipt');

    await page.goto(`${baseUrl}/r/smoke-missing-session?smoke=${Date.now()}`, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });
    await expectText(page, 'Customer proof');
    await expectText(page, 'Proof readiness');
    await expectText(page, 'Load verification');
    await expectText(page, 'QR session loaded');
    await expectText(page, 'Refresh status');
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
  await verifyPage({ viewport: { width: 1440, height: 1100 } }, 'desktop');
  await verifyPage(devices['iPad Pro 11'], 'ipad');
  log('PASS');
}

main().catch((error) => {
  console.error(`[benefits-smoke] FAIL: ${error.message}`);
  process.exit(1);
});
