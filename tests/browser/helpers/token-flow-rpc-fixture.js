const { ethers } = require("ethers");

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
        GnosisSafe: { formatted: 734545.074097347, raw: "734545074097347" }, // Treasury Safe at block 26151369 (CWA-02 recovery)
        CommunitySafe: entry(7900000),
        Vesting: entry(150000000),
        LiquidityReserve: entry(200000000),
        PartnerVault: entry(40000000),
        BootstrapVaultV3: { formatted: 0.000000001, raw: "1" },
        BuybackVault: entry(0),
        BurnReserve: entry(0),
        FeeRouterV1: { formatted: 0, raw: "0" }, // block 26151369: the IFR held by FeeRouterV1 was recovered (CWA-02)
        IFRLock: entry(2000),
        CommitmentVault: { formatted: 27786035.918948719, raw: "27786035918948719" },
        LendingVault: entry(0),
        ...balanceOverrides,
      },
    }),
  }));
}

module.exports = {
  RPC_URL, TOKEN, FEE_ROUTER, CONTROLLER, OTHER, FAIL, K, FEE_CALLS,
  selector, word, addr, flowCalls, answerRpc, answerProxy, blockNetwork,
};
