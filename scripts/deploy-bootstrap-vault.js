const { ethers } = require("hardhat");

/**
 * INFERNO — Deploy BootstrapVault to Sepolia
 *
 * 1. Deploy BootstrapVault with immutable parameters
 * 2. Verify deployment state
 * 3. Print next steps (verify, feeExempt proposal, fund ifrSource)
 *
 * Usage: npx hardhat run scripts/deploy-bootstrap-vault.js --network sepolia
 */

const DECIMALS = 9;
const parse = (n) => ethers.utils.parseUnits(String(n), DECIMALS);
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);

const ADDRESSES = {
  token:      "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  ifrSource:  "0x344720eA0cd1654e2bDB41ecC1cCb11eD60f1957", // LiquidityReserve v2
  router:     "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008",  // Uniswap V2 Router
  governance: "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
};

// Bootstrap parameters
const DURATION      = 90 * 24 * 60 * 60;   // 90 days
const IFR_ALLOC     = parse(100_000_000);   // 100M IFR (9 decimals)
const MIN_CONTRIB   = ethers.utils.parseEther("0.01");
const MAX_CONTRIB   = ethers.utils.parseEther("2");
const LP_LOCK_DUR   = 365 * 24 * 60 * 60;  // 12 months

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("  INFERNO — Deploy BootstrapVault");
  console.log("=".repeat(60));
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`  Network:   ${network.name} (${network.chainId})`);

  // ── Step 1: Get startTime from current block ─────────────
  const block = await ethers.provider.getBlock("latest");
  const startTime = block.timestamp + 60; // starts 1 minute from now

  console.log(`\n  Start:     ${new Date(startTime * 1000).toISOString()}`);
  console.log(`  End:       ${new Date((startTime + DURATION) * 1000).toISOString()}`);
  console.log(`  Duration:  ${DURATION / 86400} days`);

  // ── Step 2: Deploy BootstrapVault ────────────────────────
  console.log("\n[1/2] Deploying BootstrapVault...");

  // teamFinanceLocker = address(0) on testnet (no Team.Finance on Sepolia)
  // LP tokens stay in vault contract (effectively locked)
  const TF_LOCKER = ethers.constants.AddressZero;

  const BootstrapVault = await ethers.getContractFactory("BootstrapVault");
  const vault = await BootstrapVault.deploy(
    ADDRESSES.token,
    ADDRESSES.ifrSource,
    ADDRESSES.router,
    TF_LOCKER,
    startTime,
    DURATION,
    IFR_ALLOC,
    MIN_CONTRIB,
    MAX_CONTRIB,
    LP_LOCK_DUR
  );
  await vault.deployed();

  console.log(`  BootstrapVault: ${vault.address}`);
  console.log(`  TX:             ${vault.deployTransaction.hash}`);

  // ── Step 3: Verify deployment state ──────────────────────
  console.log("\n[2/2] Verifying deployment...");

  console.log(`  ifrToken:        ${await vault.ifrToken()}`);
  console.log(`  ifrSource:       ${await vault.ifrSource()}`);
  console.log(`  uniswapRouter:   ${await vault.uniswapRouter()}`);
  console.log(`  teamFinanceLocker: ${await vault.teamFinanceLocker()}`);
  console.log(`  startTime:       ${(await vault.startTime()).toNumber()} (${new Date((await vault.startTime()).toNumber() * 1000).toISOString()})`);
  console.log(`  endTime:         ${(await vault.endTime()).toNumber()} (${new Date((await vault.endTime()).toNumber() * 1000).toISOString()})`);
  console.log(`  ifrAllocation:   ${fmt(await vault.ifrAllocation())} IFR`);
  console.log(`  minContribution: ${ethers.utils.formatEther(await vault.minContribution())} ETH`);
  console.log(`  maxContribution: ${ethers.utils.formatEther(await vault.maxContribution())} ETH`);
  console.log(`  lpLockDuration:  ${(await vault.lpLockDuration()).toNumber() / 86400} days`);
  console.log(`  totalETHRaised:  ${ethers.utils.formatEther(await vault.totalETHRaised())} ETH`);
  console.log(`  finalised:       ${await vault.finalised()}`);
  console.log(`  OK — BootstrapVault deployed successfully.`);

  // ── Summary ──────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  BootstrapVault:  ${vault.address}
  IFR Source:      ${ADDRESSES.ifrSource} (LiquidityReserve v2)
  TF Locker:       ${TF_LOCKER} (disabled on testnet)
  Start:           ${new Date(startTime * 1000).toISOString()}
  End:             ${new Date((startTime + DURATION) * 1000).toISOString()}
  IFR Allocation:  ${fmt(IFR_ALLOC)} IFR
  Min/Max:         0.01 — 2 ETH

  Next steps:
  1. Verify on Etherscan:
     npx hardhat verify --network sepolia ${vault.address} \\
       "${ADDRESSES.token}" "${ADDRESSES.ifrSource}" "${ADDRESSES.router}" \\
       "${TF_LOCKER}" "${startTime}" "${DURATION}" \\
       "${IFR_ALLOC.toString()}" "${MIN_CONTRIB.toString()}" \\
       "${MAX_CONTRIB.toString()}" "${LP_LOCK_DUR}"

  2. Create Governance proposal: setFeeExempt(BootstrapVault, true)
     (Required before finalise() can work correctly)

  3. LiquidityReserve must approve BootstrapVault for ${fmt(IFR_ALLOC.mul(2))} IFR
     (2x allocation: half for LP, half for claims)
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
