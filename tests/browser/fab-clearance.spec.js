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
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
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
