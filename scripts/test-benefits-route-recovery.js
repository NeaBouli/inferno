#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.BENEFITS_BASE_URL || 'http://127.0.0.1:3000';
const SESSION_ID = 'recovery-session';
const PASS_ID = 'recoveryPass0000000000000000000';
const BUSINESS_ID = 'recovery-seller';
const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

const business = {
  id: BUSINESS_ID,
  slug: BUSINESS_ID,
  name: 'Recovery Test Seller',
  description: 'Deterministic recovery fixture.',
  website: null,
  logoUrl: null,
  serviceArea: 'Online',
  categories: ['Local services'],
  discountPercent: 10,
  requiredLockIFR: 1000,
  tierLabel: 'Member',
};

const rule = {
  id: 'recovery-rule',
  businessId: BUSINESS_ID,
  productId: null,
  label: 'Recovery benefit',
  category: 'Local services',
  productName: 'Recovery checkout',
  discountPercent: 10,
  requiredLockIFR: 1000,
  minIFRHeld: 0,
  lockSource: 'ifrlock',
  dailyRedemptionLimit: 1,
  monthlyRedemptionLimit: 4,
  ttlSeconds: 300,
  active: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const session = {
  status: 'PENDING',
  reason: null,
  redeemedAt: null,
  expiresAt,
  attestAttempts: 0,
  businessId: BUSINESS_ID,
  benefitRuleId: rule.id,
  presentation: 'SELLER_QR',
  benefit: {
    benefitRuleId: rule.id,
    label: rule.label,
    category: rule.category,
    productName: rule.productName,
    basePriceMinor: null,
    currency: null,
    discountPercent: rule.discountPercent,
    requiredLockIFR: rule.requiredLockIFR,
    minIFRHeld: rule.minIFRHeld,
    lockSource: rule.lockSource,
    dailyRedemptionLimit: rule.dailyRedemptionLimit,
    monthlyRedemptionLimit: rule.monthlyRedemptionLimit,
    ttlSeconds: rule.ttlSeconds,
    tierLabel: 'Member',
  },
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function createContext(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  await context.route('**/sw.js*', (route) => route.abort());
  return context;
}

function verifyGlobalErrorContract() {
  const source = fs.readFileSync(
    path.join(ROOT, 'apps/benefits-network/frontend/src/app/global-error.tsx'),
    'utf8',
  );
  assert.match(source, /^'use client';/);
  assert.match(source, /<html lang="en">/);
  assert.match(source, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(source, /<body/);
  assert.match(source, /data-testid="shop-global-error"/);
  assert.match(source, /onClick=\{reset\}/);
  assert.match(source, /Your wallet remains in your control/);
  assert.match(source, /never asks for a seed phrase or private key/i);
  assert.doesNotMatch(source, /error\.(?:message|stack)|error\.digest/);
}

async function verifyCustomerSessionRetry(browser) {
  const context = await createContext(browser);
  let attempts = 0;
  await context.route(`**/api/sessions/${SESSION_ID}`, (route) => {
    attempts += 1;
    if (attempts === 1) return json(route, { error: 'Temporary session outage.' }, 503);
    return json(route, session);
  });
  await context.route(`**/api/businesses/${BUSINESS_ID}`, (route) => json(route, business));

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/r/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Verification unavailable', exact: true }).waitFor();
  await page.getByText('The session did not load. Check your connection and retry this checkout link.', { exact: true }).waitFor();
  const retry = page.getByRole('button', { name: 'Retry loading verification', exact: true });
  assert.equal(await retry.isEnabled(), true, 'customer session retry must be enabled after initial failure');
  assert.equal(attempts, 1, 'customer session must not poll while the initial load is unresolved');
  await retry.click();
  await page.getByText(business.name, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).waitFor();
  assert.ok(attempts >= 2, 'customer session retry must perform a successful additional load');
  await context.close();
}

async function verifyCustomerPassRetry(browser) {
  const context = await createContext(browser);
  let attempts = 0;
  await context.route(`**/api/passes/${PASS_ID}`, (route) => {
    attempts += 1;
    if (attempts === 1) return json(route, { error: 'Temporary pass outage.' }, 503);
    return json(route, { available: true, expiresAt });
  });

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/p/${PASS_ID}`, { waitUntil: 'domcontentloaded' });
  const retry = page.getByRole('button', { name: 'Retry pass lookup', exact: true });
  await retry.waitFor();
  assert.equal(await retry.isEnabled(), true, 'pass retry must be enabled after lookup failure');
  await retry.click();
  await page.getByText('Ready', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Open seller checkout', exact: true }).isEnabled(),
    true,
    'seller handoff must recover after pass retry',
  );
  assert.equal(attempts, 2, 'pass retry must perform exactly one additional lookup');
  await page.getByRole('button', { name: 'Open seller checkout', exact: true }).click();
  await page.getByText('Enter a shop.ifrunit.tech seller URL, seller slug or profile ID.', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Retry pass lookup', exact: true }).count(),
    0,
    'seller-reference validation errors must not be presented as pass lookup failures',
  );
  await context.close();
}

async function verifyUnavailablePassGuidance(browser) {
  const context = await createContext(browser);
  await context.route(`**/api/passes/${PASS_ID}`, (route) => json(route, { available: false, expiresAt }));
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/p/${PASS_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(
    'This pass is expired, cancelled or already bound. Ask the customer to create a fresh checkout pass.',
    { exact: true },
  ).waitFor();
  await context.close();
}

async function verifySellerProfileRetry(browser) {
  const context = await createContext(browser);
  let attempts = 0;
  await context.route(`**/api/businesses/${BUSINESS_ID}`, (route) => {
    attempts += 1;
    if (attempts === 1) return json(route, { error: 'Temporary seller outage.' }, 503);
    return json(route, business);
  });
  await context.route(`**/api/businesses/${BUSINESS_ID}/rules`, (route) => json(route, { rules: [rule] }));

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/b/${BUSINESS_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Seller profile unavailable', exact: true }).waitFor();
  const retry = page.getByRole('button', { name: 'Retry seller profile', exact: true });
  assert.equal(await retry.isEnabled(), true, 'seller profile retry must be enabled after initial failure');
  await retry.click();
  await page.getByRole('heading', { name: business.name, exact: true }).waitFor();
  assert.equal(attempts, 2, 'seller retry must perform exactly one additional profile load');
  await context.close();
}

async function main() {
  verifyGlobalErrorContract();
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyCustomerSessionRetry(browser);
    await verifyCustomerPassRetry(browser);
    await verifyUnavailablePassGuidance(browser);
    await verifySellerProfileRetry(browser);
  } finally {
    await browser.close();
  }
  console.log('[benefits-route-recovery] PASS');
}

main().catch((error) => {
  console.error(`[benefits-route-recovery] FAIL: ${error?.stack || error}`);
  process.exitCode = 1;
});
