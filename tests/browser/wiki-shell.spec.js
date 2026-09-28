// @ts-check
// T-158: rendered Wiki shell consistency and open-audit control contrast.
const { test, expect } = require("@playwright/test");

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 1000 },
];

async function blockNetwork(page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
}

// Computes WCAG contrast of an element's text against the first opaque ancestor background.
async function contrastOf(locator) {
  return locator.evaluate((el) => {
    const parse = (value) => {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = ({ r, g, b }) => {
      const [R, G, B] = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };
    let node = el;
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a > 0.5) { bg = c; break; }
      node = node.parentElement;
    }
    const fg = parse(getComputedStyle(el).color);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("open-audit action controls meet AA contrast, 44px targets and focus", async ({ page }) => {
      await blockNetwork(page);
      await page.goto("/wiki/open-audit.html");
      const buttons = page.locator(".wiki-actions .btn");
      await expect(buttons).toHaveCount(8);
      for (let i = 0; i < 8; i += 1) {
        const button = buttons.nth(i);
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(await contrastOf(button)).toBeGreaterThanOrEqual(4.5);
        await button.hover();
        expect(await contrastOf(button)).toBeGreaterThanOrEqual(4.5);
        await button.focus();
        const outline = await button.evaluate((el) => getComputedStyle(el).outlineStyle);
        expect(outline).not.toBe("none");
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("wiki index uses the canonical shell brand and active navigation", async ({ page }) => {
      await blockNetwork(page);
      await page.goto("/wiki/index.html");
      await expect(page.locator("#wiki-wallet-bar > a").first()).toHaveText("← Inferno");
      const current = page.locator('.sidebar-nav a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText("Home");
      await expect(current).toHaveClass(/active/);

      const shell = async (path) => {
        await page.goto(path);
        return page.evaluate(() => {
          const pick = (sel) => {
            const s = getComputedStyle(document.querySelector(sel));
            return [s.fontSize, s.color, s.paddingLeft, s.borderBottomWidth].join("|");
          };
          const active = getComputedStyle(document.querySelector(".sidebar-nav a.active"));
          return {
            logo: pick(".sidebar-logo"),
            subtitle: pick(".sidebar-subtitle"),
            active: [active.color, active.backgroundColor, active.borderLeftColor].join("|"),
          };
        });
      };
      const index = await shell("/wiki/index.html");
      const canonical = await shell("/wiki/tokenomics.html");
      expect(index).toEqual(canonical);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
