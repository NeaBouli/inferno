const { ethers } = require("hardhat");

/**
 * INFERNO — Top-up PartnerVault with IFR tokens
 *
 * Transfers 1.4M IFR from deployer to PartnerVault v2.
 * The vault must be feeExempt on InfernoToken for the full
 * amount to arrive (otherwise 2.5% burn + 1% pool fee applies).
 *
 * Usage: npx hardhat run scripts/topup-partnervault.js --network sepolia
 */

const DECIMALS = 9;

const ADDRESSES = {
  token: "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  partnerVault: "0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39",
};

const TOPUP_AMOUNT = "1400000"; // 1.4M IFR

function fmt(bn) {
  return ethers.utils.formatUnits(bn, DECIMALS);
}

function parse(str) {
  return ethers.utils.parseUnits(str, DECIMALS);
}

function hr(title) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const token = await ethers.getContractAt("InfernoToken", ADDRESSES.token);

  const network = await ethers.provider.getNetwork();
  console.log("=".repeat(60));
  console.log("  INFERNO — PartnerVault Top-up");
  console.log("=".repeat(60));
  console.log(`  Deployer:      ${deployer.address}`);
  console.log(`  Network:       ${network.name} (${network.chainId})`);
  console.log(`  Token:         ${ADDRESSES.token}`);
  console.log(`  PartnerVault:  ${ADDRESSES.partnerVault}`);
  console.log(`  Amount:        ${TOPUP_AMOUNT} IFR`);

  // ── Step 1: Pre-checks ───────────────────────────────────
  hr("1. PRE-CHECKS");

  const deployerBalance = await token.balanceOf(deployer.address);
  const vaultBalanceBefore = await token.balanceOf(ADDRESSES.partnerVault);
  const feeExempt = await token.feeExempt(ADDRESSES.partnerVault);

  console.log(`  Deployer balance:    ${fmt(deployerBalance)} IFR`);
  console.log(`  Vault balance:       ${fmt(vaultBalanceBefore)} IFR`);
  console.log(`  Vault feeExempt:     ${feeExempt}`);

  const amount = parse(TOPUP_AMOUNT);
  if (deployerBalance.lt(amount)) {
    console.log(`\n  ERROR — Deployer has insufficient balance!`);
    console.log(`  Required: ${TOPUP_AMOUNT} IFR`);
    console.log(`  Available: ${fmt(deployerBalance)} IFR`);
    process.exit(1);
  }

  if (!feeExempt) {
    console.log(`\n  WARNING — PartnerVault is NOT feeExempt!`);
    console.log(`  Transfer will incur 2.5% burn + 1% pool fee.`);
    console.log(`  Execute Proposal #3 first to set feeExempt.`);
    process.exit(1);
  }

  console.log(`  All checks passed.`);

  // ── Step 2: Transfer ─────────────────────────────────────
  hr("2. TRANSFER");

  console.log(`  Sending ${TOPUP_AMOUNT} IFR to PartnerVault...`);
  const tx = await token.transfer(ADDRESSES.partnerVault, amount);
  const receipt = await tx.wait();

  console.log(`  TX:       ${tx.hash}`);
  console.log(`  Block:    ${receipt.blockNumber}`);
  console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`  Status:   ${receipt.status === 1 ? "SUCCESS" : "FAILED"}`);

  // ── Step 3: Verification ─────────────────────────────────
  hr("3. VERIFICATION");

  const vaultBalanceAfter = await token.balanceOf(ADDRESSES.partnerVault);
  const deployerBalanceAfter = await token.balanceOf(deployer.address);
  const received = vaultBalanceAfter.sub(vaultBalanceBefore);

  console.log(`  Vault balance BEFORE: ${fmt(vaultBalanceBefore)} IFR`);
  console.log(`  Vault balance AFTER:  ${fmt(vaultBalanceAfter)} IFR`);
  console.log(`  Received:             ${fmt(received)} IFR`);
  console.log(`  Deployer balance:     ${fmt(deployerBalanceAfter)} IFR`);

  if (received.eq(amount)) {
    console.log(`\n  SUCCESS — Full ${TOPUP_AMOUNT} IFR received (feeExempt transfer)`);
  } else {
    console.log(`\n  WARNING — Received ${fmt(received)} IFR instead of ${TOPUP_AMOUNT} IFR`);
  }

  console.log(`\n  Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
