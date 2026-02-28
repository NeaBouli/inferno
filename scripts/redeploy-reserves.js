const { ethers } = require("hardhat");

// Existing addresses (DO NOT redeploy these)
const TOKEN_ADDRESS = "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4";
const GOVERNANCE_ADDRESS = "0x6050b22E4EAF3f414d1155fBaF30B868E0107017";
const ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("INFERNO — Redeploy Reserves (transferOwnership upgrade)");
  console.log("=".repeat(60));
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`Network:   ${(await ethers.provider.getNetwork()).name}`);
  console.log(`Token:     ${TOKEN_ADDRESS}`);
  console.log(`Governance: ${GOVERNANCE_ADDRESS}`);
  console.log("-".repeat(60));

  const TREASURY_ADDR = process.env.TREASURY_ADDRESS || deployer.address;

  // ── 1. Deploy BurnReserve (must be first — BuybackVault needs it) ──
  console.log("\n[1/3] Deploying BurnReserve...");
  const BurnReserve = await ethers.getContractFactory("BurnReserve");
  const burnReserve = await BurnReserve.deploy(
    TOKEN_ADDRESS,
    deployer.address   // guardian
  );
  await burnReserve.deployed();
  console.log(`  BurnReserve:   ${burnReserve.address}`);

  // ── 2. Deploy BuybackVault ──
  console.log("\n[2/3] Deploying BuybackVault...");
  const ACTIVATION_DELAY = 60 * 86400; // 60 days
  const BuybackVault = await ethers.getContractFactory("BuybackVault");
  const vault = await BuybackVault.deploy(
    TOKEN_ADDRESS,
    burnReserve.address,
    TREASURY_ADDR,
    deployer.address,    // router (placeholder — update via setParams)
    deployer.address,    // guardian
    ACTIVATION_DELAY
  );
  await vault.deployed();
  console.log(`  BuybackVault:  ${vault.address}`);
  console.log(`  BurnReserve:   ${burnReserve.address} (linked)`);
  console.log(`  Activation:    60 days`);

  // ── 3. Deploy LiquidityReserve ──
  console.log("\n[3/3] Deploying LiquidityReserve...");
  const LOCK_DURATION = 180 * 86400;   // 180 days
  const MAX_PER_PERIOD = ethers.utils.parseUnits("50000000", 9);  // 50M IFR
  const PERIOD_DURATION = 90 * 86400;  // 90 days

  const LiquidityReserve = await ethers.getContractFactory("LiquidityReserve");
  const liquidityReserve = await LiquidityReserve.deploy(
    TOKEN_ADDRESS,
    LOCK_DURATION,
    MAX_PER_PERIOD,
    PERIOD_DURATION,
    deployer.address   // guardian
  );
  await liquidityReserve.deployed();
  console.log(`  LiquidityReserve: ${liquidityReserve.address}`);
  console.log(`  Lock:          180 days`);
  console.log(`  Max/Period:    50M IFR per 90 days`);

  // ── 4. Transfer ownership of all 3 to Governance ──
  console.log("\n[4] Transferring ownership to Governance...");

  let tx;
  tx = await burnReserve.transferOwnership(GOVERNANCE_ADDRESS);
  await tx.wait();
  console.log(`  BurnReserve.owner = Governance ✓`);

  tx = await vault.transferOwnership(GOVERNANCE_ADDRESS);
  await tx.wait();
  console.log(`  BuybackVault.owner = Governance ✓`);

  tx = await liquidityReserve.transferOwnership(GOVERNANCE_ADDRESS);
  await tx.wait();
  console.log(`  LiquidityReserve.owner = Governance ✓`);

  // ── 5. Create Governance proposals for feeExempt ──
  console.log("\n[5] Creating feeExempt Governance proposals...");
  const governance = await ethers.getContractAt("Governance", GOVERNANCE_ADDRESS);
  const token = await ethers.getContractAt("InfernoToken", TOKEN_ADDRESS);

  const targets = [
    { name: "LiquidityReserve", addr: liquidityReserve.address },
    { name: "BuybackVault", addr: vault.address },
    { name: "BurnReserve", addr: burnReserve.address },
  ];

  for (const { name, addr } of targets) {
    const calldata = token.interface.encodeFunctionData("setFeeExempt", [addr, true]);
    tx = await governance.propose(TOKEN_ADDRESS, calldata);
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === "ProposalQueued");
    const propId = event ? event.args.proposalId.toString() : "?";
    console.log(`  Proposal #${propId}: setFeeExempt(${name}, true) — TX ${receipt.transactionHash}`);
  }

  // ── Summary ──
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`BurnReserve (NEW):       ${burnReserve.address}`);
  console.log(`BuybackVault (NEW):      ${vault.address}`);
  console.log(`LiquidityReserve (NEW):  ${liquidityReserve.address}`);
  console.log("-".repeat(60));
  console.log("Ownership: all 3 transferred to Governance");
  console.log("feeExempt: 3 proposals queued (48h timelock)");
  console.log("-".repeat(60));
  console.log("\nNEXT STEPS:");
  console.log("1. Verify on Etherscan:");
  console.log(`   npx hardhat verify --network sepolia ${burnReserve.address} ${TOKEN_ADDRESS} ${deployer.address}`);
  console.log(`   npx hardhat verify --network sepolia ${vault.address} ${TOKEN_ADDRESS} ${burnReserve.address} ${TREASURY_ADDR} ${deployer.address} ${deployer.address} ${ACTIVATION_DELAY}`);
  console.log(`   npx hardhat verify --network sepolia ${liquidityReserve.address} ${TOKEN_ADDRESS} ${LOCK_DURATION} ${MAX_PER_PERIOD} ${PERIOD_DURATION} ${deployer.address}`);
  console.log("2. Wait 48h for proposals, then execute");
  console.log("3. Update docs/DEPLOYMENTS.md with new addresses");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
