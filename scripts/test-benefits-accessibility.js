#!/usr/bin/env node

const { chromium, devices } = require('playwright');
const axeSource = require('axe-core').source;

const BASE_URL = process.env.BENEFITS_BASE_URL || 'http://127.0.0.1:3000';
// Deterministic valid-looking but nonexistent resource IDs: they exercise the
// real not-found states of the checkout surfaces without touching real data.
// Business/session references are cuid-shaped (25 chars), the seller reference
// is a valid slug, and the pass ID matches the 32-char base64url pass format.
const NONEXISTENT_BUSINESS_REF = 'clza11ynonexistentbiz0001';
const NONEXISTENT_SELLER_SLUG = 'a11y-nonexistent-seller';
const NONEXISTENT_SESSION_ID = 'clza11ynonexistentsess001';
const NONEXISTENT_PASS_ID = 'a11yNonexistentPass0000000000000';
const BRANDED_NOT_FOUND_ROUTE = '/r';
const ROUTES = [
  '/',
  '/?mode=seller',
  '/guide',
  '/privacy',
  '/scan',
  '/offline.html',
  `/b/${NONEXISTENT_BUSINESS_REF}`,
  `/s/${NONEXISTENT_SELLER_SLUG}`,
  `/r/${NONEXISTENT_SESSION_ID}`,
  `/p/${NONEXISTENT_PASS_ID}`,
  BRANDED_NOT_FOUND_ROUTE,
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const DEVICES = [
  {
    name: 'desktop-1440x1000',
    config: {
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
  },
  { name: 'iPad Pro 11', config: devices['iPad Pro 11'] },
  { name: 'Galaxy S9+', config: devices['Galaxy S9+'] },
];

function parseViewportConstraint(content = '') {
  const entries = String(content)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  let userScalable = null;
  let maximumScale = null;

  for (const entry of entries) {
    const [key, rawValue] = entry.split('=').map((chunk) => chunk.trim());
    if (!key || typeof rawValue === 'undefined') continue;
    if (key === 'user-scalable') userScalable = rawValue;
    if (key === 'maximum-scale') maximumScale = rawValue;
  }

  const disallowUserScale = userScalable === 'no' || userScalable === '0';
  const maxScaleNumber = maximumScale ? Number.parseFloat(maximumScale) : null;
  const disallowScaleLimit = Number.isFinite(maxScaleNumber) && maxScaleNumber < 2;

  return {
    content,
    disallowUserScale,
    disallowScaleLimit,
    maxScale: maxScaleNumber,
    userScalable,
  };
}

function formatViolation(route, device, violation) {
  return [
    `Route: ${route}`,
    `Device: ${device}`,
    `Rule: ${violation.id} (${violation.impact || 'impact-unknown'})`,
    `Description: ${violation.description}`,
    `Targets: ${violation.nodes?.map((node) => node.target.join(' ')).join(' | ') || 'n/a'}`,
    `Help: ${violation.help}`,
  ].join('\n');
}

function formatViewportFailure(route, device, report) {
  const reasons = [];
  if (report.disallowUserScale) reasons.push(`user-scalable=${report.userScalable}`);
  if (report.disallowScaleLimit) reasons.push(`maximum-scale=${report.maxScale}`);

  return [
    `Route: ${route}`,
    `Device: ${device}`,
    'Rule: viewport-user-scalability-safety',
    `Description: Viewport prevents comfortable user scaling by mobile zoom (${reasons.join(', ')})`,
    `Content: ${report.content || '(missing)'}`,
  ].join('\n');
}

async function runRoute(route, deviceName, page) {
  const failures = [];
  const target = `${BASE_URL}${route}`;

  const response = await page.goto(target, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });

  const expectedStatus = route === BRANDED_NOT_FOUND_ROUTE ? 404 : 200;
  if (!response || response.status() !== expectedStatus) {
    failures.push({
      type: 'navigation',
      route,
      device: deviceName,
      message: `${route} returned HTTP ${response ? response.status() : 'no-response'}; expected ${expectedStatus}`,
    });
  }

  if (route === BRANDED_NOT_FOUND_ROUTE) {
    const recovery = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="shop-not-found"]');
      const links = root
        ? [...root.querySelectorAll('a')].map((link) => link.getAttribute('href'))
        : [];
      return {
        present: Boolean(root),
        text: root?.textContent || '',
        links,
      };
    });
    const requiredLinks = ['/', '/scan', '/guide'];
    if (
      !recovery.present ||
      !recovery.text.includes('This benefits link is incomplete.') ||
      recovery.text.includes('This page could not be found') ||
      requiredLinks.some((href) => !recovery.links.includes(href))
    ) {
      failures.push({
        type: 'recovery',
        route,
        device: deviceName,
        message: `${route} did not render the complete branded recovery surface`,
      });
    }
  }

  await page.addScriptTag({ content: axeSource });

  const viewportMeta = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    return meta ? meta.getAttribute('content') || '' : '';
  });

  const viewportCheck = parseViewportConstraint(viewportMeta);
  if (viewportCheck.disallowUserScale || viewportCheck.disallowScaleLimit) {
    failures.push({
      type: 'viewport-scaling',
      route,
      device: deviceName,
      message: formatViewportFailure(route, deviceName, viewportCheck),
    });
  }

  const axeResult = await page.evaluate(async (tags) => {
    return window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: tags,
      },
      resultTypes: ['violations'],
    });
  }, TAGS);

  if (axeResult.violations.length) {
    for (const violation of axeResult.violations) {
      failures.push({
        type: 'axe',
        route,
        device: deviceName,
        message: formatViolation(route, deviceName, violation),
      });
    }
  }

  return failures;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const allFailures = [];

  try {
    for (const device of DEVICES) {
      const context = await browser.newContext(device.config);
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.includes('/sw.js')) return route.abort();
        return route.continue();
      });

      const page = await context.newPage();

      for (const route of ROUTES) {
        const routeFailures = await runRoute(route, device.name, page);
        allFailures.push(...routeFailures);
      }

      await context.close();
    }

    if (allFailures.length > 0) {
      const axeFailures = allFailures.filter((entry) => entry.type === 'axe').length;
      const navFailures = allFailures.filter((entry) => entry.type === 'navigation').length;
      const viewportFailures = allFailures.filter((entry) => entry.type === 'viewport-scaling').length;
      const recoveryFailures = allFailures.filter((entry) => entry.type === 'recovery').length;

      console.error('[benefits-accessibility-gate] FAIL');
      console.error(
        `summary: axe=${axeFailures}, navigation=${navFailures}, viewport-scaling=${viewportFailures}, recovery=${recoveryFailures}, total=${allFailures.length}`,
      );
      for (const failure of allFailures) {
        console.error(`--\n${failure.message}`);
      }

      process.exitCode = 1;
      return;
    }

    console.log('[benefits-accessibility-gate] PASS');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[benefits-accessibility-gate] FAIL: ${error?.message || error}`);
  process.exitCode = 1;
});
