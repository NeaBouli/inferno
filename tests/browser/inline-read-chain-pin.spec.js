// @ts-check
// T-224 (T-212a follow-up): every page-level inline Mainnet reader must use wallet-core's
// chain-pinned read provider. An endpoint that does not answer eth_chainId 0x1 must never
// receive a data request, and no live value may render from it. All RPC answers below are
// explicit fixtures, never current chain facts; every other external request is aborted.
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

test.describe.configure({ timeout: 90000 });

const RPC_HOSTS = /^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1rpc\.io)\//;
const coder = ethers.AbiCoder.defaultAbiCoder();
const sel = (signature) => ethers.id(signature).slice(0, 10);
const word = (v) => coder.encode(["uint256"], [v]);

const CV = "0x0719d9eb28df7f5e63f91fac4bbb2d579c4f73d3";
const LV = "0x974305ab0ec905172e697271c3d7d385194eb9df";
const BOOTSTRAP = "0xf72565c4cdb9575c9d3aee6b9ae3fdbd7f56e141";
const PAIR = "0xbe495e9c0d8cc2dcf95570cf95b63c4844df31a0";
const IFR = "0x77e99917eca8539c62f509ed1193ac36580a6e7b";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

const CALLS = {
  [`${CV}:${sel("totalLocked()")}`]: word(47_952_476_871_794_375n),
  [`${LV}:${sel("totalAvailable()")}`]: word(1_234_500_000_000n),
  [`${LV}:${sel("totalLent()")}`]: word(0n),
  [`${LV}:${sel("getInterestRate()")}`]: word(200n),
  [`${LV}:${sel("ifrPriceWei()")}`]: word(0n),
  [`${LV}:${sel("getOfferCount()")}`]: word(0n),
  [`${LV}:${sel("getLoanCount()")}`]: word(0n),
  [`${BOOTSTRAP}:${sel("getBootstrapStatus()")}`]: coder.encode(
    ["bool", "bool", "uint256", "uint256", "uint256"], [true, true, 2n * 10n ** 18n, 0n, 7n]),
  [`${BOOTSTRAP}:${sel("totalETHRaised()")}`]: word(2n * 10n ** 18n),
  [`${PAIR}:${sel("getReserves()")}`]: coder.encode(["uint112", "uint112", "uint32"], [18_740_426n * 10n ** 9n, 3n * 10n ** 17n, 0n]),
  [`${PAIR}:${sel("token0()")}`]: coder.encode(["address"], [IFR]),
};

const BLOCK = {
  number: "0x100", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), nonce: "0x0000000000000000",
  sha3Uncles: "0x" + "00".repeat(32), logsBloom: "0x" + "00".repeat(256), transactionsRoot: "0x" + "00".repeat(32),
  stateRoot: "0x" + "00".repeat(32), receiptsRoot: "0x" + "00".repeat(32), miner: WETH, difficulty: "0x0",
  totalDifficulty: "0x0", extraData: "0x", size: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0",
  timestamp: "0x6a000000", baseFeePerGas: "0x1", transactions: [], uncles: [],
};

/** Routes the three wallet-core endpoints; records every JSON-RPC method sent to them. */
async function mockRpc(page, chainId) {
  const methods = [];
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route(RPC_HOSTS, async (route) => {
    const body = route.request().postDataJSON();
    const one = (req) => {
      methods.push(req.method);
      if (req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: chainId };
      if (req.method === "eth_blockNumber") return { jsonrpc: "2.0", id: req.id, result: "0x100" };
      if (req.method === "eth_getBlockByNumber") return { jsonrpc: "2.0", id: req.id, result: BLOCK };
      if (req.method === "eth_call") {
        const tx = req.params[0];
        const key = `${String(tx.to).toLowerCase()}:${String(tx.data).slice(0, 10)}`;
        return { jsonrpc: "2.0", id: req.id, result: CALLS[key] || word(0n) };
      }
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "not mocked" } };
    };
    const payload = Array.isArray(body) ? body.map(one) : one(body);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
  return methods;
}

/** Wrong chain: wallet-core rejects every endpoint and shows its unavailable notice. */
async function expectNoDataReads(page, methods) {
  await expect(page.locator("#ifr-rpc-error")).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  expect(methods.length, "the chain check must have been attempted").toBeGreaterThan(0);
  expect([...new Set(methods)], "a wrong-chain endpoint must receive nothing but eth_chainId").toEqual(["eth_chainId"]);
}

const card = (page, key) => page.locator(`[data-transparency-metric="${key}"]`);

test.describe("wrong-chain endpoint (0x5) yields no data reads and no live values", () => {
  test("landing CommitmentVault reader", async ({ page }) => {
    const methods = await mockRpc(page, "0x5");
    await page.goto("/");
    await card(page, "commitment").scrollIntoViewIfNeeded();
    await expectNoDataReads(page, methods);
    await expect(card(page, "commitment")).toHaveAttribute("data-state", "unavailable", { timeout: 30000 });
    expect(await card(page, "commitment").locator("[data-transparency-value]").textContent()).not.toMatch(/\d/);
  });

  test("bootstrap public stats and totalETHRaised readers", async ({ page }) => {
    const methods = await mockRpc(page, "0x5");
    await page.goto("/wiki/bootstrap.html");
    await expectNoDataReads(page, methods);
    await expect(page.locator("#bw-total-eth")).not.toHaveText(/2\.0000 ETH/);
    await expect(page.locator("#bw-contributors")).not.toHaveText("7");
  });

  test("bootstrap vote contribution reader (connected wallet path)", async ({ page }) => {
    const methods = await mockRpc(page, "0x5");
    await page.goto("/wiki/bootstrap.html");
    await expectNoDataReads(page, methods);
    // The contribution read itself must also refuse a wrong-chain endpoint.
    const result = await page.evaluate(async () => {
      const p = window.IFRWallet.getReadProvider();
      const c = new window.ethers.Contract("0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141",
        ["function contributions(address) view returns (uint256)"], p);
      try { await c.contributions("0x0000000000000000000000000000000000000001"); return "read"; } catch (e) { return "refused"; }
    });
    expect(result).toBe("refused");
    expect([...new Set(methods)]).toEqual(["eth_chainId"]);
  });

  test("transparency vault reader", async ({ page }) => {
    const methods = await mockRpc(page, "0x5");
    await page.goto("/wiki/transparency.html");
    await expectNoDataReads(page, methods);
    await expect(page.locator("#cur-commitment")).not.toContainText("IFR locked");
  });

  test("LendingVault page market reader (no wallet)", async ({ page }) => {
    const methods = await mockRpc(page, "0x5");
    await page.goto("/wiki/lending-vault.html");
    await expectNoDataReads(page, methods);
    await expect(page.locator("#lv-total-available")).not.toContainText("1,234");
  });

  test("lending market on-chain reader", async ({ page }) => {
    const warnings = [];
    page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
    const methods = await mockRpc(page, "0x5");
    await page.goto("/wiki/lending-market.html");
    await expectNoDataReads(page, methods);
    await expect.poll(() => warnings.some((w) => w.includes("Direct LendingVault read failed"))).toBe(true);
  });

  test("CV-01 compensation live-conditions reader", async ({ page }) => {
    const methods = await mockRpc(page, "0x5");
    await page.goto("/wiki/commitment-vault-compensation.html");
    await expectNoDataReads(page, methods);
    await expect(page.locator("#cv01-live")).toContainText("unavailable", { timeout: 30000 });
    await expect(page.locator("#cv01-live")).not.toContainText("Live at block");
  });
});

test.describe("Mainnet endpoint (0x1) renders the live fixture state", () => {
  test("landing CommitmentVault reader", async ({ page }) => {
    await mockRpc(page, "0x1");
    await page.goto("/");
    await card(page, "commitment").scrollIntoViewIfNeeded();
    await expect(card(page, "commitment").locator("[data-transparency-value]")).toHaveText("47.952M IFR", { timeout: 30000 });
  });

  test("bootstrap public stats reader", async ({ page }) => {
    const methods = await mockRpc(page, "0x1");
    await page.goto("/wiki/bootstrap.html");
    await expect(page.locator("#bw-total-eth")).toHaveText("2.0000 ETH", { timeout: 30000 });
    await expect(page.locator("#bw-contributors")).toHaveText("7");
    expect(methods).toContain("eth_call");
  });

  test("transparency vault reader", async ({ page }) => {
    await mockRpc(page, "0x1");
    await page.goto("/wiki/transparency.html");
    await expect(page.locator("#cur-commitment")).toContainText("47,952,477 IFR locked", { timeout: 30000 });
  });

  test("LendingVault page market reader (no wallet)", async ({ page }) => {
    await mockRpc(page, "0x1");
    await page.goto("/wiki/lending-vault.html");
    await expect(page.locator("#lv-total-available")).toContainText("1,234", { timeout: 30000 });
  });

  test("lending market on-chain reader", async ({ page }) => {
    const warnings = [];
    page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
    const methods = await mockRpc(page, "0x1");
    await page.goto("/wiki/lending-market.html");
    await expect.poll(() => methods.filter((m) => m === "eth_call").length, { timeout: 30000 }).toBeGreaterThanOrEqual(6);
    await page.waitForTimeout(1500);
    expect(warnings.some((w) => w.includes("Direct LendingVault read failed"))).toBe(false);
  });

  test("CV-01 compensation live-conditions reader", async ({ page }) => {
    await mockRpc(page, "0x1");
    await page.goto("/wiki/commitment-vault-compensation.html");
    await expect(page.locator("#cv01-live")).toContainText("Live at block 256", { timeout: 30000 });
  });
});

// Codex review of #193: after wallet connection the LendingVault reads must still use the
// chain-pinned read provider, including after the wallet switches chain post-connection.
test.describe("LendingVault reads ignore the connected wallet provider", () => {
  test("wallet connected, then switched to 0x5: no eth_call via the wallet, values stay from the pinned provider", async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      const FAKE = "0x" + (999999n * 10n ** 9n * 1000n).toString(16).padStart(64, "0");
      window.__walletChain = "0x1";
      window.__walletReads = [];
      const listeners = {};
      window.ethereum = {
        isMetaMask: true,
        on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        removeListener() {},
        async request({ method, params }) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return ["0x00000000000000000000000000000000000000a1"];
          if (method === "eth_chainId") return window.__walletChain;
          if (method === "net_version") return String(parseInt(window.__walletChain, 16));
          if (method === "eth_blockNumber") return "0x100";
          window.__walletReads.push(method + ":" + String((params && params[0] && params[0].to) || "").toLowerCase() + ":" + String((params && params[0] && params[0].data) || "").slice(0, 10));
          if (method === "eth_call") return FAKE;
          if (method === "eth_getBalance") return "0x0";
          return null;
        },
      };
    });
    await mockRpc(page, "0x1");
    await page.goto("/wiki/lending-vault.html");
    await expect(page.locator("#lv-total-available")).toContainText("1,234", { timeout: 30000 });

    await page.locator("#lv-connect-btn").click();
    await expect(page.locator("#lv-address")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#lv-total-available")).toContainText("1,234");

    // The wallet switches to Goerli after adoption; the 60 s market refresh must still read Mainnet via the pinned provider.
    await page.evaluate(() => { window.__walletChain = "0x5"; });
    await page.clock.runFor(61000);
    await page.waitForTimeout(1500);
    await expect(page.locator("#lv-total-available")).toContainText("1,234");
    await expect(page.locator("#lv-total-available")).not.toContainText("999");

    const walletReads = await page.evaluate(() => window.__walletReads);
    // Shared wallet-core widgets may still read through the wallet; this regression is about LendingVault page reads.
    expect(walletReads.filter((m) => m.startsWith(`eth_call:${LV}:`)),
      "no LendingVault read may go through the connected wallet provider").toEqual([]);
  });
});
