const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, `(chainId: ${network.chainId})`);
  console.log("Address:", deployer.address);
  console.log("Balance:", ethers.utils.formatEther(balance), "ETH");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
