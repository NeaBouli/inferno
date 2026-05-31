const { ethers } = require("hardhat");

/**
 * INFERNO — Call BootstrapVaultV3.finalise() to create LP and lock it.
 *
 * Prerequisites:
 *   1. Bootstrap endTime must have passed (05.06.2026 or later)
 *   2. BootstrapVaultV3 must hold >= 2x ifrAllocation IFR (200M IFR)
 *   3. DEPLOYER_PRIVATE_KEY must be set in .env
 *
 * Any wallet can call finalise() — no owner check in the contract.
 * Permissionless: whoever calls it creates the Uniswap V2 LP.
 *
 * Usage:
 *   npx hardhat run scripts/finalise-bootstrap.js --network mainnet
 *
 * After success:
 *   - Uniswap V2 LP created with all ETH raised + 100M IFR
 *   - LP tokens locked in vault (or via Team.Finance if configured)
 *   - Bootstrap claims unlocked: contributors can claim their 100M IFR share
 *   - Immediately submit Proposal #11: Uniswap Pool feeExempt (CRITICAL)
 */

const BOOTSTRAP_V3_MAINNET = "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141";

const VAULT_ABI = [
  "function finalise() external",
  "function finalised() view returns (bool)",
  "function endTime() view returns (uint256)",
  "function totalETHRaised() view returns (uint256)",
  "function ifrAllocation() view returns (uint256)",
  "function hasRefundOccurred() view returns (bool)",
  "function lpTokenAddress() view returns (address)",
  "function status() view returns (uint64 start, uint64 end, bool active, bool _finalised, uint256 totalETH, uint256 ifrAlloc)",
];

const IFR_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

const IFR_MAINNET = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const DECIMALS = 9;
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);
const fmtEth = (bn) => ethers.utils.formatEther(bn);

async function optionalBool(contract, fnName) {
  try {
    return await contract[fnName]();
  } catch (_) {
    return null;
  }
}

async function main() {
  const [caller] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const callerBalance = await ethers.provider.getBalance(caller.address);
  const now = Math.floor(Date.now() / 1000);

  console.log("=".repeat(60));
  console.log("  INFERNO — BootstrapVaultV3.finalise()");
  console.log("=".repeat(60));
  console.log(`  Caller:    ${caller.address}`);
  console.log(`  Balance:   ${fmtEth(callerBalance)} ETH`);
  console.log(`  Network:   ${network.name} (chainId ${network.chainId})`);
  console.log(`  Vault:     ${BOOTSTRAP_V3_MAINNET}`);

  if (network.chainId !== 1) {
    throw new Error(`Wrong network: expected mainnet chainId 1, got ${network.chainId}.`);
  }

  const vault = new ethers.Contract(BOOTSTRAP_V3_MAINNET, VAULT_ABI, caller);
  const token = new ethers.Contract(IFR_MAINNET, IFR_ABI, caller.provider);

  // ── Pre-flight checks ─────────────────────────────────────
  console.log("\n[1/3] Pre-flight checks...");

  const [finalised, endTime, totalETH, ifrAlloc] = await Promise.all([
    vault.finalised(),
    vault.endTime(),
    vault.totalETHRaised(),
    vault.ifrAllocation(),
  ]);
  const hasRefund = await optionalBool(vault, "hasRefundOccurred");

  const ifrBalance = await token.balanceOf(BOOTSTRAP_V3_MAINNET);
  const endDate = new Date(endTime.toNumber() * 1000).toISOString();
  const secondsLeft = endTime.toNumber() - now;

  console.log(`  Finalised:         ${finalised}`);
  console.log(`  endTime:           ${endDate}`);
  console.log(`  Seconds until end: ${secondsLeft} (${(secondsLeft / 86400).toFixed(1)} days)`);
  console.log(`  totalETHRaised:    ${fmtEth(totalETH)} ETH`);
  console.log(`  ifrAllocation:     ${fmt(ifrAlloc)} IFR`);
  console.log(`  IFR in vault:      ${fmt(ifrBalance)} IFR`);
  console.log(`  Required IFR:      ${fmt(ifrAlloc.mul(2))} IFR (2x allocation)`);
  console.log(`  hasRefundOccurred: ${hasRefund === null ? "n/a (getter not exposed)" : hasRefund}`);

  if (finalised) {
    console.log("\n✅ Already finalised! LP address:", await vault.lpTokenAddress());
    return;
  }

  if (secondsLeft > 0) {
    throw new Error(`Bootstrap still active. ${(secondsLeft / 86400).toFixed(1)} days remaining. Try after ${endDate}.`);
  }

  if (hasRefund === true) {
    throw new Error("Refund has already occurred — finalise() is permanently blocked.");
  }

  if (totalETH.isZero()) {
    console.log("\n⚠️  No ETH raised. finalise() will emit Finalised(0,0,0,0) without creating LP.");
    console.log("   Proceeding anyway (permissionless call still valid).");
  } else {
    const required = ifrAlloc.mul(2);
    if (ifrBalance.lt(required)) {
      throw new Error(
        `Insufficient IFR in vault. Has: ${fmt(ifrBalance)} IFR, needs: ${fmt(required)} IFR. ` +
        `Transfer ${fmt(required.sub(ifrBalance))} more IFR to vault before calling finalise().`
      );
    }
  }

  // ── Gas estimate ──────────────────────────────────────────
  console.log("\n[2/3] Estimating gas...");
  let gasEstimate;
  try {
    gasEstimate = await vault.estimateGas.finalise();
    console.log(`  Gas estimate: ${gasEstimate.toString()}`);
  } catch (e) {
    throw new Error(`Gas estimation failed: ${e.message}. Contract would revert.`);
  }

  // ── Execute finalise() ────────────────────────────────────
  console.log("\n[3/3] Calling finalise()...");
  const tx = await vault.finalise({
    gasLimit: gasEstimate.mul(130).div(100), // 30% buffer
  });
  console.log(`  TX hash:  ${tx.hash}`);
  console.log("  Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log(`  Status:   ${receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log(`  Block:    ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

  // ── Post-check ────────────────────────────────────────────
  const lpAddr = await vault.lpTokenAddress();
  const finalised2 = await vault.finalised();
  console.log(`\n  Finalised: ${finalised2}`);
  console.log(`  LP Token:  ${lpAddr}`);

  console.log("\n" + "=".repeat(60));
  console.log("  🔥 BOOTSTRAP FINALISED");
  console.log("=".repeat(60));
  console.log("\n  CRITICAL NEXT STEPS (do immediately):");
  console.log("  1. Submit Proposal #11: setFeeExempt(Uniswap Pool, true)");
  console.log(`     Pool address: ${lpAddr}`);
  console.log("     WITHOUT THIS: IFR is NOT tradeable on Uniswap!");
  console.log("  2. After 48h timelock: Execute Proposal #11");
  console.log("  3. Announce Bootstrap finalisation to community");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e.message);
    process.exit(1);
  });
