const { ethers } = require("hardhat");

/**
 * INFERNO — Propose BuilderRegistry registration through Governance.
 *
 * BuilderRegistry is owned by Governance, so normal wallets cannot call
 * registerBuilder directly. Default mode prints Gnosis Safe calldata.
 *
 * Usage:
 *   DRY_RUN=true npx hardhat run scripts/propose-builder-registration.js --network mainnet
 *   BUILDER_WALLET=0x... BUILDER_NAME=Chameleon BUILDER_URL=https://... BUILDER_CATEGORY=integration ...
 */

const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const TREASURY_SAFE = "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b";
const BUILDER_REGISTRY = "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3";

const DEFAULT_BUILDER = {
  wallet: "0x4f632748460E5277bF8435259cADce440AbAC254",
  name: "Chameleon",
  url: "https://github.com/NeaBouli/chameleon",
  category: "integration",
};

const GOV_ABI = [
  "function propose(address target, bytes calldata data) external returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function getProposal(uint256 id) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)",
  "function owner() view returns (address)",
];

const REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function isBuilder(address wallet) view returns (bool)",
  "function getBuilderCount() view returns (uint256)",
  "function getBuilderInfo(address wallet) view returns (string name,string url,string category,uint256 registeredAt,bool active)",
  "function registerBuilder(address wallet,string calldata name,string calldata url,string calldata category) external",
];

function env(name, fallback) {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const dryRun = process.env.DRY_RUN !== "false";

  const builder = {
    wallet: env("BUILDER_WALLET", DEFAULT_BUILDER.wallet),
    name: env("BUILDER_NAME", DEFAULT_BUILDER.name),
    url: env("BUILDER_URL", DEFAULT_BUILDER.url),
    category: env("BUILDER_CATEGORY", DEFAULT_BUILDER.category),
  };

  if (!ethers.utils.isAddress(builder.wallet)) {
    throw new Error(`Invalid BUILDER_WALLET: ${builder.wallet}`);
  }
  if (!builder.name) throw new Error("BUILDER_NAME must not be empty");

  const validCategories = new Set(["creator", "integration", "tooling", "dao"]);
  if (!validCategories.has(builder.category)) {
    throw new Error(`Invalid BUILDER_CATEGORY: ${builder.category}`);
  }

  const gov = new ethers.Contract(GOVERNANCE, GOV_ABI, signer);
  const registry = new ethers.Contract(BUILDER_REGISTRY, REGISTRY_ABI, signer);

  const [govOwner, registryOwner, alreadyRegistered, count, info] = await Promise.all([
    gov.owner(),
    registry.owner(),
    registry.isBuilder(builder.wallet),
    registry.getBuilderCount(),
    registry.getBuilderInfo(builder.wallet),
  ]);

  console.log("=".repeat(72));
  console.log("  INFERNO — BuilderRegistry Registration");
  console.log("=".repeat(72));
  console.log(`  Mode:             ${dryRun ? "DRY-RUN (calldata only)" : "LIVE BROADCAST"}`);
  console.log(`  Network:          ${network.name} (chainId ${network.chainId})`);
  console.log(`  Signer:           ${signer.address}`);
  console.log(`  Governance:       ${GOVERNANCE}`);
  console.log(`  Governance owner: ${govOwner}`);
  console.log(`  TreasurySafe:     ${TREASURY_SAFE}`);
  console.log(`  BuilderRegistry:  ${BUILDER_REGISTRY}`);
  console.log(`  Registry owner:   ${registryOwner}`);
  console.log(`  Builder count:    ${count.toString()}`);
  console.log("");
  console.log("  Builder:");
  console.log(`    wallet:   ${builder.wallet}`);
  console.log(`    name:     ${builder.name}`);
  console.log(`    url:      ${builder.url}`);
  console.log(`    category: ${builder.category}`);
  console.log(`    active:   ${alreadyRegistered}`);

  if (alreadyRegistered) {
    console.log("");
    console.log("  Already registered. Current on-chain info:");
    console.log(`    name:     ${info.name}`);
    console.log(`    url:      ${info.url}`);
    console.log(`    category: ${info.category}`);
    console.log(`    active:   ${info.active}`);
    return;
  }

  if (registryOwner.toLowerCase() !== GOVERNANCE.toLowerCase()) {
    throw new Error(`Unexpected registry owner: ${registryOwner}`);
  }

  const registryIface = new ethers.utils.Interface(REGISTRY_ABI);
  const registerCalldata = registryIface.encodeFunctionData("registerBuilder", [
    builder.wallet,
    builder.name,
    builder.url,
    builder.category,
  ]);

  const govIface = new ethers.utils.Interface(GOV_ABI);
  const proposeCalldata = govIface.encodeFunctionData("propose", [
    BUILDER_REGISTRY,
    registerCalldata,
  ]);

  console.log("");
  console.log("  Registry call:");
  console.log(`    Target: ${BUILDER_REGISTRY}`);
  console.log(`    Data:   ${registerCalldata}`);
  console.log("");
  console.log("=".repeat(72));
  console.log("  GNOSIS SAFE — Submit Governance Proposal");
  console.log("=".repeat(72));
  console.log(`  Safe URL: https://app.safe.global/transactions/queue?safe=eth:${TREASURY_SAFE}`);
  console.log(`  To:       ${GOVERNANCE}`);
  console.log("  Value:    0");
  console.log(`  Data:     ${proposeCalldata}`);
  console.log("");
  console.log("  After timelock ETA, execute the proposal through Governance.");

  if (dryRun) {
    console.log("");
    console.log("  DRY_RUN=true — no transaction broadcast.");
    return;
  }

  if (govOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer is not Governance owner. Submit the calldata via TreasurySafe.\n` +
      `Signer: ${signer.address}\nOwner:  ${govOwner}`
    );
  }

  const tx = await gov.propose(BUILDER_REGISTRY, registerCalldata);
  const receipt = await tx.wait();
  const countAfter = await gov.proposalCount();
  const proposalId = countAfter.toNumber() - 1;
  const proposal = await gov.getProposal(proposalId);

  console.log("");
  console.log("=".repeat(72));
  console.log("  PROPOSAL SUBMITTED");
  console.log("=".repeat(72));
  console.log(`  TX:          ${tx.hash}`);
  console.log(`  Gas used:    ${receipt.gasUsed.toString()}`);
  console.log(`  Proposal ID: #${proposalId}`);
  console.log(`  ETA:         ${new Date(proposal.eta.toNumber() * 1000).toISOString()}`);
}

main().catch((e) => {
  console.error("\nERROR:", e.message);
  process.exit(1);
});
