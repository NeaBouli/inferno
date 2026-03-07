const { ethers } = require("hardhat");

/**
 * INFERNO — Create Governance Proposal: setFeeExempt(Vesting, true)
 *
 * Grant feeExempt to Vesting — prevents 3.5% fee on vested token releases.
 * Since InfernoToken ownership is under Governance, feeExempt changes
 * require a 48h timelock proposal.
 *
 * Usage:
 *   MAINNET:  npx hardhat run scripts/propose-feeexempt-vesting.js --network mainnet
 */

// ── Mainnet Addresses ────────────────────────────────────────
const TOKEN      = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const VESTING    = "0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("  INFERNO — Propose setFeeExempt(Vesting)");
  console.log("=".repeat(60));
  console.log(`  Deployer:    ${deployer.address}`);
  console.log(`  Network:     ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Governance:  ${GOVERNANCE}`);
  console.log(`  Target:      ${TOKEN} (InfernoToken)`);
  console.log(`  Vesting:     ${VESTING}`);
  console.log(`  Description: Grant feeExempt to Vesting — prevents 3.5% fee on vested token releases`);

  // ── Encode calldata ────────────────────────────────────────
  const iface = new ethers.utils.Interface([
    "function setFeeExempt(address account, bool exempt)",
  ]);
  const calldata = iface.encodeFunctionData("setFeeExempt", [VESTING, true]);

  console.log(`\n  Calldata: ${calldata}`);
  console.log(`  Decoded:  setFeeExempt(${VESTING}, true)`);

  // ── Submit proposal ────────────────────────────────────────
  console.log("\n  Submitting governance.propose()...");

  const governance = await ethers.getContractAt("Governance", GOVERNANCE);
  const tx = await governance.propose(TOKEN, calldata);
  const receipt = await tx.wait();

  console.log(`  TX:       ${tx.hash}`);
  console.log(`  Block:    ${receipt.blockNumber}`);
  console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);

  // ── Read proposal details ──────────────────────────────────
  const count = await governance.proposalCount();
  const proposalId = count.toNumber() - 1;

  const proposal = await governance.getProposal(proposalId);
  const etaDate = new Date(proposal.eta.toNumber() * 1000);

  console.log(`\n  Proposal ID:  ${proposalId}`);
  console.log(`  ETA:          ${etaDate.toISOString()}`);
  console.log(`  ETA (Berlin): ${etaDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`);
  console.log(`  Executed:     ${proposal.executed}`);
  console.log(`  Cancelled:    ${proposal.cancelled}`);

  console.log("\n" + "=".repeat(60));
  console.log("  PROPOSAL CREATED SUCCESSFULLY");
  console.log("=".repeat(60));
  console.log(`
  After 48 hours, execute with:
    PROPOSAL_ID=${proposalId} npx hardhat run scripts/execute-proposal.js --network mainnet

  Etherscan: https://etherscan.io/tx/${tx.hash}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
