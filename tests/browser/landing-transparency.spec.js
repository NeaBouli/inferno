// @ts-check
// T-158 / CWA-71: the Landing "On-Chain Transparent" cards must render only
// live Mainnet reads from the shared live snapshot and fail closed.
// All network access is intercepted: RPC and copilot-api answers below are
// explicit test fixtures used to verify the mapping, never current chain facts.
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

const RPC_URL = "https://ethereum-rpc.publicnode.com/";
const PROXY = "https://copilot-api.ifrunit.tech";
const VESTING = "0x2694bc84e8d5251e9e4ecd4b2ae3f866d6106271";
const COMMITMENT_VAULT = "0x0719d9eb28df7f5e63f91fac4bbb2d579c4f73d3";
const HISTORICAL_VALUES = ["150M IFR", "2.429M", "48.0M"];
const CARDS = ["vesting", "burned", "commitment"];

// The Landing is a large page; allow slower CI hosts without loosening any assertion.
test.describe.configure({ timeout: 60000 });

const coder = ethers.AbiCoder.defaultAbiCoder();
const selector = (signature) => ethers.id(signature).slice(0, 10);
const ZERO_WORD = coder.encode(["uint256"], [0n]);

function fixtureCalls({ allocation, vested, released, schedule, totalLocked }) {
  return {
    [`${VESTING}:${selector("totalAllocation()")}`]: coder.encode(["uint256"], [allocation]),
    [`${VESTING}:${selector("vestedAmount()")}`]: coder.encode(["uint256"], [vested]),
    [`${VESTING}:${selector("released()")}`]: coder.encode(["uint256"], [released]),
    [`${VESTING}:${selector("vestingSchedule()")}`]: coder.encode(["uint256", "uint256", "uint256"], schedule),
    [`${COMMITMENT_VAULT}:${selector("totalLocked()")}`]: coder.encode(["uint256"], [totalLocked]),
  };
}

function answerRpc(calls) {
  return async (route) => {
    const body = route.request().postDataJSON();
    const one = (req) => {
      if (req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: "0x1" };
      if (req.method === "eth_call") {
        const tx = req.params[0];
        const key = `${String(tx.to).toLowerCase()}:${String(tx.data).slice(0, 10)}`;
        return { jsonrpc: "2.0", id: req.id, result: calls[key] || ZERO_WORD };
      }
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "not mocked" } };
    };
    const payload = Array.isArray(body) ? body.map(one) : one(body);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  };
}

const LIVE_FIXTURE = fixtureCalls({
  allocation: 150_000_000n * 10n ** 9n,
  vested: 0n,
  released: 0n,
  schedule: [1772670647n, 31536000n, 126144000n],
  totalLocked: 47_952_476_871_794_375n,
});

async function blockNetwork(page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
}

async function answerProxy(page) {
  await page.route(`${PROXY}/api/ifr/supply`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ totalSupply: 996694237.626, burned: 3305762.374 }),
  }));
  await page.route(`${PROXY}/api/ifr/balances`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ balances: {} }),
  }));
}

async function openTransparency(page) {
  await page.goto("/");
  const section = page.locator("#onchain-transparency");
  await section.scrollIntoViewIfNeeded();
  return section;
}

const card = (page, key) => page.locator(`[data-transparency-metric="${key}"]`);

async function expectNoNumbers(page) {
  for (const key of CARDS) {
    const value = await card(page, key).locator("[data-transparency-value]").textContent();
    expect(value, `${key} value must not show a number`).not.toMatch(/\d/);
  }
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("static markup carries no hardcoded current values", async ({ page }) => {
    await blockNetwork(page);
    await page.goto("/");
    const html = await page.locator("#onchain-transparency").innerHTML();
    for (const value of HISTORICAL_VALUES) expect(html).not.toContain(value);
    for (const key of CARDS) {
      await expect(card(page, key)).toHaveAttribute("data-state", "loading");
    }
    await expectNoNumbers(page);
  });
});

test("cards render live fixture reads with precise labels and last-updated time", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(LIVE_FIXTURE));
  await openTransparency(page);

  for (const key of CARDS) await expect(card(page, key)).toHaveAttribute("data-state", "live");
  await expect(card(page, "vesting").locator("[data-transparency-value]")).toHaveText("150.000M IFR");
  await expect(card(page, "vesting")).toContainText("Team Vesting");
  await expect(card(page, "vesting")).toContainText("Unvested");
  await expect(card(page, "vesting")).toContainText("cliff ends 2027-03-05");
  await expect(card(page, "burned").locator("[data-transparency-value]")).toHaveText("3.3M IFR");
  await expect(card(page, "commitment").locator("[data-transparency-value]")).toHaveText("47.952M IFR");
  for (const key of CARDS) {
    await expect(card(page, key).locator("[data-transparency-status]")).toHaveText(/^Live — updated \d{2}:\d{2}:\d{2}$/);
    await expect(card(page, key)).toHaveAttribute("aria-busy", "false");
  }
});

test("bigint formatting never rounds up through Number", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(fixtureCalls({
    allocation: 150_000_000n * 10n ** 9n,
    vested: 149_999_999_999_999_999n,
    released: 0n,
    schedule: [1772670647n, 31536000n, 126144000n],
    totalLocked: 999_999_999_999_999_999n,
  })));
  await openTransparency(page);
  await expect(card(page, "commitment").locator("[data-transparency-value]")).toHaveText("999.999M IFR");
  await expect(card(page, "vesting").locator("[data-transparency-value]")).toHaveText("0 IFR");
});

test("failed reads fail closed to unavailable without any number", async ({ page }) => {
  await blockNetwork(page);
  await openTransparency(page);
  for (const key of CARDS) {
    await expect(card(page, key)).toHaveAttribute("data-state", "unavailable", { timeout: 20000 });
    await expect(card(page, key).locator("[data-transparency-status]")).toContainText("no successful read yet");
  }
  await expectNoNumbers(page);
});

test("every unavailable render carries its explanatory status in the same mutation", async ({ page }) => {
  await page.addInitScript(() => {
    window.__unavailableRenders = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (!target.hasAttribute("data-transparency-metric") || target.getAttribute("data-state") !== "unavailable") continue;
        window.__unavailableRenders.push(target.querySelector("[data-transparency-status]").textContent);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
  });
  await blockNetwork(page);
  await openTransparency(page);
  for (const key of CARDS) await expect(card(page, key)).toHaveAttribute("data-state", "unavailable", { timeout: 20000 });
  const renders = await page.evaluate(() => window.__unavailableRenders);
  expect(renders.length).toBeGreaterThanOrEqual(CARDS.length);
  for (const status of renders) expect(status).toMatch(/^Unavailable — Mainnet read failed; no successful read yet$/);
});

// T-158f: the hidden legacy hero canvas loop kept rendering and starved the renderer.
test("hidden hero animation schedules no frames and resumes once the hero is shown", async ({ page }) => {
  await page.addInitScript(() => {
    window.__heroFrames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { if (cb.name === "loop") window.__heroFrames += 1; return raf(cb); };
  });
  await blockNetwork(page);
  await openTransparency(page);
  await page.evaluate(() => document.fonts.ready);
  // Hero loop frame requests during `frames` frames of our own rAF chain.
  const heroFramesDuring = (frames) => page.evaluate((n) => new Promise((resolve) => {
    const start = window.__heroFrames;
    let left = n;
    const tick = () => { if (--left === 0) resolve(window.__heroFrames - start); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), frames);

  await expect(page.locator("#legacy-hero")).toBeHidden();
  expect(await heroFramesDuring(10)).toBe(0);
  await page.addStyleTag({ content: ".legacy-hero { display: block !important; }" });
  await page.locator("#legacy-hero").scrollIntoViewIfNeeded();
  await expect.poll(() => heroFramesDuring(5)).toBeGreaterThan(0);
});

test("a failed refresh after a live read hides the previous value", async ({ page }) => {
  await page.clock.install();
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(LIVE_FIXTURE));
  await openTransparency(page);
  for (const key of CARDS) await expect(card(page, key)).toHaveAttribute("data-state", "live");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await blockNetwork(page);
  await page.clock.fastForward(61000);
  await page.clock.fastForward(20000);
  for (const key of CARDS) {
    await expect(card(page, key)).toHaveAttribute("data-state", "unavailable");
    await expect(card(page, key).locator("[data-transparency-status]")).toContainText("last successful read");
  }
  await expectNoNumbers(page);
});

test("visibility return after a missed refresh shows stale, not the old value", async ({ page }) => {
  await page.clock.install();
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(LIVE_FIXTURE));
  await openTransparency(page);
  for (const key of CARDS) await expect(card(page, key)).toHaveAttribute("data-state", "live");

  // Simulate a throttled background tab: wall time jumps, no timer fired, reads now hang.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route(/^https?:\/\/(?!localhost)/, () => {});
  await page.clock.setSystemTime(Date.now() + 200000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  for (const key of CARDS) {
    await expect(card(page, key)).toHaveAttribute("data-state", "stale");
    await expect(card(page, key).locator("[data-transparency-status]")).toContainText("Stale");
  }
  await expectNoNumbers(page);
});
