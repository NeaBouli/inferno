#!/usr/bin/env node
// Builds the Safe Transaction Builder file that executes the queued FeeRouterV1 voucher-signer rotation (CWA-06).
// Step 1 (propose) is done: the Treasury Safe queued Governance proposal 18 = FeeRouterV1.setVoucherSigner(QUEUED.signer).
// The CLI writes only step 2 (execute) and only for that proposal, after reading it from an Ethereum Mainnet RPC:
// exact target, data and ETA, not executed and not cancelled. No key is used; the file is only imported in the Safe UI.
//
//   MAINNET_RPC_URL=<rpc> node scripts/voucher-signer-rotation-proposal.cjs <new signer address> <proposalId> [outDir]
//
// build() is the offline fixture builder used by tests; it never writes production output.
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

// Read-only at block 26119897 (0xd9d97ba0ebec566ff94507e99edf5136eeca87acb4fecee1fd746d70c4024bbb).
const QUEUED = { id: 18n, signer: "0x790D99c320dafA03d83bEa152178A6523b49CA0d", eta: 1791156347n }; // ETA 2026-10-04T23:25:47Z

const feeRouter = new Interface(["function setVoucherSigner(address newSigner)"]);
const governance = new Interface([
  "function propose(address target, bytes data) returns (uint256)",
  "function execute(uint256 proposalId)",
  "function getProposal(uint256 proposalId) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)",
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

// Throws unless a getProposal(QUEUED.id) result is exactly the queued rotation and still pending.
function checkQueued([target, data, eta, executed, cancelled]) {
  if (getAddress(target) !== FEE_ROUTER) throw new Error(`proposal ${QUEUED.id} targets ${target}, not FeeRouterV1`);
  if (data.toLowerCase() !== feeRouter.encodeFunctionData("setVoucherSigner", [QUEUED.signer])) {
    throw new Error(`proposal ${QUEUED.id} data is not setVoucherSigner(${QUEUED.signer})`);
  }
  if (BigInt(eta) !== QUEUED.eta) throw new Error(`proposal ${QUEUED.id} ETA is ${eta}, expected ${QUEUED.eta}`);
  if (cancelled) throw new Error(`proposal ${QUEUED.id} is cancelled`);
  if (executed) throw new Error(`proposal ${QUEUED.id} is already executed`);
}

// Reads getProposal(QUEUED.id) from rpcUrl; fails closed unless the endpoint reports Ethereum Mainnet.
async function readQueued(rpcUrl) {
  const call = async (method, params) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error || typeof body.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.result)) {
      throw new Error(`${method} failed`);
    }
    return body.result;
  };
  const chainId = await call("eth_chainId", []);
  if (BigInt(chainId) !== 1n) throw new Error(`RPC is not Ethereum Mainnet (chainId ${chainId})`);
  const raw = await call("eth_call", [{ to: GOVERNANCE, data: governance.encodeFunctionData("getProposal", [QUEUED.id]) }, "latest"]);
  return governance.decodeFunctionResult("getProposal", raw);
}

// Production output: the step 2 file for the queued proposal, written only after the live check passed.
async function writeExecute(signerInput, idInput, outDir, rpcUrl) {
  if (!isAddress(signerInput) || getAddress(signerInput) !== QUEUED.signer || String(idInput) !== String(QUEUED.id)) {
    throw new Error(`refusing: only the queued proposal ${QUEUED.id} (setVoucherSigner(${QUEUED.signer})) can be executed`);
  }
  checkQueued(await readQueued(rpcUrl));
  const name = "cwa06-voucher-step2-execute.json";
  const content = build(QUEUED.signer, QUEUED.id).files[name];
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
  return path.join(outDir, name);
}

module.exports = { build, checkQueued, readQueued, writeExecute, QUEUED, FEE_ROUTER, GOVERNANCE, FORBIDDEN };

if (require.main === module) {
  const [signerArg, idArg, outArg] = process.argv.slice(2);
  writeExecute(signerArg, idArg, outArg || ".", process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com")
    .then((file) => {
      console.log(`verified on Mainnet: proposal ${QUEUED.id} = FeeRouterV1.setVoucherSigner(${QUEUED.signer}), ETA ${QUEUED.eta}, pending`);
      console.log(`wrote ${file}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
