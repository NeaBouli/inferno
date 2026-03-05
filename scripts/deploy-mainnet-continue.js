const { ethers } = require("hardhat");

/**
 * INFERNO — Mainnet Deploy CONTINUE (Steps 3-12)
 *
 * Resumes from after InfernoToken + Governance deployment.
 * Patches ethers v5 Formatter to handle Alchemy's empty 'to' field
 * on contract creation transactions.
 *
 * Usage: npx hardhat run scripts/deploy-mainnet-continue.js --network mainnet
 */

// ── Monkey-patch ethers v5 Formatter ─────────────────────────
// Alchemy returns to="" for contract creation TXs instead of to=null.
// ethers v5 Formatter.transactionResponse() rejects "" as invalid address.
const { Formatter } = require("@ethersproject/providers");
const _origTxResponse = Formatter.prototype.transactionResponse;
Formatter.prototype.transactionResponse = function (tx) {
  if (tx.to === "" || tx.to === "0x") tx.to = null;
  return _origTxResponse.call(this, tx);
};

const DECIMALS = 9;
const parse = (n) => ethers.utils.parseUnits(String(n), DECIMALS);
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);

// ── Already deployed ─────────────────────────────────────────
const INFERNO_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE    = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";

// Mainnet Uniswap V2 Router
const UNISWAP_V2_ROUTER_MAINNET = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

// ── Token Allocation (CFLM) ─────────────────────────────────
const ALLOC = {
  DEX_LIQUIDITY:      parse(400_000_000),
  LIQUIDITY_RESERVE:  parse(200_000_000),
  TEAM_VESTING:       parse(150_000_000),
  TREASURY:           parse(150_000_000),
  COMMUNITY:          parse( 60_000_000),
  PARTNER:            parse( 40_000_000),
};

// ── Contract Parameters ─────────────────────────────────────
const PARAMS = {
  GOV_DELAY:          2 * 86400,
  LOCK_DURATION:      180 * 86400,
  MAX_PER_PERIOD:     parse(50_000_000),
  PERIOD_DURATION:    90 * 86400,
  CLIFF_DURATION:     365 * 86400,
  TOTAL_DURATION:     4 * 365 * 86400,
  ACTIVATION_DELAY:   60 * 86400,
  REWARD_BPS:         1500,
  ANNUAL_CAP:         parse(4_000_000),
};

/**
 * Deploy helper — deploy + wait for confirmation
 */
async function safeDeploy(factory, args, label) {
  const contract = await factory.deploy(...args);
  await contract.deployed();
  console.log(`  ${label}: ${contract.address}`);
  return contract;
}

/**
 * Safe TX send — send + wait for receipt
 */
async function safeTx(txPromise, label) {
  const tx = await txPromise;
  await tx.wait();
  console.log(`  ${label}`);
  return tx;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  const TREASURY_ADDR    = process.env.TREASURY_ADDRESS       || deployer.address;
  const COMMUNITY_ADDR   = process.env.COMMUNITY_ADDRESS      || deployer.address;
  const TEAM_BENEFICIARY = process.env.TEAM_BENEFICIARY       || deployer.address;
  const VOUCHER_SIGNER   = process.env.VOUCHER_SIGNER_ADDRESS || deployer.address;
  const UNISWAP_ROUTER   = process.env.UNISWAP_ROUTER        || UNISWAP_V2_ROUTER_MAINNET;
  const GUARDIAN_ADDR    = process.env.GUARDIAN_ADDRESS        || deployer.address;

  console.log("\n" + "=".repeat(60));
  console.log("  INFERNO — MAINNET DEPLOY CONTINUE (Steps 3-12)");
  console.log("=".repeat(60));
  console.log(`  Deployer:       ${deployer.address}`);
  console.log(`  Balance:        ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`  Network:        ${network.name} (chainId: ${network.chainId})`);
  console.log(`  InfernoToken:   ${INFERNO_TOKEN} (already deployed)`);
  console.log(`  Governance:     ${GOVERNANCE} (already deployed)`);
  console.log("-".repeat(60));

  const deployed = { token: INFERNO_TOKEN, governance: GOVERNANCE };

  // Attach to already-deployed contracts
  const token = await ethers.getContractAt("InfernoToken", INFERNO_TOKEN);
  const governance = await ethers.getContractAt("Governance", GOVERNANCE);

  const supply = await token.totalSupply();
  const deployerBal = await token.balanceOf(deployer.address);
  console.log(`\n[1/12] InfernoToken — ALREADY DEPLOYED`);
  console.log(`  Address:          ${INFERNO_TOKEN}`);
  console.log(`  Total Supply:     ${fmt(supply)} IFR`);
  console.log(`  Deployer Balance: ${fmt(deployerBal)} IFR`);
  console.log(`  Owner:            ${await token.owner()}`);

  console.log(`\n[2/12] Governance — ALREADY DEPLOYED`);
  console.log(`  Address:          ${GOVERNANCE}`);
  console.log(`  Delay:            ${(await governance.delay()).toNumber() / 3600}h`);
  console.log(`  Owner:            ${await governance.owner()}`);

  // Verify deployer has all tokens
  if (!deployerBal.eq(supply)) {
    console.error(`  ERROR: Deployer doesn't hold full supply. Already distributed?`);
    console.error(`  Expected: ${fmt(supply)}, Got: ${fmt(deployerBal)}`);
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════
  // [3/12] IFRLock
  // ════════════════════════════════════════════════════════════
  console.log("\n[3/12] Deploying IFRLock...");
  const IFRLock = await ethers.getContractFactory("IFRLock");
  const ifrLock = await safeDeploy(IFRLock, [token.address, GUARDIAN_ADDR], "IFRLock");
  deployed.ifrLock = ifrLock.address;

  // ════════════════════════════════════════════════════════════
  // [4/12] BurnReserve
  // ════════════════════════════════════════════════════════════
  console.log("\n[4/12] Deploying BurnReserve...");
  const BurnReserve = await ethers.getContractFactory("BurnReserve");
  const burnReserve = await safeDeploy(BurnReserve, [token.address, GUARDIAN_ADDR], "BurnReserve");
  deployed.burnReserve = burnReserve.address;

  // ════════════════════════════════════════════════════════════
  // [5/12] BuybackVault
  // ════════════════════════════════════════════════════════════
  console.log("\n[5/12] Deploying BuybackVault...");
  const BuybackVault = await ethers.getContractFactory("BuybackVault");
  const buybackVault = await safeDeploy(BuybackVault, [
    token.address, burnReserve.address, TREASURY_ADDR,
    UNISWAP_ROUTER, GUARDIAN_ADDR, PARAMS.ACTIVATION_DELAY
  ], "BuybackVault");
  deployed.buybackVault = buybackVault.address;
  console.log(`  Activation:       60 days after deploy`);

  // ════════════════════════════════════════════════════════════
  // [6/12] PartnerVault
  // ════════════════════════════════════════════════════════════
  console.log("\n[6/12] Deploying PartnerVault...");
  const PartnerVault = await ethers.getContractFactory("PartnerVault");
  const partnerVault = await safeDeploy(PartnerVault, [
    token.address, governance.address, GUARDIAN_ADDR,
    PARAMS.REWARD_BPS, PARAMS.ANNUAL_CAP
  ], "PartnerVault");
  deployed.partnerVault = partnerVault.address;
  console.log(`  Admin:            ${governance.address} (Governance)`);
  console.log(`  RewardBps:        ${PARAMS.REWARD_BPS} (${PARAMS.REWARD_BPS / 100}%)`);

  // ════════════════════════════════════════════════════════════
  // [7/12] FeeRouterV1
  // ════════════════════════════════════════════════════════════
  console.log("\n[7/12] Deploying FeeRouterV1...");
  const FeeRouterV1 = await ethers.getContractFactory("FeeRouterV1");
  const feeRouter = await safeDeploy(FeeRouterV1, [
    governance.address, TREASURY_ADDR, VOUCHER_SIGNER
  ], "FeeRouterV1");
  deployed.feeRouter = feeRouter.address;

  // ════════════════════════════════════════════════════════════
  // [8/12] Vesting
  // ════════════════════════════════════════════════════════════
  console.log("\n[8/12] Deploying Vesting (Team)...");
  const Vesting = await ethers.getContractFactory("Vesting");
  const vesting = await safeDeploy(Vesting, [
    token.address, TEAM_BENEFICIARY, PARAMS.CLIFF_DURATION,
    PARAMS.TOTAL_DURATION, ALLOC.TEAM_VESTING, GUARDIAN_ADDR
  ], "Vesting");
  deployed.vesting = vesting.address;
  console.log(`  Beneficiary:      ${TEAM_BENEFICIARY}`);

  // ════════════════════════════════════════════════════════════
  // [9/12] LiquidityReserve
  // ════════════════════════════════════════════════════════════
  console.log("\n[9/12] Deploying LiquidityReserve...");
  const LiquidityReserve = await ethers.getContractFactory("LiquidityReserve");
  const liquidityReserve = await safeDeploy(LiquidityReserve, [
    token.address, PARAMS.LOCK_DURATION, PARAMS.MAX_PER_PERIOD,
    PARAMS.PERIOD_DURATION, GUARDIAN_ADDR
  ], "LiquidityReserve");
  deployed.liquidityReserve = liquidityReserve.address;

  // ════════════════════════════════════════════════════════════
  // [10/12] Set feeExempt
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
    { name: "Deployer",         addr: deployer.address },
  ];

  for (const { name, addr } of exemptions) {
    await safeTx(token.setFeeExempt(addr, true), `feeExempt[${name}] = true`);
  }

  // ════════════════════════════════════════════════════════════
  // [11/12] Token Distribution
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
    await safeTx(token.transfer(addr, amount), `${name}: ${fmt(amount)} IFR (${pct})`);
    const bal = await token.balanceOf(addr);
    console.log(`    → balance: ${fmt(bal)} IFR`);
  }

  const finalDeployerBal = await token.balanceOf(deployer.address);
  console.log(`  Deployer (DEX):   ${fmt(finalDeployerBal)} IFR (40% for LP pairing)`);

  if (finalDeployerBal.eq(ALLOC.DEX_LIQUIDITY)) {
    console.log("  OK — Distribution matches expected allocation.");
  } else {
    console.warn(`  WARNING: Expected ${fmt(ALLOC.DEX_LIQUIDITY)}, got ${fmt(finalDeployerBal)}`);
  }

  // ════════════════════════════════════════════════════════════
  // [12/12] Remove deployer feeExempt
  // ════════════════════════════════════════════════════════════
  console.log("\n[12/12] Removing deployer feeExempt...");
  await safeTx(token.setFeeExempt(deployer.address, false), "feeExempt[Deployer] = false");

  // ════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(60));
  console.log("  MAINNET DEPLOYMENT COMPLETE");
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
  DEX Liquidity:       400,000,000 IFR  (40%) — deployer
  Liquidity Reserve:   200,000,000 IFR  (20%) — locked 6 months
  Team Vesting:        150,000,000 IFR  (15%) — 12mo cliff + 36mo linear
  Treasury:            150,000,000 IFR  (15%) — ${TREASURY_ADDR}
  Community & Grants:   60,000,000 IFR  ( 6%) — ${COMMUNITY_ADDR}
  Partner Ecosystem:    40,000,000 IFR  ( 4%) — PartnerVault

  NEXT STEPS:
  ─────────────────────────────────────────────────
  1. Verify all 9 contracts on Etherscan
  2. Create Uniswap V2 LP (400M IFR + ETH)
  3. Lock LP tokens (min 12 months)
  4. Transfer ownership to Governance
  5. Transfer Governance admin to Multisig
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:");
    console.error(err);
    process.exit(1);
  });
