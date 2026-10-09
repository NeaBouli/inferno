// @ts-check
// The October 2026 Points voucher incident record on the security wiki page must be readable
// on phones: no horizontal overflow, and no line of the record may ever run under the fixed
// Copilot launcher (#ifr-btn) - checked horizontally (independent of scroll position) and at
// a scroll position per block.
const { test, expect } = require("@playwright/test");

const VIEWPORTS = [[375, 812], [390, 844], [1440, 1000]];
const SECTION = "#points-voucher-incident-2026-10";
const TOP_OFFSET = 70; // scroll each block to just below the top edge

for (const [width, height] of VIEWPORTS) {
  test(`voucher incident record stays readable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto(`/wiki/security.html${SECTION}`);
    await page.evaluate(() => document.fonts.ready);
    // The wiki uses smooth scrolling; measure only after an instant scroll has landed.
    await page.addStyleTag({ content: "html, body { scroll-behavior: auto !important; }" });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const blocks = await page.evaluate((sel) => {
      const heading = document.querySelector(sel);
      const out = [heading];
      for (let el = heading.nextElementSibling; el && el.tagName !== "H2" && el.tagName !== "H3"; el = el.nextElementSibling) {
        if (el.tagName === "P" || el.classList.contains("callout")) out.push(el);
      }
      return out.length;
    }, SECTION);
    expect(blocks).toBe(6); // heading, status callout, What happened, Impact, Response, Open

    for (let i = 0; i < blocks; i += 1) {
      const result = await page.evaluate(({ sel, i, top }) => {
        const heading = document.querySelector(sel);
        const els = [heading];
        for (let el = heading.nextElementSibling; el && el.tagName !== "H2" && el.tagName !== "H3"; el = el.nextElementSibling) {
          if (el.tagName === "P" || el.classList.contains("callout")) els.push(el);
        }
        const el = els[i];
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - top, behavior: "instant" });
        const r = el.getBoundingClientRect();
        const fab = document.getElementById("ifr-btn");
        const f = fab ? fab.getBoundingClientRect() : null;
        const overlaps = f ? !(r.bottom <= f.top || r.right <= f.left || r.top >= f.bottom || r.left >= f.right) : false;
        // Text box of the block (content box), not its padding: the gutter is padding by design.
        const cs = getComputedStyle(el);
        const textRight = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const parent = el.closest(".incident-record");
        const pr = parent ? parent.getBoundingClientRect().right - parseFloat(getComputedStyle(parent).paddingRight) : textRight;
        return { overflowX: el.scrollWidth > el.clientWidth + 1, overlaps, bottom: r.bottom, fabTop: f ? f.top : null,
                 right: Math.min(textRight, pr), fabLeft: f ? f.left : Infinity };
      }, { sel: SECTION, i, top: TOP_OFFSET });
      expect(result.overflowX, `block ${i} must not overflow horizontally`).toBe(false);
      expect(result.overlaps, `block ${i} must be fully readable above the launcher (${JSON.stringify(result)})`).toBe(false);
      if (width <= 480) {
        expect(result.right, `block ${i} must end left of the launcher at any scroll position`).toBeLessThanOrEqual(result.fabLeft);
      }
    }
  });
}
