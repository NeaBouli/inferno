const { ethers } = require("hardhat");

/**
 * INFERNO — Live Fee-on-Transfer Verification (Sepolia)
 *
 * Sends 1000 IFR to a random address and verifies:
 *  - Sender loses exactly 1000 IFR
 *  - Recipient receives 96.5% (965 IFR)
 *  - PoolFeeReceiver gets 1% (10 IFR)
 *  - 2.5% burned (25 IFR) → totalSupply decreases
 *
 * Usage: npx hardhat run scripts/test-transfer.js --network sepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const TOKEN_ADDRESS = "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4";
  const DECIMALS = 9;
  const TRANSFER_AMOUNT = "1000"; // 1000 IFR

  const token = await ethers.getContractAt("InfernoToken", TOKEN_ADDRESS);
  const recipient = ethers.Wallet.createRandom().address;

  console.log("=".repeat(60));
  console.log("INFERNO — Live Fee-on-Transfer Test (Sepolia)");
  console.log("=".repeat(60));
  console.log(`Deployer:        ${deployer.address}`);
  console.log(`Recipient:       ${recipient} (random)`);
  console.log(`Transfer Amount: ${TRANSFER_AMOUNT} IFR`);
  console.log("-".repeat(60));

  // ── Read fee rates from contract ──────────────────────────
  const [senderBurnBps, recipientBurnBps, poolFeeBps, poolFeeReceiver] = await Promise.all([
    token.senderBurnBps(),
    token.recipientBurnBps(),
    token.poolFeeBps(),
    token.poolFeeReceiver(),
  ]);

  console.log("\n[Fee Config]");
  console.log(`  Sender Burn:    ${senderBurnBps} bps (${senderBurnBps / 100}%)`);
  console.log(`  Recipient Burn: ${recipientBurnBps} bps (${recipientBurnBps / 100}%)`);
  console.log(`  Pool Fee:       ${poolFeeBps} bps (${poolFeeBps / 100}%)`);
  console.log(`  Pool Receiver:  ${poolFeeReceiver}`);

  // ── Check deployer is NOT fee-exempt ──────────────────────
  const deployerExempt = await token.feeExempt(deployer.address);
  if (deployerExempt) {
    console.log("\n  WARNING: Deployer is feeExempt — fees will NOT apply!");
    console.log("  Run this with a non-exempt sender for accurate results.");
    return;
  }
  console.log(`  Deployer Exempt: ${deployerExempt} (fees will apply)`);

  const senderIsPool = deployer.address.toLowerCase() === poolFeeReceiver.toLowerCase();
  if (senderIsPool) {
    console.log(`  NOTE: Sender == PoolFeeReceiver (pool fee returns to sender)`);
  }

  // ── Snapshot BEFORE ───────────────────────────────────────
  const amount = ethers.utils.parseUnits(TRANSFER_AMOUNT, DECIMALS);
  const [supplyBefore, senderBefore, recipientBefore, poolBefore] = await Promise.all([
    token.totalSupply(),
    token.balanceOf(deployer.address),
    token.balanceOf(recipient),
    senderIsPool
      ? Promise.resolve(null)
      : token.balanceOf(poolFeeReceiver),
  ]);

  console.log("\n[Before Transfer]");
  console.log(`  Total Supply:   ${ethers.utils.formatUnits(supplyBefore, DECIMALS)} IFR`);
  console.log(`  Sender Balance: ${ethers.utils.formatUnits(senderBefore, DECIMALS)} IFR`);
  console.log(`  Recipient Bal:  ${ethers.utils.formatUnits(recipientBefore, DECIMALS)} IFR`);
  if (!senderIsPool) {
    console.log(`  Pool Bal:       ${ethers.utils.formatUnits(poolBefore, DECIMALS)} IFR`);
  }

  // ── Calculate expected values ─────────────────────────────
  const expectedBurnSender = amount.mul(senderBurnBps).div(10000);
  const expectedBurnRecipient = amount.mul(recipientBurnBps).div(10000);
  const expectedPoolFee = amount.mul(poolFeeBps).div(10000);
  const expectedTotalBurn = expectedBurnSender.add(expectedBurnRecipient);
  const expectedNet = amount.sub(expectedTotalBurn).sub(expectedPoolFee);

  console.log("\n[Expected Fees for", TRANSFER_AMOUNT, "IFR]");
  console.log(`  Sender Burn:    ${ethers.utils.formatUnits(expectedBurnSender, DECIMALS)} IFR`);
  console.log(`  Recipient Burn: ${ethers.utils.formatUnits(expectedBurnRecipient, DECIMALS)} IFR`);
  console.log(`  Total Burned:   ${ethers.utils.formatUnits(expectedTotalBurn, DECIMALS)} IFR`);
  console.log(`  Pool Fee:       ${ethers.utils.formatUnits(expectedPoolFee, DECIMALS)} IFR`);
  console.log(`  Net to Recip:   ${ethers.utils.formatUnits(expectedNet, DECIMALS)} IFR`);

  // ── Execute transfer ──────────────────────────────────────
  console.log("\n[Sending Transfer...]");
  const tx = await token.transfer(recipient, amount);
  console.log(`  TX Hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Block:   ${receipt.blockNumber}`);
  console.log(`  Gas:     ${receipt.gasUsed.toString()}`);

  // ── Snapshot AFTER ────────────────────────────────────────
  const [supplyAfter, senderAfter, recipientAfter, poolAfter] = await Promise.all([
    token.totalSupply(),
    token.balanceOf(deployer.address),
    token.balanceOf(recipient),
    senderIsPool
      ? Promise.resolve(null)
      : token.balanceOf(poolFeeReceiver),
  ]);

  const actualSenderLoss = senderBefore.sub(senderAfter);
  const actualRecipientGain = recipientAfter.sub(recipientBefore);
  const actualBurned = supplyBefore.sub(supplyAfter);

  console.log("\n[After Transfer]");
  console.log(`  Total Supply:   ${ethers.utils.formatUnits(supplyAfter, DECIMALS)} IFR`);
  console.log(`  Sender Balance: ${ethers.utils.formatUnits(senderAfter, DECIMALS)} IFR`);
  console.log(`  Recipient Bal:  ${ethers.utils.formatUnits(recipientAfter, DECIMALS)} IFR`);
  if (!senderIsPool) {
    console.log(`  Pool Bal:       ${ethers.utils.formatUnits(poolAfter, DECIMALS)} IFR`);
  }

  // ── Verify results ────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("VERIFICATION");
  console.log("=".repeat(60));

  // When sender == poolFeeReceiver, pool fee returns to sender
  // so sender net loss = amount - poolFee
  const expectedSenderLoss = senderIsPool
    ? amount.sub(expectedPoolFee)
    : amount;

  const checks = [
    {
      name: senderIsPool
        ? "Sender lost amount minus pool fee (sender == pool receiver)"
        : "Sender lost exact amount",
      expected: expectedSenderLoss,
      actual: actualSenderLoss,
    },
    {
      name: "Recipient got 96.5% (net)",
      expected: expectedNet,
      actual: actualRecipientGain,
    },
    {
      name: "Supply decreased by 2.5% (burned)",
      expected: expectedTotalBurn,
      actual: actualBurned,
    },
  ];

  if (!senderIsPool) {
    checks.splice(2, 0, {
      name: "Pool got 1% fee",
      expected: expectedPoolFee,
      actual: poolAfter.sub(poolBefore),
    });
  }

  let allPassed = true;
  for (const check of checks) {
    const pass = check.expected.eq(check.actual);
    const icon = pass ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${check.name}`);
    console.log(`         Expected: ${ethers.utils.formatUnits(check.expected, DECIMALS)} IFR`);
    console.log(`         Actual:   ${ethers.utils.formatUnits(check.actual, DECIMALS)} IFR`);
    if (!pass) allPassed = false;
  }

  console.log("\n" + "-".repeat(60));
  if (allPassed) {
    console.log("  ALL CHECKS PASSED — Deflation mechanics verified on Sepolia!");
  } else {
    console.log("  SOME CHECKS FAILED — Review fee configuration.");
  }
  console.log("-".repeat(60));
  console.log(`  Etherscan TX: https://sepolia.etherscan.io/tx/${tx.hash}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
