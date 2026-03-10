const { ethers } = require("hardhat");

/**
 * INFERNO — Create Governance Proposal: setPoolFeeReceiver(FeeRouterV1)
 *
 * Redirects the 1% pool fee from deployer EOA to FeeRouterV1,
 * which splits it between BuybackVault and BurnReserve.
 * Since InfernoToken ownership is under Governance, poolFeeReceiver
 * changes require a 48h timelock proposal.
 *
 * Usage:
 *   MAINNET:  npx hardhat run scripts/propose-set-pool-fee-receiver.js --network mainnet
 */

// ── Mainnet Addresses ────────────────────────────────────────
const TOKEN        = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE   = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const FEE_ROUTER   = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("  INFERNO — Propose setPoolFeeReceiver(FeeRouterV1)");
  console.log("=".repeat(60));
  console.log(`  Deployer:      ${deployer.address}`);
  console.log(`  Network:       ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Governance:    ${GOVERNANCE}`);
  console.log(`  Target:        ${TOKEN} (InfernoToken)`);
  console.log(`  FeeRouterV1:   ${FEE_ROUTER}`);
  console.log(`  Description:   Set poolFeeReceiver to FeeRouterV1 — routes 1% pool fee to Buyback + Burn`);

  // ── Pre-flight: verify current poolFeeReceiver ───────────────
  const token = await ethers.getContractAt("InfernoToken", TOKEN);
  const currentReceiver = await token.poolFeeReceiver();
  console.log(`\n  Current poolFeeReceiver: ${currentReceiver}`);

  if (currentReceiver.toLowerCase() === FEE_ROUTER.toLowerCase()) {
    console.log("  poolFeeReceiver is already FeeRouterV1 — nothing to do.");
    process.exit(0);
  }

  // ── Encode calldata ────────────────────────────────────────
  const iface = new ethers.utils.Interface([
    "function setPoolFeeReceiver(address receiver)",
  ]);
  const calldata = iface.encodeFunctionData("setPoolFeeReceiver", [FEE_ROUTER]);

  console.log(`\n  Calldata: ${calldata}`);
  console.log(`  Decoded:  setPoolFeeReceiver(${FEE_ROUTER})`);

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
