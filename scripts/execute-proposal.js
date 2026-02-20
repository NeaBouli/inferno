const { ethers } = require("hardhat");

/**
 * INFERNO — Execute Governance Proposal #0
 *
 * Checks the status and ETA of Proposal #0 (setFeeExempt).
 * If the timelock has elapsed, executes the proposal and verifies the result.
 * If not yet ready, displays a countdown.
 *
 * Usage: npx hardhat run scripts/execute-proposal.js --network sepolia
 */

const DECIMALS = 9;
const ADDRESSES = {
  token:      "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  governance: "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
};

const PROPOSAL_ID = 0;

function hr(title) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function formatCountdown(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const token = await ethers.getContractAt("InfernoToken", ADDRESSES.token);
  const governance = await ethers.getContractAt("Governance", ADDRESSES.governance);

  const network = await ethers.provider.getNetwork();
  const block = await ethers.provider.getBlock("latest");
  const blockTimestamp = block.timestamp;

  console.log("=".repeat(60));
  console.log("  INFERNO — Execute Governance Proposal");
  console.log("=".repeat(60));
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Network:    ${network.name} (${network.chainId})`);
  console.log(`  Block:      ${block.number}`);
  console.log(`  Block Time: ${new Date(blockTimestamp * 1000).toISOString()}`);

  // ── Step 1: Read Proposal #0 ─────────────────────────────
  hr(`1. PROPOSAL #${PROPOSAL_ID} — STATUS`);

  const proposal = await governance.getProposal(PROPOSAL_ID);
  const { target, data, eta, executed, cancelled } = proposal;
  const etaNum = eta.toNumber();
  const etaDate = new Date(etaNum * 1000);

  // Decode the calldata
  const iface = new ethers.utils.Interface([
    "function setFeeExempt(address,bool)",
  ]);
  let decodedAddr, decodedBool;
  try {
    const decoded = iface.decodeFunctionData("setFeeExempt", data);
    decodedAddr = decoded[0];
    decodedBool = decoded[1];
  } catch {
    console.log("  WARNING: Could not decode calldata as setFeeExempt");
  }

  console.log(`  Proposal ID: ${PROPOSAL_ID}`);
  console.log(`  Target:      ${target}`);
  if (decodedAddr) {
    console.log(`  Action:      setFeeExempt(${decodedAddr}, ${decodedBool})`);
  }
  console.log(`  Calldata:    ${data.slice(0, 42)}...`);
  console.log(`  ETA:         ${etaDate.toISOString()}`);
  console.log(`               ${etaDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Berlin)`);
  console.log(`  Executed:    ${executed}`);
  console.log(`  Cancelled:   ${cancelled}`);

  // ── Step 2: Check executability ───────────────────────────
  hr("2. EXECUTABILITY CHECK");

  if (executed) {
    console.log("  Proposal has already been executed.");
    console.log("  Nothing to do.");
    return;
  }

  if (cancelled) {
    console.log("  Proposal has been cancelled.");
    console.log("  Cannot execute a cancelled proposal.");
    return;
  }

  const remaining = etaNum - blockTimestamp;

  if (remaining > 0) {
    console.log(`  NOT YET EXECUTABLE`);
    console.log(`  Current block time: ${new Date(blockTimestamp * 1000).toISOString()}`);
    console.log(`  ETA:                ${etaDate.toISOString()}`);
    console.log(`  Countdown:          ${formatCountdown(remaining)}`);
    console.log(`\n  Try again after: ${etaDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Berlin)`);
    return;
  }

  console.log(`  READY TO EXECUTE`);
  console.log(`  ETA passed ${formatCountdown(Math.abs(remaining))} ago`);

  // ── Step 3: Check feeExempt BEFORE ────────────────────────
  hr("3. EXECUTE PROPOSAL");

  if (decodedAddr) {
    const exemptBefore = await token.feeExempt(decodedAddr);
    console.log(`  feeExempt(${decodedAddr}) BEFORE: ${exemptBefore}`);
  }

  console.log(`\n  Executing governance.execute(${PROPOSAL_ID})...`);
  const tx = await governance.execute(PROPOSAL_ID);
  const receipt = await tx.wait();

  console.log(`  TX:       ${tx.hash}`);
  console.log(`  Block:    ${receipt.blockNumber}`);
  console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`  Status:   ${receipt.status === 1 ? "SUCCESS" : "FAILED"}`);

  // ── Step 4: Verify result ─────────────────────────────────
  hr("4. VERIFICATION");

  const proposalAfter = await governance.getProposal(PROPOSAL_ID);
  console.log(`  Proposal executed: ${proposalAfter.executed}`);

  if (decodedAddr) {
    const exemptAfter = await token.feeExempt(decodedAddr);
    console.log(`  feeExempt(${decodedAddr}) AFTER: ${exemptAfter}`);

    if (exemptAfter === decodedBool) {
      console.log(`\n  SUCCESS — setFeeExempt was applied correctly via Governance!`);
    } else {
      console.log(`\n  WARNING — feeExempt value does not match expected: ${decodedBool}`);
    }
  }

  console.log(`\n  Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
