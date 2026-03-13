/**
 * Deploy BuilderRegistry
 * Owner = Governance (Timelock)
 *
 * Usage:
 *   Sepolia:  npx hardhat run scripts/deploy-builder-registry.js --network sepolia
 *   Mainnet:  npx hardhat run scripts/deploy-builder-registry.js --network mainnet
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Governance (Timelock) address — from existing deployments
  const GOVERNANCE_ADDR = process.env.GOVERNANCE_ADDRESS ||
    "0xc43d48E7FDA576C5022d0670B652A622E8caD041"; // Mainnet Governance

  console.log("Governance (owner):", GOVERNANCE_ADDR);

  const BuilderRegistry = await hre.ethers.getContractFactory("BuilderRegistry");
  const registry = await BuilderRegistry.deploy(GOVERNANCE_ADDR);
  await registry.deployed();

  const addr = registry.address;
  console.log("BuilderRegistry deployed:", addr);
  console.log("Network:", hre.network.name);

  // Etherscan verification
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("Waiting 5 blocks for Etherscan...");
    await new Promise(r => setTimeout(r, 30000));
    await hre.run("verify:verify", {
      address: addr,
      constructorArguments: [GOVERNANCE_ADDR],
    });
    console.log("Verified on Etherscan ✅");
  }

  return addr;
}

main().catch(err => { console.error(err); process.exit(1); });
