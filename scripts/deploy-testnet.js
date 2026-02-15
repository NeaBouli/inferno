const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("INFERNO — Testnet Deployment");
  console.log("=".repeat(60));
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`Network:   ${(await ethers.provider.getNetwork()).name}`);
  console.log("-".repeat(60));

  // ──────────────────────────────────────────────────────────────
  // 1. Deploy InfernoToken
  //    poolFeeReceiver = deployer (can be changed later)
  // ──────────────────────────────────────────────────────────────
  console.log("\n[1/7] Deploying InfernoToken...");
  const InfernoToken = await ethers.getContractFactory("InfernoToken");
  const token = await InfernoToken.deploy(deployer.address);
  await token.deployed();
  console.log(`  InfernoToken:  ${token.address}`);
  console.log(`  Supply:        ${ethers.utils.formatUnits(await token.totalSupply(), 9)} IFR`);
  console.log(`  Decimals:      ${await token.decimals()}`);

  // ──────────────────────────────────────────────────────────────
  // 2. Deploy Presale
  //    TOKEN_PRICE = 0.0001 ETH per 1 IFR  →  1 ETH = 10,000 IFR
  // ──────────────────────────────────────────────────────────────
  console.log("\n[2/7] Deploying Presale...");
  const TOKEN_PRICE = process.env.TOKEN_PRICE || ethers.utils.parseUnits("0.0001", "ether");
  const HARD_CAP = process.env.HARD_CAP || ethers.utils.parseEther("100");
  const PER_WALLET_CAP = process.env.PER_WALLET_CAP || ethers.utils.parseEther("10");
  const presaleDays = process.env.PRESALE_DURATION_DAYS || 30;

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const startTime = now + 60;           // starts in 1 minute
  const endTime = now + presaleDays * 86400;

  const Presale = await ethers.getContractFactory("Presale");
  const presale = await Presale.deploy(
    token.address,
    TOKEN_PRICE,
    HARD_CAP,
    PER_WALLET_CAP,
    startTime,
    endTime
  );
  await presale.deployed();
  console.log(`  Presale:       ${presale.address}`);
  console.log(`  TOKEN_PRICE:   ${ethers.utils.formatEther(TOKEN_PRICE)} ETH/IFR`);
  console.log(`  Hard Cap:      ${ethers.utils.formatEther(HARD_CAP)} ETH`);
  console.log(`  Wallet Cap:    ${ethers.utils.formatEther(PER_WALLET_CAP)} ETH`);
  console.log(`  Window:        ${new Date(startTime * 1000).toISOString()} → ${new Date(endTime * 1000).toISOString()}`);

  // ──────────────────────────────────────────────────────────────
  // 3. Deploy BurnReserve
  //    guardian = deployer
  // ──────────────────────────────────────────────────────────────
  console.log("\n[3/7] Deploying BurnReserve...");
  const BurnReserve = await ethers.getContractFactory("BurnReserve");
  const burnReserve = await BurnReserve.deploy(
    token.address,
    deployer.address     // guardian
  );
  await burnReserve.deployed();
  console.log(`  BurnReserve:   ${burnReserve.address}`);

  // ──────────────────────────────────────────────────────────────
  // 4. Deploy BuybackVault
  //    burnReserve = BurnReserve contract, treasury = deployer (change later)
  //    router = deployer placeholder (set real router later)
  // ──────────────────────────────────────────────────────────────
  console.log("\n[4/7] Deploying BuybackVault...");
  const BuybackVault = await ethers.getContractFactory("BuybackVault");
  const vault = await BuybackVault.deploy(
    token.address,
    burnReserve.address, // burnReserve (real address)
    deployer.address,    // treasury (placeholder)
    deployer.address,    // router (placeholder — set real router via setParams)
    deployer.address     // guardian
  );
  await vault.deployed();
  console.log(`  BuybackVault:  ${vault.address}`);
  console.log(`  BurnReserve:   ${burnReserve.address} (wired)`);
  console.log(`  (!) Router, Treasury are set to deployer — update via setParams()`);

  // ──────────────────────────────────────────────────────────────
  // 5. Deploy Vesting
  //    beneficiary = deployer, 90d cliff, 365d duration, 100M IFR
  // ──────────────────────────────────────────────────────────────
  console.log("\n[5/7] Deploying Vesting...");
  const cliffDays = process.env.VESTING_CLIFF_DAYS || 90;
  const durationDays = process.env.VESTING_DURATION_DAYS || 365;
  const VESTING_ALLOCATION = ethers.utils.parseUnits("100000000", 9); // 100M IFR

  const Vesting = await ethers.getContractFactory("Vesting");
  const vesting = await Vesting.deploy(
    token.address,
    deployer.address,           // beneficiary (placeholder)
    cliffDays * 86400,          // cliff in seconds
    durationDays * 86400,       // duration in seconds
    VESTING_ALLOCATION,
    deployer.address            // guardian
  );
  await vesting.deployed();
  console.log(`  Vesting:       ${vesting.address}`);
  console.log(`  Cliff:         ${cliffDays} days`);
  console.log(`  Duration:      ${durationDays} days`);
  console.log(`  Allocation:    ${ethers.utils.formatUnits(VESTING_ALLOCATION, 9)} IFR`);

  // ──────────────────────────────────────────────────────────────
  // 6. Set FeeExempt for all contracts
  // ──────────────────────────────────────────────────────────────
  console.log("\n[6/7] Setting feeExempt...");
  const exemptAddresses = [
    { name: "Presale", addr: presale.address },
    { name: "Vesting", addr: vesting.address },
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
  // 7. Fund Presale + Vesting with tokens
  // ──────────────────────────────────────────────────────────────
  console.log("\n[7/7] Funding contracts with IFR...");
  const PRESALE_ALLOCATION = ethers.utils.parseUnits("200000000", 9); // 200M IFR

  let tx = await token.transfer(presale.address, PRESALE_ALLOCATION);
  await tx.wait();
  console.log(`  Presale funded:  ${ethers.utils.formatUnits(PRESALE_ALLOCATION, 9)} IFR`);

  tx = await token.transfer(vesting.address, VESTING_ALLOCATION);
  await tx.wait();
  console.log(`  Vesting funded:  ${ethers.utils.formatUnits(VESTING_ALLOCATION, 9)} IFR`);

  const deployerBal = await token.balanceOf(deployer.address);
  console.log(`  Deployer remaining: ${ethers.utils.formatUnits(deployerBal, 9)} IFR`);

  // ──────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  InfernoToken:  ${token.address}
  Presale:       ${presale.address}
  BurnReserve:   ${burnReserve.address}
  BuybackVault:  ${vault.address}
  Vesting:       ${vesting.address}

  Token Distribution:
    Presale:     200,000,000 IFR  (20%)
    Vesting:     100,000,000 IFR  (10%)
    Deployer:    ${ethers.utils.formatUnits(deployerBal, 9)} IFR  (70%)

  FeeExempt: Presale, Vesting, BuybackVault, BurnReserve, Deployer

  Wiring:
    BuybackVault → BurnReserve:  ${burnReserve.address}

  NEXT STEPS:
    1. Set real Uniswap router on BuybackVault via setParams()
    2. Set real treasury address on BuybackVault via setParams()
    3. Set real beneficiary for Vesting (redeploy if needed)
    4. Remove deployer from feeExempt when setup is done
    5. Verify contracts on Etherscan
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
