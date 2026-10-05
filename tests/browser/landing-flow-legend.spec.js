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

const BURN_RESERVE = "0xaa1496133b6c274190a2113410b501c5802b6fcf";
const OTHER = "0x1234567890abcdef1234567890abcdef12345678";
const FAIL = { error: true };
const addr = (a) => coder.encode(["address"], [a]);

function flowCalls(overrides = {}) {
  return {
    [`${TOKEN}:${selector("senderBurnBps()")}`]: word(200n),
    [`${TOKEN}:${selector("recipientBurnBps()")}`]: word(50n),
    [`${TOKEN}:${selector("poolFeeBps()")}`]: word(100n),
    [`${TOKEN}:${selector("poolFeeReceiver()")}`]: addr(CONTROLLER),
    [`${FEE_ROUTER}:${selector("protocolFeeBps()")}`]: coder.encode(["uint16"], [5]),
    [`${FEE_ROUTER}:${selector("feeCollector()")}`]: addr(CONTROLLER),
    [`${CONTROLLER}:${selector("executionCount()")}`]: word(0n),
    [`${BURN_RESERVE}:${selector("totalBurned()")}`]: word(0n),
    ...overrides,
  };
}
const K = {
  poolReceiver: `${TOKEN}:${selector("poolFeeReceiver()")}`,
  collector: `${FEE_ROUTER}:${selector("feeCollector()")}`,
  executions: `${CONTROLLER}:${selector("executionCount()")}`,
  totalBurned: `${BURN_RESERVE}:${selector("totalBurned()")}`,
};
const FEE_CALLS = flowCalls();

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
        if (calls[key] === FAIL) return { jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted", data: "0x" } };
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

async function answerProxy(page, balanceOverrides = {}) {
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
        ...balanceOverrides,
      },
    }),
  }));
}

async function openLegend(page) {
  await page.goto("/");
  await page.locator("#live-distribution").scrollIntoViewIfNeeded();
  return page.locator("#dist-legend");
}

test("legend: an empty BurnReserve after executed buybacks shows the live history, BuybackVault is absent", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(flowCalls({ [K.executions]: word(3n), [K.totalBurned]: word(1_500_000n * 10n ** 9n) })));
  const legend = await openLegend(page);
  const burn = legend.locator('[data-dist-cat="burnRes"]');
  await expect(burn).toContainText("0 IFR held", { timeout: 20000 });
  await expect(burn).toContainText("buybacks executed: 3 · burned via reserve: 1.5M IFR", { timeout: 20000 });
  await expect(legend.locator('[data-dist-cat="bootstrap"]')).toContainText("<1 IFR — finalized 05.06.2026");
  await expect(legend).not.toContainText("not yet active");
  await expect(legend).not.toContainText("no buyback");
  await expect(legend.locator('[data-dist-cat="buyback"]')).toHaveCount(0);
  await expect(legend).not.toContainText("Buyback Vault");
  await expect(page.locator('[data-live-key="card-buyback"]')).toHaveCount(0);
  await expect(page.locator('[data-live-key="card-burnres"]')).toHaveText("0 IFR held · buybacks executed: 3 · burned via reserve: 1.5M IFR");
  await expect(page.locator('#token-flow [data-live-key="flow-burnres"]')).toHaveText("0 IFR · 3 buybacks");
});

test("legend: a failed history read never implies zero buybacks", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(flowCalls({ [K.executions]: FAIL })));
  const legend = await openLegend(page);
  const burn = legend.locator('[data-dist-cat="burnRes"]');
  await expect(burn).toContainText("buyback history unavailable", { timeout: 20000 });
  await expect(burn).not.toContainText("executed: 0");
  await expect(burn).not.toContainText("no buyback");
  await expect(page.locator('#token-flow [data-live-key="flow-burnres"]')).toHaveText("0 IFR · history unavailable");
});

test("legend: a positive sub-1 IFR lock stays a positive amount, not a no-lock claim", async ({ page }) => {
  await blockNetwork(page);
  await answerProxy(page, { IFRLock: { formatted: 0.5, raw: "500000000" } });
  await page.route(RPC_URL, answerRpc(FEE_CALLS));
  const legend = await openLegend(page);
  const lock = legend.locator('[data-dist-cat="ifrLock"]');
  await expect(lock).toContainText("<1 IFR", { timeout: 20000 });
  await expect(lock).not.toContainText("no active");
  await expect(lock).not.toContainText("0 IFR —");
});

async function openFlow(page, calls) {
  await blockNetwork(page);
  await answerProxy(page);
  await page.route(RPC_URL, answerRpc(calls));
  await page.goto("/");
  const flow = page.locator("#token-flow");
  await flow.scrollIntoViewIfNeeded();
  return flow;
}

async function routeState(flow, name) {
  return flow.evaluate((el, n) => [...el.querySelectorAll(`[data-flow-route="${n}"]`)].map((node) => ({
    tag: node.tagName.toLowerCase(),
    state: node.getAttribute("data-route-state"),
    dashed: node.hasAttribute("stroke-dasharray"),
    visibility: node.getAttribute("visibility"),
  })), name);
}
function expectRoute(states, active) {
  expect(states.length).toBe(2);
  for (const s of states) {
    expect(s.state).toBe(active ? "active" : "unconfirmed");
    if (s.tag === "line") expect(s.dashed).toBe(!active);
    else expect(s.visibility).toBe(active ? "visible" : "hidden");
  }
}

test("token flow: canonical receivers render live split and active fee routes", async ({ page }) => {
  const flow = await openFlow(page, FEE_CALLS);
  const key = (k) => flow.locator(`[data-live-key="${k}"]`);
  await expect(key("flow-fee-total")).toHaveText("Transfer fee 3.5% (non-exempt)", { timeout: 20000 });
  await expect(key("flow-fee-split")).toHaveText("2.5% burned in-token · 1% pool fee → BuybackController");
  await expect(key("flow-pool-edge")).toHaveText("1% pool fee");
  await expect(key("flow-feerouter-bps")).toHaveText("ETH fee 0.05% → Controller");
  await expect(key("flow-eth-edge")).toHaveText("ETH fee");
  await expect(key("flow-controller")).toHaveText("0 ETH · 0 IFR pending");
  await expect(key("feerouter-flow")).toHaveText("734.5K IFR held", { timeout: 20000 });
  await expect(key("flow-lpreserve")).toHaveText("400.6M IFR · 3-of-5");
  await expect(key("lending-flow")).toHaveText("retired · 0 available");
  expectRoute(await routeState(flow, "pool"), true);
  expectRoute(await routeState(flow, "eth"), true);
  await expect(flow.locator("[data-flow-lp-fallback]")).toContainText("LP only if the controller holds IFR");
  await expect(flow).toContainText("≤50% LP*");
  await expect(flow).not.toContainText("BuybackVault");
});

for (const [name, overrides, pool, eth] of [
  ["changed pool-fee receiver", { [K.poolReceiver]: addr(OTHER) }, { edge: "1% pool fee → 0x1234…5678, not here", split: "→ 0x1234…5678", active: false }, { active: true }],
  ["failed pool-fee receiver", { [K.poolReceiver]: FAIL }, { edge: "pool fee receiver: unavailable", split: "→ unavailable", active: false }, { active: true }],
  ["changed fee collector", { [K.collector]: addr(OTHER) }, { active: true }, { edge: "ETH fee → 0x1234…5678, not here", box: "ETH fee 0.05% → 0x1234…5678", active: false }],
  ["failed fee collector", { [K.collector]: FAIL }, { active: true }, { edge: "ETH fee receiver: unavailable", box: "ETH fee 0.05% → unavailable", active: false }],
]) {
  test(`token flow: ${name} is shown accurately and its route is not drawn active`, async ({ page }) => {
    const flow = await openFlow(page, flowCalls(overrides));
    const key = (k) => flow.locator(`[data-live-key="${k}"]`);
    await expect(key("flow-fee-total")).toHaveText("Transfer fee 3.5% (non-exempt)", { timeout: 20000 });
    if (pool.edge) await expect(key("flow-pool-edge")).toHaveText(pool.edge, { timeout: 20000 });
    if (pool.split) await expect(key("flow-fee-split")).toContainText(pool.split);
    if (eth.edge) await expect(key("flow-eth-edge")).toHaveText(eth.edge, { timeout: 20000 });
    if (eth.box) await expect(key("flow-feerouter-bps")).toHaveText(eth.box);
    await expect(key("flow-feerouter-bps")).not.toContainText("loading", { timeout: 20000 });
    await expect(key("flow-pool-edge")).not.toContainText("loading");
    expectRoute(await routeState(flow, "pool"), pool.active);
    expectRoute(await routeState(flow, "eth"), eth.active);
  });
}

// Every live label inside a node must fit its node box, for long (changed receiver) and unavailable states.
for (const width of [375, 1440]) {
  for (const [state, calls, withApi] of [
    ["canonical", FEE_CALLS, true],
    ["changed receivers", flowCalls({ [K.poolReceiver]: addr(OTHER), [K.collector]: addr(OTHER), [K.executions]: FAIL }), true],
    ["all reads failed", null, false],
  ]) {
    test(`token flow: live labels fit their node boxes (${state}, ${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await blockNetwork(page);
      if (withApi) await answerProxy(page);
      if (calls) await page.route(RPC_URL, answerRpc(calls));
      await page.goto("/");
      const flow = page.locator("#token-flow");
      await flow.scrollIntoViewIfNeeded();
      await expect(flow.locator('[data-live-key="flow-feerouter-bps"]')).not.toContainText("loading", { timeout: 25000 });
      await expect(flow.locator('[data-live-key="flow-burnres"]')).not.toContainText("loading", { timeout: 25000 });
      const misfits = await flow.evaluate((root) => {
        const rects = [...root.querySelectorAll("svg rect")].filter((r) => Number(r.getAttribute("width")) > 40);
        const out = [];
        for (const t of root.querySelectorAll("svg text[data-live-key]")) {
          const x = Number(t.getAttribute("x")); const y = Number(t.getAttribute("y"));
          const box = rects.find((r) => {
            const rx = Number(r.getAttribute("x")), ry = Number(r.getAttribute("y"));
            return x >= rx && x <= rx + Number(r.getAttribute("width")) && y >= ry && y <= ry + Number(r.getAttribute("height"));
          });
          if (!box) continue; // edge labels sit on lines, not in nodes
          const tb = t.getBoundingClientRect(); const bb = box.getBoundingClientRect();
          if (tb.left < bb.left - 0.5 || tb.right > bb.right + 0.5) out.push(`${t.getAttribute("data-live-key")}: "${t.textContent}"`);
        }
        return out;
      });
      expect(misfits).toEqual([]);
    });
  }
}

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
    expect(await button.evaluate((el) => getComputedStyle(el).letterSpacing)).toMatch(/^(0px|normal)$/);
    const box = await button.boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
    expect(box && box.width).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
}
