/**
 * Deploy CommitmentVault
 * Owner = Governance (Timelock)
 * Constructor: (ifrToken, governance)
 *
 * Usage:
 *   Sepolia:  npx hardhat run scripts/deploy-commitment-vault.js --network sepolia
 *   Mainnet:  npx hardhat run scripts/deploy-commitment-vault.js --network mainnet
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const network = hre.network.name;
  console.log("Network:", network);

  // Addresses — same on Sepolia and Mainnet
  const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
  const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";

  console.log("IFR Token:", IFR_TOKEN);
  console.log("Governance (owner):", GOVERNANCE);

  const CommitmentVault = await hre.ethers.getContractFactory("CommitmentVault");
  const cv = await CommitmentVault.deploy(IFR_TOKEN, GOVERNANCE);
  await cv.deployed();

  console.log("CommitmentVault deployed:", cv.address);
  console.log("");
  console.log("NEXT STEPS:");
  console.log("1. Governance Proposal: setFeeExempt(", cv.address, ", true) — BEFORE users lock!");
  console.log("2. Governance Proposal: setP0(value) — AFTER Bootstrap finalise()");
  console.log("");

  // Etherscan verification
  if (network !== "hardhat" && network !== "localhost") {
    console.log("Waiting 30s for Etherscan indexing...");
    await new Promise(r => setTimeout(r, 30000));
    try {
      await hre.run("verify:verify", {
        address: cv.address,
        constructorArguments: [IFR_TOKEN, GOVERNANCE],
      });
      console.log("Verified on Etherscan ✅");
    } catch (e) {
      console.error("Verification failed (can retry manually):", e.message);
    }
  }

  return cv.address;
}

main().catch(err => { console.error(err); process.exit(1); });
