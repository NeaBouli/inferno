/**
 * Deploy PriceLockVault (Lane 2). Price locks start DISABLED; Governance activates them only when the
 * on-chain readiness scope holds. See docs/PRICE_LOCK_VAULT_SPEC.md.
 * Owner = Governance (Timelock)
 * Constructor: (ifrToken, pair, governance, twapWindow, minWethReserve, minActivationPrice)
 *
 * Usage:
 *   Sepolia:  PAIR=<IFR/WETH pair> npx hardhat run scripts/deploy-price-lock-vault.js --network sepolia
 *   Mainnet:  refused unless ALLOW_MAINNET_PRICE_LOCK_DEPLOY=yes (only after the independent review)
 */
const { connectHardhat } = require("./lib/hardhat-runtime");

(async () => {
const hre = await connectHardhat();

async function main() {
  const network = hre.network.name;
  if (network === "mainnet" && process.env.ALLOW_MAINNET_PRICE_LOCK_DEPLOY !== "yes") {
    throw new Error("Refusing Mainnet: PriceLockVault needs an independent review first (set ALLOW_MAINNET_PRICE_LOCK_DEPLOY=yes only after it).");
  }
  const [deployer] = await hre.ethers.getSigners();

  const IFR_TOKEN = process.env.IFR_TOKEN || "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
  const GOVERNANCE = process.env.GOVERNANCE || "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
  const PAIR = process.env.PAIR || (network === "mainnet" ? "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0" : "");
  if (!PAIR) throw new Error("PAIR (IFR/WETH Uniswap V2 pair) is required on this network");
  const TWAP_WINDOW = Number(process.env.TWAP_WINDOW || 7 * 86400);
  const MIN_WETH_RESERVE = hre.ethers.parseEther(process.env.MIN_WETH_RESERVE_ETH || "50");
  const MIN_ACTIVATION_PRICE = BigInt(process.env.MIN_ACTIVATION_PRICE_WEI || "0");

  console.log("Network:", network, "| Deployer:", deployer.address);
  console.log("IFR:", IFR_TOKEN, "| Pair:", PAIR, "| Governance (owner):", GOVERNANCE);
  console.log("TWAP window:", TWAP_WINDOW, "s | minWethReserve:", MIN_WETH_RESERVE.toString(), "| minActivationPrice:", MIN_ACTIVATION_PRICE.toString());

  const args = [IFR_TOKEN, PAIR, GOVERNANCE, TWAP_WINDOW, MIN_WETH_RESERVE, MIN_ACTIVATION_PRICE];
  const Vault = await hre.ethers.getContractFactory("PriceLockVault");
  const vault = await Vault.deploy(...args);
  await vault.waitForDeployment();
  console.log("PriceLockVault deployed:", vault.target, "(price locks disabled)");
  console.log("");
  console.log("NEXT STEPS:");
  console.log("1. Governance proposal: InfernoToken.setFeeExempt(", vault.target, ", true)");
  console.log("2. Keepers call poke() at least every twapWindow/16; the website shows readiness()");
  console.log("3. When readiness().ready is true: Governance proposal activate() (reverts on-chain if the scope is not met)");
  return { address: vault.target, args };
}

main().catch(err => { console.error(err); process.exit(1); });

})().catch((error) => {
  console.error(error);
  process.exit(1);
});
