const { ethers } = require("hardhat");

/**
 * INFERNO ($IFR) — Unified Mainnet Deployment Script
 *
 * Deploys all 9 contracts in correct order, sets feeExempt,
 * distributes tokens (CFLM 40/20/15/15/6/4 split).
 *
 * DRY RUN:   npx hardhat run scripts/deploy-mainnet.js --network hardhat
 * MAINNET:   npx hardhat run scripts/deploy-mainnet.js --network mainnet
 *
 * Required env vars for mainnet:
 *   MAINNET_RPC_URL        — Alchemy/Infura mainnet RPC
 *   DEPLOYER_PRIVATE_KEY   — deployer wallet key
 *   TREASURY_ADDRESS       — Gnosis Safe multisig
 *   COMMUNITY_ADDRESS      — Community & Grants wallet
 *   TEAM_BENEFICIARY       — Team vesting beneficiary
 *   VOUCHER_SIGNER_ADDRESS — Points backend signer key
 *
 * Optional env vars:
 *   UNISWAP_ROUTER         — Uniswap V2 Router (default: mainnet router)
 *   GUARDIAN_ADDRESS        — Guardian address (default: deployer)
 */

const DECIMALS = 9;
const parse = (n) => ethers.utils.parseUnits(String(n), DECIMALS);
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);

// Mainnet Uniswap V2 Router (well-known address)
const UNISWAP_V2_ROUTER_MAINNET = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

// ── Token Allocation (CFLM) ──────────────────────────────────
const ALLOC = {
  DEX_LIQUIDITY:      parse(400_000_000),  // 40% — stays with deployer for LP
  LIQUIDITY_RESERVE:  parse(200_000_000),  // 20%
  TEAM_VESTING:       parse(150_000_000),  // 15%
  TREASURY:           parse(150_000_000),  // 15%
  COMMUNITY:          parse( 60_000_000),  //  6%
  PARTNER:            parse( 40_000_000),  //  4%
};

// ── Contract Parameters ──────────────────────────────────────
const PARAMS = {
  GOV_DELAY:          2 * 86400,           // 48 hours
  LOCK_DURATION:      180 * 86400,         // 180 days (6 months)
  MAX_PER_PERIOD:     parse(50_000_000),   // 50M IFR per quarter
  PERIOD_DURATION:    90 * 86400,          // 90 days
  CLIFF_DURATION:     365 * 86400,         // 12 months
  TOTAL_DURATION:     4 * 365 * 86400,     // 48 months (12mo cliff + 36mo linear)
  ACTIVATION_DELAY:   60 * 86400,          // 60 days
  REWARD_BPS:         1500,                // 15%
  ANNUAL_CAP:         parse(4_000_000),    // 4M IFR
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  const isMainnet = network.chainId === 1;
  const isHardhat = network.chainId === 31337;
  const isSepolia = network.chainId === 11155111;

  // ── Resolve addresses from env ────────────────────────────
  const TREASURY_ADDR    = process.env.TREASURY_ADDRESS       || deployer.address;
  const COMMUNITY_ADDR   = process.env.COMMUNITY_ADDRESS      || deployer.address;
  const TEAM_BENEFICIARY = process.env.TEAM_BENEFICIARY       || deployer.address;
  const VOUCHER_SIGNER   = process.env.VOUCHER_SIGNER_ADDRESS || deployer.address;
  const UNISWAP_ROUTER   = process.env.UNISWAP_ROUTER        || UNISWAP_V2_ROUTER_MAINNET;
  const GUARDIAN_ADDR    = process.env.GUARDIAN_ADDRESS        || deployer.address;

  // ── Safety checks for mainnet ─────────────────────────────
  if (isMainnet) {
    const required = {
      TREASURY_ADDRESS: TREASURY_ADDR,
      COMMUNITY_ADDRESS: COMMUNITY_ADDR,
      TEAM_BENEFICIARY: TEAM_BENEFICIARY,
      VOUCHER_SIGNER_ADDRESS: VOUCHER_SIGNER,
    };
    const missing = Object.entries(required)
      .filter(([, v]) => v === deployer.address)
      .map(([k]) => k);

    if (missing.length > 0) {
      console.error("\n  ABORT: Required env vars not set (using deployer as fallback):");
      missing.forEach(k => console.error(`    - ${k}`));
      console.error("\n  Set these env vars before mainnet deployment.");
      console.error("  For DRY RUN, use: --network hardhat\n");
      process.exit(1);
    }
  }

  if (isSepolia) {
    console.error("  ABORT: This script is for mainnet (or hardhat dry run).");
    console.error("  Use deploy-testnet.js for Sepolia.");
    process.exit(1);
  }

  // ── Banner ────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  if (isHardhat) {
    console.log("  INFERNO — MAINNET DRY RUN (Hardhat Local)");
  } else {
    console.log("  INFERNO — MAINNET DEPLOYMENT (LIVE!)");
  }
  console.log("=".repeat(60));
  console.log(`  Deployer:       ${deployer.address}`);
  console.log(`  Balance:        ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`  Network:        ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Treasury:       ${TREASURY_ADDR}`);
  console.log(`  Community:      ${COMMUNITY_ADDR}`);
  console.log(`  Team Benefic.:  ${TEAM_BENEFICIARY}`);
  console.log(`  Voucher Signer: ${VOUCHER_SIGNER}`);
  console.log(`  Guardian:       ${GUARDIAN_ADDR}`);
  console.log(`  Uniswap Router: ${UNISWAP_ROUTER}`);
  console.log("-".repeat(60));

  const deployed = {};
  let tx;

  // ════════════════════════════════════════════════════════════
  // [1/12] InfernoToken
  // ════════════════════════════════════════════════════════════
  console.log("\n[1/12] Deploying InfernoToken...");
  const InfernoToken = await ethers.getContractFactory("InfernoToken");
  const token = await InfernoToken.deploy(deployer.address); // poolFeeReceiver = deployer
  await token.deployed();
  deployed.token = token.address;
  console.log(`  InfernoToken:     ${token.address}`);
  console.log(`  Total Supply:     ${fmt(await token.totalSupply())} IFR`);
  console.log(`  Decimals:         ${await token.decimals()}`);

  // ════════════════════════════════════════════════════════════
  // [2/12] Governance (Timelock)
  // ════════════════════════════════════════════════════════════
  console.log("\n[2/12] Deploying Governance (48h Timelock)...");
  const Governance = await ethers.getContractFactory("Governance");
  const governance = await Governance.deploy(PARAMS.GOV_DELAY, deployer.address);
  await governance.deployed();
  deployed.governance = governance.address;
  console.log(`  Governance:       ${governance.address}`);
  console.log(`  Delay:            ${PARAMS.GOV_DELAY / 3600}h`);

  // ════════════════════════════════════════════════════════════
  // [3/12] IFRLock
  // ════════════════════════════════════════════════════════════
  console.log("\n[3/12] Deploying IFRLock...");
  const IFRLock = await ethers.getContractFactory("IFRLock");
  const ifrLock = await IFRLock.deploy(token.address, GUARDIAN_ADDR);
  await ifrLock.deployed();
  deployed.ifrLock = ifrLock.address;
  console.log(`  IFRLock:          ${ifrLock.address}`);
  console.log(`  Guardian:         ${GUARDIAN_ADDR}`);

  // ════════════════════════════════════════════════════════════
  // [4/12] BurnReserve
  // ════════════════════════════════════════════════════════════
  console.log("\n[4/12] Deploying BurnReserve...");
  const BurnReserve = await ethers.getContractFactory("BurnReserve");
  const burnReserve = await BurnReserve.deploy(token.address, GUARDIAN_ADDR);
  await burnReserve.deployed();
  deployed.burnReserve = burnReserve.address;
  console.log(`  BurnReserve:      ${burnReserve.address}`);

  // ════════════════════════════════════════════════════════════
  // [5/12] BuybackVault (60-day activation delay)
  // ════════════════════════════════════════════════════════════
  console.log("\n[5/12] Deploying BuybackVault...");
  const BuybackVault = await ethers.getContractFactory("BuybackVault");
  const buybackVault = await BuybackVault.deploy(
    token.address,
    burnReserve.address,
    TREASURY_ADDR,
    UNISWAP_ROUTER,
    GUARDIAN_ADDR,
    PARAMS.ACTIVATION_DELAY
  );
  await buybackVault.deployed();
  deployed.buybackVault = buybackVault.address;
  console.log(`  BuybackVault:     ${buybackVault.address}`);
  console.log(`  Activation:       60 days after deploy`);
  console.log(`  Router:           ${UNISWAP_ROUTER}`);

  // ════════════════════════════════════════════════════════════
  // [6/12] PartnerVault (admin = Governance)
  // ════════════════════════════════════════════════════════════
  console.log("\n[6/12] Deploying PartnerVault...");
  const PartnerVault = await ethers.getContractFactory("PartnerVault");
  const partnerVault = await PartnerVault.deploy(
    token.address,
    governance.address,    // admin = Governance timelock
    GUARDIAN_ADDR,
    PARAMS.REWARD_BPS,
    PARAMS.ANNUAL_CAP
  );
  await partnerVault.deployed();
  deployed.partnerVault = partnerVault.address;
  console.log(`  PartnerVault:     ${partnerVault.address}`);
  console.log(`  Admin:            ${governance.address} (Governance)`);
  console.log(`  RewardBps:        ${PARAMS.REWARD_BPS} (${PARAMS.REWARD_BPS / 100}%)`);
  console.log(`  AnnualCap:        ${fmt(PARAMS.ANNUAL_CAP)} IFR`);

  // ════════════════════════════════════════════════════════════
  // [7/12] FeeRouterV1
  // ════════════════════════════════════════════════════════════
  console.log("\n[7/12] Deploying FeeRouterV1...");
  const FeeRouterV1 = await ethers.getContractFactory("FeeRouterV1");
  const feeRouter = await FeeRouterV1.deploy(
    governance.address,
    TREASURY_ADDR,         // feeCollector = Treasury multisig
    VOUCHER_SIGNER
  );
  await feeRouter.deployed();
  deployed.feeRouter = feeRouter.address;
  console.log(`  FeeRouterV1:      ${feeRouter.address}`);
  console.log(`  FeeCollector:     ${TREASURY_ADDR}`);
  console.log(`  VoucherSigner:    ${VOUCHER_SIGNER}`);

  // ════════════════════════════════════════════════════════════
  // [8/12] Vesting (Team — 12mo cliff + 36mo linear)
  // ════════════════════════════════════════════════════════════
  console.log("\n[8/12] Deploying Vesting (Team)...");
  const Vesting = await ethers.getContractFactory("Vesting");
  const vesting = await Vesting.deploy(
    token.address,
    TEAM_BENEFICIARY,
    PARAMS.CLIFF_DURATION,
    PARAMS.TOTAL_DURATION,
    ALLOC.TEAM_VESTING,
    GUARDIAN_ADDR
  );
  await vesting.deployed();
  deployed.vesting = vesting.address;
  console.log(`  Vesting:          ${vesting.address}`);
  console.log(`  Beneficiary:      ${TEAM_BENEFICIARY}`);
  console.log(`  Cliff:            12 months`);
  console.log(`  Linear:           36 months (after cliff)`);
  console.log(`  Allocation:       ${fmt(ALLOC.TEAM_VESTING)} IFR`);

  // ════════════════════════════════════════════════════════════
  // [9/12] LiquidityReserve (6-month lock, 50M/quarter)
  // ════════════════════════════════════════════════════════════
  console.log("\n[9/12] Deploying LiquidityReserve...");
  const LiquidityReserve = await ethers.getContractFactory("LiquidityReserve");
  const liquidityReserve = await LiquidityReserve.deploy(
    token.address,
    PARAMS.LOCK_DURATION,
    PARAMS.MAX_PER_PERIOD,
    PARAMS.PERIOD_DURATION,
    GUARDIAN_ADDR
  );
  await liquidityReserve.deployed();
  deployed.liquidityReserve = liquidityReserve.address;
  console.log(`  LiquidityReserve: ${liquidityReserve.address}`);
  console.log(`  Lock:             180 days`);
  console.log(`  Max/Period:       ${fmt(PARAMS.MAX_PER_PERIOD)} IFR per 90 days`);

  // ════════════════════════════════════════════════════════════
  // [10/12] Set feeExempt (BEFORE token distribution!)
  //
  // CRITICAL: All exemptions must be set before any token
  // transfer. Sepolia lesson: 1.4M IFR lost to fees because
  // PartnerVault was not exempt at funding time.
  // ════════════════════════════════════════════════════════════
  console.log("\n[10/12] Setting feeExempt (BEFORE distribution)...");
  const exemptions = [
    { name: "Vesting",          addr: vesting.address },
    { name: "LiquidityReserve", addr: liquidityReserve.address },
    { name: "BuybackVault",     addr: buybackVault.address },
    { name: "BurnReserve",      addr: burnReserve.address },
    { name: "IFRLock",          addr: ifrLock.address },
    { name: "PartnerVault",     addr: partnerVault.address },
    { name: "Treasury",         addr: TREASURY_ADDR },
    { name: "Deployer",         addr: deployer.address },  // temporary — removed in step 12
  ];

  for (const { name, addr } of exemptions) {
    tx = await token.setFeeExempt(addr, true);
    await tx.wait();
    console.log(`  feeExempt[${name}] = true`);
  }

  // ════════════════════════════════════════════════════════════
  // [11/12] Token Distribution (CFLM — 40/20/15/15/6/4)
  //
  // Deployer received 1B IFR at deploy. Now distribute to
  // contracts and wallets. DEX liquidity (400M) stays with
  // deployer for manual LP pairing in a separate step.
  // ════════════════════════════════════════════════════════════
  console.log("\n[11/12] Distributing IFR (CFLM allocation)...");

  const distributions = [
    { name: "LiquidityReserve",  addr: liquidityReserve.address, amount: ALLOC.LIQUIDITY_RESERVE, pct: "20%" },
    { name: "Vesting (Team)",    addr: vesting.address,          amount: ALLOC.TEAM_VESTING,      pct: "15%" },
    { name: "Treasury",          addr: TREASURY_ADDR,            amount: ALLOC.TREASURY,          pct: "15%" },
    { name: "Community & Grants",addr: COMMUNITY_ADDR,           amount: ALLOC.COMMUNITY,         pct: " 6%" },
    { name: "PartnerVault",      addr: partnerVault.address,     amount: ALLOC.PARTNER,           pct: " 4%" },
  ];

  for (const { name, addr, amount, pct } of distributions) {
    tx = await token.transfer(addr, amount);
    await tx.wait();
    const bal = await token.balanceOf(addr);
    console.log(`  ${name}: ${fmt(amount)} IFR (${pct}) — balance: ${fmt(bal)}`);
  }

  const deployerBal = await token.balanceOf(deployer.address);
  console.log(`  Deployer (DEX):   ${fmt(deployerBal)} IFR (40% for LP pairing)`);

  // Sanity check
  const totalSupply = await token.totalSupply();
  console.log(`\n  Total Supply:     ${fmt(totalSupply)} IFR`);
  console.log(`  Expected DEX:     ${fmt(ALLOC.DEX_LIQUIDITY)} IFR`);

  // In DRY RUN, Treasury/Community addresses = deployer, so balance accumulates
  const addressOverlap = [TREASURY_ADDR, COMMUNITY_ADDR].filter(a => a === deployer.address).length > 0;
  if (addressOverlap && !deployerBal.eq(ALLOC.DEX_LIQUIDITY)) {
    console.log("  NOTE: Deployer balance includes Treasury/Community (same address in DRY RUN).");
    console.log("  On mainnet with separate addresses, deployer will hold exactly 400M IFR.");
  } else if (!deployerBal.eq(ALLOC.DEX_LIQUIDITY)) {
    console.warn("  WARNING: Deployer balance does not match expected DEX allocation!");
    console.warn(`  Difference: ${fmt(deployerBal.sub(ALLOC.DEX_LIQUIDITY))} IFR`);
  } else {
    console.log("  OK — Distribution matches expected allocation.");
  }

  // ════════════════════════════════════════════════════════════
  // [12/12] Remove deployer feeExempt
  // ════════════════════════════════════════════════════════════
  console.log("\n[12/12] Removing deployer feeExempt...");
  tx = await token.setFeeExempt(deployer.address, false);
  await tx.wait();
  console.log("  feeExempt[Deployer] = false");

  // ════════════════════════════════════════════════════════════
  // DEPLOYMENT SUMMARY
  // ════════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(60));
  if (isHardhat) {
    console.log("  DRY RUN COMPLETE — All steps passed!");
  } else {
    console.log("  MAINNET DEPLOYMENT COMPLETE");
  }
  console.log("=".repeat(60));
  console.log(`
  Contract Addresses:
  ─────────────────────────────────────────────────
  InfernoToken:      ${deployed.token}
  Governance:        ${deployed.governance}
  IFRLock:           ${deployed.ifrLock}
  BurnReserve:       ${deployed.burnReserve}
  BuybackVault:      ${deployed.buybackVault}
  PartnerVault:      ${deployed.partnerVault}
  FeeRouterV1:       ${deployed.feeRouter}
  Vesting (Team):    ${deployed.vesting}
  LiquidityReserve:  ${deployed.liquidityReserve}

  Token Distribution (CFLM):
  ─────────────────────────────────────────────────
  DEX Liquidity:       400,000,000 IFR  (40%) — deployer (for LP)
  Liquidity Reserve:   200,000,000 IFR  (20%) — locked 6 months
  Team Vesting:        150,000,000 IFR  (15%) — 12mo cliff + 36mo linear
  Treasury:            150,000,000 IFR  (15%) — ${TREASURY_ADDR}
  Community & Grants:   60,000,000 IFR  ( 6%) — ${COMMUNITY_ADDR}
  Partner Ecosystem:    40,000,000 IFR  ( 4%) — PartnerVault

  FeeExempt (permanent):
  ─────────────────────────────────────────────────
  Vesting, LiquidityReserve, BuybackVault, BurnReserve,
  IFRLock, PartnerVault, Treasury
  Deployer: REMOVED

  Configuration:
  ─────────────────────────────────────────────────
  Governance delay:    48h
  BuybackVault:        60d activation, router = ${UNISWAP_ROUTER}
  PartnerVault:        15% reward, 4M annual cap, admin = Governance
  FeeRouterV1:         feeCollector = Treasury, voucherSigner = ${VOUCHER_SIGNER}

  NEXT STEPS:
  ─────────────────────────────────────────────────
  1. Verify all 9 contracts on Etherscan:
     npx hardhat verify --network mainnet <address> <constructor-args>

  2. Create Uniswap V2 LP (400M IFR + ETH):
     npx hardhat run scripts/create-lp.js --network mainnet

  3. Lock LP tokens (Unicrypt/Team.Finance, min 12 months)

  4. Transfer InfernoToken ownership to Governance:
     token.transferOwnership(${deployed.governance})

  5. Transfer contract ownership to Governance:
     liquidityReserve.transferOwnership(${deployed.governance})
     buybackVault.transferOwnership(${deployed.governance})
     burnReserve.transferOwnership(${deployed.governance})

  6. Transfer Governance admin to Multisig:
     governance.setOwner(<MULTISIG_ADDRESS>)

  7. Setup FeeRouter adapters:
     Deploy swap adapter + whitelist via Governance proposal

  8. Update all docs, dashboard, and app configs with mainnet addresses
`);

  // ── Write deployment record ─────────────────────────────
  if (!isHardhat) {
    console.log("  Deployment addresses saved. Update docs/DEPLOYMENTS.md manually.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:");
    console.error(err);
    process.exit(1);
  });
