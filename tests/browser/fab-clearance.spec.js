// @ts-check
// The fixed Copilot launcher (#ifr-btn on Landing/Wiki, .copilot-launcher on Web3) must not
// cover footer links when a visitor scrolls to the very end of the page.
const { test, expect } = require("@playwright/test");

const PAGES = ["/", "/wiki/open-audit.html", "/wiki/faq.html", "/web3/"];
const VIEWPORTS = [[1440, 1000], [1180, 820], [820, 1180], [390, 844]];

for (const path of PAGES) {
  for (const [width, height] of VIEWPORTS) {
    test(`footer links stay clear of the Copilot launcher on ${path} at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      // Late content (live data, fonts, reveal effects) can grow the page after the first scroll.
      // Scroll to the end until the document height is stable, then measure at the true page end.
      for (let attempt = 0, stable = 0; attempt < 20 && stable < 2; attempt += 1) {
        const before = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => document.documentElement.scrollHeight);
        stable = after === before ? stable + 1 : 0;
      }
      expect(
        await page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1),
        "the test must measure at the very end of the page"
      ).toBe(true);
      const covered = await page.evaluate(() => {
        const footer = document.querySelector("footer, .wiki-footer, .footer");
        const launcher = document.querySelector("#ifr-btn, .copilot-launcher");
        if (!footer || !launcher) return ["missing footer or launcher"];
        const z = launcher.getBoundingClientRect();
        return [...footer.querySelectorAll("a, button")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top;
          })
          .map((el) => el.textContent.trim());
      });
      expect(covered).toEqual([]);
    });
  }
}

// Mid-page content scrolls under the fixed launcher too. Because the launcher is fixed, every vertical
// position of the lost-IFR card passes behind it while scrolling, so no rendered text of the card may enter
// the launcher's horizontal band (measured on the actual text boxes, not element boxes).
for (const [width, height] of VIEWPORTS) {
  test(`lost-IFR card text stays clear of the Copilot launcher band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("[data-lost-ifr-status]").scrollIntoViewIfNeeded();
    const covered = await page.evaluate(() => {
      const launcher = document.querySelector("#ifr-btn");
      const card = document.querySelector("[data-lost-ifr]");
      if (!launcher || !card) return ["missing launcher or card"];
      const z = launcher.getBoundingClientRect();
      const hits = [];
      for (const el of card.querySelectorAll("*")) {
        if (el.children.length) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const r of range.getClientRects()) {
          if (r.width > 0 && r.left < z.right && r.right > z.left) hits.push(el.textContent.trim().slice(0, 40));
        }
      }
      return hits;
    });
    expect(covered).toEqual([]);
  });
}
