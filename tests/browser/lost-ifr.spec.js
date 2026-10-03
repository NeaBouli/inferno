// @ts-check
// T-202 / CV-01 / CWA-02: the Landing must always show the permanently lost IFR. A live FeeRouterV1 read
// updates the figure; any failed or implausible read keeps the last verified figure with its date and
// never renders 0 or "Unavailable". All network access is intercepted; values are fixtures.
const { test, expect } = require("@playwright/test");

const PROXY = "https://copilot-api.ifrunit.tech";
test.describe.configure({ timeout: 60000 });

async function blockNetwork(page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
}
async function answerProxy(page, feeRouter) {
  await page.route(`${PROXY}/api/ifr/supply`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ totalSupply: 996687518.33, burned: 3312481.67 }),
  }));
  await page.route(`${PROXY}/api/ifr/balances`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ balances: feeRouter === undefined ? {} : { FeeRouterV1: { raw: feeRouter, formatted: Number(feeRouter) / 1e9 } } }),
  }));
}
const lostCard = (page) => page.locator("[data-lost-ifr]");

// Live reads start only once the transparency section is visible.
async function openTransparency(page) {
  await page.goto("/");
  await page.locator("#onchain-transparency").scrollIntoViewIfNeeded();
}
async function expectVerifiedBaseline(page) {
  const card = lostCard(page);
  await expect(card).toHaveAttribute("data-state", "verified");
  await expect(card.locator("[data-lost-ifr-value]")).toHaveText("27,143,460.66 IFR");
  await expect(card.locator("[data-lost-ifr-status]")).toContainText("Last verified 2026-10-03 (Mainnet block 26108134)");
  await expect(card).not.toContainText("Unavailable");
  await expect(page.locator("[data-lost-ifr-ledger]")).toHaveText("27.1M IFR");
}

test("static markup shows the verified lost figure, labelled as not burned", async ({ page }) => {
  await blockNetwork(page);
  await page.goto("/");
  const card = lostCard(page);
  await expect(card).toContainText("Permanently Lost IFR");
  await expect(card).toContainText("not burned");
  await expect(card).toContainText("still counted in totalSupply");
  await expect(card.locator('a[href="wiki/commitment-vault.html"]')).toHaveCount(1);
  await expect(card.locator('a[href="wiki/transparency.html#lost-ifr"]')).toHaveCount(1);
  await expectVerifiedBaseline(page);
});

test("a live FeeRouterV1 read updates the total; CV-01 stays fixed", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page, "800000000000000");
  await openTransparency(page);
  const card = lostCard(page);
  await expect(card).toHaveAttribute("data-state", "live", { timeout: 20000 });
  await expect(card.locator("[data-lost-ifr-value]")).toHaveText("27,218,467.99 IFR");
  await expect(card.locator("[data-lost-ifr-feerouter]")).toHaveText("800,000.00");
  await expect(card.locator("[data-lost-ifr-cv01]")).toHaveText("26,418,467.99");
  await expect(card.locator("[data-lost-ifr-status]")).toContainText("Live");
  await expect(page.locator("[data-lost-ifr-ledger]")).toHaveText("27.2M IFR");
  await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("27.2M");
});

test("proxy failure keeps the last verified figure with its date, never 0", async ({ page }) => {
  await blockNetwork(page);
  await openTransparency(page);
  await expect(page.locator(".live-updated-at").first()).toHaveText("Connection failed", { timeout: 20000 });
  await expectVerifiedBaseline(page);
  await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("27.1M");
});

for (const [label, value] of [["missing", undefined], ["zero", "0"], ["below the verified baseline", "1000000000000"], ["malformed", "7.2e14"], ["non-string", 724992668043300]]) {
  test(`a ${label} FeeRouterV1 balance never lowers the figure`, async ({ page }) => {
    await blockNetwork(page);
    await answerProxy(page, value);
    await openTransparency(page);
    await expect(page.locator(".live-updated-at").first()).toContainText("Updated", { timeout: 20000 });
    await expectVerifiedBaseline(page);
  });
}

// Exact 9-decimal base-unit accounting: CV-01 26418467994338353 + FeeRouterV1 724992730661647 = 27143460725000000
// base units, i.e. exactly ...460.725 IFR, which must round half up to .73. Float addition of the two
// decimal amounts lands just below .725 and displays .72.
test("base-unit sum is exact at a 0.01 display boundary", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page, "724992730661647");
  await openTransparency(page);
  const card = lostCard(page);
  await expect(card).toHaveAttribute("data-state", "live", { timeout: 20000 });
  await expect(card.locator("[data-lost-ifr-value]")).toHaveText("27,143,460.73 IFR");
  await expect(card.locator("[data-lost-ifr-feerouter]")).toHaveText("724,992.73");
});

for (const [width, height] of [[1440, 1000], [1180, 820], [820, 1180], [390, 844]]) {
  test(`the lost total stays inside its card at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await blockNetwork(page);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const fit = await page.evaluate(() => {
      const card = document.querySelector("[data-lost-ifr]").getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("[data-lost-ifr-value]"));
      return [...range.getClientRects()].every((r) => r.left >= card.left && r.right <= card.right);
    });
    expect(fit).toBe(true);
  });
}

test("mobile: the lost card fits without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await blockNetwork(page);
  await answerProxy(page, "800000000000000");
  await openTransparency(page);
  const card = lostCard(page);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "live", { timeout: 20000 });
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
