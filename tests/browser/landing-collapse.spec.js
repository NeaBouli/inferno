const { test, expect } = require('@playwright/test');
const { expandLandingSections } = require('./helpers/landing-collapse');

const COLLAPSED = ['about', 'how', 'tokenomics', 'ecosystem', 'partners', 'architecture', 'trust',
  'onchain-transparency', 'faq', 'phase3', 'governance', 'project-continuity', 'contracts'];
const OPEN = ['hero', 'wizard', 'token-flow', 'roadmap'];
const MAIN = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
});

for (const [width, height] of [[375, 812], [390, 844], [820, 1180], [1180, 820], [1440, 1000]]) {
  test(`default tiles, open sections and readable headers at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
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
    const targets = await page.locator('#contracts .contract-row button').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { label: button.textContent.trim(), width: box.width, height: box.height };
    }));
    expect(targets).toHaveLength(20);
    for (const target of targets) {
      expect(target.width, `${target.label} target width at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(target.height, `${target.label} target height at ${width}px`).toBeGreaterThanOrEqual(44);
    }
    const pair = page.locator('#contracts .contract-row').filter({ hasText: 'Uniswap V2 LP Pair' });
    await expect(pair.locator('code')).toBeVisible();
    expect(await pair.evaluate(row => {
      const box = row.getBoundingClientRect();
      return [...row.querySelectorAll('span, code, a, button')].every(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...range.getClientRects()].every(rect => rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom);
      });
    }), 'LP Pair text and controls fit the same row at every viewport').toBe(true);
    await page.locator('#how').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`landing-expanded-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

test('one native contracts toggle controls every row including the LP Pair and preserves links', async ({ page }) => {
  await page.goto('/');
  const contracts = page.locator('#contracts');
  const toggle = contracts.locator(':scope > .landing-collapse-heading > button');
  await expect(toggle).toHaveAccessibleName('On-Chain Contract Addresses');
  await expect(toggle).toHaveAttribute('aria-controls', 'contracts-panel');
  await expect(contracts.locator('.landing-collapse-toggle')).toHaveCount(1);
  await expect(contracts.locator('.contract-row .landing-collapse-heading, .contract-row [aria-expanded]')).toHaveCount(0);
  await expect(contracts.locator('[data-landing-address]')).toHaveCount(18);
  await expect(contracts.locator('.contract-row')).toHaveCount(19);
  expect(await contracts.locator('.contract-row').evaluateAll(rows => rows.every(row => row.parentElement === rows[0].parentElement))).toBe(true);
  await expect(contracts.locator('.copy-btn')).toHaveCount(19);
  const links = await contracts.locator('a[href]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('href'), node.getAttribute('target'), node.getAttribute('rel')]));
  const addresses = await contracts.locator('code').allTextContents();
  expect(new Set(addresses).size).toBe(19);
  expect(addresses).toContain(MAIN);
  for (const address of await contracts.locator('code').all()) await expect(address).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const row of await contracts.locator('.contract-row').all()) {
    await expect(row).toBeVisible();
    await expect(row.locator('code')).toBeVisible();
    await expect(row.locator('.copy-btn')).toBeVisible();
    expect(await row.getAttribute('style')).toBe(await contracts.locator('.contract-row').first().getAttribute('style'));
  }
  const pair = contracts.locator('.contract-row').filter({ hasText: 'Uniswap V2 LP Pair' });
  await expect(pair.locator(':scope > div')).toHaveCount(2);
  await expect(pair.locator('code')).toHaveText('0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0');
  await expect(pair.locator('a')).toHaveAttribute('href', `https://app.uniswap.org/swap?outputCurrency=${MAIN}`);
  await expect(pair.locator('.copy-btn')).toHaveAttribute('data-addr', '0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0');
  expect(await pair.locator('code').getAttribute('style')).toBe(await contracts.locator('code').first().getAttribute('style'));
  await expect(contracts.locator('a[href*="etherscan.io/address/"]')).toBeVisible();
  await expect(contracts.locator('[onclick="lpAddIFRToken()"]')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  for (const address of await contracts.locator('code').all()) await expect(address).toBeHidden();
  expect(await contracts.locator('code').allTextContents()).toEqual(addresses);
  expect(await contracts.locator('a[href]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('href'), node.getAttribute('target'), node.getAttribute('rel')]))).toEqual(links);
  await expandLandingSections(page, 'tokenomics');
  await expect(page.locator(`#tokenomics a[href="https://etherscan.io/address/${MAIN}"]`)).toBeVisible();
  await expect(page.locator('#tokenomics [data-landing-address]')).toHaveCount(14);
  await expect(page.locator('[data-landing-address] .landing-collapse-heading, [data-landing-address] [aria-expanded]')).toHaveCount(0);
  for (const tile of await page.locator('#tokenomics [data-landing-address]').all()) {
    for (const address of await tile.locator('a[href*="0x"], code').all()) await expect(address).toBeVisible();
  }
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

for (const hash of ['how', 'live-distribution', 'dao-governance', 'contracts', 'landing-address-1-panel']) {
  test(`initial deep link #${hash} expands its section`, async ({ page }) => {
    await page.goto(`/#${hash}`);
    const target = page.locator(`#${hash}`);
    await expect(target).toBeVisible();
    const section = hash === 'how' ? 'how' : hash === 'dao-governance' ? 'governance' : hash === 'contracts' ? 'contracts' : 'tokenomics';
    await expect(page.locator(`#${section} > .landing-collapse-heading > button`)).toHaveAttribute('aria-expanded', 'true');
    if (hash === 'landing-address-1-panel') {
      await expect(target).toContainText('LP Reserve Safe');
      await expect(target.locator('a[href="https://etherscan.io/address/0x5D93E7919a71d725054e31017eCA86B026F86C04"]')).toBeVisible();
      await expect(target.locator('.landing-collapse-heading, .landing-collapse-toggle, [aria-expanded]')).toHaveCount(0);
      await expect.poll(async () => {
        const navBottom = await page.locator('nav').first().evaluate(element => element.getBoundingClientRect().bottom);
        const box = await target.boundingBox();
        return box && box.y >= navBottom && box.y + box.height <= page.viewportSize().height;
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
  await expect(page.locator('.landing-collapse-panel')).toHaveCount(13);
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
