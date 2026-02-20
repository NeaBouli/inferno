const { ethers } = require("hardhat");

/**
 * INFERNO — Deploy IFRLock + Create Governance Proposal for feeExempt
 *
 * 1. Deploy IFRLock(token, deployer-as-guardian)
 * 2. Create Governance proposal: token.setFeeExempt(ifrLock, true)
 * 3. Display contract address and proposal ETA
 *
 * Usage: npx hardhat run scripts/deploy-lock.js --network sepolia
 */

const ADDRESSES = {
  token:      "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  governance: "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("  INFERNO — Deploy IFRLock");
  console.log("=".repeat(60));
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`  Network:   ${network.name} (${network.chainId})`);

  // ── Step 1: Deploy IFRLock ────────────────────────────────
  console.log("\n[1/3] Deploying IFRLock...");

  const IFRLock = await ethers.getContractFactory("IFRLock");
  const lock = await IFRLock.deploy(ADDRESSES.token, deployer.address);
  await lock.deployed();

  console.log(`  IFRLock:   ${lock.address}`);
  console.log(`  Token:     ${await lock.token()}`);
  console.log(`  Guardian:  ${await lock.guardian()}`);
  console.log(`  TX:        ${lock.deployTransaction.hash}`);

  // ── Step 2: Verify deployment ─────────────────────────────
  console.log("\n[2/3] Verifying deployment...");

  const totalLocked = await lock.totalLocked();
  console.log(`  totalLocked: ${totalLocked.toString()}`);
  console.log(`  paused:      ${await lock.paused()}`);
  console.log(`  OK — IFRLock deployed successfully.`);

  // ── Step 3: Create Governance Proposal for feeExempt ──────
  console.log("\n[3/3] Creating Governance proposal: setFeeExempt(IFRLock, true)...");

  const governance = await ethers.getContractAt("Governance", ADDRESSES.governance);
  const iface = new ethers.utils.Interface([
    "function setFeeExempt(address,bool)",
  ]);
  const calldata = iface.encodeFunctionData("setFeeExempt", [lock.address, true]);

  const tx = await governance.propose(ADDRESSES.token, calldata);
  const receipt = await tx.wait();

  // Parse ProposalCreated event
  const govIface = new ethers.utils.Interface([
    "event ProposalCreated(uint256 indexed id, address target, bytes data, uint256 eta)",
  ]);
  let proposalId, eta;
  for (const log of receipt.logs) {
    try {
      const parsed = govIface.parseLog(log);
      proposalId = parsed.args.id.toNumber();
      eta = parsed.args.eta.toNumber();
      break;
    } catch { /* skip */ }
  }

  const etaDate = new Date(eta * 1000);
  const delay = await governance.delay();

  console.log(`  Proposal ID: ${proposalId}`);
  console.log(`  Action:      setFeeExempt(${lock.address}, true)`);
  console.log(`  Delay:       ${delay.toNumber() / 3600}h`);
  console.log(`  ETA:         ${etaDate.toISOString()}`);
  console.log(`               ${etaDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Berlin)`);
  console.log(`  TX:          ${tx.hash}`);

  // ── Summary ───────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  IFRLock:      ${lock.address}
  Guardian:     ${deployer.address}
  Proposal #${proposalId}: setFeeExempt(IFRLock, true)
  ETA:          ${etaDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Berlin)

  Next steps:
  1. Verify on Etherscan:
     npx hardhat verify --network sepolia ${lock.address} ${ADDRESSES.token} ${deployer.address}

  2. After ETA, execute the proposal:
     npx hardhat run scripts/execute-proposal.js --network sepolia

  3. Test lock/unlock:
     npx hardhat run scripts/test-lock.js --network sepolia
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
