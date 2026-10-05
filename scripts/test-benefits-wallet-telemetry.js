#!/usr/bin/env node
// T-280: privacy gate for the Benefits frontend.
// Loads the built app (BENEFITS_BASE_URL, default http://127.0.0.1:3000) in a
// fresh browser context with full network logging and asserts that no wallet
// SDK telemetry or analytics host is contacted before the visitor picks a
// wallet. Third-party telemetry requests are aborted (never sent upstream);
// they are only recorded. The test never connects or signs with a wallet.

const { chromium } = require('playwright');

const BASE_URL = process.env.BENEFITS_BASE_URL || 'http://127.0.0.1:3000';
const SETTLE_MS = Number(process.env.BENEFITS_TELEMETRY_SETTLE_MS || 6000);
const ROUTES = ['/', '/?mode=seller', '/guide', '/b/telemetry-check', '/r/telemetry-check'];
const VIEWPORTS = [
  { name: 'mobile 375x812', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: 'desktop 1440x1000', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false },
];

// Hosts that only exist for wallet SDK telemetry/analytics.
const TELEMETRY_HOSTS = [
  'cca-lite.coinbase.com', // Coinbase Wallet SDK client analytics (Amplitude via CCA)
  'cca.coinbase.com',
  'as.coinbase.com',
  'api.amplitude.com',
  'api2.amplitude.com',
  'pulse.walletconnect.org', // WalletConnect core event client + AppKit analytics
  'pulse.walletconnect.com',
];

function isTelemetry(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return TELEMETRY_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

(async () => {
  const failures = [];
  const thirdParty = new Set();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      for (const route of ROUTES) {
        const context = await browser.newContext({
          viewport: vp.viewport,
          isMobile: vp.isMobile,
          hasTouch: vp.hasTouch,
          serviceWorkers: 'block',
        });
        const hits = [];
        await context.route('**/*', (r) => {
          const url = r.request().url();
          if (isTelemetry(url)) {
            hits.push(`${r.request().method()} ${url}`);
            return r.abort();
          }
          return r.continue();
        });
        context.on('request', (req) => {
          const url = req.url();
          if (!url.startsWith(BASE_URL) && !url.startsWith('data:') && !url.startsWith('blob:')) {
            try { thirdParty.add(new URL(url).host); } catch { /* ignore */ }
          }
        });
        const page = await context.newPage();
        try {
          await page.goto(`${BASE_URL}${route}`, { waitUntil: 'load', timeout: 60_000 });
          await page.waitForTimeout(SETTLE_MS);
        } finally {
          await page.close();
          await context.close();
        }
        for (const hit of hits) failures.push(`[${vp.name}] ${route} -> ${hit}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`[benefits-wallet-telemetry] third-party hosts seen before wallet choice: ${[...thirdParty].sort().join(', ') || 'none'}`);
  if (failures.length > 0) {
    console.error(`[benefits-wallet-telemetry] FAIL: ${failures.length} wallet telemetry request(s) before any wallet was chosen:\n${failures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[benefits-wallet-telemetry] PASS routes=${ROUTES.length} viewports=${VIEWPORTS.length} telemetry-requests=0`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
