const { ethers } = require("hardhat");

const DECIMALS = 9;
const fmt = (v) => ethers.utils.formatUnits(v, DECIMALS);

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await deployer.getBalance();
  console.log("ETH Balance:", ethers.utils.formatEther(balance));

  // --- Config ---
  const GOVERNANCE = "0x6050b22E4EAF3f414d1155fBaF30B868E0107017";
  const FEE_COLLECTOR = deployer.address; // temporary — change to multisig on mainnet
  const VOUCHER_SIGNER = process.env.VOUCHER_SIGNER_ADDRESS || deployer.address;

  console.log("\n--- Deploy FeeRouterV1 ---");
  console.log("Governance:", GOVERNANCE);
  console.log("Fee Collector:", FEE_COLLECTOR);
  console.log("Voucher Signer:", VOUCHER_SIGNER);

  const FeeRouter = await ethers.getContractFactory("FeeRouterV1");
  const router = await FeeRouter.deploy(GOVERNANCE, FEE_COLLECTOR, VOUCHER_SIGNER);
  await router.deployed();
  console.log("\nFeeRouterV1 deployed:", router.address);

  // --- Verify state ---
  console.log("\n--- Verification ---");
  console.log("governance:", await router.governance());
  console.log("feeCollector:", await router.feeCollector());
  console.log("voucherSigner:", await router.voucherSigner());
  console.log("protocolFeeBps:", (await router.protocolFeeBps()).toString());
  console.log("FEE_CAP_BPS:", (await router.FEE_CAP_BPS()).toString());
  console.log("paused:", await router.paused());

  console.log("\n✅ FeeRouterV1 deployed and verified!");
  console.log("\nNext steps:");
  console.log("1. Verify on Etherscan:");
  console.log(`   npx hardhat verify --network sepolia ${router.address} "${GOVERNANCE}" "${FEE_COLLECTOR}" "${VOUCHER_SIGNER}"`);
  console.log("2. Whitelist adapters via Governance proposal");
  console.log("3. Update FEE_ROUTER_ADDRESS in apps/points-backend/.env");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
