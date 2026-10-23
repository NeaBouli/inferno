// @ts-check
// Run outside the Codex sandbox: real JSON, no-JS, failed fetch and longest rows.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/data/recent-votes.json"), "utf8"));
const viewports = [
  { width: 1440, height: 1000 }, { width: 1180, height: 820 },
  { width: 820, height: 1180 }, { width: 390, height: 844 },
];

async function checkRows(page) {
  const block = page.locator("#recent-votes");
  await expect(block.getByRole("heading", { name: "Council", exact: true })).toBeVisible();
  await expect(block.getByRole("heading", { name: "Forum", exact: true })).toBeVisible();
  await expect(block.locator("li")).toHaveCount(data.council.length + data.forum.length);
  for (const row of [...data.council, ...data.forum]) {
    const item = block.locator(`[data-vote-id="${row.id}"]`);
    await expect(item).toContainText(row.title);
    await expect(item).toContainText(row.result);
    await expect(item.locator("time")).toHaveAttribute("datetime", row.date);
    await expect(item.getByRole("link", { name: `Evidence for ${row.id}` })).toHaveAttribute("href", row.evidenceUrl);
  }
  await expect(block).not.toContainText("FB-SEP-0001");
  if (!data.forum.length) await expect(block).toContainText("No public forum ballot has closed yet");
  await expect(block.getByRole("link", { name: "All council votes", exact: true })).toHaveAttribute("href", data.olderCouncilUrl);
  await expect(block.getByRole("link", { name: "All Forum tally files (including tests)", exact: true })).toHaveAttribute("href", data.olderForumUrl);
  await expect(block.getByRole("link", { name: "Forum voting guide", exact: true })).toHaveAttribute("href", "/wiki/dao-governance.html#forum-vote-steps");
}

async function checkLayout(page) {
  const measurements = await page.locator("#recent-votes").evaluate((block) => {
    const box = block.getBoundingClientRect();
    const rows = Array.from(block.querySelectorAll("li")).map((row) => {
      const bounds = row.getBoundingClientRect();
      const css = getComputedStyle(row);
      return {
        left: bounds.left, right: bounds.right, width: bounds.width,
        scrollWidth: row.scrollWidth, clientWidth: row.clientWidth,
        padding: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft].map(parseFloat),
      };
    });
    const links = Array.from(block.querySelectorAll("a")).map((a) => {
      const rect = a.getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
    });
    return { left: box.left, right: box.right, rows, links, viewport: innerWidth };
  });
  expect(measurements.left).toBeGreaterThanOrEqual(0);
  expect(measurements.right).toBeLessThanOrEqual(measurements.viewport);
  for (const row of measurements.rows) {
    expect(row.left).toBeGreaterThanOrEqual(measurements.left);
    expect(row.right).toBeLessThanOrEqual(measurements.right + 1);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    for (const inset of row.padding) expect(inset).toBeGreaterThanOrEqual(16);
  }
  for (const link of measurements.links) {
    expect(link.width).toBeGreaterThanOrEqual(44);
    expect(link.height).toBeGreaterThanOrEqual(44);
    expect(link.left).toBeGreaterThanOrEqual(measurements.left);
    expect(link.right).toBeLessThanOrEqual(measurements.right + 1);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });
    test.beforeEach(async ({ page }) => {
      await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    });

    test("recent votes load real JSON, preserve evidence and fit the page", async ({ page }, testInfo) => {
      await page.goto("/wiki/governance.html#recent-votes");
      await expect(page.locator("#recent-votes-content")).toHaveAttribute("data-state", "updated");
      await checkRows(page);
      await checkLayout(page);
      const evidence = page.locator("#recent-votes a").first();
      await evidence.focus();
      expect(await evidence.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
      await page.locator("#recent-votes").screenshot({ path: testInfo.outputPath("recent-votes.png") });
    });

    test("long Council and Forum rows wrap after client rendering", async ({ page }, testInfo) => {
      const feed = structuredClone(data);
      feed.council[0].title = '<script>literal text</script> ' + "Long published proposal title ".repeat(15);
      feed.forum = [{
        id: "FB-0001", title: "Community proposal ".repeat(30),
        result: "Advisory tally passed — YES: 9007199.254740993 IFR · NO: 500 IFR · ABSTAIN: 250 IFR",
        date: "2026-10-19T10:00:00.000Z",
        evidenceUrl: "https://github.com/NeaBouli/inferno/blob/main/apps/telegram/telegram-bot/forum-results/FB-0001.json",
      }];
      await page.route("**/data/recent-votes.json", (route) => route.fulfill({ json: feed }));
      await page.goto("/wiki/governance.html#recent-votes");
      await expect(page.locator("#recent-votes-content")).toHaveAttribute("data-state", "updated");
      await expect(page.locator("#recent-votes")).toContainText(feed.council[0].title);
      await expect(page.locator('#recent-votes [data-vote-id="FB-0001"]')).toContainText(feed.forum[0].result);
      await expect(page.locator("#recent-votes script")).toHaveCount(0);
      await checkLayout(page);
      await page.locator("#recent-votes").screenshot({ path: testInfo.outputPath("recent-votes-long.png") });
    });
  });
}

test.describe("no JavaScript", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  test("generated list and archive links remain visible", async ({ page }, testInfo) => {
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/wiki/governance.html#recent-votes");
    await expect(page.locator("#recent-votes-content")).toHaveAttribute("data-state", "static");
    await checkRows(page);
    await checkLayout(page);
    await page.locator("#recent-votes").screenshot({ path: testInfo.outputPath("recent-votes-no-js.png") });
  });
});

for (const state of ["failed fetch", "invalid JSON", "unsafe URL"]) {
  test(`${state} retains the generated fallback`, async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.route("**/data/recent-votes.json", (route) => {
      if (state === "failed fetch") return route.fulfill({ status: 503, body: "Unavailable" });
      if (state === "invalid JSON") return route.fulfill({ contentType: "application/json", body: "{" });
      const unsafe = structuredClone(data);
      unsafe.olderCouncilUrl = "javascript:alert(1)";
      return route.fulfill({ json: unsafe });
    });
    await page.goto("/wiki/governance.html#recent-votes");
    await expect(page.locator("#recent-votes-content")).toHaveAttribute("data-state", "fallback");
    await checkRows(page);
  });
}

test("landing governance links to recent votes", async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.goto("/");
  await expect(page.locator('#governance a[href="wiki/governance.html#recent-votes"]')).toHaveCount(1);
});
