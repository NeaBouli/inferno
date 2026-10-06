// @ts-check
// T-271: LendingVault V1 is retired (owner decision, 3 October 2026). The wiki pages must never
// send a borrow, approve or create/increase-offer transaction, even when the read ifrPriceWei is
// non-zero, and existing lenders must be able to withdraw the full available amount of an offer.
// All RPC answers below are explicit fixtures, never current chain facts; every other external
// request is aborted.
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

test.describe.configure({ timeout: 90000 });

const RPC_HOSTS = /^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1rpc\.io)\//;
const coder = ethers.AbiCoder.defaultAbiCoder();
const sel = (signature) => ethers.id(signature).slice(0, 10);
const word = (v) => coder.encode(["uint256"], [v]);

const LV = "0x974305ab0ec905172e697271c3d7d385194eb9df";
const IFR = "0x77e99917eca8539c62f509ed1193ac36580a6e7b";
const LENDER = "0x00000000000000000000000000000000000000a1";
const OTHER_LENDER = "0x00000000000000000000000000000000000000b2";
// Deliberately not a whole-IFR value (IFR has 9 decimals): 12,345,678.123456789 IFR.
const AVAILABLE = 12_345_678_123_456_789n;
const PRICE_WEI = 10n ** 9n; // non-zero fixture price: borrowing must still stay disabled

const offerTuple = (lender, available, active = true) => coder.encode(
  ["address", "uint256", "uint256", "bool"], [lender, available, 0n, active]);

/** Read fixtures for one scenario: the connected lender's own offer (index 0) plus one other offer. */
function buildCalls({ available = AVAILABLE, hasOffer = true, active = true } = {}) {
  return {
    ...CALLS,
    [`${LV}:${sel("hasOffer(address)")}`]: word(hasOffer ? 1n : 0n),
    [`${LV}:${sel("offers(uint256)")}`]: offerTuple(LENDER, available, active),
    [`${LV}:${sel("getOffer(uint256)")}:0`]: offerTuple(LENDER, available, active),
  };
}

const CALLS = {
  [`${LV}:${sel("totalAvailable()")}`]: word(AVAILABLE + 5_000n * 10n ** 9n),
  [`${LV}:${sel("totalLent()")}`]: word(0n),
  [`${LV}:${sel("getInterestRate()")}`]: word(200n),
  [`${LV}:${sel("ifrPriceWei()")}`]: word(PRICE_WEI),
  [`${LV}:${sel("getOfferCount()")}`]: word(2n),
  [`${LV}:${sel("getLoanCount()")}`]: word(0n),
  [`${LV}:${sel("hasOffer(address)")}`]: word(1n),
  [`${LV}:${sel("lenderOfferIndex(address)")}`]: word(0n),
  [`${LV}:${sel("offers(uint256)")}`]: offerTuple(LENDER, AVAILABLE),
  [`${LV}:${sel("getRequiredCollateral(uint256)")}`]: word(10n ** 18n),
  [`${IFR}:${sel("balanceOf(address)")}`]: word(1_000n * 10n ** 9n),
  [`${IFR}:${sel("allowance(address,address)")}`]: word(10n ** 30n),
};

function getOfferResult(calls, data) {
  const id = BigInt("0x" + String(data).slice(10, 74));
  return id === 0n ? calls[`${LV}:${sel("getOffer(uint256)")}:0`] : offerTuple(OTHER_LENDER, 5_000n * 10n ** 9n);
}

const BLOCK = {
  number: "0x100", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), nonce: "0x0000000000000000",
  sha3Uncles: "0x" + "00".repeat(32), logsBloom: "0x" + "00".repeat(256), transactionsRoot: "0x" + "00".repeat(32),
  stateRoot: "0x" + "00".repeat(32), receiptsRoot: "0x" + "00".repeat(32), miner: LENDER, difficulty: "0x0",
  totalDifficulty: "0x0", extraData: "0x", size: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0",
  timestamp: "0x6a000000", baseFeePerGas: "0x1", transactions: [], uncles: [],
};

/** Chain-pinned read endpoints answer Mainnet with the retired-vault fixtures above. */
async function mockRpc(page, scenario) {
  const calls = buildCalls(scenario);
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route(RPC_HOSTS, async (route) => {
    const body = route.request().postDataJSON();
    const one = (req) => {
      if (req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: "0x1" };
      if (req.method === "eth_blockNumber") return { jsonrpc: "2.0", id: req.id, result: "0x100" };
      if (req.method === "eth_getBlockByNumber") return { jsonrpc: "2.0", id: req.id, result: BLOCK };
      if (req.method === "eth_getBalance") return { jsonrpc: "2.0", id: req.id, result: "0xde0b6b3a7640000" };
      if (req.method === "eth_call") {
        const tx = req.params[0];
        const to = String(tx.to).toLowerCase();
        const data = String(tx.data);
        if (to === LV && data.startsWith(sel("getOffer(uint256)"))) {
          return { jsonrpc: "2.0", id: req.id, result: getOfferResult(calls, data) };
        }
        return { jsonrpc: "2.0", id: req.id, result: calls[`${to}:${data.slice(0, 10)}`] || word(0n) };
      }
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "not mocked" } };
    };
    const payload = Array.isArray(body) ? body.map(one) : one(body);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
}

/** Injected wallet that records every transaction the page tries to send. */
async function mockWallet(page) {
  await page.addInitScript((lender) => {
    window.__sentTx = [];
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeListener() {},
      async request({ method, params }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [lender];
        if (method === "eth_chainId") return "0x1";
        if (method === "net_version") return "1";
        if (method === "eth_blockNumber") return "0x100";
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_sendTransaction") {
          window.__sentTx.push(params[0]);
          return "0x" + "ab".repeat(32);
        }
        if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") return null;
        if (method === "eth_call") return "0x" + "00".repeat(32);
        return null;
      },
    };
  }, LENDER);
}

async function openConnectedVault(page, scenario = {}) {
  await mockRpc(page, scenario);
  await mockWallet(page);
  await page.goto("/wiki/lending-vault.html");
  await page.locator("#lv-connect-btn").click();
  await expect(page.locator("#lv-address")).toBeVisible({ timeout: 30000 });
  // Settled connected state: the lender state has been read (existing offer or "no offer").
  await expect(page.locator("#lv-existing-offer")).not.toHaveText("—", { timeout: 30000 });
}

const sentTx = (page) => page.evaluate(() => window.__sentTx);
async function forceClick(page, id) {
  await page.evaluate((btnId) => { const b = document.getElementById(btnId); b.disabled = false; b.click(); }, id);
}
const withdrawIface = new ethers.Interface(["function withdrawOffer(uint256 amount)"]);

test.describe("LendingVault V1 retired: wiki write paths", () => {
  test("borrow stays disabled with a non-zero ifrPriceWei, also after the handler and a market refresh", async ({ page }) => {
    await page.clock.install();
    await openConnectedVault(page);
    await page.locator('.lv-tab[data-tab="borrower"]').click();
    await expect(page.locator("#lv-borrow-retired-note")).toBeVisible();
    await expect(page.locator("#lv-borrow-retired-note")).toContainText("borrowing stays disabled regardless of the on-chain price");
    // Market data has loaded with offers and a non-zero price, yet the control stays hidden and disabled.
    await expect(page.locator("#lv-borrow-offer option").first()).toContainText("Offer #0", { timeout: 30000 });
    await expect(page.locator("#lv-borrow-btn")).toBeHidden();
    await expect(page.locator("#lv-borrow-btn")).toBeDisabled();
    await expect(page.locator("#lv-borrow-btn")).toHaveText(/Borrowing disabled/);
    await expect(page.locator("#lv-borrower-offers")).toContainText("V1 is retired");

    await page.evaluate(() => { document.getElementById("lv-borrow-amount").value = "1000"; });
    await forceClick(page, "lv-borrow-btn");
    await expect(page.locator("#lv-borrow-status")).toContainText("LendingVault V1 is retired: borrowing stays disabled.");
    // finally-path: the handler must not re-enable the control.
    await expect(page.locator("#lv-borrow-btn")).toBeDisabled();

    // refresh-path: the 60 s market refresh re-reads the non-zero price and offers; the control stays locked.
    await page.clock.runFor(61000);
    await page.waitForTimeout(1500);
    await expect(page.locator("#lv-borrow-btn")).toBeDisabled();
    await expect(page.locator("#lv-borrow-btn")).toBeHidden();
    await expect(page.locator("#lv-borrow-btn")).toHaveText(/Borrowing disabled/);
    expect(await sentTx(page)).toEqual([]);
  });

  for (const scenario of [
    { name: "increase (wallet has an active offer)", hasOffer: true },
    { name: "create (wallet has no offer)", hasOffer: false },
  ]) {
    test(`${scenario.name}: offer write stays hidden and a forced click sends nothing`, async ({ page }) => {
      await openConnectedVault(page, { hasOffer: scenario.hasOffer });
      await expect(page.locator("#lv-create-retired-note")).toBeVisible();
      await expect(page.locator("#lv-create-offer-btn")).toBeHidden();
      await expect(page.locator("#lv-create-offer-btn")).toBeDisabled();
      await expect(page.locator("#lv-lender-guide")).toBeHidden();
      await page.evaluate(() => { document.getElementById("lv-offer-amount").value = "1000"; });
      await forceClick(page, "lv-create-offer-btn");
      await expect(page.locator("#lv-offer-status")).toContainText("creating or increasing offers is disabled");
      await page.waitForTimeout(1000);
      expect(await sentTx(page)).toEqual([]);
      await expect(page.locator("#lv-create-offer-btn")).toBeDisabled();
    });
  }

  for (const fixture of [
    { label: "12,345,678.123456789 IFR", amount: AVAILABLE, input: "12345678.123456789" },
    { label: "exactly 1 IFR", amount: 1_000_000_000n, input: "1" },
    { label: "0.999999999 IFR (below 1 IFR)", amount: 999_999_999n, input: "0.999999999" },
    { label: "0.000000001 IFR (one base unit)", amount: 1n, input: "0.000000001" },
  ]) {
    test(`Use max withdraws the exact full available amount: ${fixture.label}`, async ({ page }) => {
      await openConnectedVault(page, { available: fixture.amount });
      await expect(page.locator("#lv-withdraw-max")).toBeEnabled({ timeout: 30000 });
      await page.locator("#lv-withdraw-max").click();
      await expect(page.locator("#lv-withdraw-amount")).toHaveValue(fixture.input);
      await expect(page.locator("#lv-withdraw-offer-btn")).toBeEnabled();
      await page.locator("#lv-withdraw-offer-btn").click();
      await expect.poll(() => page.evaluate(() => window.__sentTx.length), { timeout: 30000 }).toBe(1);
      const [tx] = await sentTx(page);
      expect(String(tx.to).toLowerCase()).toBe(LV);
      const decoded = withdrawIface.parseTransaction({ data: tx.data });
      expect(decoded && decoded.name).toBe("withdrawOffer");
      expect(decoded && decoded.args[0]).toBe(fixture.amount);
    });
  }

  test("withdraw above the available amount is refused without a transaction", async ({ page }) => {
    await openConnectedVault(page, { available: 999_999_999n });
    await page.locator("#lv-withdraw-amount").fill("1");
    await expect(page.locator("#lv-withdraw-offer-btn")).toBeDisabled();
    await forceClick(page, "lv-withdraw-offer-btn");
    await expect(page.locator("#lv-withdraw-status")).toContainText("Amount exceeds the offer's available, unlent IFR.");
    await page.waitForTimeout(1000);
    expect(await sentTx(page)).toEqual([]);
  });

  for (const scenario of [
    { name: "no offer", hasOffer: false, active: true },
    { name: "inactive offer", hasOffer: true, active: false },
  ]) {
    test(`withdraw without an active offer (${scenario.name}) is refused without a transaction`, async ({ page }) => {
      await openConnectedVault(page, { hasOffer: scenario.hasOffer, active: scenario.active });
      await expect(page.locator("#lv-withdraw-max")).toBeDisabled();
      await page.locator("#lv-withdraw-amount").fill("1");
      await expect(page.locator("#lv-withdraw-offer-btn")).toBeDisabled();
      await forceClick(page, "lv-withdraw-offer-btn");
      await expect(page.locator("#lv-withdraw-status")).toContainText("No active lending offer found.");
      await page.waitForTimeout(1000);
      expect(await sentTx(page)).toEqual([]);
    });
  }
});

test.describe("LendingVault V1 retired: Lending Market page", () => {
  test("no borrow call to action with a non-zero ifrPriceWei", async ({ page }) => {
    await mockRpc(page, {});
    await page.goto("/wiki/lending-market.html");
    await expect(page.locator("#retired-notice")).toBeVisible();
    await expect(page.locator("#offers-body .market-btn")).toHaveCount(2, { timeout: 30000 });
    for (const label of await page.locator("#offers-body .market-btn").allTextContents()) {
      expect(label.trim()).toBe("View");
    }
    await expect(page.locator("#offers-body")).not.toContainText("Borrow");
    // The read-only action label must be readable (white on the accent button, not accent on accent).
    const btn = page.locator("#offers-body .market-btn").first();
    const [color, background] = await btn.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    expect(color).not.toBe(background);
  });
});
