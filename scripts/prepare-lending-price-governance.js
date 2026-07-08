#!/usr/bin/env node
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ADDR = {
  IFR: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  LENDING_VAULT: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
  GOVERNANCE: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
  TREASURY_SAFE: "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b",
  IFR_WETH_PAIR: "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
};

const IFR_DECIMALS = 9;
const IFR_UNIT = ethers.BigNumber.from(10).pow(IFR_DECIMALS);
const BPS = ethers.BigNumber.from(10000);
const INITIAL_COLLATERAL_PCT = ethers.BigNumber.from(200);

const LENDING_ABI = [
  "function owner() view returns (address)",
  "function ifrPriceWei() view returns (uint256)",
  "function totalAvailable() view returns (uint256)",
  "function totalLent() view returns (uint256)",
  "function getOfferCount() view returns (uint256)",
  "function setIFRPrice(uint256 _priceWei)",
];

const GOVERNANCE_ABI = [
  "function owner() view returns (address)",
  "function delay() view returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function propose(address target, bytes calldata data) external returns (uint256)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

function usage() {
  console.log(`
INFERNO - Prepare LendingVault ifrPriceWei Governance Proposal

Dry-run only. No transaction is sent.

Usage:
  node scripts/prepare-lending-price-governance.js
  IFR_PRICE_WEI=123456789 node scripts/prepare-lending-price-governance.js
  PRICE_SOURCE=spot PRICE_HAIRCUT_BPS=9000 node scripts/prepare-lending-price-governance.js --write-safe-json
  node scripts/prepare-lending-price-governance.js --self-test

Env:
  MAINNET_RPC_URL      Mainnet RPC URL. Defaults to publicnode.
  PRICE_SOURCE         spot or manual. Defaults to spot.
  IFR_PRICE_WEI        Manual wei price per 1 full IFR token. Required for PRICE_SOURCE=manual.
  PRICE_HAIRCUT_BPS    Optional multiplier for spot price. Defaults to 10000.
`);
}

function formatIFR(value) {
  return ethers.utils.commify(ethers.utils.formatUnits(value, IFR_DECIMALS));
}

function formatDuration(seconds) {
  const n = ethers.BigNumber.from(seconds).toNumber();
  const hours = n / 3600;
  return `${hours} hours (${(hours / 24).toFixed(2)} days)`;
}

function priceFromReserves(wethReserveWei, ifrReserveBaseUnits) {
  if (ifrReserveBaseUnits.isZero()) throw new Error("IFR reserve is zero");
  return wethReserveWei.mul(IFR_UNIT).div(ifrReserveBaseUnits);
}

function requiredCollateralWei(ifrAmountBaseUnits, priceWei) {
  return ifrAmountBaseUnits.mul(priceWei).mul(INITIAL_COLLATERAL_PCT).div(IFR_UNIT.mul(100));
}

function safeTxBuilderJson(governanceData, setPriceData, candidatePriceWei) {
  return {
    version: "1.0",
    chainId: "1",
    createdAt: Date.now(),
    meta: {
      name: "IFR LendingVault ifrPriceWei proposal",
      description: "Queue Governance proposal to call LendingVault.setIFRPrice(uint256).",
      txBuilderVersion: "1.17.0",
      createdFromSafeAddress: ADDR.TREASURY_SAFE,
      createdFromOwnerAddress: "",
    },
    transactions: [
      {
        to: ADDR.GOVERNANCE,
        value: "0",
        data: governanceData,
        contractMethod: {
          inputs: [
            { internalType: "address", name: "target", type: "address" },
            { internalType: "bytes", name: "data", type: "bytes" },
          ],
          name: "propose",
          payable: false,
        },
        contractInputsValues: {
          target: ADDR.LENDING_VAULT,
          data: setPriceData,
        },
        meta: {
          priceWeiPerIFR: candidatePriceWei.toString(),
          targetFunction: "LendingVault.setIFRPrice(uint256)",
        },
      },
    ],
  };
}

function runSelfTest() {
  const wethReserve = ethers.utils.parseEther("1");
  const ifrReserve = ethers.utils.parseUnits("1000000", IFR_DECIMALS);
  const price = priceFromReserves(wethReserve, ifrReserve);
  const expectedPrice = ethers.BigNumber.from("1000000000000");
  if (!price.eq(expectedPrice)) {
    throw new Error(`price formula failed: got ${price.toString()}, expected ${expectedPrice.toString()}`);
  }

  const collateral = requiredCollateralWei(ethers.utils.parseUnits("10000", IFR_DECIMALS), price);
  const expectedCollateral = ethers.utils.parseEther("0.02");
  if (!collateral.eq(expectedCollateral)) {
    throw new Error(`collateral formula failed: got ${collateral.toString()}, expected ${expectedCollateral.toString()}`);
  }

  const lendingIface = new ethers.utils.Interface(LENDING_ABI);
  const data = lendingIface.encodeFunctionData("setIFRPrice", [price]);
  const decoded = lendingIface.decodeFunctionData("setIFRPrice", data);
  if (!decoded[0].eq(price)) {
    throw new Error("setIFRPrice calldata roundtrip failed");
  }

  console.log("Self-test passed.");
}

async function readSpotPrice(provider) {
  const pair = new ethers.Contract(ADDR.IFR_WETH_PAIR, PAIR_ABI, provider);
  const [token0, token1, reserves] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.getReserves(),
  ]);

  const token0Lower = token0.toLowerCase();
  const token1Lower = token1.toLowerCase();
  const wethLower = ADDR.WETH.toLowerCase();
  const ifrLower = ADDR.IFR.toLowerCase();

  let wethReserve;
  let ifrReserve;
  if (token0Lower === wethLower && token1Lower === ifrLower) {
    wethReserve = ethers.BigNumber.from(reserves.reserve0);
    ifrReserve = ethers.BigNumber.from(reserves.reserve1);
  } else if (token0Lower === ifrLower && token1Lower === wethLower) {
    ifrReserve = ethers.BigNumber.from(reserves.reserve0);
    wethReserve = ethers.BigNumber.from(reserves.reserve1);
  } else {
    throw new Error(`Unexpected pair tokens: token0=${token0}, token1=${token1}`);
  }

  return {
    token0,
    token1,
    wethReserve,
    ifrReserve,
    spotPriceWei: priceFromReserves(wethReserve, ifrReserve),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    usage();
    return;
  }
  if (args.has("--self-test")) {
    runSelfTest();
    return;
  }

  const rpcUrl = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 1) {
    throw new Error(`Expected Ethereum Mainnet chainId 1, got ${network.chainId}`);
  }

  const lending = new ethers.Contract(ADDR.LENDING_VAULT, LENDING_ABI, provider);
  const governance = new ethers.Contract(ADDR.GOVERNANCE, GOVERNANCE_ABI, provider);
  const lendingIface = new ethers.utils.Interface(LENDING_ABI);
  const governanceIface = new ethers.utils.Interface(GOVERNANCE_ABI);

  const [
    lendingOwner,
    governanceOwner,
    delay,
    proposalCount,
    currentPrice,
    totalAvailable,
    totalLent,
    offerCount,
  ] = await Promise.all([
    lending.owner(),
    governance.owner(),
    governance.delay(),
    governance.proposalCount(),
    lending.ifrPriceWei(),
    lending.totalAvailable(),
    lending.totalLent(),
    lending.getOfferCount(),
  ]);

  const source = (process.env.PRICE_SOURCE || (process.env.IFR_PRICE_WEI ? "manual" : "spot")).toLowerCase();
  const haircutBps = ethers.BigNumber.from(process.env.PRICE_HAIRCUT_BPS || "10000");
  if (haircutBps.lte(0) || haircutBps.gt(BPS)) {
    throw new Error("PRICE_HAIRCUT_BPS must be between 1 and 10000");
  }

  let candidatePriceWei;
  let spot = null;
  if (source === "manual") {
    if (!process.env.IFR_PRICE_WEI) {
      throw new Error("PRICE_SOURCE=manual requires IFR_PRICE_WEI");
    }
    candidatePriceWei = ethers.BigNumber.from(process.env.IFR_PRICE_WEI);
  } else if (source === "spot") {
    spot = await readSpotPrice(provider);
    candidatePriceWei = spot.spotPriceWei.mul(haircutBps).div(BPS);
  } else {
    throw new Error("PRICE_SOURCE must be spot or manual");
  }

  if (candidatePriceWei.lte(0)) {
    throw new Error("candidate ifrPriceWei must be greater than zero");
  }

  const setPriceData = lendingIface.encodeFunctionData("setIFRPrice", [candidatePriceWei]);
  const governanceData = governanceIface.encodeFunctionData("propose", [ADDR.LENDING_VAULT, setPriceData]);

  console.log("=".repeat(72));
  console.log("INFERNO - LendingVault ifrPriceWei Governance Dry Run");
  console.log("=".repeat(72));
  console.log(`Network:            Ethereum Mainnet (${network.chainId})`);
  console.log(`LendingVault:       ${ADDR.LENDING_VAULT}`);
  console.log(`Governance:         ${ADDR.GOVERNANCE}`);
  console.log(`TreasurySafe:       ${ADDR.TREASURY_SAFE}`);
  console.log(`LendingVault.owner: ${lendingOwner}`);
  console.log(`Governance.owner:   ${governanceOwner}`);
  console.log(`Governance delay:   ${formatDuration(delay)}`);
  console.log(`Next proposal ID:   ${proposalCount.toString()}`);
  console.log("");
  console.log("Current LendingVault state");
  console.log(`  ifrPriceWei:      ${currentPrice.toString()}`);
  console.log(`  totalAvailable:   ${formatIFR(totalAvailable)} IFR`);
  console.log(`  totalLent:        ${formatIFR(totalLent)} IFR`);
  console.log(`  offerCount:       ${offerCount.toString()}`);

  if (spot) {
    console.log("");
    console.log("Uniswap V2 spot read");
    console.log(`  Pair:             ${ADDR.IFR_WETH_PAIR}`);
    console.log(`  token0:           ${spot.token0}`);
    console.log(`  token1:           ${spot.token1}`);
    console.log(`  WETH reserve:     ${ethers.utils.formatEther(spot.wethReserve)} ETH`);
    console.log(`  IFR reserve:      ${formatIFR(spot.ifrReserve)} IFR`);
    console.log(`  spot ifrPriceWei: ${spot.spotPriceWei.toString()}`);
    console.log(`  haircut bps:      ${haircutBps.toString()}`);
  }

  console.log("");
  console.log("Candidate price");
  console.log(`  source:           ${source}`);
  console.log(`  ifrPriceWei:      ${candidatePriceWei.toString()}`);
  console.log(`  ETH per IFR:      ${ethers.utils.formatEther(candidatePriceWei)}`);

  console.log("");
  console.log("Collateral previews at 200%");
  for (const amount of ["1000", "10000", "1000000"]) {
    const ifrAmount = ethers.utils.parseUnits(amount, IFR_DECIMALS);
    const collateral = requiredCollateralWei(ifrAmount, candidatePriceWei);
    console.log(`  ${ethers.utils.commify(amount)} IFR -> ${ethers.utils.formatEther(collateral)} ETH`);
  }

  const expectedLendingOwner = ADDR.GOVERNANCE.toLowerCase();
  const expectedGovernanceOwner = ADDR.TREASURY_SAFE.toLowerCase();
  if (lendingOwner.toLowerCase() !== expectedLendingOwner) {
    throw new Error(`Ownership mismatch: LendingVault owner is ${lendingOwner}, expected ${ADDR.GOVERNANCE}`);
  }
  if (governanceOwner.toLowerCase() !== expectedGovernanceOwner) {
    throw new Error(`Ownership mismatch: Governance owner is ${governanceOwner}, expected ${ADDR.TREASURY_SAFE}`);
  }

  await lending.callStatic.setIFRPrice(candidatePriceWei, { from: ADDR.GOVERNANCE });
  const simulatedProposalId = await governance.callStatic.propose(
    ADDR.LENDING_VAULT,
    setPriceData,
    { from: ADDR.TREASURY_SAFE }
  );

  console.log("");
  console.log("Simulation");
  console.log("  LendingVault.setIFRPrice from Governance: PASS");
  console.log(`  Governance.propose from TreasurySafe:     PASS (returns proposal ${simulatedProposalId.toString()})`);

  console.log("");
  console.log("Calldata");
  console.log(`  Target for timelock: ${ADDR.LENDING_VAULT}`);
  console.log(`  setIFRPrice data:    ${setPriceData}`);
  console.log(`  Safe To:             ${ADDR.GOVERNANCE}`);
  console.log(`  Safe Value:          0`);
  console.log(`  Safe Data:           ${governanceData}`);

  const safeJson = safeTxBuilderJson(governanceData, setPriceData, candidatePriceWei);
  if (args.has("--write-safe-json")) {
    const outDir = path.join("/tmp", "inferno");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "lending-price-safe-tx.json");
    fs.writeFileSync(outPath, `${JSON.stringify(safeJson, null, 2)}\n`);
    console.log("");
    console.log(`Safe Transaction Builder JSON written: ${outPath}`);
  } else {
    console.log("");
    console.log("Safe Transaction Builder JSON");
    console.log(JSON.stringify(safeJson, null, 2));
  }

  console.log("");
  console.log("DRY RUN COMPLETE - no transaction was sent.");
  if (spot && spot.wethReserve.lt(ethers.utils.parseEther("1"))) {
    console.log("WARNING: WETH reserve is below 1 ETH. Treat spot price as thin-liquidity input and review manually.");
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
});
