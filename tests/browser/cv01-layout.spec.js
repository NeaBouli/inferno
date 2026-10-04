// @ts-check
// CV-01 compensation page layout: the tranche status stays legible without horizontal scrolling,
// JavaScript-only live output is absent without JavaScript, mobile cards are filled edge to edge,
// and the fixed Copilot launcher never covers tranche text while the table is scrolled past.
const { test, expect } = require("@playwright/test");

const PAGE = "/wiki/commitment-vault-compensation.html";
const VIEWPORTS = [[1440, 1000], [820, 1180], [390, 844]];
const MODES = [["JS on", true, "#cv01-table"], ["no JS", false, "#cv01-static"]];

async function open(browser, baseURL, width, height, js) {
  const context = await browser.newContext({ baseURL, viewport: { width, height }, javaScriptEnabled: js });
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.goto(PAGE);
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

for (const [width, height] of VIEWPORTS) {
  for (const [mode, js, table] of MODES) {
    test(`${mode} at ${width}x${height}: 11 tranches, status column visible without horizontal scrolling`, async ({ browser, baseURL }) => {
      const { context, page } = await open(browser, baseURL, width, height, js);
      const rows = page.locator(`${table} tbody tr`);
      await expect(rows).toHaveCount(11);
      const m = await page.evaluate((sel) => {
        const t = document.querySelector(sel);
        const wrap = t.closest(".table-scroll");
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const w = wrap.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= w.left - 0.5 && r.right <= w.right + 0.5 && r.right <= window.innerWidth;
        };
        const lastCells = [...t.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild);
        return {
          wrapOverflow: wrap.scrollWidth - wrap.clientWidth,
          tableOverflow: t.scrollWidth - t.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          lastCellsVisible: lastCells.filter(visible).length,
          statusVisible: [...t.querySelectorAll("tbody .cv-status")].filter(visible).length,
        };
      }, table);
      expect(m.wrapOverflow, "tranche table wrapper must not scroll horizontally").toBeLessThanOrEqual(0);
      expect(m.tableOverflow, "tranche table must not scroll horizontally").toBeLessThanOrEqual(0);
      expect(m.pageOverflow, "page must not scroll horizontally").toBeLessThanOrEqual(0);
      expect(m.lastCellsVisible, "last column of every row is inside the visible table area").toBe(11);
      if (js) expect(m.statusVisible, "every status pill is inside the visible table area").toBe(11);
      await context.close();
    });
  }

  test(`no JS at ${width}x${height}: live loading line and empty live table are absent`, async ({ browser, baseURL }) => {
    const { context, page } = await open(browser, baseURL, width, height, false);
    await expect(page.locator("#cv01-live")).toBeHidden();
    await expect(page.locator("#cv01-table")).toBeHidden();
    expect(await page.locator("main").innerText()).not.toContain("Loading live conditions");
    await context.close();
  });
}

test("JS on: the live line replaces the loading text once rendering starts", async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL, 390, 844, true);
  await expect(page.locator("#cv01-live")).toBeVisible();
  await expect(page.locator("#cv01-live")).not.toContainText("Loading");
  await context.close();
});

for (const [width, height] of [[390, 844], [820, 1180]]) {
  for (const [mode, js, table] of MODES) {
    test(`${mode} at ${width}x${height}: cards are shaded edge to edge`, async ({ browser, baseURL }) => {
      const { context, page } = await open(browser, baseURL, width, height, js);
      await expect(page.locator(`${table} tbody tr`)).toHaveCount(11);
      const m = await page.evaluate((sel) => {
        const transparent = (c) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
        const trs = [...document.querySelectorAll(`${sel} tbody tr`)];
        return {
          display: getComputedStyle(trs[0]).display,
          odd: getComputedStyle(trs[0]).backgroundColor,
          even: getComputedStyle(trs[1]).backgroundColor,
          shadedCells: trs.flatMap((tr) => [...tr.children]).filter((td) => !transparent(getComputedStyle(td).backgroundColor)).length,
        };
      }, table);
      expect(m.display, "rows render as cards").toBe("block");
      expect(m.shadedCells, "no cell carries its own inset fill").toBe(0);
      expect(m.even, "alternate cards are shaded on the card itself").not.toBe(m.odd);
      await context.close();
    });
  }
}

for (const [width, height] of [[390, 844], [820, 1180]]) {
  for (const [mode, js, table] of MODES) {
    test(`${mode} at ${width}x${height}: Copilot launcher never covers tranche text while scrolling the table`, async ({ browser, baseURL }) => {
      const { context, page } = await open(browser, baseURL, width, height, js);
      await expect(page.locator(`${table} tbody tr`)).toHaveCount(11);
      const { top, bottom } = await page.evaluate((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
      }, table);
      let states = 0;
      // Walk the page so that every part of the table passes the launcher at the bottom of the viewport.
      for (let y = Math.max(0, top - height); y <= bottom; y += 60) {
        // The page sets scroll-behavior: smooth; jump instantly and confirm the scroll really happened.
        const at = await page.evaluate((v) => { window.scrollTo({ top: v, behavior: "instant" }); return window.scrollY; }, y);
        expect(Math.abs(at - y), `page scrolled to ${y}`).toBeLessThanOrEqual(1);
        const hits = await page.evaluate((sel) => {
          const z = document.querySelector("#ifr-btn").getBoundingClientRect();
          const out = [];
          const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const r of range.getClientRects()) {
              if (r.width > 0 && r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top) out.push(n.textContent.trim());
            }
          }
          return out;
        }, table);
        expect(hits, `text under the launcher at scrollY=${y}`).toEqual([]);
        states += 1;
      }
      expect(states).toBeGreaterThan(10);
      await context.close();
    });
  }
}
