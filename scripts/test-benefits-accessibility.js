#!/usr/bin/env node

const { chromium, devices } = require('playwright');
const axeSource = require('axe-core').source;

const BASE_URL = process.env.BENEFITS_BASE_URL || 'http://127.0.0.1:3000';
const ROUTES = ['/', '/?mode=seller', '/guide', '/scan', '/offline.html'];
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

  if (!response || response.status() >= 400) {
    failures.push({
      type: 'navigation',
      route,
      device: deviceName,
      message: `${route} returned HTTP ${response ? response.status() : 'no-response'}`,
    });
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

      console.error('[benefits-accessibility-gate] FAIL');
      console.error(
        `summary: axe=${axeFailures}, navigation=${navFailures}, viewport-scaling=${viewportFailures}, total=${allFailures.length}`,
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
