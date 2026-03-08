// DEPRECATED — use deploy-bootstrap-mainnet-v3.js
const { ethers } = require("hardhat");

// ── Monkey-patch ethers v5 Formatter ─────────────────────────
// Alchemy returns to="" for contract creation TXs instead of to=null.
// ethers v5 Formatter.transactionResponse() rejects "" as invalid address.
const { Formatter } = require("@ethersproject/providers");
const _origTxResponse = Formatter.prototype.transactionResponse;
Formatter.prototype.transactionResponse = function (tx) {
  if (tx.to === "" || tx.to === "0x") tx.to = null;
  return _origTxResponse.call(this, tx);
};

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
const parse = (n) => ethers.utils.parseUnits(String(n), DECIMALS);
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);

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
const MIN_CONTRIB   = ethers.utils.parseEther("0.01");        // 0.01 ETH
const MAX_CONTRIB   = ethers.utils.parseEther("2");           // 2 ETH
const LP_LOCK_DUR   = 365 * 24 * 60 * 60;                    // 12 months
const TF_LOCKER     = ethers.constants.AddressZero;           // Team.Finance disabled for now

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("  INFERNO — Deploy BootstrapVaultV2 (Mainnet)");
  console.log("=".repeat(60));
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.utils.formatEther(balance)} ETH`);
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
  console.log(`  Total IFR: ${fmt(IFR_ALLOC.mul(2))} IFR (LP + claims)`);
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
  await vault.deployed();

  const receipt = await vault.deployTransaction.wait();

  console.log(`  BootstrapVaultV2: ${vault.address}`);
  console.log(`  TX:              ${vault.deployTransaction.hash}`);
  console.log(`  Block:           ${receipt.blockNumber}`);
  console.log(`  Gas Used:        ${receipt.gasUsed.toString()}`);

  // Estimate cost
  const gasPrice = vault.deployTransaction.gasPrice || (await ethers.provider.getGasPrice());
  const cost = receipt.gasUsed.mul(gasPrice);
  console.log(`  Gas Price:       ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`  Deploy Cost:     ${ethers.utils.formatEther(cost)} ETH`);

  // ── Step 3: Verify deployment state ────────────────────────
  console.log("\n[2/2] Verifying deployment...");

  console.log(`  ifrToken:         ${await vault.ifrToken()}`);
  console.log(`  uniswapRouter:    ${await vault.uniswapRouter()}`);
  console.log(`  teamFinanceLocker: ${await vault.teamFinanceLocker()}`);
  console.log(`  startTime:        ${(await vault.startTime()).toNumber()} (${new Date((await vault.startTime()).toNumber() * 1000).toISOString()})`);
  console.log(`  endTime:          ${(await vault.endTime()).toNumber()} (${new Date((await vault.endTime()).toNumber() * 1000).toISOString()})`);
  console.log(`  ifrAllocation:    ${fmt(await vault.ifrAllocation())} IFR`);
  console.log(`  minContribution:  ${ethers.utils.formatEther(await vault.minContribution())} ETH`);
  console.log(`  maxContribution:  ${ethers.utils.formatEther(await vault.maxContribution())} ETH`);
  console.log(`  lpLockDuration:   ${(await vault.lpLockDuration()).toNumber() / 86400} days`);
  console.log(`  totalETHRaised:   ${ethers.utils.formatEther(await vault.totalETHRaised())} ETH`);
  console.log(`  finalised:        ${await vault.finalised()}`);
  console.log(`  OK — BootstrapVaultV2 deployed successfully.`);

  // ── Summary ────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  BootstrapVaultV2: ${vault.address}
  TF Locker:        ${TF_LOCKER} (disabled)
  Start:            ${startDate}
  End:              ${endDate}
  IFR Allocation:   ${fmt(IFR_ALLOC)} IFR (claims)
  Total IFR needed: ${fmt(IFR_ALLOC.mul(2))} IFR (LP + claims)
  Min/Max:          0.01 — 2 ETH
  Deploy Cost:      ${ethers.utils.formatEther(cost)} ETH

  Next steps:
  1. Verify on Etherscan:
     npx hardhat verify --network mainnet ${vault.address} \\
       "${ADDRESSES.token}" "${ADDRESSES.router}" \\
       "${TF_LOCKER}" "${startTime}" "${DURATION}" \\
       "${IFR_ALLOC.toString()}" "${MIN_CONTRIB.toString()}" \\
       "${MAX_CONTRIB.toString()}" "${LP_LOCK_DUR}"

  2. Create Governance proposal: setFeeExempt(BootstrapVaultV2, true)
     (Required before finalise() can work correctly)

  3. Fund vault with ${fmt(IFR_ALLOC.mul(2))} IFR via Governance proposal:
     LiquidityReserve.withdraw(${vault.address}, ${IFR_ALLOC.mul(2).toString()})
     LiqRes: ${ADDRESSES.liqRes}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
