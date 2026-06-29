#!/usr/bin/env node
/**
 * INFERNO - Contributor execution readiness check.
 *
 * Read-only status check for the post-buy flow:
 * contributor buy -> 50% CommitmentVault lock -> 50% LendingVault offer.
 *
 * Usage:
 *   node scripts/check-contributors-execution.js
 *   STRICT=true node scripts/check-contributors-execution.js
 *
 * Optional:
 *   MIN_CONTRIBUTOR_ETH=0.05  minimum ETH before the Uniswap buy
 *   MIN_GAS_ETH=0.005         minimum ETH after buy for lock/lending gas
 */

"use strict";

require("dotenv").config({ quiet: true });
const { ethers } = require("ethers");

const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const BOOTSTRAP_VAULT = "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141";
const COMMITMENT_VAULT = "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
const LENDING_VAULT = "0x974305Ab0EC905172e697271C3d7d385194EB9DF";
const LP_TOKEN = "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0";

const IFR_DECIMALS = 9;
const CLAIM_BALANCE = ethers.utils.parseUnits("33333333.333333333", IFR_DECIMALS);
const PUBLIC_MAINNET_RPC = "https://ethereum-rpc.publicnode.com";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const BOOTSTRAP_ABI = [
  "function contributors(uint256) view returns (address)",
  "function claimed(address) view returns (bool)",
  "function finalised() view returns (bool)",
];

const COMMITMENT_ABI = [
  "function lockedBalance(address wallet) view returns (uint256)",
  "function getTrancheCount(address wallet) view returns (uint256)",
];

const LENDING_ABI = [
  "function hasOffer(address lender) view returns (bool)",
  "function lenderOfferIndex(address lender) view returns (uint256)",
  "function offers(uint256) view returns (address lender, uint256 availableIFR, uint256 lentIFR, bool active)",
  "function totalAvailable() view returns (uint256)",
  "function totalLent() view returns (uint256)",
  "function getInterestRate() view returns (uint256)",
];

function envFlag(name, defaultValue) {
  if (process.env[name] == null) return defaultValue;
  return String(process.env[name]).toLowerCase() === "true";
}

function fmtIFR(value) {
  return ethers.utils.formatUnits(value, IFR_DECIMALS);
}

function fmtEth(value) {
  return ethers.utils.formatEther(value);
}

function short(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function nextAction(row, minBuyEth, minGasEth) {
  if (!row.claimed) return "claim bootstrap IFR";
  if (!row.buyDetected) {
    if (row.eth.lt(minBuyEth)) return "top up ETH for buy + gas";
    return "buy IFR on Uniswap";
  }
  if (row.tranches.isZero()) {
    if (row.eth.lt(minGasEth)) return "top up ETH for lock/lending gas";
    return "run LOCK_BPS=5000 lock";
  }
  if (!row.hasOffer) {
    if (row.eth.lt(minGasEth)) return "top up ETH for lending gas";
    return "run LendingVault offer with LENDING_BPS=10000";
  }
  return "done";
}

async function main() {
  const strict = envFlag("STRICT", false);
  const minBuyEth = ethers.utils.parseEther(process.env.MIN_CONTRIBUTOR_ETH || "0.05");
  const minGasEth = ethers.utils.parseEther(process.env.MIN_GAS_ETH || "0.005");
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.MAINNET_RPC_URL || PUBLIC_MAINNET_RPC
  );

  const [network, blockNumber] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
  ]);

  const token = new ethers.Contract(IFR_TOKEN, ERC20_ABI, provider);
  const weth = new ethers.Contract(WETH, ERC20_ABI, provider);
  const bootstrap = new ethers.Contract(BOOTSTRAP_VAULT, BOOTSTRAP_ABI, provider);
  const commitment = new ethers.Contract(COMMITMENT_VAULT, COMMITMENT_ABI, provider);
  const lending = new ethers.Contract(LENDING_VAULT, LENDING_ABI, provider);

  const [finalised, contributors, poolEth, poolIfr, totalAvailable, totalLent, rate] =
    await Promise.all([
      bootstrap.finalised(),
      Promise.all([0, 1, 2].map((i) => bootstrap.contributors(i))),
      weth.balanceOf(LP_TOKEN),
      token.balanceOf(LP_TOKEN),
      lending.totalAvailable(),
      lending.totalLent(),
      lending.getInterestRate(),
    ]);

  const rows = [];
  for (let i = 0; i < contributors.length; i += 1) {
    const address = ethers.utils.getAddress(contributors[i]);
    const [
      eth,
      ifr,
      claimed,
      locked,
      tranches,
      commitmentAllowance,
      lendingAllowance,
      hasOffer,
    ] = await Promise.all([
      provider.getBalance(address),
      token.balanceOf(address),
      bootstrap.claimed(address),
      commitment.lockedBalance(address),
      commitment.getTrancheCount(address),
      token.allowance(address, COMMITMENT_VAULT),
      token.allowance(address, LENDING_VAULT),
      lending.hasOffer(address),
    ]);

    let offer = null;
    if (hasOffer) {
      const offerIndex = await lending.lenderOfferIndex(address);
      offer = await lending.offers(offerIndex);
    }

    const accountedIfr = ifr
      .add(locked)
      .add(offer ? offer.availableIFR : 0)
      .add(offer ? offer.lentIFR : 0);

    rows.push({
      name: `C${i + 1}`,
      address,
      eth,
      ifr,
      accountedIfr,
      claimed,
      locked,
      tranches,
      commitmentAllowance,
      lendingAllowance,
      hasOffer,
      offer,
      buyDetected: accountedIfr.gt(CLAIM_BALANCE),
    });
  }

  console.log("=".repeat(72));
  console.log("INFERNO - Contributor Execution Readiness");
  console.log("=".repeat(72));
  console.log(`Network: ${network.name} (${network.chainId})`);
  console.log(`Block: ${blockNumber}`);
  console.log(`Bootstrap finalised: ${finalised}`);
  console.log(`Min ETH target before buy: ${fmtEth(minBuyEth)}`);
  console.log(`Min ETH target after buy for gas: ${fmtEth(minGasEth)}`);
  console.log(`Pool ETH: ${fmtEth(poolEth)}`);
  console.log(`Pool IFR: ${fmtIFR(poolIfr)}`);
  console.log(`Lending totalAvailable: ${fmtIFR(totalAvailable)}`);
  console.log(`Lending totalLent: ${fmtIFR(totalLent)}`);
  console.log(`Lending rate: ${rate.toString()} bps/month`);
  console.log("");

  let allDone = true;
  for (const row of rows) {
    const action = nextAction(row, minBuyEth, minGasEth);
    if (action !== "done") allDone = false;

    console.log(`${row.name} ${short(row.address)} ${row.address}`);
    console.log(`  ETH: ${fmtEth(row.eth)}`);
    console.log(`  IFR: ${fmtIFR(row.ifr)}`);
    console.log(`  Accounted IFR: ${fmtIFR(row.accountedIfr)}`);
    console.log(`  Claimed: ${row.claimed}`);
    console.log(`  Buy detected: ${row.buyDetected}`);
    console.log(`  Locked: ${fmtIFR(row.locked)} IFR`);
    console.log(`  Tranches: ${row.tranches.toString()}`);
    console.log(`  Commitment allowance: ${fmtIFR(row.commitmentAllowance)}`);
    console.log(`  Lending allowance: ${fmtIFR(row.lendingAllowance)}`);
    console.log(`  Has lending offer: ${row.hasOffer}`);
    if (row.offer) {
      console.log(`  Offer available: ${fmtIFR(row.offer.availableIFR)}`);
      console.log(`  Offer lent: ${fmtIFR(row.offer.lentIFR)}`);
      console.log(`  Offer active: ${row.offer.active}`);
    }
    console.log(`  Next: ${action}`);
    console.log("");
  }

  console.log("Commands after contributor buys:");
  console.log("  CONTRIBUTOR_ADDR=0x... LOCK_BPS=5000 DRY_RUN=true node scripts/contributors-lock.js");
  console.log("  CONTRIBUTOR_ADDR=0x... LENDING_BPS=10000 DRY_RUN=true node scripts/contributors-lending-offer.js");
  console.log("  CONTRIBUTOR_ADDR=0x... PRIVATE_KEY=0x... DRY_RUN=false MAINNET=true LOCK_BPS=5000 node scripts/contributors-lock.js");
  console.log("  CONTRIBUTOR_ADDR=0x... PRIVATE_KEY=0x... DRY_RUN=false MAINNET=true LENDING_BPS=10000 node scripts/contributors-lending-offer.js");

  if (strict && !allDone) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
