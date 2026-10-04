#!/usr/bin/env node
// Builds the Safe Transaction Builder files for wiring CommitmentVault V2 (CV-01 repair).
// Step 1 (propose) queues InfernoToken.setFeeExempt(V2, true) in Governance with its 48h delay;
// step 2 (execute) runs it after the delay. No key is used; the files are only imported in the Safe UI.
//
//   node scripts/commitment-vault-v2-proposal.cjs <V2 address> [proposalId] [outDir] [--verify-onchain]
//
// Only the deployed V2 is accepted; any other address (including V1) is refused before a file is written.
// Step 2 is pinned to Governance proposal #17, the CV-01 repair proposal queued on 2026-10-02; any other id is
// refused because Governance.execute(id) would run whatever that proposal contains. With --verify-onchain the
// queued proposal is read (MAINNET_RPC_URL or a public RPC) and must target InfernoToken with exactly
// setFeeExempt(V2, true), not executed and not cancelled, before anything is written.
const fs = require("node:fs");
const path = require("node:path");
const { Interface, getAddress, isAddress } = require("ethers");

const CHAIN_ID = "1";
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const V1 = "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
const V2 = "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F"; // deployed 2026-10-02, block 26107296
const CV01_PROPOSAL_ID = 17; // queued 2026-10-02 by the Treasury Safe, ETA 2026-10-04 21:53:11 UTC

const token = new Interface(["function setFeeExempt(address account, bool exempt)"]);
const governance = new Interface([
  "function propose(address target, bytes data) returns (uint256)",
  "function execute(uint256 proposalId)",
  "function getProposal(uint256 proposalId) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)",
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
    if (BigInt(proposalId) !== BigInt(CV01_PROPOSAL_ID)) {
      throw new Error(`refusing: CV-01 step 2 is pinned to Governance proposal #${CV01_PROPOSAL_ID}, not #${proposalId}`);
    }
    files["cv01-v2-step2-execute.json"] = batch(
      "CV-01 repair step 2: execute setFeeExempt(CommitmentVault V2)",
      `Executes Governance proposal ${proposalId} (InfernoToken.setFeeExempt(${v2}, true)) after its delay.`,
      [{ to: GOVERNANCE, value: "0", data: governance.encodeFunctionData("execute", [BigInt(proposalId)]) }]
    );
  }
  return { v2, inner, files };
}

/**
 * Read-only check that the queued proposal is exactly the CV-01 repair before step 2 is written.
 * `call(to, data)` performs an eth_call and resolves to the hex result.
 */
async function verifyOnChain(call, proposalId = CV01_PROPOSAL_ID) {
  const raw = await call(GOVERNANCE, governance.encodeFunctionData("getProposal", [BigInt(proposalId)]));
  const [target, data, eta, executed, cancelled] = governance.decodeFunctionResult("getProposal", raw);
  const expected = token.encodeFunctionData("setFeeExempt", [V2, true]);
  if (eta === 0n) throw new Error(`refusing: Governance proposal #${proposalId} does not exist`);
  if (getAddress(target) !== getAddress(IFR_TOKEN)) throw new Error(`refusing: proposal #${proposalId} targets ${target}, not InfernoToken`);
  if (data.toLowerCase() !== expected.toLowerCase()) throw new Error(`refusing: proposal #${proposalId} data is not setFeeExempt(V2, true)`);
  if (executed) throw new Error(`refusing: proposal #${proposalId} is already executed`);
  if (cancelled) throw new Error(`refusing: proposal #${proposalId} is cancelled`);
  return { eta };
}

/** Minimal JSON-RPC eth_call with a chainId 1 check. */
function rpcCaller(url) {
  const post = async (method, params) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = await res.json();
    if (body.error || typeof body.result !== "string") throw new Error(`RPC ${method} failed: ${JSON.stringify(body.error || body.result)}`);
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

module.exports = { build, verifyOnChain, rpcCaller, IFR_TOKEN, GOVERNANCE, V2, CV01_PROPOSAL_ID };

if (require.main === module) {
  const args = process.argv.slice(2);
  const verify = args.includes("--verify-onchain");
  const [v2Arg, idArg, outArg] = args.filter((a) => a !== "--verify-onchain");
  (async () => {
    const { v2, inner, files } = build(v2Arg, idArg);
    if (verify && idArg !== undefined) {
      const { eta } = await verifyOnChain(rpcCaller(process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com"), idArg);
      console.log(`verified on-chain: proposal #${idArg} = InfernoToken.setFeeExempt(V2, true), queued, ETA ${new Date(Number(eta) * 1000).toISOString()}`);
    }
    const outDir = outArg || ".";
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
      console.log(`wrote ${path.join(outDir, name)}`);
    }
    console.log(`V2: ${v2}`);
    console.log(`inner call InfernoToken.setFeeExempt: ${inner}`);
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
