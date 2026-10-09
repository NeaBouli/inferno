// @ts-check
// T-202 / CV-01 / CWA-02: the Landing must always show the permanently lost IFR. Since the CWA-02 recovery
// (tx 0x5dc641c7..., block 26143797) that is CV-01 only: a fixed on-chain amount. The IFR held by FeeRouterV1 was
// recovered to the Treasury Safe, so no FeeRouterV1 balance (live, failed or implausible) and no older API field
// that still adds it may change the figure, and it never renders 0 or "Unavailable". All network access is
// intercepted; values are fixtures pinned to Mainnet block 26151369 where stated.
const { test, expect } = require("@playwright/test");

const PROXY = "https://copilot-api.ifrunit.tech";
test.describe.configure({ timeout: 60000 });

async function blockNetwork(page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
}
async function answerProxy(page, feeRouter) {
  await page.route(`${PROXY}/api/ifr/supply`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ totalSupply: 996660371.64, burned: 3339628.36 }),
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
async function expectCv01Only(page) {
  const card = lostCard(page);
  await expect(card).toHaveAttribute("data-state", "verified");
  await expect(card.locator("[data-lost-ifr-value]")).toHaveText("26,418,467.99 IFR");
  await expect(card.locator("[data-lost-ifr-cv01]")).toHaveText("26,418,467.99");
  await expect(card.locator("[data-lost-ifr-status]")).toContainText("verified 2026-10-09 (Mainnet block 26151369)");
  await expect(card).not.toContainText("27,153,013");
  await expect(card).not.toContainText("Unavailable");
  await expect(card.locator("[data-lost-ifr-feerouter]")).toHaveCount(0);
  await expect(page.locator("[data-lost-ifr-ledger]")).toHaveText("26.4M IFR");
}

test("static markup shows CV-01 as the only permanently lost IFR, labelled as not burned", async ({ page }) => {
  await blockNetwork(page);
  await page.goto("/");
  const card = lostCard(page);
  await expect(card).toContainText("Permanently Lost IFR");
  await expect(card).toContainText("not burned");
  await expect(card).toContainText("still counted in totalSupply");
  await expect(card.locator('a[href="wiki/commitment-vault-compensation.html"]')).toHaveCount(1);
  await expect(card.locator('a[href="wiki/transparency.html#lost-ifr"]')).toHaveCount(1);
  // The recovered FeeRouterV1-held IFR is shown separately as unallocated Treasury custody, not as lost.
  const recovered = card.locator("[data-lost-ifr-recovered]");
  await expect(recovered).toContainText("Not lost");
  await expect(recovered).toContainText("734,545.07 IFR held by FeeRouterV1");
  await expect(recovered).toContainText("recovered to the Treasury Safe on 2026-10-07");
  await expect(recovered).toContainText("Unallocated Treasury IFR");
  await expect(recovered).toContainText("FeeRouterV1 holds 0 IFR");
  await expectCv01Only(page);
});

for (const [label, value] of [["non-zero", "800000000000000"], ["zero", "0"], ["missing", undefined], ["malformed", "7.2e14"], ["non-string", 734545074097400]]) {
  test(`a ${label} live FeeRouterV1 balance never changes the CV-01 figure`, async ({ page }) => {
    await blockNetwork(page);
    await answerProxy(page, value);
    await openTransparency(page);
    await expect(page.locator(".live-updated-at").first()).toContainText("Updated", { timeout: 20000 });
    await expectCv01Only(page);
    await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("26.4M");
  });
}

test("proxy failure keeps the CV-01 figure with its date, never 0", async ({ page }) => {
  await blockNetwork(page);
  await openTransparency(page);
  await expect(page.locator(".live-updated-at").first()).toHaveText("Connection failed", { timeout: 20000 });
  await expectCv01Only(page);
  await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("26.4M");
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
  await expect(page.locator(".live-updated-at").first()).toContainText("Updated", { timeout: 20000 });
  await expect(card.locator("[data-lost-ifr-value]")).toHaveText("26,418,467.99 IFR");
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// Owner decision 2026-10-03: permanently lost IFR is a black "dead" segment of the live distribution,
// removed from the CommitmentVault segment (no double count). Since the CWA-02 recovery the dead segment is CV-01
// only. Every balance label the production API returns: values from a 2026-10-03 live read, with FeeRouterV1,
// Treasury Safe (GnosisSafe), CommitmentVault and totalSupply re-pinned to Mainnet block 26151369.
const FULL_BALANCES = {
  Deployer: { raw: "248001307527159", formatted: 248001.307527159 },
  LPReserveSafe: { raw: "400600000000000000", formatted: 400600000 },
  GnosisSafe: { raw: "734545074097347", formatted: 734545.074097347 },
  CommunitySafe: { raw: "7900000000000000", formatted: 7900000 },
  Vesting: { raw: "150000000000000000", formatted: 150000000 },
  LiquidityReserve: { raw: "200000000000000000", formatted: 200000000 },
  PartnerVault: { raw: "40000000000000000", formatted: 40000000 },
  BootstrapVaultV3: { raw: "1", formatted: 1e-9 },
  BuybackVault: { raw: "0", formatted: 0 },
  BurnReserve: { raw: "0", formatted: 0 },
  FeeRouterV1: { raw: "0", formatted: 0 },
  IFRLock: { raw: "2000000000000", formatted: 2000 },
  CommitmentVault: { raw: "27786035918948719", formatted: 27786035.918948719 },
  LendingVault: { raw: "0", formatted: 0 },
};
const SUPPLY_26151369 = { totalSupply: 996660371.641431105, totalSupplyRaw: "996660371641431105", burned: 3339628.358568895 };
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
  await answerProxyWith(page, SUPPLY_26151369, FULL_BALANCES);
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
  // Numeric compact value: baseUnitsToNumber truncates raw 26418467994338353 to cents (26418467.99).
  expect(deadValue).toBeCloseTo(26418467.99, 2); // CV-01 only; FeeRouterV1 (0 IFR) is never dead
  expect(commit).toBeCloseTo(1367567.92, 2);    // 27,786,035.92 vault balance − CV-01: time tranches only
  expect(commit + 26418467.99).toBeCloseTo(27786035.92, 1); // dead CV-01 part + live part = vault balance
  // Exact base units: 996660371641431105 − 26418467994338353 = 970241903647092752 (not classified as permanently lost).
  await expect(page.locator('[data-live-key="live-supply-stat"]').first()).toHaveText("970.2M");
  await expect(page.locator("#donut-live-supply")).toHaveText("Live 970.2M");
  await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("26.4M");
});

test("live supply never renders 0 when the supply read fails", async ({ page }) => {
  await blockNetwork(page);
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  await expect(page.locator(".live-updated-at").first()).toHaveText("Connection failed", { timeout: 20000 });
  await expect(page.locator("#donut-live-supply")).not.toHaveText(/^Live 0/);
  await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("26.4M");
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
  await answerProxyWith(page, SUPPLY_26151369, partial, { incomplete: true, unavailable: ["Vesting", "LendingVault"] });
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
  // Dead segment and live supply still use the exact values that are available (CV-01 only).
  expect(Number(await page.locator('[data-dist-cat="dead"]').getAttribute("data-dist-value"))).toBeCloseTo(26418467.99, 2);
  await expect(page.locator("#donut-live-supply")).toHaveText("Live 970.2M");
});

// The still-running older supply API adds the FeeRouterV1 balance to permanentlyLostRaw/liveSupplyRaw. The Landing
// must not use those fields: even a stale or hypothetical FeeRouterV1 amount in them never reaches the lost figure.
for (const [label, feeRouter] of [["missing FeeRouterV1", null], ["non-zero FeeRouterV1", "734545074097347"]]) {
  test(`older API permanentlyLostRaw/liveSupplyRaw are ignored (${label})`, async ({ page }) => {
    await blockNetwork(page);
    const balances = Object.assign({}, FULL_BALANCES);
    if (feeRouter === null) delete balances.FeeRouterV1;
    else balances.FeeRouterV1 = { raw: feeRouter, formatted: Number(feeRouter) / 1e9 };
    await answerProxyWith(page, Object.assign({}, SUPPLY_26151369, {
      permanentlyLostRaw: "27153013068435700", liveSupplyRaw: "969507358572995405",
    }), balances);
    await page.goto("/");
    await page.locator("#live-distribution").scrollIntoViewIfNeeded();
    await expect(page.locator('[data-dist-cat="dead"]')).toBeVisible({ timeout: 20000 });
    expect(Number(await page.locator('[data-dist-cat="dead"]').getAttribute("data-dist-value"))).toBeCloseTo(26418467.99, 2);
    await expect(page.locator("#donut-live-supply")).toHaveText("Live 970.2M");
    await expect(page.locator("[data-lost-ifr-value]")).toHaveText("26,418,467.99 IFR");
    await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("26.4M");
  });
}

// Codex review (#170): a CommitmentVault read that completes after the live distribution refresh re-renders
// the metrics; card, ledger, metric and donut must keep agreeing on the CV-01-only figure in both arrival orders,
// even with a non-zero live FeeRouterV1 balance.
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
  test(`a CommitmentVault read that ${label} keeps the CV-01 lost-IFR value everywhere`, async ({ page }) => {
    test.setTimeout(120000);
    await page.route(/^https?:\/\/(?!localhost|ethereum-rpc\.publicnode\.com)/, (route) => route.abort());
    const balances = Object.assign({}, FULL_BALANCES, { FeeRouterV1: { raw: "800000000000000", formatted: 800000 } });
    await answerProxyWith(page, SUPPLY_26151369, balances);
    await answerCommitmentVaultRpc(page, delayMs);
    await page.goto("/");
    await page.locator("#onchain-transparency").scrollIntoViewIfNeeded();
    await expect(page.locator(".live-updated-at").first()).toContainText("Updated", { timeout: 60000 });
    // The CommitmentVault read has completed once its transparency card is live.
    await expect(page.locator('[data-transparency-metric="commitment"]')).toHaveAttribute("data-state", "live", { timeout: 60000 });
    await expect(lostCard(page).locator("[data-lost-ifr-value]")).toHaveText("26,418,467.99 IFR");
    await expect(page.locator("[data-lost-ifr-ledger]")).toHaveText("26.4M IFR");
    await expect(page.locator('[data-live-key="lost-ifr-stat"]')).toHaveText("26.4M");
    await page.locator("#live-distribution").scrollIntoViewIfNeeded();
    expect(Number(await page.locator('[data-dist-cat="dead"]').getAttribute("data-dist-value"))).toBeCloseTo(26418467.99, 2);
  });
}
