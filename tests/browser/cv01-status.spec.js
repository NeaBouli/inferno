// @ts-check
// CV-01 compensation page: status colours follow the Council decision and the live conditions.
// red = Council pending, yellow = approved but conditions not met, green = approved and payable.
const { test, expect } = require("@playwright/test");

const PAGE = "/wiki/commitment-vault-compensation.html";
const TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";

function word(hex) { return hex.replace(/^0x/, "").padStart(64, "0"); }

/** Fake Mainnet JSON-RPC: block time and IFR/WETH reserves for a given spot price (gwei per IFR). */
async function mockChain(page, { timestamp, priceGwei }) {
  const reserveIFR = 18_740_426n * 10n ** 9n;                         // IFR, 9 decimals
  const reserveETH = BigInt(Math.round(18_740_426 * priceGwei)) * 10n ** 9n; // wei = IFR * gwei * 1e9
  const answer = (req) => {
    const { method, params, id } = req;
    let result;
    if (method === "eth_chainId") result = "0x1";
    else if (method === "eth_blockNumber") result = "0x18e5f0c";
    else if (method === "eth_getBlockByNumber") result = { number: "0x18e5f0c", hash: "0x" + "11".repeat(32), timestamp: "0x" + timestamp.toString(16), parentHash: "0x" + "00".repeat(32), transactions: [], gasLimit: "0x0", gasUsed: "0x0", miner: "0x" + "00".repeat(20), extraData: "0x", difficulty: "0x0", nonce: "0x0000000000000000", baseFeePerGas: "0x0" };
    else if (method === "eth_call") {
      const data = params[0].data.slice(0, 10);
      if (data === "0x0dfe1681") result = "0x" + word(TOKEN.toLowerCase());                        // token0()
      else if (data === "0x0902f1ac") result = "0x" + word(reserveIFR.toString(16)) + word(reserveETH.toString(16)) + word("1"); // getReserves()
      else result = "0x";
    }
    return { jsonrpc: "2.0", id, result };
  };
  await page.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.llamarpc\.com)/, async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const out = Array.isArray(body) ? body.map(answer) : answer(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
}

async function setCouncil(page, council) {
  await page.route("**" + PAGE, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace('"council": "pending"', `"council": "${council}"`);
    await route.fulfill({ response, body: html });
  });
}

const AFTER_UNLOCK = Date.parse("2026-12-01T00:00:00Z") / 1000;
const BEFORE_UNLOCK = Date.parse("2026-10-02T00:00:00Z") / 1000;

test("Council pending: every tranche is red", async ({ page }) => {
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 16 });
  await page.goto(PAGE);
  await expect(page.locator("#cv01-live")).toContainText("Live at block");
  await expect(page.locator("#cv01-rows .cv-status")).toHaveCount(11);
  await expect(page.locator("#cv01-rows .cv-red")).toHaveCount(11);
  await expect(page.locator("#cv01-rows tr").first().locator(".cv-status")).toHaveText("Conditions met — Council pending");
});

test("Approved: met tranches are green, unmet tranches yellow", async ({ page }) => {
  await setCouncil(page, "approved");
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 16 });   // C1: after 2026-11-29 and >= 15 gwei
  await page.goto(PAGE);
  await expect(page.locator("#cv01-live")).toContainText("Live at block");
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(1);   // C1 #0
  await expect(page.locator("#cv01-rows .cv-yellow")).toHaveCount(10); // C3 needs 1,500 gwei
});

test("Approved but before the unlock date: C1 stays yellow", async ({ page }) => {
  await setCouncil(page, "approved");
  await mockChain(page, { timestamp: BEFORE_UNLOCK, priceGwei: 2000 });
  await page.goto(PAGE);
  await expect(page.locator("#cv01-live")).toContainText("Live at block");
  await expect(page.locator("#cv01-rows tr").first().locator(".cv-status")).toHaveClass(/cv-yellow/);
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(10);  // C3: price-only, 2,000 >= 1,500 gwei
});

test("RPC unavailable: no green status is ever shown", async ({ page }) => {
  await setCouncil(page, "approved");
  await page.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.llamarpc\.com)/, (route) => route.abort());
  await page.goto(PAGE);
  await expect(page.locator("#cv01-live")).toContainText("unavailable");
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(0);
});
