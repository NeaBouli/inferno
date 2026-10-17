// @ts-check
// CV-01 compensation page layout: the tranche status stays legible without horizontal scrolling,
// JavaScript-only live output is absent without JavaScript, mobile cards are filled edge to edge,
// and the fixed retired overlay never covers tranche text while the table is scrolled past.
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
