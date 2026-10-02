// @ts-check
// CV-01 compensation page: status colours follow the Council decision and the live conditions.
// red = Council pending, yellow = approved without verified TWAP evidence, green = approved with a
// published, verified 7-day TWAP record. Live spot data and RPC results must never produce green.
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

async function setPage(page, { council, evidence }) {
  await page.route("**" + PAGE, async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    if (council) html = html.replace('"council": "pending"', `"council": "${council}"`);
    if (evidence) html = html.replace('"twapEvidence": []', `"twapEvidence": ${JSON.stringify(evidence)}`);
    await route.fulfill({ response, body: html });
  });
}

const AFTER_UNLOCK = Date.parse("2026-12-01T00:00:00Z") / 1000;
const C1 = "0x4f632748460E5277bF8435259cADce440AbAC254";
const C3 = "0xf556cCe85128c93AC6A7e088cF334180F2D3905B";
const goodC1 = { wallet: C1, id: 0, startBlock: 26500000, endBlock: 26550400, endTimestamp: AFTER_UNLOCK, twapGwei: 16, verifiedBy: "test" };

async function load(page) {
  await page.goto(PAGE);
  await expect(page.locator("#cv01-rows .cv-status")).toHaveCount(11);
}

test("Council pending: every tranche is red, even with a spot spike", async ({ page }) => {
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 100000 });
  await load(page);
  await expect(page.locator("#cv01-live")).toContainText("Live at block");
  await expect(page.locator("#cv01-rows .cv-red")).toHaveCount(11);
  await expect(page.locator("#cv01-rows tr").first().locator(".cv-status")).toHaveText("Council pending");
  await expect(page.locator("#cv01-rows tr").first()).toContainText("indicative only");
});

test("Approved + spot spike without TWAP evidence: nothing is green", async ({ page }) => {
  await setPage(page, { council: "approved" });
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 100000 });  // spot far above every target
  await load(page);
  await expect(page.locator("#cv01-live")).toContainText("Live at block");
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(0);
  await expect(page.locator("#cv01-rows .cv-yellow")).toHaveCount(11);
});

test("Approved + RPC unavailable: nothing is green", async ({ page }) => {
  await setPage(page, { council: "approved" });
  await page.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.llamarpc\.com)/, (route) => route.abort());
  await load(page);
  await expect(page.locator("#cv01-live")).toContainText("unavailable");
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(0);
});

test("Approved + verified TWAP record: only that tranche is green, independent of spot and RPC", async ({ page }) => {
  await setPage(page, { council: "approved", evidence: [goodC1] });
  await page.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.llamarpc\.com)/, (route) => route.abort());
  await load(page);
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(1);
  await expect(page.locator("#cv01-rows tr").first().locator(".cv-status")).toHaveClass(/cv-green/);
});

test("Incomplete or failing TWAP records never produce green", async ({ page }) => {
  const bad = [
    { ...goodC1, twapGwei: 14 },                          // below the 15 gwei target
    { ...goodC1, endTimestamp: AFTER_UNLOCK - 86400 * 30 }, // ends before the original unlock date
    { ...goodC1, startBlock: undefined },                 // missing start block
    { ...goodC1, endBlock: 26400000 },                    // end before start
    { ...goodC1, verifiedBy: "" },                        // not verified
    { wallet: C3, id: 0, startBlock: 1, endBlock: 2, twapGwei: 10, verifiedBy: "test" }, // C3 target 1,500 gwei
  ];
  await setPage(page, { council: "approved", evidence: bad });
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 100000 });
  await load(page);
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(0);
});

test("Evidence without Council approval stays red", async ({ page }) => {
  await setPage(page, { evidence: [goodC1] });
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 16 });
  await load(page);
  await expect(page.locator("#cv01-rows .cv-red")).toHaveCount(11);
});
