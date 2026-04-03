const { ethers } = require("hardhat");

/**
 * INFERNO — Create Governance Proposals for feeExempt
 * Proposes setFeeExempt(true) for BootstrapVaultV3 and FeeRouterV1
 *
 * Usage:
 *   npx hardhat run scripts/propose-feeexempt-batch.js --network mainnet
 */

const TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOV   = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";

const TARGETS = [
  { label: "BootstrapVaultV3", address: "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141" },
  { label: "FeeRouterV1",      address: "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a" },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("  INFERNO — Batch Propose setFeeExempt");
  console.log("=".repeat(60));
  console.log(`  Deployer:    ${deployer.address}`);
  console.log(`  Network:     ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Balance:     ${ethers.utils.formatEther(await deployer.getBalance())} ETH`);
  console.log(`  Governance:  ${GOV}`);
  console.log(`  Token:       ${TOKEN}`);

  const governance = await ethers.getContractAt("Governance", GOV);
  const token = await ethers.getContractAt("InfernoToken", TOKEN);
  const iface = new ethers.utils.Interface([
    "function setFeeExempt(address account, bool exempt)",
  ]);

  for (const t of TARGETS) {
    console.log("\n" + "-".repeat(60));

    // Check if already exempt
    const alreadyExempt = await token.feeExempt(t.address);
    if (alreadyExempt) {
      console.log(`  ${t.label} (${t.address}): ALREADY EXEMPT — skipping`);
      continue;
    }

    console.log(`  Proposing: setFeeExempt(${t.label}, true)`);
    console.log(`  Address:   ${t.address}`);

    const calldata = iface.encodeFunctionData("setFeeExempt", [t.address, true]);
    console.log(`  Calldata:  ${calldata.slice(0, 42)}...`);

    const tx = await governance.propose(TOKEN, calldata);
    const receipt = await tx.wait();

    console.log(`  TX:        ${tx.hash}`);
    console.log(`  Gas:       ${receipt.gasUsed.toString()}`);

    const count = await governance.proposalCount();
    const proposalId = count.toNumber() - 1;
    const p = await governance.getProposal(proposalId);
    const eta = new Date(p.eta.toNumber() * 1000);

    console.log(`  Proposal:  #${proposalId}`);
    console.log(`  ETA:       ${eta.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} CET`);
    console.log(`  Etherscan: https://etherscan.io/tx/${tx.hash}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  ALL PROPOSALS SUBMITTED");
  console.log("=".repeat(60));

  // Summary
  const totalProposals = await governance.proposalCount();
  console.log(`  Total proposals: ${totalProposals.toString()}`);
  console.log(`\n  Execute after 48h with:`);
  console.log(`    PROPOSAL_ID=<id> npx hardhat run scripts/execute-proposal.js --network mainnet`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
