#!/usr/bin/env node
// Builds the Safe Transaction Builder files for wiring CommitmentVault V2 (CV-01 repair).
// Step 1 (propose) queues InfernoToken.setFeeExempt(V2, true) in Governance with its 48h delay;
// step 2 (execute) runs it after the delay. No key is used; the files are only imported in the Safe UI.
//
//   node scripts/commitment-vault-v2-proposal.cjs <V2 address> [proposalId] [outDir]
//
// proposalId is printed by step 1 (Governance.proposalCount() before proposing).
// Only the deployed V2 is accepted; any other address (including V1) is refused before a file is written.
const fs = require("node:fs");
const path = require("node:path");
const { Interface, getAddress, isAddress } = require("ethers");

const CHAIN_ID = "1";
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const V1 = "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
const V2 = "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F"; // deployed 2026-10-02, block 26107296

const token = new Interface(["function setFeeExempt(address account, bool exempt)"]);
const governance = new Interface([
  "function propose(address target, bytes data) returns (uint256)",
  "function execute(uint256 proposalId)",
]);

function batch(name, description, transactions) {
  return {
    version: "1.0",
    chainId: CHAIN_ID,
    createdAt: 0,
    meta: { name, description, txBuilderVersion: "1.16.5" },
    transactions,
  };
}

function build(v2Input, proposalId) {
  if (!isAddress(v2Input)) throw new Error("V2 address required");
  const v2 = getAddress(v2Input);
  if (v2 === getAddress(V1)) throw new Error("refusing: that is the V1 vault");
  if (v2 !== V2) throw new Error(`refusing: ${v2} is not the deployed V2 ${V2}`);
  const inner = token.encodeFunctionData("setFeeExempt", [v2, true]);
  const files = {
    "cv01-v2-step1-propose.json": batch(
      "CV-01 repair step 1: propose setFeeExempt(CommitmentVault V2)",
      `Queues InfernoToken.setFeeExempt(${v2}, true) in Governance; executable after the Governance delay (48h).`,
      [{ to: GOVERNANCE, value: "0", data: governance.encodeFunctionData("propose", [IFR_TOKEN, inner]) }]
    ),
  };
  if (proposalId !== undefined) {
    if (!/^\d+$/.test(String(proposalId))) throw new Error("proposalId must be a non-negative integer");
    files["cv01-v2-step2-execute.json"] = batch(
      "CV-01 repair step 2: execute setFeeExempt(CommitmentVault V2)",
      `Executes Governance proposal ${proposalId} (InfernoToken.setFeeExempt(${v2}, true)) after its delay.`,
      [{ to: GOVERNANCE, value: "0", data: governance.encodeFunctionData("execute", [BigInt(proposalId)]) }]
    );
  }
  return { v2, inner, files };
}

module.exports = { build, IFR_TOKEN, GOVERNANCE, V2 };

if (require.main === module) {
  const [v2Arg, idArg, outArg] = process.argv.slice(2);
  try {
    const { v2, inner, files } = build(v2Arg, idArg);
    const outDir = outArg || ".";
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
      console.log(`wrote ${path.join(outDir, name)}`);
    }
    console.log(`V2: ${v2}`);
    console.log(`inner call InfernoToken.setFeeExempt: ${inner}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
