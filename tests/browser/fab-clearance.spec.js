// Retirement regression: the former fixed chat overlay is absent; independent content remains usable.
const { test, expect } = require('@playwright/test');
const PAGES = ['/', '/wiki/open-audit.html', '/wiki/faq.html', '/wiki/agent.html', '/wiki/council-votes.html', '/web3/'];
const VIEWPORTS = [[1440, 1000], [1180, 820], [820, 1180], [390, 844]];
for (const [width, height] of VIEWPORTS) {
  for (const url of PAGES) {
    test(`chat retirement preserves content and footer at ${url} ${width}x${height}`, async ({ page, baseURL }) => {
      const origin = new URL(baseURL).origin;
      const chatRequests = [];
      page.on('request', request => {
        if (/\/api\/chat|embedded=1|CoPilot\.jpg|copilot-avatar/.test(request.url())) chatRequests.push(request.url());
      });
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.setViewportSize({ width, height });
      await page.goto(url);
      await expect(page.locator('#ifr-btn, #ifr-panel, .copilot-launcher, .copilot-panel, .shop-copilot-button, .shop-copilot-panel')).toHaveCount(0);
      await expect(page.locator('iframe[src*="copilot"], iframe[data-src*="copilot"]')).toHaveCount(0);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const footer = page.locator('footer, .wiki-footer, .footer').first();
      await footer.scrollIntoViewIfNeeded();
      await expect(footer).toBeVisible();
      const blocked = await footer.locator('a').evaluateAll(links => links.filter(link => {
        // Wrapped inline links: probe the first line box, not the union rectangle.
        const box = link.getClientRects()[0] || link.getBoundingClientRect();
        if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) return false;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit && hit !== link && !link.contains(hit);
      }).map(link => link.textContent.trim()));
      expect(blocked, 'footer links must remain reachable').toEqual([]);
      expect(chatRequests).toEqual([]);
      if (process.env.RETIREMENT_SHOTS) {
        await page.screenshot({ path: `${process.env.RETIREMENT_SHOTS}/${url.replace(/[^a-z0-9]/gi, '_')}-${width}x${height}.png`, fullPage: true });
      }
    });
  }
  test(`network notice and wallet wizard remain usable at ${width}x${height}`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const notice = page.locator('#ifr-rpc-error');
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toHaveAttribute('role', 'alert');
    for (const route of [[], ['lock'], ['lend_choice'], ['benefits', 'benefits_customer'], ['benefits', 'benefits_seller']]) {
      await page.locator('#wizard button[onclick="wzReset()"]').click();
      for (const step of route) await page.locator(`#wz-box button[onclick="wzGo('${step}')"]`).click();
      await expect(page.locator('#wz-box .wz-option').first()).toBeVisible();
      const sizes = await page.locator('#wz-box .wz-option').evaluateAll(controls => controls.map(control => {
        const box = control.getBoundingClientRect();
        return { width: box.width, height: box.height, fits: control.scrollWidth <= control.clientWidth + 1 };
      }));
      for (const size of sizes) {
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
        expect(size.fits).toBe(true);
      }
      expect(await notice.evaluate(el => el.getBoundingClientRect().bottom <= el.nextElementSibling.getBoundingClientRect().top)).toBe(true);
    }
    await notice.getByRole('button', { name: 'Dismiss network notice' }).click();
    await expect(notice).toHaveCount(0);
  });
  test(`FAQ native toggles retain keyboard operation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
    await page.goto('/wiki/faq.html');
    const question = page.locator('.faq-q').first();
    await question.focus();
    await question.press('Enter');
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await question.press('Enter');
    await expect(question).toHaveAttribute('aria-expanded', 'false');
  });
}
