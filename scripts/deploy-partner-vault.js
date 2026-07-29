const { connectHardhat } = require("./lib/hardhat-runtime");

(async () => {
const { ethers } = await connectHardhat();

/**
 * INFERNO — Deploy PartnerVault + Fund + Create Governance Proposal
 *
 * 1. Deploy PartnerVault(token, governance, deployer-as-guardian, 1500 bps, 4M cap)
 * 2. Create Governance proposal: token.setFeeExempt(partnerVault, true)
 * 3. Display next steps (execute after ETA, then transfer 40M IFR)
 *
 * Usage: npx hardhat run scripts/deploy-partner-vault.js --network sepolia
 */

const DECIMALS = 9;
const parse = (n) => ethers.parseUnits(String(n), DECIMALS);
const fmt = (bn) => ethers.formatUnits(bn, DECIMALS);

const ADDRESSES = {
  token:      "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
};

// Constructor parameters
const REWARD_BPS = 1500;                    // 15%
const ANNUAL_CAP = parse(4_000_000);        // 4M IFR
const PARTNER_POOL = parse(40_000_000);     // 40M IFR

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("  INFERNO — Deploy PartnerVault");
  console.log("=".repeat(60));
  console.log(`  Deployer:    ${deployer.address}`);
  console.log(`  Balance:     ${ethers.formatEther(balance)} ETH`);
  console.log(`  Network:     ${network.name} (${network.chainId})`);

  // Check deployer IFR balance
  const token = await ethers.getContractAt("InfernoToken", ADDRESSES.token);
  const ifrBalance = await token.balanceOf(deployer.address);
  console.log(`  IFR Balance: ${fmt(ifrBalance)} IFR`);
  console.log(`  Need:        ${fmt(PARTNER_POOL)} IFR (for funding)`);

  if (BigInt(ifrBalance)<BigInt(PARTNER_POOL)) {
    console.error("\n  ERROR: Insufficient IFR balance for 40M transfer!");
    process.exit(1);
  }

  // ── Step 1: Deploy PartnerVault ─────────────────────────────
  console.log("\n[1/4] Deploying PartnerVault...");

  const PartnerVault = await ethers.getContractFactory("PartnerVault");
  const vault = await PartnerVault.deploy(
    ADDRESSES.token,         // ifrToken
    ADDRESSES.governance,    // admin = Governance Timelock
    deployer.address,        // guardian = deployer (emergency pause)
    REWARD_BPS,              // 15% reward rate
    ANNUAL_CAP               // 4M IFR annual emission cap
  );
  await vault.waitForDeployment();

  console.log(`  PartnerVault: ${vault.target}`);
  console.log(`  Admin:        ${await vault.admin()}`);
  console.log(`  Guardian:     ${await vault.guardian()}`);
  console.log(`  RewardBps:    ${await vault.rewardBps()}`);
  console.log(`  AnnualCap:    ${fmt(await vault.annualEmissionCap())} IFR`);
  console.log(`  TX:           ${vault.deploymentTransaction().hash}`);

  // ── Step 2: Verify deployment ───────────────────────────────
  console.log("\n[2/4] Verifying deployment...");

  console.log(`  PARTNER_POOL: ${fmt(await vault.PARTNER_POOL())} IFR`);
  console.log(`  totalAllocated: ${fmt(await vault.totalAllocated())} IFR`);
  console.log(`  paused:       ${await vault.paused()}`);
  console.log(`  OK — PartnerVault deployed successfully.`);

  // ── Step 3: Create Governance Proposal for feeExempt ────────
  console.log("\n[3/4] Creating Governance proposal: setFeeExempt(PartnerVault, true)...");

  const governance = await ethers.getContractAt("Governance", ADDRESSES.governance);
  const iface = new ethers.Interface([
    "function setFeeExempt(address,bool)",
  ]);
  const calldata = iface.encodeFunctionData("setFeeExempt", [vault.target, true]);

  const tx = await governance.propose(ADDRESSES.token, calldata);
  const receipt = await tx.wait();

  // Parse ProposalCreated event
  const govIface = new ethers.Interface([
    "event ProposalCreated(uint256 indexed id, address target, bytes data, uint256 eta)",
  ]);
  let proposalId, eta;
  for (const log of receipt.logs) {
    try {
      const parsed = govIface.parseLog(log);
      proposalId = Number(parsed.args.id);
      eta = Number(parsed.args.eta);
      break;
    } catch { /* skip */ }
  }

  const etaDate = new Date(eta * 1000);
  const delay = await governance.delay();

  console.log(`  Proposal ID: ${proposalId}`);
  console.log(`  Action:      setFeeExempt(${vault.target}, true)`);
  console.log(`  Delay:       ${Number(delay) / 3600}h`);
  console.log(`  ETA:         ${etaDate.toISOString()}`);
  console.log(`               ${etaDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Berlin)`);
  console.log(`  TX:          ${tx.hash}`);

  // ── Step 4: Transfer 40M IFR to PartnerVault ────────────────
  console.log("\n[4/4] Transferring 40M IFR to PartnerVault...");
  console.log(`  NOTE: Deployer is NOT feeExempt. Fees will be deducted.`);
  console.log(`  The vault must be feeExempt BEFORE claims, not before funding.`);
  console.log(`  Sending ${fmt(PARTNER_POOL)} IFR...`);

  const transferTx = await token.transfer(vault.target, PARTNER_POOL);
  await transferTx.wait();

  const vaultBalance = await token.balanceOf(vault.target);
  console.log(`  Vault balance: ${fmt(vaultBalance)} IFR`);
  console.log(`  TX:            ${transferTx.hash}`);

  if (BigInt(vaultBalance)<BigInt(PARTNER_POOL)) {
    const lost = BigInt(PARTNER_POOL)-BigInt(vaultBalance);
    console.log(`  Fee deducted:  ${fmt(lost)} IFR (burned + pool fee)`);
    console.log(`  NOTE: After feeExempt proposal executes, top up the`);
    console.log(`        difference: ${fmt(lost)} IFR (fee-free transfer)`);
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  PartnerVault:   ${vault.target}
  Admin:          ${ADDRESSES.governance} (Governance)
  Guardian:       ${deployer.address}
  RewardBps:      ${REWARD_BPS} (${REWARD_BPS / 100}%)
  AnnualCap:      ${fmt(ANNUAL_CAP)} IFR
  Vault Balance:  ${fmt(vaultBalance)} IFR

  Proposal #${proposalId}: setFeeExempt(PartnerVault, true)
  ETA:            ${etaDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Berlin)

  Next steps:
  1. Verify on Etherscan:
     npx hardhat verify --network sepolia ${vault.target} ${ADDRESSES.token} ${ADDRESSES.governance} ${deployer.address} ${REWARD_BPS} ${ANNUAL_CAP.toString()}

  2. After ETA, execute the proposal:
     npx hardhat run scripts/execute-proposal.js --network sepolia

  3. Top up vault to exactly 40M IFR (fee-free after feeExempt):
     Transfer ${BigInt(vaultBalance)<BigInt(PARTNER_POOL) ? fmt(BigInt(PARTNER_POOL)-BigInt(vaultBalance)) : "0"} IFR
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
