const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("INFERNO — CFLM Testnet Deployment");
  console.log("=".repeat(60));
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`Network:   ${(await ethers.provider.getNetwork()).name}`);
  console.log("-".repeat(60));

  // Allocation addresses (placeholders — set real addresses before mainnet)
  const TREASURY_ADDR = process.env.TREASURY_ADDRESS || deployer.address;
  const COMMUNITY_ADDR = process.env.COMMUNITY_ADDRESS || deployer.address;
  const TEAM_BENEFICIARY = process.env.TEAM_BENEFICIARY || deployer.address;

  // ──────────────────────────────────────────────────────────────
  // 1. Deploy InfernoToken
  //    poolFeeReceiver = deployer (can be changed later)
  // ──────────────────────────────────────────────────────────────
  console.log("\n[1/9] Deploying InfernoToken...");
  const InfernoToken = await ethers.getContractFactory("InfernoToken");
  const token = await InfernoToken.deploy(deployer.address);
  await token.deployed();
  console.log(`  InfernoToken:  ${token.address}`);
  console.log(`  Supply:        ${ethers.utils.formatUnits(await token.totalSupply(), 9)} IFR`);

  // ──────────────────────────────────────────────────────────────
  // 2. Deploy LiquidityReserve
  //    6 months lock, 50M IFR per quarter
  // ──────────────────────────────────────────────────────────────
  console.log("\n[2/9] Deploying LiquidityReserve...");
  const LOCK_DURATION = 180 * 86400;   // 180 days
  const MAX_PER_PERIOD = ethers.utils.parseUnits("50000000", 9);  // 50M IFR
  const PERIOD_DURATION = 90 * 86400;  // 90 days

  const LiquidityReserve = await ethers.getContractFactory("LiquidityReserve");
  const liquidityReserve = await LiquidityReserve.deploy(
    token.address,
    LOCK_DURATION,
    MAX_PER_PERIOD,
    PERIOD_DURATION,
    deployer.address   // guardian
  );
  await liquidityReserve.deployed();
  console.log(`  LiquidityReserve: ${liquidityReserve.address}`);
  console.log(`  Lock:          180 days`);
  console.log(`  Max/Period:    50,000,000 IFR per 90 days`);

  // ──────────────────────────────────────────────────────────────
  // 3. Deploy Vesting (Team)
  //    12 months cliff, 48 months total (36 months linear after cliff)
  // ──────────────────────────────────────────────────────────────
  console.log("\n[3/9] Deploying Vesting (Team)...");
  const CLIFF_DURATION = 365 * 86400;      // 12 months
  const TOTAL_DURATION = 4 * 365 * 86400;  // 48 months (12mo cliff + 36mo linear)
  const TEAM_ALLOCATION = ethers.utils.parseUnits("150000000", 9); // 150M IFR

  const Vesting = await ethers.getContractFactory("Vesting");
  const vesting = await Vesting.deploy(
    token.address,
    TEAM_BENEFICIARY,
    CLIFF_DURATION,
    TOTAL_DURATION,
    TEAM_ALLOCATION,
    deployer.address   // guardian
  );
  await vesting.deployed();
  console.log(`  Vesting:       ${vesting.address}`);
  console.log(`  Beneficiary:   ${TEAM_BENEFICIARY}`);
  console.log(`  Cliff:         12 months`);
  console.log(`  Linear:        36 months (after cliff)`);
  console.log(`  Allocation:    150,000,000 IFR`);

  // ──────────────────────────────────────────────────────────────
  // 4. Deploy BuybackVault
  //    60-day activation delay
  // ──────────────────────────────────────────────────────────────
  console.log("\n[4/9] Deploying BuybackVault...");
  const ACTIVATION_DELAY = 60 * 86400; // 60 days

  const BurnReserveFactory = await ethers.getContractFactory("BurnReserve");
  const burnReserve = await BurnReserveFactory.deploy(
    token.address,
    deployer.address   // guardian
  );
  await burnReserve.deployed();
  console.log(`  BurnReserve:   ${burnReserve.address}`);

  const BuybackVault = await ethers.getContractFactory("BuybackVault");
  const vault = await BuybackVault.deploy(
    token.address,
    burnReserve.address,
    TREASURY_ADDR,
    deployer.address,    // router (placeholder — set real router via setParams)
    deployer.address,    // guardian
    ACTIVATION_DELAY
  );
  await vault.deployed();
  console.log(`  BuybackVault:  ${vault.address}`);
  console.log(`  Activation:    60 days after deploy`);
  console.log(`  (!) Router is set to deployer — update via setParams()`);

  // ──────────────────────────────────────────────────────────────
  // 5. Deploy BurnReserve (already deployed above with BuybackVault)
  // ──────────────────────────────────────────────────────────────
  console.log("\n[5/9] BurnReserve already deployed in step 4.");

  // ──────────────────────────────────────────────────────────────
  // 6. Deploy Governance (Timelock)
  //    48h delay, guardian = deployer
  // ──────────────────────────────────────────────────────────────
  console.log("\n[6/9] Deploying Governance...");
  const GOV_DELAY = 2 * 86400; // 48 hours

  const GovernanceFactory = await ethers.getContractFactory("Governance");
  const governance = await GovernanceFactory.deploy(GOV_DELAY, deployer.address);
  await governance.deployed();
  console.log(`  Governance:    ${governance.address}`);
  console.log(`  Delay:         48 hours`);
  console.log(`  (!) Transfer contract ownership to Governance after setup`);

  // ──────────────────────────────────────────────────────────────
  // 7. Set feeExempt for all contracts + deployer (temporary)
  // ──────────────────────────────────────────────────────────────
  console.log("\n[7/9] Setting feeExempt...");
  const exemptAddresses = [
    { name: "Vesting", addr: vesting.address },
    { name: "LiquidityReserve", addr: liquidityReserve.address },
    { name: "Treasury", addr: TREASURY_ADDR },
    { name: "BuybackVault", addr: vault.address },
    { name: "BurnReserve", addr: burnReserve.address },
    { name: "Deployer", addr: deployer.address },
  ];

  for (const { name, addr } of exemptAddresses) {
    const tx = await token.setFeeExempt(addr, true);
    await tx.wait();
    console.log(`  feeExempt[${name}] = true`);
  }

  // ──────────────────────────────────────────────────────────────
  // 8. Distribute tokens (CFLM allocation)
  // ──────────────────────────────────────────────────────────────
  console.log("\n[8/9] Distributing IFR (CFLM allocation)...");

  const LIQUIDITY_RESERVE_ALLOC = ethers.utils.parseUnits("200000000", 9);  // 200M
  const TREASURY_ALLOC = ethers.utils.parseUnits("150000000", 9);           // 150M
  const COMMUNITY_ALLOC = ethers.utils.parseUnits("100000000", 9);          // 100M
  // DEX_LIQUIDITY = 400M stays with deployer for manual pairing
  // TEAM_ALLOCATION = 150M already defined above

  let tx;

  tx = await token.transfer(liquidityReserve.address, LIQUIDITY_RESERVE_ALLOC);
  await tx.wait();
  console.log(`  LiquidityReserve: 200,000,000 IFR (20%)`);

  tx = await token.transfer(vesting.address, TEAM_ALLOCATION);
  await tx.wait();
  console.log(`  Team Vesting:     150,000,000 IFR (15%)`);

  tx = await token.transfer(TREASURY_ADDR, TREASURY_ALLOC);
  await tx.wait();
  console.log(`  Treasury:         150,000,000 IFR (15%)`);

  tx = await token.transfer(COMMUNITY_ADDR, COMMUNITY_ALLOC);
  await tx.wait();
  console.log(`  Community:        100,000,000 IFR (10%)`);

  const deployerBal = await token.balanceOf(deployer.address);
  console.log(`  Deployer (DEX):   ${ethers.utils.formatUnits(deployerBal, 9)} IFR (40% for DEX liquidity)`);

  // ──────────────────────────────────────────────────────────────
  // 9. Remove deployer feeExempt
  // ──────────────────────────────────────────────────────────────
  console.log("\n[9/9] Removing deployer feeExempt...");
  tx = await token.setFeeExempt(deployer.address, false);
  await tx.wait();
  console.log(`  feeExempt[Deployer] = false`);

  // ──────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("CFLM DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  InfernoToken:      ${token.address}
  LiquidityReserve:  ${liquidityReserve.address}
  Vesting (Team):    ${vesting.address}
  BuybackVault:      ${vault.address}
  BurnReserve:       ${burnReserve.address}
  Governance:        ${governance.address}

  Token Distribution (CFLM):
    DEX Liquidity:       400,000,000 IFR  (40%) — held by deployer
    Liquidity Reserve:   200,000,000 IFR  (20%) — locked 6 months
    Team Vesting:        150,000,000 IFR  (15%) — 12mo cliff + 36mo linear
    Treasury:            150,000,000 IFR  (15%) — ${TREASURY_ADDR}
    Community:           100,000,000 IFR  (10%) — ${COMMUNITY_ADDR}

  FeeExempt: Vesting, LiquidityReserve, Treasury, BuybackVault, BurnReserve
  Deployer feeExempt: REMOVED

  Governance:
    Timelock delay: 48 hours
    Address: ${governance.address}

  BuybackVault:
    Activation: 60 days after deploy
    BurnReserve wired: ${burnReserve.address}

  NEXT STEPS:
    1. Pair 400M IFR + ETH on Uniswap (create LP)
    2. Set real Uniswap router on BuybackVault via setParams()
    3. Set real treasury address if placeholder was used
    4. Transfer InfernoToken ownership to Governance
    5. Verify contracts on Etherscan
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
