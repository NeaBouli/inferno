const { ethers } = require("hardhat");

/**
 * INFERNO — Sepolia Smoke Test
 *
 * Comprehensive live verification of all protocol mechanics:
 *   1. Fee-on-Transfer (10,000 IFR transfer)
 *   2. Burn / Supply verification
 *   3. Governance proposal creation
 *   4. Contract state checks
 *
 * Usage: npx hardhat run scripts/sepolia-smoke-test.js --network sepolia
 */

const DECIMALS = 9;
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);
const parse = (s) => ethers.utils.parseUnits(s, DECIMALS);
const INITIAL_SUPPLY = parse("1000000000");

const ADDRESSES = {
  token:      "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  reserve:    "0xF7E90D0d17f8232365186AA085D26eaEfAf011aF",
  vesting:    "0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B",
  buyback:    "0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C",
  burn:       "0x6D4582FCac792FD3880e252fC0a585A0c1823e80",
  governance: "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
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
  const governance = await ethers.getContractAt("Governance", ADDRESSES.governance);
  const buyback = await ethers.getContractAt("BuybackVault", ADDRESSES.buyback);
  const reserve = await ethers.getContractAt("LiquidityReserve", ADDRESSES.reserve);

  const results = [];
  const now = Math.floor(Date.now() / 1000);

  console.log("=".repeat(60));
  console.log("  INFERNO — Sepolia Smoke Test");
  console.log("=".repeat(60));
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Network:  ${(await ethers.provider.getNetwork()).name}`);
  console.log(`  Time:     ${new Date().toISOString()}`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. FEE TRANSFER TEST
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  hr("1. FEE TRANSFER TEST (10,000 IFR)");

  const amount = parse("10000");
  const recipient = ethers.Wallet.createRandom().address;
  const poolFeeReceiver = await token.poolFeeReceiver();
  const senderIsPool = deployer.address.toLowerCase() === poolFeeReceiver.toLowerCase();

  const [senderBurnBps, recipientBurnBps, poolFeeBps] = await Promise.all([
    token.senderBurnBps(),
    token.recipientBurnBps(),
    token.poolFeeBps(),
  ]);

  // Expected
  const expBurnSender    = amount.mul(senderBurnBps).div(10000);
  const expBurnRecipient = amount.mul(recipientBurnBps).div(10000);
  const expPoolFee       = amount.mul(poolFeeBps).div(10000);
  const expTotalBurn     = expBurnSender.add(expBurnRecipient);
  const expNet           = amount.sub(expTotalBurn).sub(expPoolFee);

  console.log(`  Recipient:       ${recipient}`);
  console.log(`  PoolFeeReceiver: ${poolFeeReceiver}${senderIsPool ? " (== Sender)" : ""}`);
  console.log(`  Fees:            ${senderBurnBps}/${recipientBurnBps}/${poolFeeBps} bps`);
  console.log(`  Expected Net:    ${fmt(expNet)} IFR (${fmt(expTotalBurn)} burn, ${fmt(expPoolFee)} pool)`);

  // Snapshot before
  const [supplyBefore, senderBefore, recipientBefore, poolBefore] = await Promise.all([
    token.totalSupply(),
    token.balanceOf(deployer.address),
    token.balanceOf(recipient),
    senderIsPool ? token.balanceOf(deployer.address) : token.balanceOf(poolFeeReceiver),
  ]);

  console.log(`\n  [Before]`);
  console.log(`    totalSupply:  ${fmt(supplyBefore)} IFR`);
  console.log(`    sender:       ${fmt(senderBefore)} IFR`);
  console.log(`    recipient:    ${fmt(recipientBefore)} IFR`);

  // Transfer
  console.log(`\n  Sending 10,000 IFR...`);
  const tx1 = await token.transfer(recipient, amount);
  const receipt1 = await tx1.wait();
  console.log(`    TX:    ${tx1.hash}`);
  console.log(`    Block: ${receipt1.blockNumber} | Gas: ${receipt1.gasUsed}`);

  // Snapshot after
  const [supplyAfter, senderAfter, recipientAfter, poolAfter] = await Promise.all([
    token.totalSupply(),
    token.balanceOf(deployer.address),
    token.balanceOf(recipient),
    senderIsPool ? token.balanceOf(deployer.address) : token.balanceOf(poolFeeReceiver),
  ]);

  const actualRecipientGain = recipientAfter.sub(recipientBefore);
  const actualBurned = supplyBefore.sub(supplyAfter);
  const actualSenderLoss = senderBefore.sub(senderAfter);

  console.log(`\n  [After]`);
  console.log(`    totalSupply:  ${fmt(supplyAfter)} IFR`);
  console.log(`    sender:       ${fmt(senderAfter)} IFR`);
  console.log(`    recipient:    ${fmt(recipientAfter)} IFR`);

  console.log();
  results.push(result(
    "Recipient received 96.5% (9,650 IFR)",
    expNet.eq(actualRecipientGain),
    `Expected: ${fmt(expNet)} | Actual: ${fmt(actualRecipientGain)}`
  ));

  results.push(result(
    "totalSupply decreased by 2.5% (250 IFR burned)",
    expTotalBurn.eq(actualBurned),
    `Expected: ${fmt(expTotalBurn)} | Actual: ${fmt(actualBurned)}`
  ));

  if (senderIsPool) {
    const expSenderLoss = amount.sub(expPoolFee);
    results.push(result(
      "Sender lost 9,900 IFR (10,000 - 100 pool fee returned)",
      expSenderLoss.eq(actualSenderLoss),
      `Expected: ${fmt(expSenderLoss)} | Actual: ${fmt(actualSenderLoss)}`
    ));
  } else {
    const actualPoolGain = poolAfter.sub(poolBefore);
    results.push(result(
      "PoolFeeReceiver got 1% (100 IFR)",
      expPoolFee.eq(actualPoolGain),
      `Expected: ${fmt(expPoolFee)} | Actual: ${fmt(actualPoolGain)}`
    ));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. BURN VERIFICATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  hr("2. BURN VERIFICATION");

  const totalBurnedAll = INITIAL_SUPPLY.sub(supplyAfter);
  const burnPercent = totalBurnedAll.mul(10000).div(INITIAL_SUPPLY).toNumber() / 100;

  console.log(`  Initial Supply:  1,000,000,000.0 IFR`);
  console.log(`  Current Supply:  ${fmt(supplyAfter)} IFR`);
  console.log(`  Total Burned:    ${fmt(totalBurnedAll)} IFR`);
  console.log(`  Burn Rate:       ${burnPercent}%`);

  results.push(result(
    "totalSupply < initial supply (deflation active)",
    supplyAfter.lt(INITIAL_SUPPLY),
    `${fmt(INITIAL_SUPPLY)} → ${fmt(supplyAfter)} (-${fmt(totalBurnedAll)})`
  ));

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. GOVERNANCE CHECK — Create Test Proposal
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  hr("3. GOVERNANCE — Test Proposal");

  const dummyAddr = ethers.Wallet.createRandom().address;
  const iface = new ethers.utils.Interface([
    "function setFeeExempt(address,bool)",
  ]);
  const calldata = iface.encodeFunctionData("setFeeExempt", [dummyAddr, true]);

  console.log(`  Target:   InfernoToken (${ADDRESSES.token})`);
  console.log(`  Action:   setFeeExempt(${dummyAddr.slice(0, 10)}..., true)`);
  console.log(`  Calldata: ${calldata.slice(0, 20)}...`);

  console.log(`\n  Sending propose()...`);
  const tx2 = await governance.propose(ADDRESSES.token, calldata);
  const receipt2 = await tx2.wait();

  // Parse ProposalCreated event
  const govIface = new ethers.utils.Interface([
    "event ProposalCreated(uint256 indexed id, address target, bytes data, uint256 eta)",
  ]);
  let proposalId, eta;
  for (const log of receipt2.logs) {
    try {
      const parsed = govIface.parseLog(log);
      proposalId = parsed.args.id.toNumber();
      eta = parsed.args.eta.toNumber();
      break;
    } catch { /* skip non-matching logs */ }
  }

  const delay = await governance.delay();
  const etaDate = new Date(eta * 1000);
  const hoursUntil = ((eta - now) / 3600).toFixed(1);

  console.log(`    TX:         ${tx2.hash}`);
  console.log(`    Block:      ${receipt2.blockNumber}`);
  console.log(`    ProposalId: ${proposalId}`);
  console.log(`    ETA:        ${etaDate.toISOString()} (in ~${hoursUntil}h)`);
  console.log(`    Status:     Pending (execute after ETA)`);

  // Verify proposal
  const proposal = await governance.getProposal(proposalId);
  results.push(result(
    "Proposal created successfully",
    proposal.target === ADDRESSES.token && !proposal.executed && !proposal.cancelled,
    `ID: ${proposalId} | Target: ${proposal.target.slice(0, 10)}... | ETA: ${etaDate.toLocaleString()}`
  ));

  results.push(result(
    "Proposal ETA = now + delay (48h)",
    proposal.eta.toNumber() > now && proposal.eta.toNumber() <= now + delay.toNumber() + 60,
    `Delay: ${delay.toNumber() / 3600}h | ETA: ${etaDate.toISOString()}`
  ));

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. CONTRACT STATE CHECK
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  hr("4. CONTRACT STATE CHECK");

  const [
    tokenOwner,
    govOwner,
    govGuardian,
    govDelay,
    activationTime,
    lockEnd,
  ] = await Promise.all([
    token.owner(),
    governance.owner(),
    governance.guardian(),
    governance.delay(),
    buyback.activationTime(),
    reserve.lockEnd(),
  ]);

  const activationDate = new Date(activationTime.toNumber() * 1000);
  const lockEndDate = new Date(lockEnd.toNumber() * 1000);
  const daysUntilActivation = ((activationTime.toNumber() - now) / 86400).toFixed(1);
  const daysUntilUnlock = ((lockEnd.toNumber() - now) / 86400).toFixed(1);

  results.push(result(
    "token.owner() == Governance",
    tokenOwner.toLowerCase() === ADDRESSES.governance.toLowerCase(),
    `token.owner() = ${tokenOwner.slice(0, 10)}... | Governance = ${ADDRESSES.governance.slice(0, 10)}...`
  ));

  results.push(result(
    "governance.owner() == Deployer",
    govOwner.toLowerCase() === deployer.address.toLowerCase(),
    `governance.owner() = ${govOwner.slice(0, 10)}... | Deployer = ${deployer.address.slice(0, 10)}...`
  ));

  results.push(result(
    "governance.delay() == 48h (172800s)",
    govDelay.toNumber() === 172800,
    `Actual: ${govDelay.toNumber()}s (${govDelay.toNumber() / 3600}h)`
  ));

  results.push(result(
    "buybackVault.activationTime > now",
    activationTime.toNumber() > now,
    `Activation: ${activationDate.toISOString()} (in ${daysUntilActivation} days)`
  ));

  results.push(result(
    "liquidityReserve.lockEnd > now",
    lockEnd.toNumber() > now,
    `Lock End: ${lockEndDate.toISOString()} (in ${daysUntilUnlock} days)`
  ));

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SUMMARY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  hr("SUMMARY");

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;

  console.log(`  Total Checks: ${results.length}`);
  console.log(`  Passed:       ${passed}`);
  console.log(`  Failed:       ${failed}`);
  console.log();

  if (failed === 0) {
    console.log("  ALL CHECKS PASSED — Inferno is fully operational on Sepolia!");
  } else {
    console.log(`  ${failed} CHECK(S) FAILED — Review output above.`);
  }

  console.log("\n  TX Links:");
  console.log(`    Transfer: https://sepolia.etherscan.io/tx/${tx1.hash}`);
  console.log(`    Proposal: https://sepolia.etherscan.io/tx/${tx2.hash}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
