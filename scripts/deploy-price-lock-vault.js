/**
 * Deploy PriceLockVault (Lane 2). Price locks start DISABLED; Governance activates them only when the
 * on-chain readiness scope holds. See docs/PRICE_LOCK_VAULT_SPEC.md.
 * Owner = Governance (Timelock)
 * Constructor: (ifrToken, weth, factory, governance, twapWindow, minWethReserve, minActivationPrice)
 * The pair is never configured directly: the vault reads factory.getPair(IFR, WETH) and checks both tokens.
 *
 * Usage:
 *   Sepolia:  WETH=<canonical WETH> FACTORY=<Uniswap V2 factory> npx hardhat run scripts/deploy-price-lock-vault.js --network sepolia
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

  // Mainnet identities are pinned and cannot be overridden: canonical WETH9, Uniswap V2 factory, IFR, Governance.
  const MAINNET = {
    IFR_TOKEN: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
    GOVERNANCE: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    FACTORY: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    EXPECTED_PAIR: "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0",
  };
  if (network === "mainnet") {
    for (const key of ["IFR_TOKEN", "GOVERNANCE", "WETH", "FACTORY", "PAIR"]) {
      if (process.env[key]) throw new Error(`Refusing Mainnet: ${key} override is not allowed`);
    }
  }
  const pick = (key) => (network === "mainnet" ? MAINNET[key] : process.env[key]);
  const IFR_TOKEN = pick("IFR_TOKEN") || MAINNET.IFR_TOKEN;
  const GOVERNANCE = pick("GOVERNANCE") || MAINNET.GOVERNANCE;
  const WETH = pick("WETH");
  const FACTORY = pick("FACTORY");
  if (!WETH || !FACTORY) throw new Error("WETH and FACTORY (canonical for this network) are required");
  const TWAP_WINDOW = Number(process.env.TWAP_WINDOW || 7 * 86400);
  const MIN_WETH_RESERVE = hre.ethers.parseEther(process.env.MIN_WETH_RESERVE_ETH || "50");
  const MIN_ACTIVATION_PRICE = BigInt(process.env.MIN_ACTIVATION_PRICE_WEI || "0");

  console.log("Network:", network, "| Deployer:", deployer.address);
  const factory = new hre.ethers.Contract(FACTORY, ["function getPair(address,address) view returns (address)"], deployer);
  const PAIR = await factory.getPair(IFR_TOKEN, WETH);
  if (PAIR === hre.ethers.ZeroAddress) throw new Error("Factory has no IFR/WETH pair");
  if (network === "mainnet" && PAIR.toLowerCase() !== MAINNET.EXPECTED_PAIR.toLowerCase()) {
    throw new Error(`Refusing Mainnet: factory pair ${PAIR} is not the expected ${MAINNET.EXPECTED_PAIR}`);
  }
  console.log("IFR:", IFR_TOKEN, "| WETH:", WETH, "| Factory:", FACTORY, "| Pair (from factory):", PAIR, "| Governance (owner):", GOVERNANCE);
  console.log("TWAP window:", TWAP_WINDOW, "s | minWethReserve:", MIN_WETH_RESERVE.toString(), "| minActivationPrice:", MIN_ACTIVATION_PRICE.toString());

  const args = [IFR_TOKEN, WETH, FACTORY, GOVERNANCE, TWAP_WINDOW, MIN_WETH_RESERVE, MIN_ACTIVATION_PRICE];
  const Vault = await hre.ethers.getContractFactory("PriceLockVault");
  const vault = await Vault.deploy(...args);
  await vault.waitForDeployment();
  if ((await vault.pair()).toLowerCase() !== PAIR.toLowerCase()) throw new Error("Deployed vault reports a different pair");
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
