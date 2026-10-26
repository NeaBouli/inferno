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

// T-269: on phones every wallet-guide card stays inside its grid track and the main column never scrolls
// sideways; a long unbreakable value (an address in <code>) must wrap instead of widening the track.
for (const [width, height] of [[320, 740], [375, 812], [390, 844]]) {
  test(`wallet-guide cards stay inside the main column at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await blockNetwork(page);
    await page.goto("/wiki/wallet-guide.html");
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const main = document.querySelector("main");
      const overflowing = [...document.querySelectorAll(".wg-grid")].flatMap((grid) => {
        const g = grid.getBoundingClientRect();
        return [...grid.querySelectorAll(":scope > .wg-card")]
          .filter((card) => card.getClientRects().length && card.getBoundingClientRect().right > g.right + 0.5)
          .map((card) => `${card.querySelector(".wg-card-name")?.textContent.trim()} +${Math.round(card.getBoundingClientRect().right - g.right)}px`);
      });
      return {
        overflowing,
        mainOverflow: main ? main.scrollWidth - main.clientWidth : -1,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.overflowing, "cards end inside their grid").toEqual([]);
    expect(layout.mainOverflow, "main column has no horizontal overflow").toBeLessThanOrEqual(0);
    expect(layout.docOverflow, "document has no horizontal overflow").toBeLessThanOrEqual(0);
  });
}

// Native fragment placement must account for the existing sticky Wiki wallet bar.
async function settledContinuityGeometry(page) {
  await page.waitForLoadState("load", { timeout: 10000 });
  await page.evaluate(() => Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]));
  const started = Date.now();
  let previous;
  let stableSince;
  while (Date.now() - started < 10000) {
    const state = await page.locator("h2#project-continuity").evaluate((heading) => {
      const r = heading.getBoundingClientRect();
      return [scrollY, r.top, r.height, document.documentElement.scrollHeight,
        document.fonts.status === "loaded", document.readyState === "complete"];
    });
    const same = previous && state.slice(0, 4).every((value, i) => Math.abs(Number(value) - Number(previous[i])) <= 0.5);
    if (same && state[4] && state[5]) stableSince ??= Date.now();
    else stableSince = undefined;
    if (Date.now() - started >= 2000 && stableSince && Date.now() - stableSince >= 1200) break;
    previous = state;
    await page.waitForTimeout(200);
  }
  expect(stableSince && Date.now() - stableSince >= 1200, "native fragment scroll settles within the bound").toBeTruthy();
  return page.locator("h2#project-continuity").evaluate((heading) => {
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const h = rect(heading);
    const bar = rect(document.querySelector("#wiki-wallet-bar"));
    const range = document.createRange();
    range.selectNodeContents(heading);
    const lines = [...range.getClientRects()].filter((r) => r.width && r.height);
    const unobstructed = lines.every((r) => [0.2, 0.5, 0.8].every((part) => {
      const x = r.left + r.width * part;
      const y = (r.top + r.bottom) / 2;
      if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return hit === heading || heading.contains(hit);
    }));
    return {
      heading: h, bar, gap: h.top - bar.bottom, scrollY, width: innerWidth, height: innerHeight,
      fontsLoaded: document.fonts.status === "loaded", readyComplete: document.readyState === "complete",
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      textFits: lines.every((r) => r.left >= h.left - 0.5 && r.right <= h.right + 0.5),
      unobstructed,
    };
  });
}

for (const [width, height] of [[390, 844], [375, 812], [1440, 1000], [1180, 820], [820, 1180]]) {
  test.describe("continuity target " + width + "x" + height, () => {
    test.use({ viewport: { width, height }, hasTouch: width <= 820 });
    for (const navigation of ["hash", "policy-link"]) {
      test("wiki continuity anchor " + navigation + " " + width + "x" + height, async ({ page }, testInfo) => {
        await blockNetwork(page);
        await page.routeWebSocket("**/*", (socket) => socket.close());
        if (navigation === "hash") {
          await page.goto("/wiki/multisig.html#project-continuity", { waitUntil: "domcontentloaded" });
        } else {
          await page.goto("/#project-continuity");
          await expect(page.locator('#project-continuity > .landing-collapse-heading > button')).toHaveAttribute("aria-expanded", "true");
          const link = page.locator('#project-continuity a[href="wiki/multisig.html#project-continuity"]');
          await page.keyboard.press("Tab");
          await link.focus();
          const control = await link.evaluate((element) => {
            const r = element.getBoundingClientRect(), style = getComputedStyle(element);
            return { width: r.width, height: r.height, focused: document.activeElement === element,
              focusVisible: element.matches(":focus-visible"), outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
          });
          expect(control.width).toBeGreaterThanOrEqual(44);
          expect(control.height).toBeGreaterThanOrEqual(44);
          expect(control.focused && control.focusVisible && control.outline !== "none" && control.outlineWidth > 0).toBe(true);
          if (width <= 390) await link.tap();
          else await link.click();
        }
        await expect(page).toHaveURL(/\/wiki\/multisig(?:\.html)?#project-continuity$/);
        await expect(page.locator("h2#project-continuity")).toHaveText("Project continuity");
        const geometry = await settledContinuityGeometry(page);
        await testInfo.attach("continuity-geometry", { body: Buffer.from(JSON.stringify({ navigation, ...geometry })), contentType: "application/json" });
        if (navigation === "policy-link") {
          await page.screenshot({ path: testInfo.outputPath("continuity-target-" + width + "x" + height + ".png"), animations: "disabled" });
        }
        expect(geometry.fontsLoaded && geometry.readyComplete).toBe(true);
        expect(geometry.gap, "continuity heading clears sticky header by at least 8px").toBeGreaterThanOrEqual(8);
        expect(geometry.heading.bottom).toBeLessThanOrEqual(height);
        expect(geometry.heading.left).toBeGreaterThanOrEqual(0);
        expect(geometry.heading.right).toBeLessThanOrEqual(width);
        expect(geometry.docOverflow).toBeLessThanOrEqual(1);
        expect(geometry.textFits && geometry.unobstructed).toBe(true);
        const handover = page.getByRole("link", { name: "Core Developer Handover", exact: true });
        await expect(handover).toHaveAttribute("href", "https://github.com/NeaBouli/inferno/blob/main/docs/CORE_DEVELOPER_HANDOVER.md");
        await page.keyboard.press("Tab");
        await handover.focus();
        await expect(handover).toBeFocused();
        expect(await handover.evaluate((element) => {
          const s = getComputedStyle(element);
          return element.matches(":focus-visible") && s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        })).toBe(true);
      });
    }
  });
}
