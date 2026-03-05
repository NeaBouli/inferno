const { ethers } = require("ethers");
require("dotenv").config();

const DEPLOYER = "0x6b36687b0cd4386fb14cf565B67D7862110Fed67";
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const DECIMALS = 9;

async function main() {
  const rpcUrl = process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  const token = new ethers.Contract(IFR_TOKEN, erc20Abi, provider);

  const [ethBal, ifrBal, totalSupply, decimals] = await Promise.all([
    provider.getBalance(DEPLOYER),
    token.balanceOf(DEPLOYER),
    token.totalSupply(),
    token.decimals(),
  ]);

  console.log("=".repeat(50));
  console.log("  INFERNO — Deployer Balances");
  console.log("=".repeat(50));
  console.log(`  Deployer:      ${DEPLOYER}`);
  console.log(`  ETH Balance:   ${ethers.utils.formatEther(ethBal)} ETH`);
  console.log(`  IFR Balance:   ${ethers.utils.formatUnits(ifrBal, decimals)} IFR`);
  console.log(`  IFR Decimals:  ${decimals}`);
  console.log(`  Total Supply:  ${ethers.utils.formatUnits(totalSupply, decimals)} IFR`);
  console.log("=".repeat(50));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
