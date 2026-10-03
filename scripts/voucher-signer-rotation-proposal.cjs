#!/usr/bin/env node
// Builds the Safe Transaction Builder files that rotate the FeeRouterV1 voucher signer (CWA-06).
// Step 1 (propose) queues FeeRouterV1.setVoucherSigner(newSigner) in Governance with its 48h delay;
// step 2 (execute) runs it after the delay. No key is used; the files are only imported in the Safe UI.
//
//   node scripts/voucher-signer-rotation-proposal.cjs <new signer address> [proposalId] [outDir]
//
// proposalId is Governance.proposalCount() immediately before step 1 is executed.
const fs = require("node:fs");
const path = require("node:path");
const { Interface, getAddress, isAddress, ZeroAddress } = require("ethers");

const CHAIN_ID = "1";
const FEE_ROUTER = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
// The new signer must own nothing else: never a Safe owner, the deployer/guardian or the current signer.
const FORBIDDEN = {
  "0x6b36687b0cd4386fb14cf565B67D7862110Fed67": "deployer / guardian / Safe owner",
  "0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4": "current voucher signer / Safe owner",
  "0x0C4893DcF730E0Ddc7D18CF9723932784Fb4ED74": "Safe owner",
  "0xA0860f872a9cAB34817D9a764e71ab43B942b275": "Safe owner",
  "0x32cF8b4F29A8F211804857EcF8BF0847f0BC0fE9": "Safe owner",
  "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b": "Treasury Safe",
  "0xaC5687547B2B21d80F8fd345B51e608d476667C7": "Community Safe",
  "0x5D93E7919a71d725054e31017eCA86B026F86C04": "LP Reserve Safe",
  [GOVERNANCE]: "Governance",
  [FEE_ROUTER]: "FeeRouterV1",
};

const feeRouter = new Interface(["function setVoucherSigner(address newSigner)"]);
const governance = new Interface([
  "function propose(address target, bytes data) returns (uint256)",
  "function execute(uint256 proposalId)",
]);

function batch(name, description, transactions) {
  return { version: "1.0", chainId: CHAIN_ID, createdAt: 0, meta: { name, description, txBuilderVersion: "1.16.5" }, transactions };
}

function build(signerInput, proposalId) {
  if (!isAddress(signerInput)) throw new Error("new signer address required");
  const signer = getAddress(signerInput);
  if (signer === ZeroAddress) throw new Error("refusing: zero address");
  for (const [address, role] of Object.entries(FORBIDDEN)) {
    if (getAddress(address) === signer) throw new Error(`refusing: ${signer} is the ${role}`);
  }
  const inner = feeRouter.encodeFunctionData("setVoucherSigner", [signer]);
  const files = {
    "cwa06-voucher-step1-propose.json": batch(
      "CWA-06 step 1: propose FeeRouterV1.setVoucherSigner",
      `Queues FeeRouterV1.setVoucherSigner(${signer}) in Governance; executable after the Governance delay (48h).`,
      [{ to: GOVERNANCE, value: "0", data: governance.encodeFunctionData("propose", [FEE_ROUTER, inner]) }]
    ),
  };
  if (proposalId !== undefined) {
    if (!/^\d+$/.test(String(proposalId))) throw new Error("proposalId must be a non-negative integer");
    files["cwa06-voucher-step2-execute.json"] = batch(
      "CWA-06 step 2: execute FeeRouterV1.setVoucherSigner",
      `Executes Governance proposal ${proposalId} (FeeRouterV1.setVoucherSigner(${signer})) after its delay.`,
      [{ to: GOVERNANCE, value: "0", data: governance.encodeFunctionData("execute", [BigInt(proposalId)]) }]
    );
  }
  return { signer, inner, files };
}

module.exports = { build, FEE_ROUTER, GOVERNANCE, FORBIDDEN };

if (require.main === module) {
  const [signerArg, idArg, outArg] = process.argv.slice(2);
  try {
    const { signer, inner, files } = build(signerArg, idArg);
    const outDir = outArg || ".";
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
      console.log(`wrote ${path.join(outDir, name)}`);
    }
    console.log(`new voucher signer: ${signer}`);
    console.log(`inner call FeeRouterV1.setVoucherSigner: ${inner}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
