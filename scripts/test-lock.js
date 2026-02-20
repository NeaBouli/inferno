const { ethers } = require("hardhat");

/**
 * INFERNO — Live IFRLock Test on Sepolia
 *
 * Tests lock, isLocked, unlock, and balance verification.
 * Checks feeExempt status first — if not set, fees affect amounts.
 *
 * Usage: npx hardhat run scripts/test-lock.js --network sepolia
 */

const DECIMALS = 9;
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);
const parse = (s) => ethers.utils.parseUnits(s, DECIMALS);

const ADDRESSES = {
  token:    "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  lock:     "0x0Cab0A9440643128540222acC6eF5028736675d3",
};

function hr(title) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function result(name, pass, detail) {
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name}`);
  if (detail) console.log(`         ${detail}`);
  return pass;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const token = await ethers.getContractAt("InfernoToken", ADDRESSES.token);
  const lock = await ethers.getContractAt("IFRLock", ADDRESSES.lock);

  const results = [];

  console.log("=".repeat(60));
  console.log("  INFERNO — IFRLock Live Test");
  console.log("=".repeat(60));
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Token:    ${ADDRESSES.token}`);
  console.log(`  IFRLock:  ${ADDRESSES.lock}`);

  // ── Pre-flight: Check feeExempt status ────────────────────
  hr("0. PRE-FLIGHT CHECK");

  const lockExempt = await token.feeExempt(ADDRESSES.lock);
  const deployerExempt = await token.feeExempt(deployer.address);
  const feeFree = lockExempt || deployerExempt;

  console.log(`  IFRLock feeExempt:  ${lockExempt}`);
  console.log(`  Deployer feeExempt: ${deployerExempt}`);
  console.log(`  Fee-free transfers: ${feeFree}`);

  if (!feeFree) {
    console.log(`\n  WARNING: IFRLock is NOT feeExempt yet.`);
    console.log(`  Governance Proposal #1 must be executed first.`);
    console.log(`  Fees will be deducted — unlock will fail.`);
    console.log(`  Running partial test (lock + isLocked only)...\n`);
  }

  const lockAmount = parse("5000");

  // ── Step 1: Lock 5000 IFR ─────────────────────────────────
  hr("1. LOCK 5000 IFR");

  const balBefore = await token.balanceOf(deployer.address);
  console.log(`  Balance before: ${fmt(balBefore)} IFR`);

  console.log(`  Approving ${fmt(lockAmount)} IFR...`);
  const approveTx = await token.approve(ADDRESSES.lock, lockAmount);
  await approveTx.wait();

  console.log(`  Locking ${fmt(lockAmount)} IFR...`);
  const lockTx = await lock.lock(lockAmount);
  const lockReceipt = await lockTx.wait();
  console.log(`  TX:   ${lockTx.hash}`);
  console.log(`  Gas:  ${lockReceipt.gasUsed.toString()}`);

  const balAfterLock = await token.balanceOf(deployer.address);
  const lockedBal = await lock.lockedBalance(deployer.address);
  const contractBal = await token.balanceOf(ADDRESSES.lock);
  const totalLocked = await lock.totalLocked();

  console.log(`  Balance after:  ${fmt(balAfterLock)} IFR`);
  console.log(`  lockedBalance:  ${fmt(lockedBal)} IFR`);
  console.log(`  Contract holds: ${fmt(contractBal)} IFR`);
  console.log(`  totalLocked:    ${fmt(totalLocked)} IFR`);

  results.push(result(
    "lockedBalance == 5000 IFR",
    lockedBal.eq(lockAmount),
    `Expected: ${fmt(lockAmount)} | Actual: ${fmt(lockedBal)}`
  ));

  // ── Step 2: Check isLocked ────────────────────────────────
  hr("2. isLocked() CHECKS");

  const isLocked5000 = await lock.isLocked(deployer.address, parse("5000"));
  const isLocked10000 = await lock.isLocked(deployer.address, parse("10000"));
  const isLocked1 = await lock.isLocked(deployer.address, parse("1"));

  results.push(result(
    "isLocked(deployer, 5000) == true",
    isLocked5000 === true,
    `Actual: ${isLocked5000}`
  ));

  results.push(result(
    "isLocked(deployer, 10000) == false",
    isLocked10000 === false,
    `Actual: ${isLocked10000}`
  ));

  results.push(result(
    "isLocked(deployer, 1) == true",
    isLocked1 === true,
    `Actual: ${isLocked1}`
  ));

  // ── Step 3: lockInfo ──────────────────────────────────────
  hr("3. lockInfo()");

  const info = await lock.lockInfo(deployer.address);
  console.log(`  amount:   ${fmt(info.amount)} IFR`);
  console.log(`  lockedAt: ${info.lockedAt.toString()} (${new Date(info.lockedAt.toNumber() * 1000).toISOString()})`);

  results.push(result(
    "lockInfo.amount == 5000 IFR",
    info.amount.eq(lockAmount),
    `Actual: ${fmt(info.amount)}`
  ));

  // ── Step 4: Unlock ────────────────────────────────────────
  if (feeFree) {
    hr("4. UNLOCK");

    console.log(`  Unlocking all IFR...`);
    const unlockTx = await lock.unlock();
    const unlockReceipt = await unlockTx.wait();
    console.log(`  TX:   ${unlockTx.hash}`);
    console.log(`  Gas:  ${unlockReceipt.gasUsed.toString()}`);

    const balAfterUnlock = await token.balanceOf(deployer.address);
    const lockedAfter = await lock.lockedBalance(deployer.address);
    const isLockedAfter = await lock.isLocked(deployer.address, parse("1"));
    const totalLockedAfter = await lock.totalLocked();

    console.log(`  Balance after:  ${fmt(balAfterUnlock)} IFR`);
    console.log(`  lockedBalance:  ${fmt(lockedAfter)} IFR`);
    console.log(`  totalLocked:    ${fmt(totalLockedAfter)} IFR`);

    results.push(result(
      "lockedBalance == 0 after unlock",
      lockedAfter.eq(0),
      `Actual: ${fmt(lockedAfter)}`
    ));

    results.push(result(
      "isLocked(deployer, 1) == false after unlock",
      isLockedAfter === false,
      `Actual: ${isLockedAfter}`
    ));

    results.push(result(
      "Balance restored after unlock",
      balAfterUnlock.eq(balBefore),
      `Before: ${fmt(balBefore)} | After: ${fmt(balAfterUnlock)}`
    ));
  } else {
    hr("4. UNLOCK (SKIPPED)");
    console.log(`  Skipped — feeExempt not yet set.`);
    console.log(`  Unlock would fail: contract holds less than recorded amount.`);
    console.log(`  Execute Governance Proposal #1 first, then re-run this test.`);
  }

  // ── Summary ───────────────────────────────────────────────
  hr("SUMMARY");

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log(`  Checks: ${passed}/${total} passed`);
  if (!feeFree) {
    console.log(`  (Unlock skipped — waiting for feeExempt proposal)`);
  }

  console.log(`\n  Etherscan:`);
  console.log(`    IFRLock: https://sepolia.etherscan.io/address/${ADDRESSES.lock}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
