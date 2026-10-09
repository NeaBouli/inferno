#!/usr/bin/env node

// Release e90e2501 follow-up: at 305px the "WalletConnect" connector label crossed its button in the
// wallet chooser's "Connect with" box after the T-284 launcher clearance took 16px from the box.
// This test renders the chooser on every surface that shows connector buttons and checks, for the
// longest connector labels and the Connecting... loading state, that each label's text stays inside
// its button's content box and inside every clipping ancestor (not only that the page does not
// overflow), that buttons keep a 44x44px target, and that the launcher gap of the customer chooser
// stays >= 12px.
//
// Surfaces: customer home "/" (WalletStatus -> WalletConnectControl), customer session
// "/r/<id>" (CustomerSessionClient -> WalletConnectControl) and the seller console "/b/<id>"
// (checkout wallet "Connect with" grid). No wallet connection, signature or SDK choice is made;
// every non-local request is aborted and API calls are answered 404 by the stopped backend URL.
//
// Needs a production build WITH a WalletConnect project ID so both Coinbase Wallet and
// WalletConnect connectors render, e.g.
//   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef npm run build --prefix apps/benefits-network/frontend
// Set BENEFITS_LABEL_FIT_SHOTS=<dir> to save one viewport screenshot per surface and width (plus
// the loading state at 305px) and an assertions.json with the raw measurements.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_LABEL_FIT_PORT || 3218);
const origin = `http://127.0.0.1:${port}`;
const shotDir = process.env.BENEFITS_LABEL_FIT_SHOTS || '';

const VIEWPORTS = [
  [305, 720], [320, 740], [375, 812],
  [768, 1024], [819, 1180], [820, 1180], [821, 1180], [834, 1194],
  [1024, 1366], [1440, 1000],
];
const LAUNCHER_MIN_GAP_PX = 12;
const MIN_TARGET_PX = 44;

const SURFACES = [
  {
    name: 'customer-home',
    path: '/',
    box: '[data-wallet-connect-with]',
    ready: '[data-wallet-connect-control][data-wallet-connectors-ready="true"]',
    loadingState: true,
    launcherClearance: true,
  },
  {
    name: 'customer-session',
    path: '/r/label-fit',
    box: '[data-wallet-connect-with]',
    ready: '[data-wallet-connect-control][data-wallet-connectors-ready="true"]',
    loadingState: true,
    launcherClearance: true,
  },
  {
    // The seller connector buttons never switch to "Connecting..."; the seller shows that on its
    // primary Connect button instead.
    name: 'seller-console',
    path: '/b/label-fit',
    box: '[aria-label="Connect a checkout wallet"]',
    ready: '[aria-label="Connect a checkout wallet"] button',
    loadingState: false,
    launcherClearance: false,
  },
];

const REQUIRED_LABELS = ['Coinbase Wallet', 'WalletConnect'];

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

// Puts the given state into every connector button of the box. Label states copy the real markup
// of the button that renders that label, so any break hints the app renders travel with it.
function applyState(page, boxSelector, state) {
  return page.evaluate(({ boxSelector, state }) => {
    const buttons = [...document.querySelector(boxSelector).querySelectorAll('button')];
    // Start every state from the markup the app rendered.
    for (const button of buttons) {
      if (button.dataset.labelFitOriginal === undefined) button.dataset.labelFitOriginal = button.innerHTML;
      else button.innerHTML = button.dataset.labelFitOriginal;
    }
    if (state.kind === 'label') {
      const source = buttons.find((button) => button.textContent.trim() === state.label);
      if (!source) return `no rendered button shows "${state.label}"`;
      const markup = source.innerHTML;
      for (const button of buttons) button.innerHTML = markup;
    } else if (state.kind === 'text') {
      for (const button of buttons) button.textContent = state.text;
    }
    return '';
  }, { boxSelector, state });
}

function measure(page, boxSelector, launcherClearance) {
  return page.evaluate(({ boxSelector, launcherClearance, minTarget, minGap }) => {
    const problems = [];
    const viewport = document.documentElement.clientWidth;
    const box = document.querySelector(boxSelector);
    const buttons = [...box.querySelectorAll('button')];
    const px = (value) => parseFloat(value) || 0;
    const round = (value) => Math.round(value * 10) / 10;
    const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(/\s+/).slice(0, 3).join('.')}`;

    const pageOverflow = document.documentElement.scrollWidth - viewport;
    if (pageOverflow > 0) problems.push(`page overflows horizontally by ${pageOverflow}px`);

    const results = buttons.map((button) => {
      const label = button.textContent.trim();
      const b = button.getBoundingClientRect();
      const cs = getComputedStyle(button);
      const content = {
        left: b.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
        right: b.right - px(cs.borderRightWidth) - px(cs.paddingRight),
        top: b.top + px(cs.borderTopWidth),
        bottom: b.bottom - px(cs.borderBottomWidth),
      };
      const range = document.createRange();
      range.selectNodeContents(button);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      const text = lines.length
        ? {
            left: Math.min(...lines.map((r) => r.left)),
            right: Math.max(...lines.map((r) => r.right)),
            top: Math.min(...lines.map((r) => r.top)),
            bottom: Math.max(...lines.map((r) => r.bottom)),
          }
        : null;
      const tag = `button "${label}"`;
      if (!text) problems.push(`${tag} renders no text`);
      else {
        if (text.left < content.left - 0.5 || text.right > content.right + 0.5) {
          problems.push(`${tag} text ${round(text.left)}-${round(text.right)} crosses the button content box ${round(content.left)}-${round(content.right)} (button ${round(b.left)}-${round(b.right)})`);
        }
        if (text.top < content.top - 0.5 || text.bottom > content.bottom + 0.5) {
          problems.push(`${tag} text ${round(text.top)}-${round(text.bottom)} leaves the button vertically ${round(content.top)}-${round(content.bottom)}`);
        }
      }
      if (button.scrollWidth > button.clientWidth) problems.push(`${tag} scrollWidth ${button.scrollWidth} > clientWidth ${button.clientWidth}`);
      if (b.height < minTarget - 0.5 || b.width < minTarget - 0.5) problems.push(`${tag} is ${round(b.width)}x${round(b.height)}px (< ${minTarget}px target)`);
      if (b.left < -0.5 || b.right > viewport + 0.5) problems.push(`${tag} spans ${round(b.left)}-${round(b.right)}px outside the ${viewport}px viewport`);

      // Every ancestor that clips (overflow other than visible) must contain the button and its text.
      const clippedBy = [];
      for (let a = button.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        const clipX = s.overflowX !== 'visible';
        const clipY = s.overflowY !== 'visible';
        if (!clipX && !clipY) continue;
        const r = a === document.documentElement
          ? { left: 0, right: viewport, top: -Infinity, bottom: Infinity }
          : a.getBoundingClientRect();
        const inner = {
          left: r.left + px(s.borderLeftWidth),
          right: r.right - px(s.borderRightWidth),
          top: r.top + px(s.borderTopWidth),
          bottom: r.bottom - px(s.borderBottomWidth),
        };
        for (const [what, rect] of [['button', b], ['text', text]]) {
          if (!rect) continue;
          const outX = clipX && (rect.left < inner.left - 0.5 || rect.right > inner.right + 0.5);
          const outY = clipY && (rect.top < inner.top - 0.5 || rect.bottom > inner.bottom + 0.5);
          if (outX || outY) {
            clippedBy.push(describe(a));
            problems.push(`${tag} ${what} is clipped by ${describe(a)} (overflow ${s.overflowX}/${s.overflowY})`);
          }
        }
      }

      // Report-only: a word split across lines (not at a rendered <wbr>) still fits, but reads badly.
      const midWordBreaks = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const re = /\S+/g;
        for (let m = re.exec(node.nodeValue); m; m = re.exec(node.nodeValue)) {
          const r = document.createRange();
          r.setStart(node, m.index);
          r.setEnd(node, m.index + m[0].length);
          const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
          if (tops.size > 1) midWordBreaks.push(m[0]);
        }
      }

      return {
        label,
        button: { left: round(b.left), right: round(b.right), width: round(b.width), height: round(b.height) },
        contentBox: { left: round(content.left), right: round(content.right) },
        text: text && { left: round(text.left), right: round(text.right), lines: new Set(lines.map((r) => Math.round(r.top))).size },
        scrollOverflow: button.scrollWidth - button.clientWidth,
        clippedBy,
        midWordBreaks,
      };
    });

    let launcherGap = null;
    const launcher = document.querySelector('.shop-copilot-button');
    if (launcher && !launcher.classList.contains('is-hidden')) {
      launcherGap = Math.round(launcher.getBoundingClientRect().left - box.getBoundingClientRect().right);
      if (launcherClearance && launcherGap < minGap) problems.push(`"Connect with" box ends ${launcherGap}px before the launcher band (needs >= ${minGap}px)`);
    } else if (launcherClearance) {
      problems.push('Copilot launcher not rendered');
    }
    return { problems, pageOverflow, launcherGap, buttons: results };
  }, { boxSelector, launcherClearance, minTarget: MIN_TARGET_PX, minGap: LAUNCHER_MIN_GAP_PX });
}

async function openSurface(browser, surface, width, height) {
  const mobile = width <= 834;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.goto(`${origin}${surface.path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator(surface.ready).first().waitFor({ state: 'attached', timeout: 35_000 });
  await page.locator(`${surface.box} button`).nth(1).waitFor({ state: 'attached', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

async function shoot(page, boxSelector, file) {
  await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - (window.innerHeight - r.height) / 2), behavior: 'instant' });
  }, boxSelector);
  await page.screenshot({ path: path.join(shotDir, file) });
}

async function run() {
  const serverOutput = [];
  const server = spawn(
    process.execPath,
    [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: frontend,
      env: { ...process.env, BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  const failures = [];
  const records = [];
  let checks = 0;
  try {
    await waitForServer(server);
    if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    for (const surface of SURFACES) {
      for (const [width, height] of VIEWPORTS) {
        const where = `${surface.name} @ ${width}x${height}`;
        let context;
        try {
          const opened = await openSurface(browser, surface, width, height);
          context = opened.context;
          const { page } = opened;
          const rendered = await page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('button')].map((b) => b.textContent.trim()), surface.box);
          for (const label of REQUIRED_LABELS) {
            if (!rendered.includes(label)) {
              throw new Error(`connector "${label}" not rendered (got ${rendered.join(', ') || 'none'}); build with NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`);
            }
          }
          if (shotDir) await shoot(page, surface.box, `${surface.name}-${width}x${height}.png`);
          const states = [
            { name: 'as-rendered', kind: 'none' },
            ...REQUIRED_LABELS.map((label) => ({ name: `every button "${label}"`, kind: 'label', label })),
            ...(surface.loadingState ? [{ name: 'loading "Connecting..."', kind: 'text', text: 'Connecting...' }] : []),
          ];
          for (const state of states) {
            const setupError = await applyState(page, surface.box, state);
            const m = setupError ? { problems: [setupError], buttons: [] } : await measure(page, surface.box, surface.launcherClearance);
            checks += 1;
            records.push({ surface: surface.name, width, height, state: state.name, ...m });
            if (m.problems.length) failures.push(`${where} [${state.name}]:\n  - ${m.problems.join('\n  - ')}`);
            if (shotDir && state.kind === 'text' && width === 305) await shoot(page, surface.box, `${surface.name}-${width}x${height}-loading.png`);
          }
        } catch (error) {
          failures.push(`${where}: ${error.message.split('\n')[0]}`);
        } finally {
          if (context) await context.close();
        }
      }
    }
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'assertions.json'), `${JSON.stringify(records, null, 1)}\n`);
    const breaks = records.flatMap((r) => (r.buttons || []).filter((b) => b.midWordBreaks.length).map((b) => `${r.surface}@${r.width} [${r.state}] "${b.label}": ${b.midWordBreaks.join(', ')}`));
    if (breaks.length) console.log(`[benefits-wallet-label-fit] note: words split across lines (fit, report only):\n  ${breaks.join('\n  ')}`);
    assert.deepEqual(failures, [], `Wallet connector labels do not fit:\n${failures.join('\n')}`);
    console.log(`[benefits-wallet-label-fit] PASS ${checks} checks - connector labels, Connecting... state, 44px targets, clipping ancestors and launcher gap on ${SURFACES.map((s) => s.name).join(', ')} at ${VIEWPORTS.map(([w]) => w).join('/')}px`);
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
