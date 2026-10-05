#!/usr/bin/env node

// T-277 regression: with a loaded seller profile, the seller task bar must not widen the
// seller workspace past the viewport. The card used to render ~721px wide on a 375px phone and
// was clipped by main's overflow-x: clip, so documentElement overflow still read 0. This test
// therefore measures component and text boxes against every clipping ancestor, not only the
// document scroll width.
// Needs a production build (`npm run build --prefix apps/benefits-network/frontend`). Mocked API
// responses only; the profile loads through the operator-fallback path: no wallet, no signature.
// Set BENEFITS_SELLER_LAYOUT_SHOTS=<dir> to also save one screenshot per state and width.

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_SELLER_LAYOUT_PORT || 3216);
const origin = `http://127.0.0.1:${port}`;
const shotDir = process.env.BENEFITS_SELLER_LAYOUT_SHOTS || '';
const WIDTHS = [375, 390, 820, 1180, 1440];

const baseBusiness = {
  id: 'biz-layout',
  slug: 'demo-cafe',
  name: 'Demo Cafe',
  description: null,
  website: null,
  logoUrl: null,
  serviceArea: 'Athens',
  categories: ['cafe'],
  ownerAddress: null,
  verifyUrl: `${origin}/b/demo-cafe`,
  qrUrl: `${origin}/b/demo-cafe`,
  discountPercent: 10,
  requiredLockIFR: 1000,
  tierLabel: 'Bronze',
  createdAt: '2026-10-05T00:00:00Z',
  rulesCount: 0,
  productsCount: 0,
};

const STATES = {
  'not-applied': baseBusiness,
  // Long seller name, slug and service area: the longest strings a seller controls in this card.
  'long-content': {
    ...baseBusiness,
    id: 'biz-layout-long',
    slug: 'thessaloniki-waterfront-specialty-coffee-and-bakery-cooperative',
    name: 'Thessaloniki Waterfront Specialty Coffee and Bakery Cooperative',
    serviceArea: 'Thessaloniki, Kalamaria, Pylaia and the wider Central Macedonia region',
    categories: ['cafe', 'bakery', 'food'],
    verifyUrl: `${origin}/b/thessaloniki-waterfront-specialty-coffee-and-bakery-cooperative`,
    qrUrl: `${origin}/b/thessaloniki-waterfront-specialty-coffee-and-bakery-cooperative`,
  },
};

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

async function openLoadedSeller(browser, width, business) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.route(/\/api\//, (route) => {
    if (route.request().url().endsWith(`/api/admin/businesses/${business.id}`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(business) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"mocked"}' });
  });
  await page.addInitScript((id) => {
    try { window.localStorage.setItem('ifr.shop.lastSellerBusinessId', id); } catch {}
  }, business.id);
  await page.goto(`${origin}/?mode=seller#seller-workspace`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const nav = page.locator('nav[aria-label="Seller tasks"]');
  await nav.waitFor({ timeout: 35_000 });
  await page.getByPlaceholder('Admin fallback only').fill('mock-only');
  await page.getByRole('button', { name: 'Load existing profile by ID' }).click();
  await nav.locator('a[href="#seller-rewards"]').waitFor({ timeout: 15_000 });
  await page.locator('#seller-rewards h3').waitFor({ timeout: 15_000 });
  return { context, page };
}

// Returns every fit problem as a string; an empty list means the workspace fits.
function inspect(page) {
  return page.evaluate(() => {
    const problems = [];
    const viewport = document.documentElement.clientWidth;
    const workspace = document.getElementById('seller-workspace');
    const nav = document.querySelector('nav[aria-label="Seller tasks"]');
    const card = nav.closest('section');
    const box = (el) => el.getBoundingClientRect();
    const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.textContent || '').trim().slice(0, 40)}"`;
    const clips = (el) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.overflowX !== 'visible') {
          const outer = box(a);
          const inner = box(el);
          if (inner.left < outer.left - 0.5 || inner.right > outer.right + 0.5) return a;
        }
      }
      return null;
    };

    const pageOverflow = document.documentElement.scrollWidth - viewport;
    if (pageOverflow > 0) problems.push(`page overflows horizontally by ${pageOverflow}px`);
    const ws = box(workspace);
    if (ws.right > viewport + 0.5) problems.push(`seller workspace ends at ${Math.round(ws.right)}px past the ${viewport}px viewport`);
    if (box(card).right > viewport + 0.5) problems.push(`seller card ends at ${Math.round(box(card).right)}px past the viewport`);
    if (workspace.scrollWidth > workspace.clientWidth) problems.push(`seller workspace content is ${workspace.scrollWidth - workspace.clientWidth}px wider than the workspace`);

    // The reward paragraphs (opt-in rules and the reward model) must be fully readable:
    // inside the viewport and not cut by any ancestor.
    const rewardTexts = [...document.querySelectorAll('#seller-rewards p.text-sm')];
    const rewardText = rewardTexts.map((p) => p.textContent).join(' ');
    if (!/Creating a seller profile never enables rewards/.test(rewardText) || !/Reward model:/.test(rewardText)) {
      problems.push('reward paragraphs not rendered');
    }
    for (const paragraph of rewardTexts) {
      const r = box(paragraph);
      if (r.left < -0.5 || r.right > viewport + 0.5) problems.push(`reward paragraph ${name(paragraph)} spans ${Math.round(r.left)}-${Math.round(r.right)}px outside the viewport`);
      const cut = clips(paragraph);
      if (cut) problems.push(`reward paragraph ${name(paragraph)} is clipped by ${name(cut)}`);
    }

    // Controls and text in the card stay inside the workspace. Task chips may scroll inside the nav only.
    const controls = card.querySelectorAll('a, button, input, select, textarea, h2, h3, p, summary');
    for (const el of controls) {
      const r = box(el);
      if (r.width === 0 || r.height === 0) continue;
      const inNav = nav.contains(el) && el !== nav;
      const cut = clips(el);
      if (inNav) {
        if (cut && cut !== nav && !nav.contains(cut)) problems.push(`task chip ${name(el)} is clipped outside the task bar by ${name(cut)}`);
        continue;
      }
      if (r.right > ws.right + 0.5) problems.push(`${name(el)} ends at ${Math.round(r.right)}px past the workspace (${Math.round(ws.right)}px)`);
      else if (cut) problems.push(`${name(el)} is clipped by ${name(cut)}`);
      if (problems.length > 12) break;
    }

    // The task bar stays usable: inside the workspace, and every chip reachable by scrolling the bar.
    const n = box(nav);
    if (n.right > ws.right + 0.5) problems.push('task bar extends past the workspace');
    const chips = [...nav.querySelectorAll('a')];
    const last = chips[chips.length - 1];
    nav.scrollLeft = nav.scrollWidth;
    const lr = box(last);
    if (lr.right > box(nav).right + 0.5 || lr.left < box(nav).left - 0.5) problems.push(`last task chip ${name(last)} cannot be scrolled into the task bar`);
    nav.scrollLeft = 0;
    for (const chip of chips) {
      const c = box(chip);
      if (c.height < 44) problems.push(`task chip ${name(chip)} is ${Math.round(c.height)}px tall (< 44px target)`);
    }
    return problems;
  });
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
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    for (const [state, business] of Object.entries(STATES)) {
      for (const width of WIDTHS) {
        const { context, page } = await openLoadedSeller(browser, width, business);
        const problems = await inspect(page);
        if (shotDir) {
          await page.evaluate(() => {
            const nav = document.querySelector('nav[aria-label="Seller tasks"]');
            window.scrollTo({ top: Math.max(0, nav.getBoundingClientRect().top + window.scrollY - 330), behavior: 'instant' });
          });
          await page.screenshot({ path: path.join(shotDir, `seller-workspace-${state}-${width}.png`) });
          await page.locator('#seller-rewards').screenshot({ path: path.join(shotDir, `seller-rewards-${state}-${width}.png`) });
        }
        if (problems.length) failures.push(`${state} @ ${width}px:\n  - ${problems.join('\n  - ')}`);
        await context.close();
      }
    }
    assert.deepEqual(failures, [], `Seller workspace does not fit:\n${failures.join('\n')}`);
    console.log(`[benefits-seller-layout] PASS - seller workspace, task bar and reward paragraphs fit at ${WIDTHS.join('/')}px (${Object.keys(STATES).join(', ')})`);
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
