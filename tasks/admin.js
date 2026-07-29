/**
 * IFR Admin Hardhat Tasks
 * Usage: npx hardhat <task> --network sepolia [args]
 */

import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";

function required(value, name) {
  if (value === undefined || value === "") {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}

async function getEthers(hre) {
  const { ethers } = await hre.network.create();
  return ethers;
}

const lockCheck = task("lock-check", "Check if wallet has IFR locked")
  .addOption({
    name: "wallet",
    description: "Wallet address",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "min",
    description: "Minimum IFR amount",
    defaultValue: "1000",
  })
  .setInlineAction(async (args, hre) => {
    const ethers = await getEthers(hre);
    const wallet = required(args.wallet, "wallet");
    const lock = await ethers.getContractAt(
      "IFRLock",
      process.env.IFRLOCK_ADDRESS,
    );
    const min = ethers.parseUnits(args.min, 9);
    const isLocked = await lock.isLocked(wallet, min);
    const amount = await lock.lockedAmount(wallet);
    console.log(`Wallet: ${wallet}`);
    console.log(`Locked: ${ethers.formatUnits(amount, 9)} IFR`);
    console.log(`isLocked(>=${args.min}): ${isLocked}`);
  })
  .build();

const vaultStatus = task("vault-status", "Show PartnerVault status")
  .setInlineAction(async (_args, hre) => {
    const ethers = await getEthers(hre);
    const vault = await ethers.getContractAt(
      "PartnerVault",
      process.env.PARTNERVAULT_ADDRESS,
    );
    const rewardBps = await vault.rewardBps();
    const totalRewarded = await vault.totalRewarded();
    const annualCap = await vault.annualEmissionCap();
    console.log(`rewardBps: ${rewardBps} (${Number(rewardBps) / 100}%)`);
    console.log(
      `totalRewarded: ${ethers.formatUnits(totalRewarded, 9)} IFR`,
    );
    console.log(`annualCap: ${ethers.formatUnits(annualCap, 9)} IFR`);
  })
  .build();

const vaultSetCaller = task(
  "vault-set-caller",
  "Set authorized caller for PartnerVault",
)
  .addOption({
    name: "caller",
    description: "Address to authorize",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "status",
    description: "true or false",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .setInlineAction(async (args, hre) => {
    const ethers = await getEthers(hre);
    const caller = required(args.caller, "caller");
    const status = required(args.status, "status");
    const vault = await ethers.getContractAt(
      "PartnerVault",
      process.env.PARTNERVAULT_ADDRESS,
    );
    const tx = await vault.setAuthorizedCaller(caller, status === "true");
    await tx.wait();
    console.log(`setAuthorizedCaller(${caller}, ${status}) done. TX: ${tx.hash}`);
  })
  .build();

const feeRouterStatus = task(
  "feerouter-status",
  "Show FeeRouterV1 status",
)
  .setInlineAction(async (_args, hre) => {
    const ethers = await getEthers(hre);
    const router = await ethers.getContractAt(
      "FeeRouterV1",
      process.env.FEEROUTER_ADDRESS,
    );
    const feeBps = await router.protocolFeeBps();
    const paused = await router.paused();
    const signer = await router.voucherSigner();
    console.log(`protocolFeeBps: ${feeBps} (${Number(feeBps) / 100}%)`);
    console.log(`paused: ${paused}`);
    console.log(`voucherSigner: ${signer}`);
  })
  .build();

const feeRouterPause = task(
  "feerouter-pause",
  "Pause/unpause FeeRouterV1",
)
  .addOption({
    name: "status",
    description: "true or false",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .setInlineAction(async (args, hre) => {
    const ethers = await getEthers(hre);
    const status = required(args.status, "status");
    const router = await ethers.getContractAt(
      "FeeRouterV1",
      process.env.FEEROUTER_ADDRESS,
    );
    const tx = await router.setPaused(status === "true");
    await tx.wait();
    console.log(`setPaused(${status}) done. TX: ${tx.hash}`);
  })
  .build();

const governanceQueue = task(
  "gov-queue",
  "Show all governance proposals with status",
)
  .setInlineAction(async (_args, hre) => {
    const ethers = await getEthers(hre);
    const gov = await ethers.getContractAt(
      "Governance",
      process.env.GOVERNANCE_ADDRESS,
    );
    const count = await gov.proposalCount();
    console.log(`Total proposals: ${count}\n`);
    for (let i = 0; i < count; i++) {
      const [target, data, eta, executed, cancelled] =
        await gov.getProposal(i);
      const etaDate = new Date(Number(eta) * 1000);
      const now = Date.now();
      let status = "PENDING";
      if (executed) status = "EXECUTED";
      else if (cancelled) status = "CANCELLED";
      else if (now >= Number(eta) * 1000) status = "READY";
      const fnSig = data.slice(0, 10);
      console.log(
        `#${i} | ${status} | ETA: ${etaDate.toISOString()} | Target: ${target} | Selector: ${fnSig}`,
      );
    }
  })
  .build();

const tokenStats = task("token-stats", "Show IFRToken stats")
  .setInlineAction(async (_args, hre) => {
    const ethers = await getEthers(hre);
    const token = await ethers.getContractAt(
      "InfernoToken",
      process.env.TOKEN_ADDRESS,
    );
    const supply = await token.totalSupply();
    const senderBurn = await token.senderBurnBps();
    const recipientBurn = await token.recipientBurnBps();
    const poolFee = await token.poolFeeBps();
    const totalFee = Number(senderBurn) + Number(recipientBurn) + Number(poolFee);
    console.log(`totalSupply: ${ethers.formatUnits(supply, 9)} IFR`);
    console.log(
      `senderBurnBps: ${senderBurn} (${Number(senderBurn) / 100}%)`,
    );
    console.log(
      `recipientBurnBps: ${recipientBurn} (${Number(recipientBurn) / 100}%)`,
    );
    console.log(`poolFeeBps: ${poolFee} (${Number(poolFee) / 100}%)`);
    console.log(`totalFeeBps: ${totalFee} (${totalFee / 100}%)`);
  })
  .build();

export default [
  lockCheck,
  vaultStatus,
  vaultSetCaller,
  feeRouterStatus,
  feeRouterPause,
  governanceQueue,
  tokenStats,
];
