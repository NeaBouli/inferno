// Uses existing project Playwright/browser binaries; never installs tools or uses a user profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const tooling = process.env.IFR_FVA_TOOL_ROOT || path.resolve(app, '../..');
const requireTool = createRequire(path.join(tooling, 'package.json'));
const { chromium } = requireTool('playwright');
const evidence = process.env.IFR_FVA_EVIDENCE_DIR;
assert.ok(evidence && path.isAbsolute(evidence), 'An explicit isolated evidence directory is required');
await mkdir(evidence, { recursive: true });
const origin = new URL(process.env.IFR_DASHBOARD_PREVIEW_URL || 'http://127.0.0.1:4178').origin;
assert.equal(new URL(origin).hostname, '127.0.0.1');
const sourceFiles = ['src/App.css', 'src/main.jsx', 'scripts/test-wallet-visual.mjs'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name, createHash('sha256').update(await readFile(path.join(app, name))).digest('hex'),
])));
const initialHashes = await sourceHashes();
const results = [];
const failures = [];
const profiles = [];
const viewports = [
  { width: 1440, height: 1000 }, { width: 1180, height: 820 },
  { width: 820, height: 1180 }, { width: 390, height: 844 },
];

function measurements(expectedViewport) {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const rgb = (value) => {
    const numbers = value.match(/[\d.]+/g)?.map(Number);
    return numbers?.length >= 3 ? [...numbers.slice(0, 3), numbers[3] ?? 1] : null;
  };
  const blend = (fg, bg) => fg.slice(0, 3).map((part, i) => part * fg[3] + bg[i] * (1 - fg[3]));
  const background = (element) => {
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.unshift(node);
    return chain.reduce((color, node) => {
      const next = rgb(getComputedStyle(node).backgroundColor);
      return next ? blend(next, color) : color;
    }, [255, 255, 255]);
  };
  const luminance = (color) => color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
  const scope = dialog || document.querySelector('.header-right');
  const buttons = [...scope.querySelectorAll('button, a[href]')].filter(visible).map((button) => {
    const rect = button.getBoundingClientRect();
    const bg = background(button);
    const text = button.innerText.trim();
    const icon = button.querySelector('svg path, svg');
    const painted = [];
    const decorativeText = [];
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim()) {
        const parent = walker.currentNode.parentElement;
        const value = walker.currentNode.textContent.trim();
        if (button.getAttribute('data-testid') === 'rk-account-button' &&
            parent.closest('[aria-hidden="true"]') && !/[\p{L}\p{N}]/u.test(value) && /0x[\da-f]/i.test(text)) {
          decorativeText.push({ value, ariaHidden: true, redundantWithVisibleAccountLabel: true,
            cssTextColorDoesNotMeasureMulticolorEmojiRaster: true });
          continue;
        }
        if (visible(parent)) painted.push({ color: rgb(getComputedStyle(parent).color), bg: background(parent) });
      }
    }
    if (!painted.length) painted.push({ color: rgb(icon ? getComputedStyle(icon).fill : getComputedStyle(button).color)
      || rgb(getComputedStyle(button).color), bg });
    const contrasts = painted.map(({ color, bg: actualBackground }) => {
      const foreground = blend(color, actualBackground);
      return { foreground, background: actualBackground,
        ratio: (Math.max(luminance(foreground), luminance(actualBackground)) + 0.05) /
          (Math.min(luminance(foreground), luminance(actualBackground)) + 0.05) };
    });
    const minimum = contrasts.reduce((left, right) => left.ratio < right.ratio ? left : right);
    return { label: text || button.getAttribute('aria-label') || 'icon',
      tag: button.tagName, rect: rect.toJSON(), contrast: minimum.ratio,
      foreground: minimum.foreground, background: minimum.background, paintedContrasts: contrasts,
      decorativeText,
      minimumContrast: text ? 4.5 : 3, disabled: button.disabled };
  });
  const overlaps = [];
  for (let i = 0; i < buttons.length; i += 1) {
    for (let j = i + 1; j < buttons.length; j += 1) {
      const left = buttons[i].rect; const right = buttons[j].rect;
      if (Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
          Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1) {
        overlaps.push([buttons[i].label, buttons[j].label]);
      }
    }
  }
  const textOutside = [];
  for (const element of [...scope.querySelectorAll('button, a[href]'),
    ...(!dialog ? document.querySelectorAll('.header h1, .token-grid .stat-value') : [])].filter(visible)) {
    const box = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (rect.width && (rect.left < box.left - 1 || rect.right > box.right + 1 ||
            rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) {
          textOutside.push({ label: walker.currentNode.textContent.trim(), rect: rect.toJSON(), box: box.toJSON() });
        }
      }
    }
  }
  const header = document.querySelector('.header').getBoundingClientRect();
  const main = document.querySelector('.main').getBoundingClientRect();
  const fixture = window.__IFR_DASHBOARD_FIXTURE__;
  return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight),
    horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - expectedViewport.width,
    visualViewport: { width: window.visualViewport.width, height: window.visualViewport.height,
      scale: window.visualViewport.scale },
    dialog: dialog?.querySelector('[role="document"]')?.getBoundingClientRect().toJSON() || null,
    dialogBackdrop: dialog?.getBoundingClientRect().toJSON() || null, buttons, overlaps, textOutside,
    headerMainGap: main.top - header.bottom, fixture: fixture.snapshot(),
    fixtureOnlyProvider: fixture.syntheticOnly && window.ethereum.isMetaMask &&
      !Object.getOwnPropertyDescriptor(window, 'ethereum').writable &&
      !Object.getOwnPropertyDescriptor(window, 'ethereum').configurable };
}

for (const viewport of viewports) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'ifr-dashboard-fva-'));
  profiles.push({ path: profile, isolated: true, removed: false });
  const blocked = [];
  const pageErrors = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.IFR_FVA_BROWSER || chromium.executablePath(),
      headless: true, viewport, deviceScaleFactor: 1, locale: 'en-US',
      hasTouch: viewport.width <= 820, isMobile: viewport.width === 390,
      serviceWorkers: 'block', args: ['--disable-extensions'],
    });
    await context.route('**/*', async (route) => {
      const target = new URL(route.request().url());
      if (target.origin === origin) await route.continue();
      else { blocked.push(target.origin); await route.abort('blockedbyclient'); }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = context.pages()[0];
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const hit = (locator) => viewport.width <= 820 ? locator.tap() : locator.click();
    const connect = () => page.locator('[data-testid="rk-connect-button"]');
    const account = () => page.locator('[data-testid="rk-account-button"]');
    const chain = () => page.locator('[data-testid="rk-wrong-network-button"]');
    const capture = async (state) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.getAnimations().every((animation) =>
        animation.effect?.getComputedTiming().iterations === Infinity || animation.playState !== 'running'),
      undefined, { timeout: 3000 });
      await page.waitForTimeout(150);
      const data = await page.evaluate(measurements, viewport);
      const file = `${viewport.width}x${viewport.height}-${state}.png`;
      const png = await page.screenshot({ path: path.join(evidence, file), fullPage: true,
        animations: 'disabled', scale: 'css' });
      const raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      const defects = [];
      if (data.width !== viewport.width || data.height !== viewport.height || data.dpr !== 1) defects.push('viewport mismatch');
      if (raster.width !== viewport.width || raster.height !== Math.ceil(data.documentHeight)) defects.push('raster/full-page mismatch');
      if (data.horizontalOverflow > 1) defects.push(`horizontal overflow ${data.horizontalOverflow}px`);
      if (data.headerMainGap < -1) defects.push('header/main overlap');
      if (data.dialog && (data.dialog.left < -1 || data.dialog.right > viewport.width + 1 ||
          data.dialog.top < -1 || data.dialog.bottom > viewport.height + 1)) defects.push('dialog outside viewport');
      for (const button of data.buttons) {
        if (button.rect.width < 43.99 || button.rect.height < 43.99) defects.push(`undersized ${button.label}`);
        if (!button.disabled && button.contrast + 0.01 < button.minimumContrast) defects.push(`contrast ${button.label}: ${button.contrast}`);
      }
      if (data.overlaps.length) defects.push('overlapping controls');
      if (data.textOutside.length) defects.push('text outside control or neighbor');
      if (!data.fixtureOnlyProvider) defects.push('synthetic-only provider identity missing');
      const result = { viewport, state, file: path.join(evidence, file), raster,
        sha256: createHash('sha256').update(png).digest('hex'), data, defects,
        browserVersion: context.browser().version(), imageInspected: false };
      results.push(result);
      if (defects.length) failures.push({ viewport, state, defects });
      await writeFile(path.join(evidence, 'visual-results.json'), JSON.stringify({ results, failures, profiles }, null, 2) + '\n');
    };
    const openAndClose = async (opener, state) => {
      await opener.focus(); await hit(opener);
      const modal = page.getByRole('dialog'); await modal.waitFor();
      const focusableCount = await modal.locator('button, a[href], [tabindex="0"]').count();
      for (let i = 0; i < focusableCount + 2; i += 1) {
        await page.keyboard.press('Tab');
        assert.ok(await modal.evaluate((element) => element.contains(document.activeElement)), 'Modal must retain keyboard focus');
      }
      for (let i = 0; i < 2; i += 1) {
        await page.keyboard.press('Shift+Tab');
        assert.ok(await modal.evaluate((element) => element.contains(document.activeElement)), 'Modal must retain reverse keyboard focus');
      }
      await capture(state);
      await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
      await page.waitForFunction((element) => element === document.activeElement,
        await opener.elementHandle(), { timeout: 2000 });
      assert.ok(await opener.evaluate((element) => element === document.activeElement), 'Modal close must restore opener focus');
    };
    await page.goto(origin + '/?fixture=disconnected', { waitUntil: 'domcontentloaded' });
    await connect().waitFor();
    await page.getByText('Inferno (Fixture) (IFR)', { exact: true }).waitFor();
    await capture('disconnected');
    await openAndClose(connect(), 'wallet-modal');
    await hit(connect());
    const before = await page.evaluate(() => window.__IFR_DASHBOARD_FIXTURE__.snapshot().events.length);
    await hit(page.getByRole('button', { name: 'MetaMask', exact: true }));
    await account().waitFor();
    const after = await page.evaluate(() => window.__IFR_DASHBOARD_FIXTURE__.snapshot());
    assert.ok(after.events.slice(before).some((event) => event.kind === 'wallet' && event.method === 'eth_requestAccounts'),
      'The actual plain MetaMask choice must call only the supplied fixture');
    assert.equal(after.account, '0x1111111111111111111111111111111111111111');
    await capture('connected');
    await openAndClose(account(), 'account-modal');
    await hit(account()); await hit(page.getByTestId('rk-disconnect-button'));
    await connect().waitFor(); await capture('disconnected-after-action');
    await hit(connect()); await hit(page.getByRole('button', { name: 'MetaMask', exact: true }));
    await account().waitFor(); await capture('reconnected');
    await page.evaluate(() => window.__IFR_DASHBOARD_FIXTURE__.setState('unsupported'));
    await chain().waitFor();
    await capture('unsupported');
    await openAndClose(chain(), 'chain-modal');
    await hit(chain());
    await hit(page.getByRole('dialog').getByRole('button', { name: /Sepolia/ }));
    await chain().waitFor({ state: 'hidden' }); await account().waitFor();
    for (const state of ['long', 'owner', 'loading', 'error']) {
      await page.goto(origin + '/?fixture=' + state, { waitUntil: 'domcontentloaded' });
      await connect().or(account()).first().waitFor();
      if (state === 'loading') await page.getByText('Loading token data...', { exact: true }).waitFor();
      else if (state === 'error') await page.getByText('Failed to load token data.', { exact: true }).waitFor();
      else await page.getByText(state === 'long'
        ? 'Inferno Synthetic Very Long Token Name For Layout Inspection (IFR)'
        : 'Inferno (Fixture) (IFR)', { exact: true }).waitFor();
      if (state === 'owner' && await connect().isVisible()) {
        await hit(connect()); await hit(page.getByRole('button', { name: 'MetaMask', exact: true }));
        await account().waitFor();
      }
      if (state === 'owner') await page.locator('.gov-create').waitFor();
      await capture(state);
    }
    assert.deepEqual(pageErrors, [], 'Unexpected application page errors');
    results.push({ viewport, interactions: 'PASS', syntheticPlainMetaMaskMapping: true,
      connectDisconnectReconnect: true, focusRestorationAndTrap: true,
      touchActions: viewport.width <= 820, blockedOrigins: [...new Set(blocked)], pageErrors });
  } catch (error) {
    failures.push({ viewport, actionFailure: String(error), pageErrors, blockedOrigins: [...new Set(blocked)] });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    profiles.at(-1).removed = true;
  }
}
assert.deepEqual(await sourceHashes(), initialHashes, 'Source changed during visual qualification');
const report = { status: failures.length ? 'FAIL' : 'PASS_PENDING_IMAGE_INSPECTION',
  sourceSha256: initialHashes, toolVersion: requireTool('playwright/package.json').version,
  origin, viewports, results, failures, profiles, userBrowserProfileUsed: false,
  realWalletProviderDeviceOrChainAcceptance: false };
await writeFile(path.join(evidence, 'visual-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, screenshots: results.filter((r) => r.file).length,
  failures, profilesCleaned: profiles.every((p) => p.removed) }, null, 2));
if (failures.length) process.exitCode = 1;
