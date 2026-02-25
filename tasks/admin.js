/**
 * IFR Admin Hardhat Tasks
 * Usage: npx hardhat <task> --network sepolia [args]
 */

const { task } = require("hardhat/config");

// === IFRLOCK ===
task("lock-check", "Check if wallet has IFR locked")
  .addParam("wallet", "Wallet address")
  .addOptionalParam("min", "Minimum IFR amount", "1000")
  .setAction(async (args, hre) => {
    const lock = await hre.ethers.getContractAt("IFRLock", process.env.IFRLOCK_ADDRESS);
    const min = hre.ethers.utils.parseUnits(args.min, 9);
    const isLocked = await lock.isLocked(args.wallet, min);
    const amount = await lock.lockedAmount(args.wallet);
    console.log(`Wallet: ${args.wallet}`);
    console.log(`Locked: ${hre.ethers.utils.formatUnits(amount, 9)} IFR`);
    console.log(`isLocked(>=${args.min}): ${isLocked}`);
  });

// === PARTNERVAULT ===
task("vault-status", "Show PartnerVault status")
  .setAction(async (args, hre) => {
    const vault = await hre.ethers.getContractAt("PartnerVault", process.env.PARTNERVAULT_ADDRESS);
    const rewardBps = await vault.rewardBps();
    const totalRewarded = await vault.totalRewarded();
    const annualCap = await vault.annualEmissionCap();
    console.log(`rewardBps: ${rewardBps} (${rewardBps / 100}%)`);
    console.log(`totalRewarded: ${hre.ethers.utils.formatUnits(totalRewarded, 9)} IFR`);
    console.log(`annualCap: ${hre.ethers.utils.formatUnits(annualCap, 9)} IFR`);
  });

task("vault-set-caller", "Set authorized caller for PartnerVault")
  .addParam("caller", "Address to authorize")
  .addParam("status", "true or false")
  .setAction(async (args, hre) => {
    const vault = await hre.ethers.getContractAt("PartnerVault", process.env.PARTNERVAULT_ADDRESS);
    const tx = await vault.setAuthorizedCaller(args.caller, args.status === "true");
    await tx.wait();
    console.log(`setAuthorizedCaller(${args.caller}, ${args.status}) done. TX: ${tx.hash}`);
  });

// === FEEROUTER ===
task("feerouter-status", "Show FeeRouterV1 status")
  .setAction(async (args, hre) => {
    const router = await hre.ethers.getContractAt("FeeRouterV1", process.env.FEEROUTER_ADDRESS);
    const feeBps = await router.protocolFeeBps();
    const paused = await router.paused();
    const signer = await router.voucherSigner();
    console.log(`protocolFeeBps: ${feeBps} (${feeBps / 100}%)`);
    console.log(`paused: ${paused}`);
    console.log(`voucherSigner: ${signer}`);
  });

task("feerouter-pause", "Pause/unpause FeeRouterV1")
  .addParam("status", "true or false")
  .setAction(async (args, hre) => {
    const router = await hre.ethers.getContractAt("FeeRouterV1", process.env.FEEROUTER_ADDRESS);
    const tx = await router.setPaused(args.status === "true");
    await tx.wait();
    console.log(`setPaused(${args.status}) done. TX: ${tx.hash}`);
  });

// === GOVERNANCE ===
task("gov-queue", "Show all queued governance proposals")
  .setAction(async (args, hre) => {
    const gov = await hre.ethers.getContractAt("Governance", process.env.GOVERNANCE_ADDRESS);
    const filter = gov.filters.ProposalCreated();
    const events = await gov.queryFilter(filter, 0, "latest");
    console.log(`Found ${events.length} proposals:`);
    for (const e of events) {
      console.log(`- ID: ${e.args.proposalId.toString()} | ETA: ${new Date(e.args.eta.toNumber() * 1000).toISOString()}`);
    }
  });

// === TOKEN ===
task("token-stats", "Show IFRToken stats")
  .setAction(async (args, hre) => {
    const token = await hre.ethers.getContractAt("InfernoToken", process.env.TOKEN_ADDRESS);
    const supply = await token.totalSupply();
    const senderBurn = await token.senderBurnBps();
    const recipientBurn = await token.recipientBurnBps();
    const poolFee = await token.poolFeeBps();
    console.log(`totalSupply: ${hre.ethers.utils.formatUnits(supply, 9)} IFR`);
    console.log(`senderBurnBps: ${senderBurn} (${senderBurn / 100}%)`);
    console.log(`recipientBurnBps: ${recipientBurn} (${recipientBurn / 100}%)`);
    console.log(`poolFeeBps: ${poolFee} (${poolFee / 100}%)`);
    console.log(`totalFeeBps: ${Number(senderBurn) + Number(recipientBurn) + Number(poolFee)} (${(Number(senderBurn) + Number(recipientBurn) + Number(poolFee)) / 100}%)`);
  });
