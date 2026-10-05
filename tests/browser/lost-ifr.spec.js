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
  await expect(card.locator("[data-lost-ifr-value]")).toHaveText("27,153,013.07 IFR");
  await expect(card.locator("[data-lost-ifr-status]")).toContainText("Last verified 2026-10-05 (Mainnet block 26124660)");
  await expect(card).not.toContainText("Unavailable");
  await expect(page.locator("[data-lost-ifr-ledger]")).toHaveText("27.2M IFR");
}

test("static markup shows the verified lost figure, labelled as not burned", async ({ page }) => {
  await blockNetwork(page);
  await page.goto("/");
  const card = lostCard(page);
  await expect(card).toContainText("Permanently Lost IFR");
  await expect(card).toContainText("not burned");
  await expect(card).toContainText("still counted in totalSupply");
  await expect(card.locator('a[href="wiki/commitment-vault-compensation.html"]')).toHaveCount(1);
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
  await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("27.2M");
});

for (const [label, value] of [["missing", undefined], ["zero", "0"], ["below the verified baseline", "1000000000000"], ["malformed", "7.2e14"], ["non-string", 734545074097400]]) {
  test(`a ${label} FeeRouterV1 balance never lowers the figure`, async ({ page }) => {
    await blockNetwork(page);
    await answerProxy(page, value);
    await openTransparency(page);
    await expect(page.locator(".live-updated-at").first()).toContainText("Updated", { timeout: 20000 });
    await expectVerifiedBaseline(page);
  });
}

// Exact 9-decimal base-unit accounting: CV-01 26418467994338353 + FeeRouterV1 734545730661647 = 27153013725000000
// base units, i.e. exactly ...013.725 IFR, which must round half up to .73. Float addition of the two
// decimal amounts lands just below .725 and displays .72.
test("base-unit sum is exact at a 0.01 display boundary", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page, "734545730661647");
  await openTransparency(page);
  const card = lostCard(page);
  await expect(card).toHaveAttribute("data-state", "live", { timeout: 20000 });
  await expect(card.locator("[data-lost-ifr-value]")).toHaveText("27,153,013.73 IFR");
  await expect(card.locator("[data-lost-ifr-feerouter]")).toHaveText("734,545.73");
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

// Owner decision 2026-10-03: permanently lost IFR is a black "dead" segment of the live distribution,
// removed from the CommitmentVault segment (no double count), and Live Supply = supply − dead.
// Every balance label the production API returns (values from a 2026-10-03 live read).
const FULL_BALANCES = {
  Deployer: { raw: "248001307527159", formatted: 248001.307527159 },
  LPReserveSafe: { raw: "400600000000000000", formatted: 400600000 },
  GnosisSafe: { raw: "0", formatted: 0 },
  CommunitySafe: { raw: "7900000000000000", formatted: 7900000 },
  Vesting: { raw: "150000000000000000", formatted: 150000000 },
  LiquidityReserve: { raw: "200000000000000000", formatted: 200000000 },
  PartnerVault: { raw: "40000000000000000", formatted: 40000000 },
  BootstrapVaultV3: { raw: "1", formatted: 1e-9 },
  BuybackVault: { raw: "0", formatted: 0 },
  BurnReserve: { raw: "0", formatted: 0 },
  FeeRouterV1: { raw: "734545074097347", formatted: 734545.074097347 },
  IFRLock: { raw: "2000000000000", formatted: 2000 },
  CommitmentVault: { raw: "27795535918948719", formatted: 27795535.918948717 },
  LendingVault: { raw: "0", formatted: 0 },
};
async function answerProxyWith(page, supplyBody, balances, extra) {
  await page.route(`${PROXY}/api/ifr/supply`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(supplyBody),
  }));
  await page.route(`${PROXY}/api/ifr/balances`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(Object.assign({ balances, ifrLock: { unlockedFormatted: 0 } }, extra || {})),
  }));
}
async function answerProxyFull(page) {
  await answerProxyWith(page, { totalSupply: 996687518.33, burned: 3312481.67 }, FULL_BALANCES);
}

test("distribution shows a black dead segment, splits CommitmentVault without double count, and live supply", async ({ page }) => {
  await blockNetwork(page);
  await answerProxyFull(page);
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  const dead = page.locator('[data-dist-cat="dead"]');
  await expect(dead).toBeVisible({ timeout: 20000 });
  await expect(dead).toContainText("Permanently Lost (dead, not burned)");
  await expect(dead.locator("[data-dist-swatch]")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  const deadValue = Number(await dead.getAttribute("data-dist-value"));
  const commit = Number(await page.locator('[data-dist-cat="commitmentLocked"]').getAttribute("data-dist-value"));
  expect(deadValue).toBeCloseTo(27153013.06, 2); // 26,418,467.99 CV-01 + 734,545.07 FeeRouterV1 (block 26124660)
  expect(commit).toBeCloseTo(1377067.92, 2);    // 27,795,535.92 vault balance − CV-01: time tranches only
  expect(commit + 26418467.99).toBeCloseTo(27795535.92, 1); // dead CV-01 part + live part = vault balance
  await expect(page.locator('[data-live-key="live-supply-stat"]').first()).toHaveText("969.5M");
  await expect(page.locator("#donut-live-supply")).toHaveText("Live 969.5M");
});

test("live supply never renders 0 when the supply read fails", async ({ page }) => {
  await blockNetwork(page);
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  await expect(page.locator(".live-updated-at").first()).toHaveText("Connection failed", { timeout: 20000 });
  await expect(page.locator("#donut-live-supply")).not.toHaveText(/^Live 0/);
  await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("27.2M");
});

test("a slice smaller than the segment gap does not paint the whole ring", async ({ page }) => {
  await blockNetwork(page);
  await answerProxyFull(page); // CommitmentVault time tranches are only ~0.14% of genesis
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  await expect(page.locator('[data-dist-cat="dead"]')).toBeVisible({ timeout: 20000 });
  const amberShare = await page.evaluate(() => {
    const c = document.getElementById("dist-donut"); const x = c.getContext("2d");
    const r = c.width / 2 - 10, cx = c.width / 2, cy = c.height / 2; let amber = 0, n = 0;
    for (let a = 0; a < 360; a += 2) {
      const t = (a * Math.PI) / 180, px = x.getImageData(cx + Math.cos(t) * r * 0.8, cy + Math.sin(t) * r * 0.8, 1, 1).data;
      n++; if (px[0] === 251 && px[1] === 191 && px[2] === 36) amber++;
    }
    return amber / n;
  });
  expect(amberShare).toBeLessThan(0.05);
});

test("segments sum to genesis; circulating remainder is neutral and distinct from the black dead segment", async ({ page }) => {
  await blockNetwork(page);
  await answerProxyFull(page);
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  await expect(page.locator('[data-dist-cat="rest"]')).toBeVisible({ timeout: 20000 });
  const values = await page.$$eval("[data-dist-cat]", (els) => els.map((e) => Number(e.getAttribute("data-dist-value"))));
  expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1000000000, 0); // burned + holdings + dead + rest = genesis
  await expect(page.locator('[data-dist-cat="rest"] [data-dist-swatch]')).toHaveCSS("background-color", "rgb(214, 207, 196)");
  await expect(page.locator('[data-dist-cat="rest"]')).toContainText("Wallets & DEX pool (circulating)");
});

test("mobile: the distribution donut with the dead segment stays visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await blockNetwork(page);
  await answerProxyFull(page);
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  await expect(page.locator('[data-dist-cat="dead"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#dist-donut")).toBeVisible();
  const box = await page.locator("#dist-donut").boundingBox();
  expect(box.width).toBeGreaterThan(200);
});

// T-217 follow-up: a failed or unavailable read must render N/A, never 0, and the chart must not show
// wrong proportions when some inputs are missing.
test("unavailable balances render N/A, not 0, and the chart shows a partially unavailable state", async ({ page }) => {
  await blockNetwork(page);
  const partial = Object.assign({}, FULL_BALANCES, {
    Vesting: { raw: null, formatted: null, error: "unavailable" },
    LendingVault: { raw: null, formatted: null, error: "unavailable" },
  });
  delete partial.PartnerVault; // missing entry
  await answerProxyWith(page, { totalSupply: 996687518.33, burned: 3312481.67 }, partial, { incomplete: true, unavailable: ["Vesting", "LendingVault"] });
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  const rest = page.locator('[data-dist-cat="rest"]');
  await expect(rest).toHaveAttribute("data-dist-state", "unavailable", { timeout: 20000 });
  await expect(rest).toContainText("N/A");
  await expect(rest.locator("[data-dist-swatch]")).toHaveCSS("background-color", "rgb(82, 82, 91)");
  for (const key of ["vesting", "partner", "lendingAvailable"]) {
    const row = page.locator(`[data-dist-cat="${key}"]`);
    await expect(row).toContainText("N/A");
    await expect(row).toHaveAttribute("data-dist-value", "");
  }
  await expect(page.locator('[data-live-key="protocol-locked"]').first()).toHaveText("N/A");
  await expect(page.locator('[data-live-key="lending-available-stat"]').first()).toHaveText("N/A");
  await expect(page.locator('[data-live-key="card-vesting"]').first()).not.toHaveText(/^0/);
  await expect(page.locator(".live-status").first()).toContainText("Partially live");
  // Dead segment and live supply still use the exact values that are available.
  expect(Number(await page.locator('[data-dist-cat="dead"]').getAttribute("data-dist-value"))).toBeCloseTo(27153013.06, 2);
  await expect(page.locator("#donut-live-supply")).toHaveText("Live 969.5M");
});

test("supply endpoint fields permanentlyLostRaw/liveSupplyRaw are used when the balances read lacks FeeRouterV1", async ({ page }) => {
  await blockNetwork(page);
  const noFee = Object.assign({}, FULL_BALANCES);
  delete noFee.FeeRouterV1;
  await answerProxyWith(page, {
    totalSupply: 996687518.33, burned: 3312481.67,
    permanentlyLostRaw: "27218467994338353", liveSupplyRaw: "969469050335661647",
  }, noFee);
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  await expect(page.locator('[data-dist-cat="dead"]')).toBeVisible({ timeout: 20000 });
  expect(Number(await page.locator('[data-dist-cat="dead"]').getAttribute("data-dist-value"))).toBeCloseTo(27218467.99, 2);
  await expect(page.locator("#donut-live-supply")).toHaveText("Live 969.5M");
  await expect(page.locator('[data-lost-ifr-value]')).toHaveText("27,218,467.99 IFR");
});

// Codex review (#170): a CommitmentVault read that completes after the live distribution refresh re-renders
// the metrics; it must not reset the live "Permanently Lost" value to the verified baseline. Card, ledger,
// metric and donut must keep agreeing on the live FeeRouterV1 amount in both arrival orders.
const RPC = "https://ethereum-rpc.publicnode.com";
const CV_V1 = "0x0719d9eb28df7f5e63f91fac4bbb2d579c4f73d3";
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
async function answerCommitmentVaultRpc(page, delayMs) {
  await page.route(RPC, async (route) => {
    let body;
    try { body = JSON.parse(route.request().postData() || "null"); } catch { body = null; }
    const answer = (req) => {
      const call = req && req.method === "eth_call" && req.params && req.params[0];
      const to = call && String(call.to || "").toLowerCase();
      const data = call && String(call.data || call.input || "");
      if (to === CV_V1 && data.startsWith("0x56891412")) return { jsonrpc: "2.0", id: req.id, result: word("27795535918948719") }; // totalLocked()
      if (to === CV_V1 && data.startsWith("0x9ae697bf")) return { jsonrpc: "2.0", id: req.id, result: word("20156940952845656") }; // lockedBalance(C2)
      if (to === CV_V1 && data.startsWith("0x49cfece1")) return { jsonrpc: "2.0", id: req.id, result: word(10) };                 // getTrancheCount(C2)
      if (req && req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: "0x1" };
      // The chain-pinned FallbackProvider (wallet-core getReadProvider, #193) also polls the block number.
      if (req && req.method === "eth_blockNumber") return { jsonrpc: "2.0", id: req.id, result: "0x18e5d89" };
      return { jsonrpc: "2.0", id: req && req.id, error: { code: -32000, message: "not mocked" } };
    };
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const result = Array.isArray(body) ? body.map(answer) : answer(body);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
  });
}
for (const [label, delayMs] of [["completes after the live refresh", 2500], ["completes immediately", 0]]) {
  test(`a CommitmentVault read that ${label} keeps the live lost-IFR value everywhere`, async ({ page }) => {
    test.setTimeout(120000);
    await page.route(/^https?:\/\/(?!localhost|ethereum-rpc\.publicnode\.com)/, (route) => route.abort());
    const balances = Object.assign({}, FULL_BALANCES, { FeeRouterV1: { raw: "800000000000000", formatted: 800000 } });
    await answerProxyWith(page, { totalSupply: 996687518.33, burned: 3312481.67 }, balances);
    await answerCommitmentVaultRpc(page, delayMs);
    await page.goto("/");
    await page.locator("#onchain-transparency").scrollIntoViewIfNeeded();
    await expect(lostCard(page)).toHaveAttribute("data-state", "live", { timeout: 60000 });
    // The CommitmentVault read has completed once its transparency card is live.
    await expect(page.locator('[data-transparency-metric="commitment"]')).toHaveAttribute("data-state", "live", { timeout: 60000 });
    await expect(lostCard(page).locator("[data-lost-ifr-value]")).toHaveText("27,218,467.99 IFR");
    await expect(page.locator("[data-lost-ifr-ledger]")).toHaveText("27.2M IFR");
    await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("27.2M");
    await page.locator("#live-distribution").scrollIntoViewIfNeeded();
    expect(Number(await page.locator('[data-dist-cat="dead"]').getAttribute("data-dist-value"))).toBeCloseTo(27218467.99, 2);
  });
}
