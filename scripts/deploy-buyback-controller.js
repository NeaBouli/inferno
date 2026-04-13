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

// ── Network Addresses (from DEPLOYMENTS.md — immutable) ─────
const ADDRESSES = {
  // Ethereum Mainnet (Chain ID: 1)
  1: {
    TOKEN:        "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
    BURN_RESERVE: "0xaA1496133B6c274190A2113410B501C5802b6fCF",
    ROUTER:       "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    LP_RECEIVER:  "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b", // TreasurySafe 3-of-5
    GOVERNANCE:   "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
    FEE_ROUTER:   "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a",
  },
  // Sepolia Testnet (Chain ID: 11155111)
  11155111: {
    TOKEN:        "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
    BURN_RESERVE: "0xB9FbE5dB44EEce77A69C8F09e9E0eE2E4F745D75",
    ROUTER:       "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008", // Sepolia Uniswap V2
    LP_RECEIVER:  null, // set to deployer on testnet
    GOVERNANCE:   "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
    FEE_ROUTER:   "0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4",
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;
  const isMainnet = chainId === 1;
  const isSepolia = chainId === 11155111;
  const networkName = isMainnet ? "Ethereum Mainnet" : isSepolia ? "Sepolia Testnet" : `Chain ${chainId}`;

  // Resolve addresses — fallback to mainnet for local hardhat dry-runs
  const addr = ADDRESSES[chainId] || ADDRESSES[1];
  const TOKEN        = addr.TOKEN;
  const BURN_RESERVE = addr.BURN_RESERVE;
  const ROUTER       = addr.ROUTER;
  const LP_RECEIVER  = addr.LP_RECEIVER || deployer.address;
  const GOVERNANCE   = addr.GOVERNANCE;

  console.log("═══════════════════════════════════════════════");
  console.log("  BuybackController Deployment");
  console.log("═══════════════════════════════════════════════");
  console.log("Network:    ", networkName);
  console.log("Deployer:   ", deployer.address);
  console.log("");
  console.log("Constructor Parameters:");
  console.log("  token:       ", TOKEN);
  console.log("  burnReserve: ", BURN_RESERVE);
  console.log("  router:      ", ROUTER);
  console.log("  lpReceiver:  ", LP_RECEIVER, isMainnet ? "(TreasurySafe)" : "(Deployer — testnet)");
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
  if (isMainnet || isSepolia) {
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

  const fileName = isMainnet ? "mainnet.json" : isSepolia ? "sepolia.json" : "local.json";
  const outFile = path.join(deploymentsDir, fileName);
  let existing = {};
  if (fs.existsSync(outFile)) {
    existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
  }
  existing.BuybackController = {
    address: controller.address,
    deployer: deployer.address,
    tx: controller.deployTransaction.hash,
    timestamp: new Date().toISOString(),
    network: isMainnet ? "mainnet" : isSepolia ? "sepolia" : `chain-${chainId}`,
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
  } else if (isSepolia) {
    console.log("  Etherscan: https://sepolia.etherscan.io/address/" + controller.address + "#code");
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
