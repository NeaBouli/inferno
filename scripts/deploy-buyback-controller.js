const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * INFERNO ($IFR) — BuybackController Mainnet Deployment
 *
 * Deploys BuybackController with hardcoded mainnet addresses.
 * Verifies on Etherscan automatically.
 *
 * DRY RUN:   npx hardhat run scripts/deploy-buyback-controller.js --network hardhat
 * MAINNET:   npx hardhat run scripts/deploy-buyback-controller.js --network mainnet
 *
 * Required env vars for mainnet:
 *   MAINNET_RPC_URL        — Alchemy/Infura mainnet RPC
 *   DEPLOYER_PRIVATE_KEY   — deployer wallet key
 */

// ── Mainnet Addresses (from DEPLOYMENTS.md — immutable) ─────
const TOKEN         = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const BURN_RESERVE  = "0xaA1496133B6c274190A2113410B501C5802b6fCF";
const ROUTER        = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const LP_RECEIVER   = "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b"; // TreasurySafe 3-of-5
const GOVERNANCE    = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const isMainnet = network.chainId === 1;

  console.log("═══════════════════════════════════════════════");
  console.log("  BuybackController Deployment");
  console.log("═══════════════════════════════════════════════");
  console.log("Network:    ", isMainnet ? "Ethereum Mainnet" : `Chain ${network.chainId}`);
  console.log("Deployer:   ", deployer.address);
  console.log("");
  console.log("Constructor Parameters:");
  console.log("  token:       ", TOKEN);
  console.log("  burnReserve: ", BURN_RESERVE);
  console.log("  router:      ", ROUTER);
  console.log("  lpReceiver:  ", LP_RECEIVER, "(TreasurySafe)");
  console.log("  guardian:    ", deployer.address, "(Deployer EOA)");
  console.log("  governance:  ", GOVERNANCE, "(Governance Timelock)");
  console.log("");

  // Deploy
  console.log("Deploying BuybackController...");
  const Factory = await ethers.getContractFactory("BuybackController");
  const controller = await Factory.deploy(
    TOKEN,
    BURN_RESERVE,
    ROUTER,
    LP_RECEIVER,
    deployer.address,  // guardian
    GOVERNANCE         // owner
  );
  await controller.deployed();

  console.log("  TX:      ", controller.deployTransaction.hash);
  console.log("  Address: ", controller.address);
  console.log("  Gas:     ", (await controller.deployTransaction.wait()).gasUsed.toString());
  console.log("");

  // Verify on Etherscan
  if (isMainnet) {
    console.log("Verifying on Etherscan...");
    try {
      await run("verify:verify", {
        address: controller.address,
        constructorArguments: [
          TOKEN,
          BURN_RESERVE,
          ROUTER,
          LP_RECEIVER,
          deployer.address,
          GOVERNANCE,
        ],
      });
      console.log("  Verified!");
    } catch (err) {
      if (err.message.includes("Already Verified")) {
        console.log("  Already verified.");
      } else {
        console.log("  Verification failed:", err.message);
        console.log("  Retry manually:");
        console.log(`  npx hardhat verify --network mainnet ${controller.address} ${TOKEN} ${BURN_RESERVE} ${ROUTER} ${LP_RECEIVER} ${deployer.address} ${GOVERNANCE}`);
      }
    }
    console.log("");
  }

  // Save deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const outFile = path.join(deploymentsDir, "mainnet.json");
  let existing = {};
  if (fs.existsSync(outFile)) {
    existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
  }
  existing.BuybackController = {
    address: controller.address,
    deployer: deployer.address,
    tx: controller.deployTransaction.hash,
    timestamp: new Date().toISOString(),
    network: isMainnet ? "mainnet" : `chain-${network.chainId}`,
  };
  fs.writeFileSync(outFile, JSON.stringify(existing, null, 2));
  console.log("Saved to:", outFile);
  console.log("");

  // Next steps
  console.log("═══════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════");
  console.log("  BuybackController:", controller.address);
  if (isMainnet) {
    console.log("  Etherscan: https://etherscan.io/address/" + controller.address + "#code");
  }
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  NEXT STEPS (REIHENFOLGE: FeeExempt ZUERST!)");
  console.log("═══════════════════════════════════════════════");
  console.log("");
  console.log("  1. Governance Proposal — setFeeExempt(BuybackController, true)");
  console.log("     Target: InfernoToken", TOKEN);
  console.log("     → Verhindert 2.5% Fee auf LP-Adds");
  console.log("     → 48h Timelock, dann Execute via TreasurySafe 3-of-5");
  console.log("");
  console.log("  2. Governance Proposal — setFeeCollector(BuybackController)");
  console.log("     Target: FeeRouterV1 0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a");
  console.log("     → Leitet Protocol-Fees an BuybackController");
  console.log("     → 48h Timelock, dann Execute via TreasurySafe 3-of-5");
  console.log("");
  console.log("  Script: node scripts/propose-buyback-wiring.js");
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
