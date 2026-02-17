const { ethers } = require("hardhat");

// ── Deployed contract addresses (Sepolia) ──────────────────
const INFERNO_TOKEN = "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4";
const GOVERNANCE = "0x6050b22E4EAF3f414d1155fBaF30B868E0107017";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("INFERNO — Ownership Transfer to Governance");
  console.log("=".repeat(60));
  console.log(`Deployer:    ${deployer.address}`);
  console.log(`Network:     ${network.name} (${network.chainId})`);
  console.log(`Token:       ${INFERNO_TOKEN}`);
  console.log(`Governance:  ${GOVERNANCE}`);
  console.log("-".repeat(60));

  const InfernoToken = await ethers.getContractFactory("InfernoToken");
  const token = InfernoToken.attach(INFERNO_TOKEN);

  // ── Step 1: Verify current owner ────────────────────────
  console.log("\n[1/3] Checking current owner...");
  const currentOwner = await token.owner();
  console.log(`  Current owner: ${currentOwner}`);

  if (currentOwner !== deployer.address) {
    console.error(`  ERROR: Deployer is not the current owner.`);
    console.error(`  Owner is: ${currentOwner}`);
    process.exit(1);
  }
  console.log(`  OK — Deployer is the owner.`);

  // ── Step 2: Transfer ownership ──────────────────────────
  console.log("\n[2/3] Transferring ownership to Governance...");
  console.log(`  WARNING: After this, only Governance (48h timelock) can call:`);
  console.log(`    - setFeeRates()`);
  console.log(`    - setFeeExempt()`);
  console.log(`    - setPoolFeeReceiver()`);

  const tx = await token.transferOwnership(GOVERNANCE);
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt.transactionHash}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

  // ── Step 3: Verify new owner ────────────────────────────
  console.log("\n[3/3] Verifying new owner...");
  const newOwner = await token.owner();
  console.log(`  New owner: ${newOwner}`);

  if (newOwner === GOVERNANCE) {
    console.log(`  SUCCESS — Governance is now the owner of InfernoToken.`);
  } else {
    console.error(`  ERROR: Ownership transfer may have failed.`);
    console.error(`  Expected: ${GOVERNANCE}`);
    console.error(`  Got:      ${newOwner}`);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("OWNERSHIP TRANSFER COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  InfernoToken owner: Governance (${GOVERNANCE})
  Timelock delay:     48 hours

  To change token parameters, use Governance:
    1. governance.propose(token.address, encodedCalldata)
    2. Wait 48 hours
    3. governance.execute(proposalId)
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
