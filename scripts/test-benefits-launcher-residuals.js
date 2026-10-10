#!/usr/bin/env node

// Release 8c21eb0e follow-up (non-chooser launcher residuals): the fixed IFR Copilot launcher
// (AppShell -> CopilotWidget, bottom-right, 60px at 20px above 820px, 54px at 16px up to 820px)
// covered the seller console's checkout summary values ("Per-wallet use", "Selected rule") at
// 820-900px and the customer session's "Sign and verify" approval action at 305px.
//
// The launcher is fixed, so every element that scrolls through its vertical band meets it unless it
// stays horizontally clear of it. This test therefore puts each target at the worst-case scroll
// position (its vertical centre on the launcher's vertical centre, clamped to the reachable scroll
// range), at the scroll position of the live evidence screenshots (wallet chooser centred in the
// viewport) and at the end of the page, and checks there:
//   - no real rectangle intersection between the launcher and the target box / its rendered text,
//     and a horizontal gap >= 12px between them where they share a vertical band;
//   - document.elementFromPoint at sample points across every text line and across the action
//     button resolves to the target itself (not the launcher), i.e. the hit target is reachable;
//   - the rendered text stays inside every clipping ancestor, controls keep 44x44px, no page
//     overflow, and the launcher itself stays rendered and reachable.
//
// Fixtures (clearly attributed; no wallet connection, signature, login or payment is made):
//   - seller "/b/launcher-fit", customer "/r/launcher-fit": API calls fail against the stopped
//     backend URL, every non-local request is aborted;
//   - "long summary values": the summary <strong> values are replaced in the DOM with long strings
//     and the elements carry data-launcher-fixture="long-summary-values";
//   - "approval enabled": the rendered "Sign and verify" button gets its disabled attribute removed
//     (data-launcher-fixture="approval-enabled"); it is never clicked. "Retry verification" and
//     "Verifying..." label states are applied the same way.
//   - primary actions on customer home/session: as-rendered disconnected layout, disabled with
//     the chooser removed, and disabled "Connecting..." label fixtures. Each uses a fresh page;
//     DOM substitutions do NOT exercise wallet hooks, SDK transitions or connected-state absence.
//     Their measurements/screenshots are separate from the original seller/approval cases.
//
// Needs a production build of apps/benefits-network/frontend. Set BENEFITS_LAUNCHER_SHOTS=<dir> to
// save screenshots at the evidence and worst-case positions plus an assertions.json.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_LAUNCHER_PORT || 3219);
const origin = `http://127.0.0.1:${port}`;
const shotDir = process.env.BENEFITS_LAUNCHER_SHOTS || '';

const VIEWPORTS = [
  [305, 720], [320, 740], [375, 812],
  [820, 1180], [821, 1180], [900, 1200],
  [1024, 1366], [1440, 1000],
];
const SHOT_WIDTHS = new Set([305, 375, 820, 900, 1440]);
const LAUNCHER_MIN_GAP_PX = 12;
const MIN_TARGET_PX = 44;
const PRIMARY_VIEWPORTS = [...VIEWPORTS, [390, 844], [1180, 820]];
const PRIMARY_SURFACES = [
  { name: 'customer-home-primary', path: '/' },
  { name: 'customer-session-primary', path: '/r/launcher-fit' },
];
const PRIMARY_FIXTURES = ['as-rendered', 'disabled-no-chooser-dom-fixture', 'pending-long-label-dom-fixture'];
const PRIMARY_TARGET = 'primary "Connect wallet"';

const LONG_SUMMARY_VALUES = {
  Benefit: '100%',
  'Accepted lock source': 'CommitmentVault TIME_ONLY lock',
  'Required lock': '1,000,000,000 IFR',
  'Selected rule': 'Seasonal loyalty tier for returning members',
};

// Marks the seller summary rows: the grid that holds the "Selected rule" row. (The "Per-wallet use"
// row was removed with owner decision B: IFR no longer hosts per-customer limits.)
function markSellerSummary(page, long) {
  return page.evaluate(({ long, values }) => {
    const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Selected rule');
    if (!label) return 'summary row "Selected rule" not rendered';
    const grid = label.parentElement.parentElement;
    grid.dataset.launcherContainer = 'checkout summary';
    const targets = [];
    for (const row of grid.children) {
      const name = row.querySelector('span')?.textContent.trim();
      const value = row.querySelector('strong');
      if (!name || !value) continue;
      if (value.dataset.launcherOriginal === undefined) value.dataset.launcherOriginal = value.textContent;
      if (long && values[name]) {
        value.textContent = values[name];
        value.dataset.launcherFixture = 'long-summary-values';
      } else {
        value.textContent = value.dataset.launcherOriginal;
        delete value.dataset.launcherFixture;
      }
      value.dataset.launcherTarget = `value "${name}"`;
      targets.push(`value "${name}"`);
    }
    return targets.length ? '' : 'no summary values found';
  }, { long, values: LONG_SUMMARY_VALUES });
}

function markCustomerAction(page, state) {
  return page.evaluate((state) => {
    const button = document.querySelector('[data-launcher-target]')
      || [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign and verify');
    if (!button) return 'approval action "Sign and verify" not rendered';
    if (button.dataset.launcherOriginal === undefined) {
      button.dataset.launcherOriginal = button.textContent;
      button.dataset.launcherDisabled = button.disabled ? '1' : '0';
    }
    button.textContent = state.label || button.dataset.launcherOriginal;
    button.disabled = state.enabled ? false : button.dataset.launcherDisabled === '1';
    if (state.enabled) button.dataset.launcherFixture = 'approval-enabled';
    else delete button.dataset.launcherFixture;
    button.dataset.launcherTarget = 'action "Sign and verify"';
    return '';
  }, state);
}

function markPrimaryAction(page, fixture) {
  return page.evaluate(({ fixture, target }) => {
    const control = document.querySelector('[data-wallet-connect-control]');
    const button = control?.querySelector(':scope > button[data-wallet-action="connect"]');
    if (!button) return { error: 'disconnected primary Connect wallet action not rendered' };
    if (document.querySelector('[data-launcher-target]')) return { error: 'primary page already has another launcher target' };
    const originalLabel = button.textContent.trim();
    const originalDisabled = button.disabled;
    if (originalLabel !== 'Connect wallet') return { error: `unexpected as-rendered primary label: ${originalLabel}` };
    if (fixture !== 'as-rendered') {
      button.disabled = true;
      button.dataset.launcherFixture = fixture;
      control.dataset.launcherFixture = fixture;
      if (fixture === 'disabled-no-chooser-dom-fixture') control.querySelector('[data-wallet-connect-with]')?.remove();
      else if (fixture === 'pending-long-label-dom-fixture') button.textContent = 'Connecting...';
      else return { error: `unknown primary fixture: ${fixture}` };
    }
    button.dataset.launcherTarget = target;
    return {
      error: '',
      evidenceKind: fixture === 'as-rendered' ? 'as-rendered-disconnected-layout' : 'DOM-layout-fixture',
      walletStateTransitions: 'NOT EXERCISED',
      originalLabel,
      originalDisabled,
      label: button.textContent.trim(),
      disabled: button.disabled,
      chooserPresent: Boolean(control.querySelector('[data-wallet-connect-with]')),
    };
  }, { fixture, target: PRIMARY_TARGET });
}

// Scroll helpers. Every position is recorded as the scrollY that was actually reached.
function scrollToPosition(page, position, target, primary = false) {
  return page.evaluate(({ position, target, primary }) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    let top = 0;
    if (position === 'end') top = max;
    else if (position === 'evidence') {
      // The live evidence and the label-fit screenshots centre the wallet chooser in the viewport.
      const box = document.querySelector('[data-wallet-connect-with], [aria-label="Connect a checkout wallet"]')
        || (primary ? document.querySelector(`[data-launcher-target='${target}']`) : null);
      const r = box.getBoundingClientRect();
      top = window.scrollY + r.top - (window.innerHeight - r.height) / 2;
    } else {
      const el = document.querySelector(`[data-launcher-target='${target}']`);
      const launcher = document.querySelector('.shop-copilot-button').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      top = window.scrollY + (r.top + r.height / 2) - (launcher.top + launcher.height / 2);
    }
    window.scrollTo({ top: Math.max(0, Math.min(max, top)), behavior: 'instant' });
    return Math.round(window.scrollY);
  }, { position, target, primary });
}

function measure(page, target, primary = false) {
  return page.evaluate(({ target, minGap, minTarget, primary }) => {
    const problems = [];
    const viewport = document.documentElement.clientWidth;
    const px = (value) => parseFloat(value) || 0;
    const round = (value) => Math.round(value * 10) / 10;
    const describe = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join('.')}`;
    const el = document.querySelector(`[data-launcher-target='${target}']`);
    const launcherEl = document.querySelector('.shop-copilot-button');

    const pageOverflow = document.documentElement.scrollWidth - viewport;
    if (pageOverflow > 0) problems.push(`page overflows horizontally by ${pageOverflow}px`);
    // The app shell clips horizontal overflow, so also check the content inside it (fallback fonts on
    // Linux once made an intrinsic-width input push the seller cards 6px past a 305px viewport).
    const shell = document.querySelector('main');
    const shellOverflow = shell ? shell.scrollWidth - shell.clientWidth : 0;
    if (shellOverflow > 0) problems.push(`content overflows the app shell horizontally by ${shellOverflow}px`);
    if (!launcherEl || launcherEl.classList.contains('is-hidden') || getComputedStyle(launcherEl).display === 'none') {
      return { problems: [...problems, 'Copilot launcher not rendered'] };
    }
    const launcher = launcherEl.getBoundingClientRect();
    const lc = { x: launcher.left + launcher.width / 2, y: launcher.top + launcher.height / 2 };
    if (document.elementFromPoint(lc.x, lc.y)?.closest('.shop-copilot-button') !== launcherEl) {
      problems.push('launcher centre is not its own hit target');
    }

    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!lines.length) problems.push(`${target} renders no text`);
    const isButton = el.tagName === 'BUTTON';
    let contentBox;
    if (primary) {
      const cs = getComputedStyle(el);
      contentBox = {
        left: box.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
        right: box.right - px(cs.borderRightWidth) - px(cs.paddingRight),
        top: box.top + px(cs.borderTopWidth) + px(cs.paddingTop),
        bottom: box.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom),
      };
      lines.forEach((r, i) => {
        if (r.left < contentBox.left - 0.5 || r.right > contentBox.right + 0.5
          || r.top < contentBox.top - 0.5 || r.bottom > contentBox.bottom + 0.5) {
          problems.push(`${target} text line ${i + 1} leaves the primary button content box`);
        }
      });
    }

    // Summary values stay inside the summary box's content box (its padding reserves the launcher band).
    const container = el.closest('[data-launcher-container]');
    if (container) {
      const c = container.getBoundingClientRect();
      const cs = getComputedStyle(container);
      const left = c.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
      const right = c.right - px(cs.borderRightWidth) - px(cs.paddingRight);
      lines.forEach((r, i) => {
        if (r.left < left - 0.5 || r.right > right + 0.5) problems.push(`${target} text line ${i + 1} ${round(r.left)}-${round(r.right)} leaves the summary content box ${round(left)}-${round(right)}`);
      });
    }

    // Real rectangle intersection with the launcher, for the element box and every text line.
    const overlap = (r) => Math.max(0, Math.min(r.right, launcher.right) - Math.max(r.left, launcher.left))
      * Math.max(0, Math.min(r.bottom, launcher.bottom) - Math.max(r.top, launcher.top));
    const boxOverlap = overlap(box);
    if (boxOverlap > 0) problems.push(`${target} box ${round(box.left)}-${round(box.right)}x${round(box.top)}-${round(box.bottom)} intersects the launcher ${round(launcher.left)}-${round(launcher.right)}x${round(launcher.top)}-${round(launcher.bottom)} (${round(boxOverlap)}px²)`);
    lines.forEach((r, i) => {
      const o = overlap(r);
      if (o > 0) problems.push(`${target} text line ${i + 1} ${round(r.left)}-${round(r.right)} intersects the launcher (${round(o)}px²)`);
    });
    // Horizontal gap wherever the element shares the launcher's vertical band.
    const sharesBand = box.bottom > launcher.top && box.top < launcher.bottom;
    const gap = round(launcher.left - box.right);
    if (sharesBand && gap < minGap) problems.push(`${target} ends ${gap}px before the launcher in its band (needs >= ${minGap}px)`);

    // Hit targets: sample points across every visible text line and, for the action, its box.
    const points = [];
    // Points under the sticky site header are out of scope (the header, not the launcher, covers them there).
    const header = document.querySelector('.shop-header');
    const headerBottom = header && /sticky|fixed/.test(getComputedStyle(header).position) ? header.getBoundingClientRect().bottom : 0;
    const inView = (x, y) => x >= 0 && x < viewport && y > headerBottom && y < window.innerHeight;
    for (const r of lines) {
      const y = r.top + r.height / 2;
      for (const x of [r.left + 1, r.left + r.width / 2, r.right - 1]) points.push([x, y, 'text']);
    }
    if (isButton) {
      for (const fx of [0.02, 0.5, 0.98]) for (const fy of [0.1, 0.5, 0.9]) points.push([box.left + box.width * fx, box.top + box.height * fy, 'button']);
    }
    let hitChecked = 0;
    for (const [x, y, kind] of points) {
      if (!inView(x, y)) continue;
      hitChecked += 1;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) {
        const by = hit ? (hit.closest('.shop-copilot-button') ? 'the Copilot launcher' : describe(hit)) : 'nothing';
        problems.push(`${target} ${kind} point (${round(x)}, ${round(y)}) hits ${by}`);
      }
    }

    // Rendered text inside every clipping ancestor.
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      const clipX = s.overflowX !== 'visible';
      const clipY = s.overflowY !== 'visible';
      if (!clipX && !clipY) continue;
      const r = a === document.documentElement ? { left: 0, right: viewport, top: -Infinity, bottom: Infinity } : a.getBoundingClientRect();
      const inner = { left: r.left + px(s.borderLeftWidth), right: r.right - px(s.borderRightWidth), top: r.top + px(s.borderTopWidth), bottom: r.bottom - px(s.borderBottomWidth) };
      for (const line of lines) {
        if ((clipX && (line.left < inner.left - 0.5 || line.right > inner.right + 0.5)) || (clipY && (line.top < inner.top - 0.5 || line.bottom > inner.bottom + 0.5))) {
          problems.push(`${target} text is clipped by ${describe(a)} (overflow ${s.overflowX}/${s.overflowY})`);
          break;
        }
      }
    }
    if (el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).display !== 'inline') problems.push(`${target} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    if (isButton && (box.height < minTarget - 0.5 || box.width < minTarget - 0.5)) problems.push(`${target} is ${round(box.width)}x${round(box.height)}px (< ${minTarget}px target)`);
    if (box.left < -0.5 || box.right > viewport + 0.5) problems.push(`${target} spans ${round(box.left)}-${round(box.right)} outside the ${viewport}px viewport`);
    if (launcher.right > viewport + 0.5 || launcher.bottom > window.innerHeight + 0.5) problems.push('launcher leaves the viewport');

    return {
      problems,
      pageOverflow,
      box: { left: round(box.left), right: round(box.right), top: round(box.top), bottom: round(box.bottom) },
      launcher: { left: round(launcher.left), right: round(launcher.right), top: round(launcher.top), bottom: round(launcher.bottom) },
      sharesBand,
      gap,
      lines: lines.length,
      hitChecked,
      ...(primary ? {
        contentBox,
        shellOverflow,
        boxOverlap,
        label: el.textContent.trim(),
        disabled: el.disabled,
        chooserPresent: Boolean(el.closest('[data-wallet-connect-control]').querySelector('[data-wallet-connect-with]')),
      } : {}),
    };
  }, { target, minGap: LAUNCHER_MIN_GAP_PX, minTarget: MIN_TARGET_PX, primary });
}

function listTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-launcher-target]')].map((e) => e.dataset.launcherTarget));
}

const SURFACES = [
  {
    name: 'seller-console',
    path: '/b/launcher-fit',
    ready: async (page) => {
      await page.locator('[aria-label="Connect a checkout wallet"] button').first().waitFor({ state: 'attached', timeout: 35_000 });
      await page.getByText('Selected rule', { exact: true }).waitFor({ state: 'attached', timeout: 15_000 });
    },
    states: [
      { name: 'as-rendered', apply: (page) => markSellerSummary(page, false) },
      { name: 'long summary values (fixture)', apply: (page) => markSellerSummary(page, true) },
    ],
  },
  {
    name: 'customer-session',
    path: '/r/launcher-fit',
    ready: async (page) => {
      await page.locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]').first().waitFor({ state: 'attached', timeout: 35_000 });
      await page.getByRole('button', { name: 'Sign and verify' }).waitFor({ state: 'attached', timeout: 15_000 });
    },
    states: [
      { name: 'approval disabled', apply: (page) => markCustomerAction(page, { enabled: false }) },
      { name: 'approval enabled (fixture)', apply: (page) => markCustomerAction(page, { enabled: true }) },
      { name: 'retry label (fixture)', apply: (page) => markCustomerAction(page, { enabled: true, label: 'Retry verification' }) },
      { name: 'loading label (fixture)', apply: (page) => markCustomerAction(page, { enabled: false, label: 'Verifying...' }) },
    ],
  },
];

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before startup (${child.exitCode})`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for Benefits frontend');
}

async function run() {
  const serverOutput = [];
  const server = spawn(
    process.execPath,
    [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: frontend, env: { ...process.env, BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  const failures = [];
  const records = [];
  let checks = 0;
  const primaryRecords = [];
  let primaryChecks = 0;
  try {
    await waitForServer(server);
    if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    for (const surface of SURFACES) {
      for (const [width, height] of VIEWPORTS) {
        const where = `${surface.name} @ ${width}x${height}`;
        const mobile = width <= 834;
        const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
          await page.goto(`${origin}${surface.path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await surface.ready(page);
          await page.evaluate(() => document.fonts.ready);
          for (const state of surface.states) {
            const setupError = await state.apply(page);
            if (setupError) {
              failures.push(`${where} [${state.name}]: ${setupError}`);
              continue;
            }
            const targets = await listTargets(page);
            for (const position of ['evidence', 'worst-case', 'end']) {
              for (const target of position === 'worst-case' ? targets : [targets[0]]) {
                const scrollY = await scrollToPosition(page, position, target);
                const measured = position === 'worst-case' ? [[target, await measure(page, target)]] : await Promise.all(targets.map(async (t) => [t, await measure(page, t)]));
                for (const [t, m] of measured) {
                  checks += 1;
                  records.push({ surface: surface.name, width, height, state: state.name, position, scrollY, target: t, ...m });
                  if (m.problems.length) failures.push(`${where} [${state.name}] @${position} scrollY=${scrollY} ${t}:\n  - ${m.problems.join('\n  - ')}`);
                }
                if (shotDir && SHOT_WIDTHS.has(width) && position !== 'end') {
                  const focus = position === 'evidence' || /Selected rule|Sign and verify/.test(target);
                  if (focus) {
                    const slug = `${surface.name}-${width}x${height}-${state.name.replace(/[^a-z]+/gi, '-').replace(/-+$/, '')}-${position}`.toLowerCase();
                    await page.screenshot({ path: path.join(shotDir, `${slug}.png`) });
                  }
                }
              }
            }
          }
        } catch (error) {
          failures.push(`${where}: ${error.message.split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
    // Leave the original matrix/markers intact; each primary fixture starts in its own context.
    for (const surface of PRIMARY_SURFACES) {
      for (const [width, height] of PRIMARY_VIEWPORTS) {
        for (const fixture of PRIMARY_FIXTURES) {
          const where = `${surface.name} @ ${width}x${height} [${fixture}]`;
          const mobile = width <= 834;
          const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
          try {
            const page = await context.newPage();
            await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
            await page.goto(`${origin}${surface.path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await page.locator('[data-wallet-connect-control][data-wallet-connectors-ready="true"]').first().waitFor({ state: 'attached', timeout: 35_000 });
            const setup = await markPrimaryAction(page, fixture);
            if (setup.error) {
              failures.push(`${where}: ${setup.error}`);
              continue;
            }
            await page.evaluate(() => document.fonts.ready);
            for (const position of ['evidence', 'worst-case', 'end']) {
              const scrollY = await scrollToPosition(page, position, PRIMARY_TARGET, true);
              const m = await measure(page, PRIMARY_TARGET, true);
              if (m.label !== setup.label || m.disabled !== setup.disabled || m.chooserPresent !== setup.chooserPresent) {
                m.problems.push('primary DOM layout fixture changed before measurement');
              }
              if (position === 'worst-case' && (!m.sharesBand || !m.hitChecked)) {
                m.problems.push('worst-case primary scroll did not exercise the launcher band and visible hit points');
              }
              primaryChecks += 1;
              primaryRecords.push({ surface: surface.name, width, height, fixture, ...setup, position, scrollY, target: PRIMARY_TARGET, ...m });
              if (m.problems.length) failures.push(`${where} @${position} scrollY=${scrollY}:\n  - ${m.problems.join('\n  - ')}`);
              if (shotDir && position !== 'end') {
                await page.screenshot({ path: path.join(shotDir, `${surface.name}-${width}x${height}-${fixture}-${position}.png`) });
              }
            }
          } catch (error) {
            failures.push(`${where}: ${error.message.split('\n')[0]}`);
          } finally {
            await context.close();
          }
        }
      }
    }
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'assertions.json'), `${JSON.stringify(records, null, 1)}\n`);
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'primary-layout-assertions.json'), `${JSON.stringify(primaryRecords, null, 1)}\n`);
    assert.deepEqual(failures, [], `Copilot launcher covers checkout content:\n${failures.join('\n')}`);
    assert.equal(primaryChecks, PRIMARY_SURFACES.length * PRIMARY_VIEWPORTS.length * PRIMARY_FIXTURES.length * 3, 'primary layout matrix incomplete');
    console.log(`[benefits-launcher-residuals] PASS ${checks} checks - launcher intersection, elementFromPoint hit targets, clipping ancestors, 44px action and page overflow on ${SURFACES.map((s) => s.name).join(', ')} at ${VIEWPORTS.map(([w]) => w).join('/')}px`);
    console.log(`[benefits-primary-layout] PASS ${primaryChecks} layout checks (as-rendered disconnected + attributed DOM fixtures); wallet hook/SDK transitions and connected primary absence NOT EXERCISED`);
  } catch (error) {
    if (!(error instanceof assert.AssertionError) && serverOutput.length) console.error(serverOutput.join('').slice(-4000));
    throw error;
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
