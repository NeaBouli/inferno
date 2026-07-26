#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_SUPPORT_UI_PORT || 3217);
const origin = `http://127.0.0.1:${port}`;
const injectedWallet = '0x1000000000000000000000000000000000000001';
const querySecret = 'private-business-reference';
const hashSecret = 'private-pass-reference';
const storageSecret = 'private-browser-value';
const upstreamSecret = 'private-upstream-error';

async function waitForServer(server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js exited before startup (${server.exitCode})`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Timed out waiting for Benefits support UI');
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function createContext(browser, clipboardMode = 'success') {
  const context = await browser.newContext({
    viewport: { width: 320, height: 658 },
    serviceWorkers: 'block',
  });
  await context.addInitScript(({ account, localSecret, copyMode }) => {
    const providerCalls = [];
    Object.defineProperty(window, '__ifrSupportProviderCalls', { value: providerCalls });
    Object.defineProperty(window, '__ifrSupportCopiedText', { value: '', writable: true });
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        isMetaMask: true,
        request: async ({ method }) => {
          providerCalls.push(method);
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
          throw new Error('Provider method must not be called by support diagnostics');
        },
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          if (copyMode === 'reject') throw new Error('Clipboard permission denied');
          window.__ifrSupportCopiedText = value;
        },
      },
    });
    document.execCommand = (command) => {
      if (command !== 'copy') return false;
      window.__ifrSupportCopiedText = document.activeElement?.value || '';
      return true;
    };
    localStorage.setItem('ifr.shop.private-fixture', localSecret);
    sessionStorage.setItem('ifr.shop.private-session-fixture', localSecret);
  }, { account: injectedWallet, localSecret: storageSecret, copyMode: clipboardMode });
  return context;
}

function assertReportContract(reportText, expectedApiAvailable) {
  const report = JSON.parse(reportText);
  assert.deepEqual(Object.keys(report).sort(), [
    'app',
    'checks',
    'expectedChainId',
    'generatedAt',
    'route',
    'schema',
  ]);
  assert.deepEqual(Object.keys(report.checks).sort(), [
    'apiAvailable',
    'apiExpectedChain',
    'coinbaseConnectorConfigured',
    'commitmentVaultConfigured',
    'ifrLockConfigured',
    'ifrTokenConfigured',
    'injectedWalletAvailable',
    'online',
    'serviceWorkerControllingPage',
    'serviceWorkerSupported',
    'standaloneDisplay',
    'walletConnectConfigured',
  ]);
  assert.equal(report.schema, 'ifr-benefits-support-v1');
  assert.equal(report.app, 'IFR Benefits Network');
  assert.equal(report.route, '/support');
  assert.equal(report.expectedChainId, 1);
  assert.equal(report.checks.apiAvailable, expectedApiAvailable);
  assert.equal(report.checks.injectedWalletAvailable, true);
  assert.equal(typeof report.checks.walletConnectConfigured, 'boolean');
  assert.equal(typeof report.checks.serviceWorkerSupported, 'boolean');
  assert.ok(Number.isFinite(Date.parse(report.generatedAt)), 'generatedAt must be a valid ISO timestamp');

  for (const secret of [
    injectedWallet,
    injectedWallet.toLowerCase(),
    querySecret,
    hashSecret,
    storageSecret,
    upstreamSecret,
    'userAgent',
    'location.href',
  ]) {
    assert.ok(!reportText.includes(secret), `diagnostic report leaked forbidden value: ${secret}`);
  }
}

async function assertMobileHeaderFits(page) {
  const layout = await page.evaluate(() => {
    const nav = document.querySelector('.shop-nav');
    const links = Array.from(document.querySelectorAll('.shop-nav a'));
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      navClientWidth: nav?.clientWidth || 0,
      navScrollWidth: nav?.scrollWidth || 0,
      links: links.map((link) => {
        const rect = link.getBoundingClientRect();
        return {
          text: link.textContent?.trim() || '',
          left: rect.left,
          right: rect.right,
          clientHeight: link.clientHeight,
          scrollHeight: link.scrollHeight,
        };
      }),
    };
  });
  assert.equal(layout.documentScrollWidth, layout.viewportWidth, 'shop shell must not overflow the mobile viewport');
  assert.ok(layout.navScrollWidth <= layout.navClientWidth, 'all mobile navigation links must fit without scrolling');
  assert.deepEqual(layout.links.map((link) => link.text), [
    'Benefits',
    'For sellers',
    'Guide',
    'Lock IFR',
    'IFR Unit',
  ]);
  for (const link of layout.links) {
    assert.ok(link.left >= 0 && link.right <= layout.viewportWidth, `${link.text} must remain inside the viewport`);
    assert.ok(link.scrollHeight <= link.clientHeight, `${link.text} must remain on one line`);
  }
}

async function verifyAvailableState(browser) {
  const context = await createContext(browser);
  await context.route('**/api/ready', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'ready',
      chainId: 1,
      database: 'ok',
      rateLimitStore: 'ok',
      ignoredSensitiveField: upstreamSecret,
    }),
  }));

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/support?business=${querySecret}#${hashSecret}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { name: 'Find the problem without exposing your wallet.' }).waitFor();
  await page.getByText('Available', { exact: true }).waitFor();
  await assertMobileHeaderFits(page);

  const reportText = await page.getByTestId('support-report').textContent();
  assertReportContract(reportText, true);
  const layout = await page.evaluate(() => {
    const diagnostics = document.querySelector('#diagnostics');
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      diagnosticsClientWidth: diagnostics?.clientWidth || 0,
      diagnosticsScrollWidth: diagnostics?.scrollWidth || 0,
    };
  });
  assert.equal(layout.documentScrollWidth, layout.documentClientWidth, 'support page must not overflow the mobile viewport');
  assert.ok(
    layout.diagnosticsScrollWidth <= layout.diagnosticsClientWidth,
    'support diagnostics must not clip mobile status content',
  );
  assert.deepEqual(
    await page.evaluate(() => window.__ifrSupportProviderCalls),
    [],
    'support diagnostics must not call the injected wallet provider',
  );

  await page.getByRole('button', { name: 'Copy redacted report', exact: true }).click();
  await page.getByText('Redacted report copied.', { exact: true }).waitFor();
  const copiedText = await page.evaluate(() => window.__ifrSupportCopiedText);
  assert.equal(copiedText, reportText, 'copy action must copy exactly the visible allowlisted report');
  assertReportContract(copiedText, true);
  assert.deepEqual(pageErrors, []);
  await context.close();
}

async function verifyUnavailableState(browser) {
  const context = await createContext(browser);
  await context.route('**/api/ready', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'not_ready', error: upstreamSecret }),
  }));

  const page = await context.newPage();
  await page.goto(`${origin}/support`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Unavailable', { exact: true }).waitFor();
  const reportText = await page.getByTestId('support-report').textContent();
  assertReportContract(reportText, false);
  assert.ok(!(await page.locator('body').innerText()).includes(upstreamSecret), 'raw API errors must stay hidden');
  assert.deepEqual(await page.evaluate(() => window.__ifrSupportProviderCalls), []);
  await context.close();
}

async function verifyClipboardFallback(browser) {
  const context = await createContext(browser, 'reject');
  await context.route('**/api/ready', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }),
  }));
  const page = await context.newPage();
  await page.goto(`${origin}/support`, { waitUntil: 'domcontentloaded' });
  const copyButton = page.getByRole('button', { name: 'Copy redacted report', exact: true });
  await copyButton.waitFor();
  await copyButton.click();
  await page.getByText('Redacted report copied.', { exact: true }).waitFor();
  const copiedText = await page.evaluate(() => window.__ifrSupportCopiedText);
  assertReportContract(copiedText, true);
  await context.close();
}

async function main() {
  const output = [];
  const server = spawn(process.execPath, [
    path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'),
    'dev',
    '--hostname', '127.0.0.1',
    '--port', String(port),
  ], {
    cwd: frontend,
    env: { ...process.env, BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => output.push(chunk.toString()));
  server.stderr.on('data', (chunk) => output.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    await verifyAvailableState(browser);
    await verifyUnavailableState(browser);
    await verifyClipboardFallback(browser);
    console.log('[benefits-support-ui] PASS - diagnostics are wallet-passive, allowlisted and redacted');
  } catch (error) {
    process.stderr.write(output.join(''));
    throw error;
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(`[benefits-support-ui] FAIL: ${error?.stack || error}`);
  process.exitCode = 1;
});
