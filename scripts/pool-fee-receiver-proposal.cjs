#!/usr/bin/env node
// Lane 3 decision B (CWA-02): route future IFR pool fees from FeeRouterV1 (no withdrawal path) to
// BuybackController, where the IFR stays recoverable through the governed withdrawIFR. The controller is
// dormant (0 executions, no ETH); when it runs with much IFR against little ETH, the LP add fails and the
// ETH falls back to buyback-and-burn, so the accrued IFR is not automatically paired into liquidity.
// Step 1 queues InfernoToken.setPoolFeeReceiver(BuybackController) in Governance (48h); step 2 executes it.
// IFR already stranded in FeeRouterV1 stays there: FeeRouterV1 has no sweep.
//
//   node scripts/pool-fee-receiver-proposal.cjs <proposalId = Governance.proposalCount()> [outDir]
const fs = require("node:fs");
const path = require("node:path");
const { Interface } = require("ethers");

const CHAIN_ID = "1";
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const BUYBACK_CONTROLLER = "0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c";
const FEE_ROUTER_V1 = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a";

const token = new Interface(["function setPoolFeeReceiver(address)"]);
const gov = new Interface(["function propose(address,bytes) returns (uint256)", "function execute(uint256)"]);
const batch = (name, description, transactions) =>
  ({ version: "1.0", chainId: CHAIN_ID, createdAt: 0, meta: { name, description, txBuilderVersion: "1.16.5" }, transactions });

function build(proposalId) {
  if (!/^\d+$/.test(String(proposalId))) throw new Error("proposalId must be a non-negative integer");
  const inner = token.encodeFunctionData("setPoolFeeReceiver", [BUYBACK_CONTROLLER]);
  return {
    "lane3-poolfee-step1-propose.json": batch(
      "Lane 3 step 1: propose InfernoToken.setPoolFeeReceiver(BuybackController)",
      `Queues InfernoToken.setPoolFeeReceiver(${BUYBACK_CONTROLLER}) as Governance proposal ${proposalId}; executable after 48h.`,
      [{ to: GOVERNANCE, value: "0", data: gov.encodeFunctionData("propose", [IFR_TOKEN, inner]) }]
    ),
    "lane3-poolfee-step2-execute.json": batch(
      "Lane 3 step 2: execute InfernoToken.setPoolFeeReceiver(BuybackController)",
      `Executes Governance proposal ${proposalId} after its delay.`,
      [{ to: GOVERNANCE, value: "0", data: gov.encodeFunctionData("execute", [BigInt(proposalId)]) }]
    ),
  };
}

module.exports = { build, IFR_TOKEN, GOVERNANCE, BUYBACK_CONTROLLER, FEE_ROUTER_V1 };

if (require.main === module) {
  const [idArg, outArg] = process.argv.slice(2);
  try {
    const files = build(idArg);
    const outDir = outArg || ".";
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
      console.log(`wrote ${path.join(outDir, name)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
