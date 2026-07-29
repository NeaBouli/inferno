// DEPRECATED — use deploy-bootstrap-mainnet-v3.js
const { ethers } = require("hardhat");

/**
 * INFERNO — Deploy BootstrapVaultV2 to Ethereum Mainnet
 *
 * 1. Deploy BootstrapVaultV2 with immutable parameters (no ifrSource)
 * 2. Verify deployment state
 * 3. Print next steps (verify, feeExempt, LiqRes.withdraw)
 *
 * Usage:
 *   DRY RUN:  npx hardhat run scripts/deploy-bootstrap-mainnet-v2.js
 *   MAINNET:  npx hardhat run scripts/deploy-bootstrap-mainnet-v2.js --network mainnet
 */

const DECIMALS = 9;
const parse = (n) => ethers.parseUnits(String(n), DECIMALS);
const fmt = (bn) => ethers.formatUnits(bn, DECIMALS);

// ── Mainnet Addresses ────────────────────────────────────────
const ADDRESSES = {
  token:      "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",  // InfernoToken
  router:     "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",  // Uniswap V2 Router (Mainnet)
  governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
  liqRes:     "0xdc0309804803b3A105154f6073061E3185018f64",  // LiquidityReserve (for next-steps info)
};

// ── Bootstrap Parameters ─────────────────────────────────────
const DURATION      = 90 * 24 * 60 * 60;                     // 90 days
const IFR_ALLOC     = parse(100_000_000);                     // 100M IFR (finalise needs 2x = 200M in contract)
const MIN_CONTRIB   = ethers.parseEther("0.01");        // 0.01 ETH
const MAX_CONTRIB   = ethers.parseEther("2");           // 2 ETH
const LP_LOCK_DUR   = 365 * 24 * 60 * 60;                    // 12 months
const TF_LOCKER     = ethers.ZeroAddress;           // Team.Finance disabled for now

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("  INFERNO — Deploy BootstrapVaultV2 (Mainnet)");
  console.log("=".repeat(60));
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log(`  Network:   ${network.name} (chainId: ${network.chainId})`);

  // ── Step 1: Compute startTime from latest block ────────────
  const block = await ethers.provider.getBlock("latest");
  const startTime = block.timestamp + 300; // starts 5 minutes from now (buffer for mainnet)

  const startDate = new Date(startTime * 1000).toISOString();
  const endDate = new Date((startTime + DURATION) * 1000).toISOString();

  console.log(`\n  Start:     ${startDate}`);
  console.log(`  End:       ${endDate}`);
  console.log(`  Duration:  ${DURATION / 86400} days`);
  console.log(`  IFR Alloc: ${fmt(IFR_ALLOC)} IFR (claims)`);
  console.log(`  Total IFR: ${fmt(BigInt(IFR_ALLOC)*BigInt(2))} IFR (LP + claims)`);
  console.log(`  Min/Max:   0.01 — 2 ETH`);

  // ── Step 2: Deploy BootstrapVaultV2 ──────────────────────────
  console.log("\n[1/2] Deploying BootstrapVaultV2...");

  const BootstrapVaultV2 = await ethers.getContractFactory("BootstrapVaultV2");
  const vault = await BootstrapVaultV2.deploy(
    ADDRESSES.token,
    ADDRESSES.router,
    TF_LOCKER,
    startTime,
    DURATION,
    IFR_ALLOC,
    MIN_CONTRIB,
    MAX_CONTRIB,
    LP_LOCK_DUR
  );
  await vault.waitForDeployment();

  const deploymentTx = vault.deploymentTransaction();
  const receipt = await deploymentTx.wait();

  console.log(`  BootstrapVaultV2: ${vault.target}`);
  console.log(`  TX:              ${deploymentTx.hash}`);
  console.log(`  Block:           ${receipt.blockNumber}`);
  console.log(`  Gas Used:        ${receipt.gasUsed.toString()}`);

  // Estimate cost
  const gasPrice = deploymentTx.gasPrice || (await ethers.provider.getFeeData()).gasPrice;
  const cost = BigInt(receipt.gasUsed)*BigInt(gasPrice);
  console.log(`  Gas Price:       ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`  Deploy Cost:     ${ethers.formatEther(cost)} ETH`);

  // ── Step 3: Verify deployment state ────────────────────────
  console.log("\n[2/2] Verifying deployment...");

  console.log(`  ifrToken:         ${await vault.ifrToken()}`);
  console.log(`  uniswapRouter:    ${await vault.uniswapRouter()}`);
  console.log(`  teamFinanceLocker: ${await vault.teamFinanceLocker()}`);
  console.log(`  startTime:        ${Number(await vault.startTime())} (${new Date(Number(await vault.startTime()) * 1000).toISOString()})`);
  console.log(`  endTime:          ${Number(await vault.endTime())} (${new Date(Number(await vault.endTime()) * 1000).toISOString()})`);
  console.log(`  ifrAllocation:    ${fmt(await vault.ifrAllocation())} IFR`);
  console.log(`  minContribution:  ${ethers.formatEther(await vault.minContribution())} ETH`);
  console.log(`  maxContribution:  ${ethers.formatEther(await vault.maxContribution())} ETH`);
  console.log(`  lpLockDuration:   ${Number(await vault.lpLockDuration()) / 86400} days`);
  console.log(`  totalETHRaised:   ${ethers.formatEther(await vault.totalETHRaised())} ETH`);
  console.log(`  finalised:        ${await vault.finalised()}`);
  console.log(`  OK — BootstrapVaultV2 deployed successfully.`);

  // ── Summary ────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  BootstrapVaultV2: ${vault.target}
  TF Locker:        ${TF_LOCKER} (disabled)
  Start:            ${startDate}
  End:              ${endDate}
  IFR Allocation:   ${fmt(IFR_ALLOC)} IFR (claims)
  Total IFR needed: ${fmt(BigInt(IFR_ALLOC)*BigInt(2))} IFR (LP + claims)
  Min/Max:          0.01 — 2 ETH
  Deploy Cost:      ${ethers.formatEther(cost)} ETH

  Next steps:
  1. Verify on Etherscan:
     npx hardhat verify --network mainnet ${vault.target} \\
       "${ADDRESSES.token}" "${ADDRESSES.router}" \\
       "${TF_LOCKER}" "${startTime}" "${DURATION}" \\
       "${IFR_ALLOC.toString()}" "${MIN_CONTRIB.toString()}" \\
       "${MAX_CONTRIB.toString()}" "${LP_LOCK_DUR}"

  2. Create Governance proposal: setFeeExempt(BootstrapVaultV2, true)
     (Required before finalise() can work correctly)

  3. Fund vault with ${fmt(BigInt(IFR_ALLOC)*BigInt(2))} IFR via Governance proposal:
     LiquidityReserve.withdraw(${vault.target}, ${BigInt(IFR_ALLOC)*BigInt(2).toString()})
     LiqRes: ${ADDRESSES.liqRes}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
