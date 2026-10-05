// @ts-check
// T-279: Landing distribution legend, token flow and DOCS button.
// - BurnReserve never shows "not yet active"; at 0 IFR it states that no buyback has executed yet.
// - The legacy BuybackVault is absent from the legend, the wallet cards and the token flow.
// - Token-flow values are live reads that fail closed to "unavailable".
// - The Dante quote carries a DOCS button to the Wiki start page.
// All network access is intercepted: the RPC and copilot-api answers are test fixtures, not chain facts.
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

test.describe.configure({ timeout: 60000 });

const RPC_URL = "https://ethereum-rpc.publicnode.com/";
const PROXY = "https://copilot-api.ifrunit.tech";
const TOKEN = "0x77e99917eca8539c62f509ed1193ac36580a6e7b";
const FEE_ROUTER = "0x4807b77b2e25cd055da42b09ba4d0af9e580c60a";
const CONTROLLER = "0x1e0547d50005a4af66abd5e6915ebfaa2d711f7c";

const coder = ethers.AbiCoder.defaultAbiCoder();
const selector = (signature) => ethers.id(signature).slice(0, 10);
const word = (v) => coder.encode(["uint256"], [v]);
const ZERO_WORD = word(0n);

const FEE_CALLS = {
  [`${TOKEN}:${selector("senderBurnBps()")}`]: word(200n),
  [`${TOKEN}:${selector("recipientBurnBps()")}`]: word(50n),
  [`${TOKEN}:${selector("poolFeeBps()")}`]: word(100n),
  [`${TOKEN}:${selector("poolFeeReceiver()")}`]: coder.encode(["address"], [CONTROLLER]),
  [`${FEE_ROUTER}:${selector("protocolFeeBps()")}`]: coder.encode(["uint16"], [5]),
};

function answerRpc(calls) {
  return async (route) => {
    const body = route.request().postDataJSON();
    const one = (req) => {
      if (req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: "0x1" };
      if (req.method === "eth_blockNumber") return { jsonrpc: "2.0", id: req.id, result: "0x100" };
      if (req.method === "eth_getBalance") return { jsonrpc: "2.0", id: req.id, result: "0x0" };
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

const entry = (formatted) => ({ formatted, raw: String(BigInt(Math.round(formatted * 1e9))) });

async function blockNetwork(page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
}

async function answerProxy(page) {
  await page.route(`${PROXY}/api/ifr/supply`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ totalSupply: 996663637.314, burned: 3336362.686 }),
  }));
  await page.route(`${PROXY}/api/ifr/balances`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      balances: {
        Deployer: entry(0),
        LPReserveSafe: entry(400600000),
        GnosisSafe: entry(0),
        CommunitySafe: entry(7900000),
        Vesting: entry(150000000),
        LiquidityReserve: entry(200000000),
        PartnerVault: entry(40000000),
        BootstrapVaultV3: { formatted: 0.000000001, raw: "1" },
        BuybackVault: entry(0),
        BurnReserve: entry(0),
        FeeRouterV1: { formatted: 734545.074097347, raw: "734545074097347" },
        IFRLock: entry(2000),
        CommitmentVault: { formatted: 27786035.918948719, raw: "27786035918948719" },
        LendingVault: entry(0),
      },
    }),
  }));
}

test("legend: BurnReserve states no buyback yet, BuybackVault is absent, no generic 'not yet active'", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(FEE_CALLS));
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  const legend = page.locator("#dist-legend");
  await expect(legend.locator('[data-dist-cat="burnRes"]')).toContainText("0 IFR — no buyback executed yet", { timeout: 20000 });
  await expect(legend.locator('[data-dist-cat="bootstrap"]')).toContainText("finalized 05.06.2026");
  await expect(legend.locator('[data-dist-cat="ifrLock"]')).not.toContainText("not yet active");
  await expect(legend).not.toContainText("not yet active");
  await expect(legend.locator('[data-dist-cat="buyback"]')).toHaveCount(0);
  await expect(legend).not.toContainText("Buyback Vault");
  // The wallet cards no longer show the legacy BuybackVault either.
  await expect(page.locator('[data-live-key="card-buyback"]')).toHaveCount(0);
  await expect(page.locator('[data-live-key="card-burnres"]')).toHaveText("0 IFR — no buyback executed yet");
});

test("token flow renders live fee split, routes and balances", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(FEE_CALLS));
  await page.goto("/");
  const flow = page.locator("#token-flow");
  await flow.scrollIntoViewIfNeeded();
  const key = (k) => flow.locator(`[data-live-key="${k}"]`);
  await expect(key("flow-fee-total")).toHaveText("Transfer fee 3.5% (non-exempt)", { timeout: 20000 });
  await expect(key("flow-fee-split")).toHaveText("2.5% burned in-token · 1% pool fee → BuybackController");
  await expect(key("flow-pool-edge")).toHaveText("1% pool fee");
  await expect(key("flow-feerouter-bps")).toHaveText("ETH swap fee 0.05% → Controller");
  await expect(key("flow-controller")).toHaveText("0 ETH · 0 IFR pending");
  await expect(key("flow-burnres")).toHaveText("0 IFR · no buyback yet", { timeout: 20000 });
  await expect(key("feerouter-flow")).toHaveText("734.5K IFR held");
  await expect(key("flow-lpreserve")).toHaveText("400.6M IFR · 3-of-5");
  await expect(key("flow-treasury")).toHaveText("0 IFR · 3-of-5");
  await expect(key("lending-flow")).toHaveText("retired · 0 available");
  await expect(flow).not.toContainText("BuybackVault");
});

test("token flow fails closed to 'unavailable' when every read fails", async ({ page }) => {
  await blockNetwork(page);
  await page.goto("/");
  const flow = page.locator("#token-flow");
  await flow.scrollIntoViewIfNeeded();
  for (const k of ["flow-snapshot-supply", "supply-flow", "feerouter-flow", "flow-burnres", "flow-lpreserve", "flow-treasury"]) {
    await expect(flow.locator(`[data-live-key="${k}"]`)).toContainText("unavailable", { timeout: 25000 });
  }
  for (const k of ["flow-fee-total", "flow-controller", "flow-feerouter-bps", "lp-flow"]) {
    await expect(flow.locator(`[data-live-key="${k}"]`)).toContainText("unavailable", { timeout: 25000 });
  }
  const texts = await flow.locator("[data-live-key]").allTextContents();
  for (const t of texts) expect(t, `flow label must not show a number after failed reads: ${t}`).not.toMatch(/\d/);
});

for (const width of [375, 1440]) {
  test(`DOCS button in the Dante quote links to the Wiki start page (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await blockNetwork(page);
    await page.goto("/");
    const button = page.locator(".dante-quote a[data-docs-button]");
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("href", "wiki/index.html");
    await expect(button).toContainText("DOCS");
    const box = await button.boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
    expect(box && box.width).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
}
