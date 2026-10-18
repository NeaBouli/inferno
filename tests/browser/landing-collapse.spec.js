const { test, expect } = require('@playwright/test');
const { expandLandingSections } = require('./helpers/landing-collapse');

const COLLAPSED = ['about', 'how', 'tokenomics', 'ecosystem', 'partners', 'architecture', 'trust',
  'onchain-transparency', 'faq', 'phase3', 'governance'];
const OPEN = ['hero', 'wizard', 'token-flow', 'roadmap', 'contracts'];
const MAIN = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
});

for (const width of [390, 1280]) {
  test(`default tiles, open sections and readable headers at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    expect(await page.locator('main > section.landing-collapsible').evaluateAll(sections => sections.map(s => s.id))).toEqual(COLLAPSED);
    for (const id of COLLAPSED) {
      const section = page.locator(`#${id}`);
      const toggle = section.locator(':scope > .landing-collapse-heading > button');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const panelId = await toggle.getAttribute('aria-controls');
      await expect(page.locator(`#${panelId}`)).toBeHidden();
      expect(normalize(await section.innerText())).toBe(normalize(await section.locator(':scope > .landing-collapse-heading').innerText()));
      await expect(toggle).toBeVisible();
      const fit = await toggle.evaluate(button => {
        const heading = button.parentElement;
        const rect = heading.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(heading.querySelector('h2'));
        return rect.left >= 0 && rect.right <= innerWidth && heading.scrollWidth <= heading.clientWidth &&
          [...range.getClientRects()].every(line => line.left >= rect.left && line.right <= rect.right);
      });
      expect(fit, `${id}: the entire header fits`).toBe(true);
      expect(await toggle.evaluate(button => getComputedStyle(button.querySelector('.landing-collapse-chevron')).borderRightWidth)).toBe('2px');
    }
    for (const id of OPEN) {
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator(`#${id} > .landing-collapse-heading`)).toHaveCount(0);
    }
    await expect(page.locator('#liquidity-gauge-title')).toBeVisible();
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#how').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`landing-collapsed-${width}.png`) });
    await expandLandingSections(page, ...COLLAPSED);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#how').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`landing-expanded-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

test('only InfernoToken stays visible in every address list; other cards toggle independently', async ({ page }) => {
  await page.goto('/');
  const contracts = page.locator('#contracts');
  await expect(contracts.locator('code').filter({ hasText: MAIN })).toBeVisible();
  await expect(contracts.locator('[data-landing-address]')).toHaveCount(18);
  await expandLandingSections(page, 'tokenomics');
  await expect(page.locator(`#tokenomics a[href="https://etherscan.io/address/${MAIN}"]`)).toBeVisible();
  await expect(page.locator('#tokenomics [data-landing-address]')).toHaveCount(14);
  for (const tile of await page.locator('[data-landing-address]').all()) {
    await expect(tile.locator(':scope > .landing-collapse-heading > button')).toHaveAttribute('aria-expanded', 'false');
    await expect(tile.locator(':scope > .landing-collapse-panel')).toBeHidden();
    for (const address of await tile.locator('a[href*="0x"], code').all()) await expect(address).toBeHidden();
  }
  const first = contracts.locator('[data-landing-address]').first();
  await first.locator(':scope > .landing-collapse-heading > button').click();
  await expect(first.locator('code')).toBeVisible();
  await expect(contracts.locator('[data-landing-address]').nth(1).locator(':scope > .landing-collapse-heading > button')).toHaveAttribute('aria-expanded', 'false');
  await first.locator(':scope > .landing-collapse-heading > button').click();
  await expect(first.locator('code')).toBeHidden();
});

test('Enter and Space toggle the same accessible header and preserve focus', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('#how > .landing-collapse-heading > button');
  await expect(toggle).toHaveAccessibleName('How It Works Three steps to lock-based access');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#how .how-cards')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#how .how-cards')).toBeHidden();
  await expect(toggle).toBeFocused();
});

for (const hash of ['how', 'live-distribution', 'dao-governance', 'landing-address-1-panel']) {
  test(`initial deep link #${hash} expands its section and nested tile`, async ({ page }) => {
    await page.goto(`/#${hash}`);
    const target = page.locator(`#${hash}`);
    await expect(target).toBeVisible();
    const section = hash === 'how' ? 'how' : hash === 'dao-governance' ? 'governance' : 'tokenomics';
    await expect(page.locator(`#${section} > .landing-collapse-heading > button`)).toHaveAttribute('aria-expanded', 'true');
    if (hash === 'landing-address-1-panel') await expect(page.locator('[aria-controls="landing-address-1-panel"]')).toHaveAttribute('aria-expanded', 'true');
    if (hash === 'landing-address-1-panel') {
      // Address tiles: the tile header and its panel must both sit fully below the sticky nav.
      const header = page.locator('[aria-controls="landing-address-1-panel"]');
      await expect.poll(async () => {
        const navBottom = await page.locator('nav').first().evaluate(el => el.getBoundingClientRect().bottom);
        const headerTop = await header.evaluate(el => el.getBoundingClientRect().top);
        const panelBottom = await target.evaluate(el => el.getBoundingClientRect().bottom);
        const viewport = page.viewportSize().height;
        return headerTop >= navBottom && panelBottom <= viewport;
      }).toBe(true);
    } else {
      await expect.poll(() => target.evaluate(element => Math.abs(element.getBoundingClientRect().top - 150))).toBeLessThan(8);
    }
  });
}

test('nav click, hashchange and repeated same-hash in-page links expand and scroll', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav a[href="#how"]').click();
  await expect(page.locator('#how > .landing-collapse-heading > button')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#how > .landing-collapse-heading > button').click();
  await page.locator('nav a[href="#how"]').click();
  await expect(page.locator('#how > .landing-collapse-heading > button')).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { location.hash = 'live-distribution'; });
  await expect(page.locator('#tokenomics > .landing-collapse-heading > button')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#live-distribution')).toBeVisible();
});

test('print exposes every section and address panel without changing screen state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.landing-collapse-panel')).toHaveCount(43);
  await page.emulateMedia({ media: 'print' });
  for (const panel of await page.locator('.landing-collapse-panel').all()) await expect(panel).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  for (const panel of await page.locator('.landing-collapse-panel').all()) await expect(panel).toBeHidden();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('all source sections and every address remain visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.landing-collapse-toggle')).toHaveCount(0);
    for (const id of COLLAPSED) {
      await expect(page.locator(`#${id} h2`)).toBeVisible();
      for (const reveal of await page.locator(`#${id} .reveal`).all()) await expect(reveal).toHaveCSS('opacity', '1');
    }
    for (const address of await page.locator('#contracts code, #tokenomics a[href*="etherscan.io/address/"]').all()) await expect(address).toBeVisible();
    await expect(page.locator('#how .how-cards')).toBeVisible();
    await expect(page.locator('[data-lost-ifr]')).toBeVisible();
  });
});
