const { ethers } = require("hardhat");

/**
 * INFERNO — Propose setP0 on CommitmentVault (Issue #34)
 *
 * P0 = initial IFR price in wei per 1 IFR (9 decimals).
 * Calculated once after Bootstrap finalise():
 *   P0 = totalETHRaised_wei / ifrAllocation_whole_tokens
 *      = 30_000_000_000_000_000 / 100_000_000
 *      = 300_000_000 wei/IFR
 *
 * IMPORTANT: The Governance contract's owner is TreasurySafe (3-of-5 multisig).
 * The deployer wallet CANNOT submit proposals directly.
 *
 * TWO PATHS:
 *   PATH A — If DEPLOYER_CAN_PROPOSE=true in env (fallback/test only):
 *     npx hardhat run scripts/propose-set-p0.js --network mainnet
 *
 *   PATH B — TreasurySafe via Gnosis Safe UI (PRODUCTION):
 *     Run this script with DRY_RUN=true to print calldata only, then
 *     submit manually via https://app.safe.global/
 *
 * Environment variables:
 *   COMMITMENT_VAULT  — CommitmentVault deployed address (required)
 *   P0_VALUE          — Override P0 in wei/IFR (optional, defaults to 300000000)
 *   DRY_RUN           — Set to 'true' to print calldata without broadcasting (default: true)
 */

// ── Constants ────────────────────────────────────────────────────────────────

const GOV              = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const TREASURY_SAFE    = "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b";

// Bootstrap actuals (on-chain, finalised 2026-06-05 23:51 UTC)
// TX: 0x949848bdd09f4c867a2593afffb0137c7db2c1457d8a8f5ff4428f8ecce69c5f
const TOTAL_ETH_RAISED_WEI   = "30000000000000000";    // 0.030 ETH
const IFR_ALLOCATION_TOKENS  = "100000000";             // 100M IFR (whole tokens, 9 decimals)

// P0 = totalETHRaised_wei / ifrAllocation_whole_tokens
// = 30_000_000_000_000_000 / 100_000_000 = 300_000_000 wei per 1 IFR
const P0_DEFAULT = ethers.BigNumber.from(TOTAL_ETH_RAISED_WEI)
  .div(ethers.BigNumber.from(IFR_ALLOCATION_TOKENS));  // = 300_000_000

// ── ABIs ─────────────────────────────────────────────────────────────────────

const GOV_ABI = [
  "function propose(address target, bytes calldata calldata_) external returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function getProposal(uint256 id) view returns (address proposer, address target, bytes memory calldata_, uint256 eta, bool executed, bool cancelled)",
  "function owner() view returns (address)",
];

const VAULT_ABI = [
  "function setP0(uint256 _p0) external",
  "function p0() view returns (uint256)",
  "function p0Set() view returns (bool)",
  "function owner() view returns (address)",
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();
  const dryRun     = process.env.DRY_RUN !== "false"; // default: dry-run

  // Resolve P0 value
  const p0Value = process.env.P0_VALUE
    ? ethers.BigNumber.from(process.env.P0_VALUE)
    : P0_DEFAULT;

  // Resolve CommitmentVault address
  const vaultAddress = process.env.COMMITMENT_VAULT;
  if (!vaultAddress || !ethers.utils.isAddress(vaultAddress)) {
    throw new Error(
      "COMMITMENT_VAULT env var missing or invalid.\n" +
      "Set COMMITMENT_VAULT=0x<address> in your .env or environment."
    );
  }

  console.log("=".repeat(64));
  console.log("  INFERNO — Propose setP0 on CommitmentVault (Issue #34)");
  console.log("=".repeat(64));
  console.log(`  Mode:             ${dryRun ? "DRY-RUN (calldata only)" : "LIVE BROADCAST"}`);
  console.log(`  Network:          ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer:         ${deployer.address}`);
  console.log(`  CommitmentVault:  ${vaultAddress}`);
  console.log(`  Governance:       ${GOV}`);
  console.log(`  TreasurySafe:     ${TREASURY_SAFE} (3-of-5, must submit proposal)`);
  console.log();
  console.log("  P0 Calculation:");
  console.log(`    totalETHRaised = ${TOTAL_ETH_RAISED_WEI} wei (0.030 ETH)`);
  console.log(`    ifrAllocation  = ${IFR_ALLOCATION_TOKENS} IFR (whole tokens)`);
  console.log(`    P0             = ${p0Value.toString()} wei/IFR`);
  console.log(`                   = ${ethers.utils.formatUnits(p0Value, 9)} ETH/IFR`);
  console.log(`                   = ${ethers.utils.formatUnits(p0Value, 9)} ETH per 1 IFR token`);
  console.log();

  // Read current state from CommitmentVault
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, deployer.provider);
  const [p0AlreadySet, currentP0, vaultOwner] = await Promise.all([
    vault.p0Set(),
    vault.p0(),
    vault.owner(),
  ]);

  console.log("  On-chain state:");
  console.log(`    CommitmentVault.p0Set():  ${p0AlreadySet}`);
  console.log(`    CommitmentVault.p0():     ${currentP0.toString()}`);
  console.log(`    CommitmentVault.owner():  ${vaultOwner}`);
  console.log();

  if (p0AlreadySet) {
    console.log("  P0 is already set on CommitmentVault.");
    console.log(`  Current P0: ${currentP0.toString()} wei/IFR`);
    console.log("  Nothing to propose. Exiting.");
    return;
  }

  // Governance owner check
  const gov = new ethers.Contract(GOV, GOV_ABI, deployer.provider);
  const govOwner = await gov.owner();
  console.log(`  Governance.owner():  ${govOwner}`);
  const callerIsGovOwner = govOwner.toLowerCase() === deployer.address.toLowerCase();
  console.log(`  Caller is gov owner: ${callerIsGovOwner}`);
  console.log();

  // Encode the setP0 calldata
  const vaultIface  = new ethers.utils.Interface(VAULT_ABI);
  const setP0Calldata = vaultIface.encodeFunctionData("setP0", [p0Value]);

  console.log("  Calldata for setP0:");
  console.log(`    Target:   ${vaultAddress}  (CommitmentVault)`);
  console.log(`    Calldata: ${setP0Calldata}`);
  console.log();

  // Encode Governance.propose() calldata (for Gnosis Safe UI)
  const govIface = new ethers.utils.Interface(GOV_ABI);
  const proposeCalldata = govIface.encodeFunctionData("propose", [vaultAddress, setP0Calldata]);

  console.log("=".repeat(64));
  console.log("  GNOSIS SAFE — Manual Submission (Path B — PRODUCTION)");
  console.log("=".repeat(64));
  console.log(`  URL:      https://app.safe.global/transactions/queue?safe=eth:${TREASURY_SAFE}`);
  console.log(`  To:       ${GOV}  (Governance)`);
  console.log(`  Value:    0`);
  console.log(`  Data:     ${proposeCalldata}`);
  console.log();
  console.log("  After 48h timelock, execute via TreasurySafe:");
  console.log(`  PROPOSAL_ID=<id> npx hardhat run scripts/execute-proposal.js --network mainnet`);
  console.log();

  if (dryRun) {
    console.log("  DRY_RUN=true — no transaction broadcast.");
    console.log("  Set DRY_RUN=false to broadcast (requires deployer = gov owner).");
    console.log("  Recommended: submit via Gnosis Safe UI (see above).");
    return;
  }

  if (!callerIsGovOwner) {
    throw new Error(
      `Deployer (${deployer.address}) is NOT the governance owner.\n` +
      `Gov owner: ${govOwner}\n` +
      "Submit the proposal via Gnosis Safe UI instead (see calldata above)."
    );
  }

  // Live broadcast
  console.log("  Submitting proposal to Governance...");
  const tx = await gov.propose(vaultAddress, setP0Calldata, { gasLimit: 200000 });
  const receipt = await tx.wait();

  console.log(`  TX hash:   ${tx.hash}`);
  console.log(`  Gas used:  ${receipt.gasUsed.toString()}`);

  const count = await gov.proposalCount();
  const proposalId = count.toNumber() - 1;
  const proposal = await gov.getProposal(proposalId);
  const eta = new Date(proposal.eta.toNumber() * 1000);

  console.log();
  console.log("=".repeat(64));
  console.log("  PROPOSAL SUBMITTED");
  console.log("=".repeat(64));
  console.log(`  Proposal ID:  #${proposalId}`);
  console.log(`  ETA:          ${eta.toISOString()} (48h timelock)`);
  console.log(`  Etherscan:    https://etherscan.io/tx/${tx.hash}`);
  console.log();
  console.log("  NEXT STEPS:");
  console.log(`  1. Wait until: ${eta.toISOString()}`);
  console.log(`  2. Execute via TreasurySafe (3-of-5):`);
  console.log(`     PROPOSAL_ID=${proposalId} npx hardhat run scripts/execute-proposal.js --network mainnet`);
  console.log("  3. CommitmentVault.p0Set() == true ✅");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e.message);
    process.exit(1);
  });
