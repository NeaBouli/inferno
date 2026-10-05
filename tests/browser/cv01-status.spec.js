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
  await page.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1rpc\.io|eth\.llamarpc\.com)/, async (route) => {
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
const WEEK = 7 * 24 * 60 * 60;
const H1 = "0x" + "a1".repeat(32);
const H2 = "0x" + "b2".repeat(32);
const CALC = { script: "scripts/cv01-twap.cjs", commit: "0123456789abcdef0123456789abcdef01234567", artifact: "https://example.org/cv01-twap-c1-0.json" };
const goodC1 = {
  wallet: C1, id: 0, startBlock: 26500000, endBlock: 26550400, startBlockHash: H1, endBlockHash: H2,
  startTimestamp: AFTER_UNLOCK - WEEK, endTimestamp: AFTER_UNLOCK, twapGwei: 16, verifiedBy: "test", calculation: CALC,
};

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
  await page.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1rpc\.io|eth\.llamarpc\.com)/, (route) => route.abort());
  await load(page);
  await expect(page.locator("#cv01-live")).toContainText("unavailable");
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(0);
});

test("Approved + verified TWAP record: only that tranche is green, independent of spot and RPC", async ({ page }) => {
  await page.clock.setFixedTime((AFTER_UNLOCK + 3600) * 1000);  // the TWAP window has ended
  await setPage(page, { council: "approved", evidence: [goodC1] });
  await page.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1rpc\.io|eth\.llamarpc\.com)/, (route) => route.abort());
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

test("One-block, short-window or unreproducible high-price records stay yellow", async ({ page }) => {
  const bad = [
    { ...goodC1, twapGwei: 100000, startBlock: 26550399, endBlock: 26550400, startTimestamp: AFTER_UNLOCK - 12 }, // one block
    { ...goodC1, twapGwei: 100000, startTimestamp: AFTER_UNLOCK - WEEK + 3600 },  // window shorter than 7 days
    { ...goodC1, twapGwei: 100000, calculation: undefined },                       // no calculation reference
    { ...goodC1, twapGwei: 100000, calculation: { ...CALC, artifact: "" } },        // no evidence artifact
    { ...goodC1, twapGwei: 100000, calculation: { ...CALC, commit: "main" } },      // not an immutable commit
    { ...goodC1, twapGwei: 100000, endBlockHash: undefined },                      // no immutable block identifier
    { ...goodC1, twapGwei: 100000, startTimestamp: undefined },                    // no published start time
  ];
  await setPage(page, { council: "approved", evidence: bad });
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 100000 });
  await load(page);
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(0);
  await expect(page.locator("#cv01-rows .cv-yellow")).toHaveCount(11);
});

test("Approved + TWAP record ending in the future stays yellow until the window has ended", async ({ page }) => {
  await page.clock.setFixedTime((AFTER_UNLOCK - 3600) * 1000);  // one hour before the record's endTimestamp
  await setPage(page, { council: "approved", evidence: [goodC1] });
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 100000 });
  await load(page);
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(0);
  await expect(page.locator("#cv01-rows .cv-yellow")).toHaveCount(11);
});

test("Approved + completed TWAP record turns green once the controlled clock passes its end", async ({ page }) => {
  await page.clock.setFixedTime(AFTER_UNLOCK * 1000);  // exactly at endTimestamp
  await setPage(page, { council: "approved", evidence: [goodC1] });
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 1 });  // spot below target must not matter
  await load(page);
  await expect(page.locator("#cv01-rows .cv-green")).toHaveCount(1);
  await expect(page.locator("#cv01-rows tr").first().locator(".cv-status")).toHaveText("Payable (TWAP verified)");
});

test("Without JavaScript the static fallback lists every tranche from the page data", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto(PAGE);
  const html = await page.content();
  const data = JSON.parse(html.match(/<script type="application\/json" id="cv01-data">([\s\S]*?)<\/script>/)[1]);
  const rows = page.locator("#cv01-static tbody tr");
  await expect(rows).toHaveCount(data.tranches.length);
  for (let i = 0; i < data.tranches.length; i++) {
    const t = data.tranches[i];
    const cells = rows.nth(i).locator("td");
    await expect(cells.nth(0).locator("a")).toHaveAttribute("href", "https://etherscan.io/address/" + t.wallet);
    await expect(cells.nth(1)).toHaveText("#" + t.id);
    await expect(cells.nth(2)).toHaveText(t.type);
    const [whole, frac] = t.amount.split(".");
    await expect(cells.nth(3)).toHaveText(Number(whole).toLocaleString("en-US") + "." + frac);
    const target = Number(data.p0WeiPerIFR) * t.multiplier / 100 / 1e9;
    await expect(cells.nth(4)).toHaveText((t.unlock ? "after " + t.unlock + " and " : "") + "price ≥ " + target.toLocaleString("en-US") + " gwei/IFR (" + (t.multiplier / 100) + " × P0)");
  }
  await expect(page.locator("#cv01-static tfoot")).toContainText("26,418,467.994338353");
  await expect(page.locator("main")).not.toContainText("static and complete");
  await context.close();
});

test("Evidence without Council approval stays red", async ({ page }) => {
  await setPage(page, { evidence: [goodC1] });
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 16 });
  await load(page);
  await expect(page.locator("#cv01-rows .cv-red")).toHaveCount(11);
});

test("Page copy stays accurate: live time-only Web3 state, dated vault balance, compensation only proposed", async ({ page }) => {
  await mockChain(page, { timestamp: AFTER_UNLOCK, priceGwei: 1 });
  await load(page);
  const body = page.locator("main");
  await expect(body).not.toContainText("The Web3 app and the wiki offer only time-based locks");
  await expect(body).toContainText("The wiki lock form offers only time-based locks.");
  // The time-only Web3 release is live and verified (417e3478/3771e284); the page states that state, not the pre-release warning (T-263).
  await expect(body).not.toContainText("still offers price-conditioned V1 locks");
  await expect(body).not.toContainText("until that release is verified");
  await expect(body).toContainText("offers only time-based locks in CommitmentVault V2");
  await expect(body).toContainText("existing V1 tranches stay listed and unlock through V1");
  await expect(body).not.toContainText("The vault now holds");
  await expect(body).toContainText("At block 26,113,577 (3 October 2026, 18:22:23 UTC) the vault held 27,795,535.918948719 IFR");
  for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    const text = await page.locator(sel).getAttribute("content");
    expect(text).toContain("would follow");
    expect(text).toContain("not approved");
    expect(text).not.toContain("compensation from the LP Reserve Safe follows");
  }
});

test("Governance CV-01 roster names five members, G.M.'s abstention and four eligible signers", async ({ page }) => {
  await page.goto("/wiki/governance.html");
  const callout = page.locator("h3#agenda-cv-01 + p");
  await expect(callout).toContainText("The Council has five members: M.G., A.M., Y.K., A.P. and G.M.");
  await expect(callout).toContainText("G.M. abstained. The other four are eligible to sign, and 3 YES signatures from them are required.");
  await expect(callout).toContainText("Two YES signatures (M.G., Y.K.) have been received so far.");
  const row = page.locator("tr", { has: page.locator("td", { hasText: /^CV-01$/ }) });
  await expect(row).toContainText("5 Council members; G.M. abstained; 4 eligible signers (M.G., A.M., Y.K., A.P.), 3 YES required; 2 YES so far (M.G., Y.K.); not approved");
});

test("CV-01 states G.M.'s abstention neutrally, without a reason or holding reference", async ({ page }) => {
  await page.goto("/wiki/commitment-vault-compensation.html");
  await expect(page.locator("#cv01-vote + p + ul")).toContainText("G.M. abstained.");
  for (const path of ["/wiki/commitment-vault-compensation.html", "/wiki/governance.html"]) {
    await page.goto(path);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/G\.M\.[^.]*abstain[^.]*(conflict|interest|because|due to|holding|balance)/i);
  }
});

test("llms.txt does not suggest that configuring priceOracle could release V1 price tranches", async ({ request }) => {
  const text = await (await request.get("/llms.txt")).text();
  expect(text).not.toContain("fail closed while Mainnet priceOracle is the zero address");
  expect(text).toContain("can never unlock: the deployed V1 price check always reads zero, regardless of priceOracle configuration");
  expect(text).not.toContain("compensation from the LP Reserve Safe follows");
});
