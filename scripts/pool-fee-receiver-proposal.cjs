#!/usr/bin/env node
// Lane 3 decision B (CWA-02): route future IFR pool fees from FeeRouterV1 (no withdrawal path) to
// BuybackController, where the IFR stays recoverable through the governed withdrawIFR. The controller is
// dormant (0 executions, no ETH); when it runs with much IFR against little ETH, the LP add fails and the
// ETH falls back to buyback-and-burn, so the accrued IFR is not automatically paired into liquidity.
// IFR already stranded in FeeRouterV1 stays there: FeeRouterV1 has no sweep.
// Step 1 already ran on Mainnet: Governance proposal #21 (InfernoToken.setPoolFeeReceiver(BuybackController))
// is queued with ETA 2026-10-05 00:18:23 UTC; only step 2 (execute) is still pending.
//
//   node scripts/pool-fee-receiver-proposal.cjs --execute [outDir]   production step 2 (the only CLI mode)
//
// The CLI writes lane3-poolfee-step2-execute.json only after a read-only
// on-chain check (MAINNET_RPC_URL or a public RPC) proves that proposal #21 still exists with exactly the
// pinned target, calldata and ETA and is neither executed nor cancelled. Any drift, an unreachable RPC or
// a non-Mainnet chain refuses the write. The unverified build(proposalId) fixture is a library export only
// (unit test); the CLI never writes it.
const fs = require("node:fs");
const path = require("node:path");
const { Interface, getAddress } = require("ethers");

const CHAIN_ID = "1";
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const BUYBACK_CONTROLLER = "0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c";
const FEE_ROUTER_V1 = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a";

const token = new Interface(["function setPoolFeeReceiver(address)"]);
const gov = new Interface([
  "function propose(address,bytes) returns (uint256)",
  "function execute(uint256)",
  "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)",
]);

// Queued by the Treasury Safe on 2026-10-03; content verified read-only at block 26119897.
const QUEUED_ETA = 1791159503n; // 2026-10-05T00:18:23.000Z
const POOL_FEE_INNER = token.encodeFunctionData("setPoolFeeReceiver", [BUYBACK_CONTROLLER]);
const QUEUED = { id: 21n, name: "InfernoToken", target: IFR_TOKEN };

const batch = (name, description, transactions) =>
  ({ version: "1.0", chainId: CHAIN_ID, createdAt: 0, meta: { name, description, txBuilderVersion: "1.16.5" }, transactions });

function executeBatch() {
  return batch(
    "Lane 3 step 2: execute InfernoToken.setPoolFeeReceiver(BuybackController)",
    `Executes Governance proposal 21 (InfernoToken.setPoolFeeReceiver(${BUYBACK_CONTROLLER})) after ETA ${new Date(Number(QUEUED_ETA) * 1000).toISOString()}; the queued content was verified on-chain before this file was written.`,
    [{ to: GOVERNANCE, value: "0", data: gov.encodeFunctionData("execute", [QUEUED.id]) }]
  );
}

// Offline fixture for tests. Library-only, never written by the CLI.
function build(proposalId) {
  if (!/^\d+$/.test(String(proposalId))) throw new Error("proposalId must be a non-negative integer");
  return {
    "lane3-poolfee-step1-propose.json": batch(
      "Lane 3 step 1: propose InfernoToken.setPoolFeeReceiver(BuybackController)",
      `Queues InfernoToken.setPoolFeeReceiver(${BUYBACK_CONTROLLER}) as Governance proposal ${proposalId}; executable after 48h.`,
      [{ to: GOVERNANCE, value: "0", data: gov.encodeFunctionData("propose", [IFR_TOKEN, POOL_FEE_INNER]) }]
    ),
    "lane3-poolfee-step2-execute.json": batch(
      "Lane 3 step 2: execute InfernoToken.setPoolFeeReceiver(BuybackController)",
      `Executes Governance proposal ${proposalId} after its delay.`,
      [{ to: GOVERNANCE, value: "0", data: gov.encodeFunctionData("execute", [BigInt(proposalId)]) }]
    ),
  };
}

/**
 * Read-only check that the queued proposal is exactly the approved Lane 3 decision B operation.
 * `call(to, data)` performs an eth_call and resolves to the hex result. Throws on any drift:
 * unknown id, wrong target, wrong calldata, wrong ETA, already executed, cancelled.
 */
async function verifyQueuedProposal(call) {
  const raw = await call(GOVERNANCE, gov.encodeFunctionData("getProposal", [QUEUED.id]));
  const [target, data, eta, executed, cancelled] = gov.decodeFunctionResult("getProposal", raw);
  if (eta === 0n) throw new Error(`refusing: Governance proposal #${QUEUED.id} does not exist`);
  if (getAddress(target) !== getAddress(QUEUED.target)) throw new Error(`refusing: proposal #${QUEUED.id} targets ${target}, not InfernoToken ${QUEUED.target}`);
  if (data.toLowerCase() !== POOL_FEE_INNER.toLowerCase()) throw new Error(`refusing: proposal #${QUEUED.id} data is not InfernoToken.setPoolFeeReceiver(BuybackController)`);
  if (eta !== QUEUED_ETA) throw new Error(`refusing: proposal #${QUEUED.id} ETA ${eta} is not the pinned ${QUEUED_ETA} (${new Date(Number(QUEUED_ETA) * 1000).toISOString()})`);
  if (executed) throw new Error(`refusing: proposal #${QUEUED.id} is already executed`);
  if (cancelled) throw new Error(`refusing: proposal #${QUEUED.id} is cancelled`);
  return { eta: QUEUED_ETA };
}

/** Production step 2: verify the pinned queued proposal on-chain, then write only the execute batch. */
async function buildVerifiedExecute(call) {
  await verifyQueuedProposal(call);
  return { "lane3-poolfee-step2-execute.json": executeBatch() };
}

const RPC_TIMEOUT_MS = 10_000;

/**
 * Minimal JSON-RPC eth_call with a chainId 1 check. Every request is bounded by `timeoutMs`; a non-2xx
 * status, an unparsable body or any envelope other than {jsonrpc "2.0", matching id, hex result} refuses
 * with a generic error that never echoes the endpoint or its response.
 */
function rpcCaller(url, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
  let nextId = 0;
  const post = async (method, params) => {
    const id = ++nextId;
    let body;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error("http status");
      body = await res.json();
    } catch {
      throw new Error(`refusing: RPC ${method} failed`);
    }
    const valid = body !== null && typeof body === "object" && !Array.isArray(body) && body.jsonrpc === "2.0" &&
      body.id === id && !("error" in body) && typeof body.result === "string" && /^0x[0-9a-fA-F]*$/.test(body.result);
    if (!valid) throw new Error(`refusing: RPC ${method} returned an invalid response`);
    return body.result;
  };
  let checked = false;
  return async (to, data) => {
    if (!checked) {
      if ((await post("eth_chainId", [])) !== "0x1") throw new Error("refusing: RPC is not Ethereum Mainnet");
      checked = true;
    }
    return post("eth_call", [{ to, data }, "latest"]);
  };
}

module.exports = { build, buildVerifiedExecute, verifyQueuedProposal, rpcCaller, RPC_TIMEOUT_MS, IFR_TOKEN, GOVERNANCE, BUYBACK_CONTROLLER, FEE_ROUTER_V1, QUEUED, QUEUED_ETA, POOL_FEE_INNER };

if (require.main === module) {
  const args = process.argv.slice(2);
  (async () => {
    // Only verified output is ever written; build() stays a library export for the unit test.
    if (args[0] !== "--execute" || args.length > 2 || (args[1] !== undefined && args[1].startsWith("-"))) {
      throw new Error("usage: --execute [outDir] (verified against the queued Mainnet proposal)");
    }
    const outDir = args[1] || ".";
    const files = await buildVerifiedExecute(rpcCaller(process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com"));
    console.log(`verified on-chain: proposal #21 = InfernoToken.setPoolFeeReceiver(BuybackController), queued, ETA ${new Date(Number(QUEUED_ETA) * 1000).toISOString()}`);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
      console.log(`wrote ${path.join(outDir, name)}`);
    }
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
