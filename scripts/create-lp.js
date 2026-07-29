const { ethers } = require("hardhat");

// ── Deployed contract addresses (Sepolia) ──────────────────
const INFERNO_TOKEN = "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4";
const BUYBACK_VAULT = "0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C";

// ── Defaults (override via .env) ───────────────────────────
const DEFAULT_ROUTER = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const DEFAULT_IFR_AMOUNT = "400000000"; // 400M IFR
const DEFAULT_ETH_AMOUNT = "0.01";      // ETH for pairing

// ── Minimal ABIs ───────────────────────────────────────────
const ROUTER_ABI = [
  "function WETH() external view returns (address)",
  "function factory() external view returns (address)",
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const ERC20_ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const ethBalance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  // ── Config ─────────────────────────────────────────────────
  const ROUTER_ADDR = process.env.UNISWAP_V2_ROUTER || DEFAULT_ROUTER;
  const IFR_AMOUNT = ethers.parseUnits(
    process.env.LP_IFR_AMOUNT || DEFAULT_IFR_AMOUNT, 9
  );
  const ETH_AMOUNT = ethers.parseEther(
    process.env.LP_ETH_AMOUNT || DEFAULT_ETH_AMOUNT
  );

  console.log("=".repeat(60));
  console.log("INFERNO — Uniswap V2 LP Pairing");
  console.log("=".repeat(60));
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`Network:   ${network.name} (${network.chainId})`);
  console.log(`Router:    ${ROUTER_ADDR}`);
  console.log(`IFR:       ${ethers.formatUnits(IFR_AMOUNT, 9)} IFR`);
  console.log(`ETH:       ${ethers.formatEther(ETH_AMOUNT)} ETH`);
  console.log("-".repeat(60));

  // ══════════════════════════════════════════════════════════
  // Step 1/4 — Pre-flight checks
  // ══════════════════════════════════════════════════════════
  console.log("\n[1/4] Pre-flight checks...");

  // ETH balance (need LP amount + gas buffer)
  const MIN_ETH = BigInt(ETH_AMOUNT)+BigInt(ethers.parseEther('0.005'));
  if (BigInt(ethBalance)<BigInt(MIN_ETH)) {
    console.error(`  ERROR: Need at least ${ethers.formatEther(MIN_ETH)} ETH`);
    console.error(`  Current balance: ${ethers.formatEther(ethBalance)} ETH`);
    console.error(`  Get Sepolia ETH from a faucet and try again.`);
    process.exit(1);
  }
  console.log(`  ETH balance OK (${ethers.formatEther(ethBalance)} >= ${ethers.formatEther(MIN_ETH)})`);

  // IFR balance
  const ifrToken = new ethers.Contract(INFERNO_TOKEN, ERC20_ABI, deployer);
  const ifrBalance = await ifrToken.balanceOf(deployer.address);
  if (BigInt(ifrBalance)<BigInt(IFR_AMOUNT)) {
    console.error(`  ERROR: Need ${ethers.formatUnits(IFR_AMOUNT, 9)} IFR`);
    console.error(`  Current balance: ${ethers.formatUnits(ifrBalance, 9)} IFR`);
    process.exit(1);
  }
  console.log(`  IFR balance OK (${ethers.formatUnits(ifrBalance, 9)} IFR)`);

  // Router reachable
  const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, deployer);
  let wethAddr;
  try {
    wethAddr = await router.WETH();
    console.log(`  Router OK — WETH: ${wethAddr}`);
  } catch (err) {
    console.error(`  ERROR: Router not reachable at ${ROUTER_ADDR}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  const factoryAddr = await router.factory();
  console.log(`  Factory: ${factoryAddr}`);

  // ══════════════════════════════════════════════════════════
  // Step 2/4 — Set feeExempt + Approve router
  // ══════════════════════════════════════════════════════════
  console.log("\n[2/4] Setting feeExempt + approving router...");

  // Temporarily make deployer feeExempt so LP creation doesn't lose tokens to fees
  const InfernoToken = await ethers.getContractFactory("InfernoToken");
  const tokenContract = InfernoToken.attach(INFERNO_TOKEN);

  let tx = await tokenContract.setFeeExempt(deployer.address, true);
  await tx.wait();
  console.log(`  feeExempt[Deployer] = true (temporary)`);

  // Approve router to spend IFR
  tx = await ifrToken.approve(ROUTER_ADDR, IFR_AMOUNT);
  await tx.wait();
  console.log(`  Approved router for ${ethers.formatUnits(IFR_AMOUNT, 9)} IFR`);

  // ══════════════════════════════════════════════════════════
  // Step 3/4 — addLiquidityETH
  // ══════════════════════════════════════════════════════════
  console.log("\n[3/4] Adding liquidity (IFR + ETH)...");

  // 2% slippage tolerance
  const amountTokenMin = BigInt(BigInt(IFR_AMOUNT)*BigInt(98))/BigInt(100);
  const amountETHMin = BigInt(BigInt(ETH_AMOUNT)*BigInt(98))/BigInt(100);
  const block = await ethers.provider.getBlock("latest");
  const deadline = block.timestamp + 300; // 5 minutes

  console.log(`  amountTokenDesired: ${ethers.formatUnits(IFR_AMOUNT, 9)} IFR`);
  console.log(`  amountTokenMin:     ${ethers.formatUnits(amountTokenMin, 9)} IFR (2% slippage)`);
  console.log(`  amountETHMin:       ${ethers.formatEther(amountETHMin)} ETH (2% slippage)`);
  console.log(`  deadline:           ${deadline} (block.timestamp + 300s)`);

  tx = await router.addLiquidityETH(
    INFERNO_TOKEN,
    IFR_AMOUNT,
    amountTokenMin,
    amountETHMin,
    deployer.address,
    deadline,
    { value: ETH_AMOUNT }
  );
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt.hash}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

  // Remove deployer feeExempt
  tx = await tokenContract.setFeeExempt(deployer.address, false);
  await tx.wait();
  console.log(`  feeExempt[Deployer] = false (restored)`);

  // Get pair address
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, deployer);
  const pairAddr = await factory.getPair(INFERNO_TOKEN, wethAddr);
  console.log(`  LP Pair: ${pairAddr}`);

  // LP token balance
  const lpToken = new ethers.Contract(pairAddr, ERC20_ABI, deployer);
  const lpBalance = await lpToken.balanceOf(deployer.address);
  console.log(`  LP Tokens: ${ethers.formatUnits(lpBalance, 18)}`);

  // Remaining balances
  const ifrAfter = await ifrToken.balanceOf(deployer.address);
  const ethAfter = await ethers.provider.getBalance(deployer.address);
  console.log(`  IFR remaining: ${ethers.formatUnits(ifrAfter, 9)}`);
  console.log(`  ETH remaining: ${ethers.formatEther(ethAfter)}`);

  // ══════════════════════════════════════════════════════════
  // Step 4/4 — Update BuybackVault router
  // ══════════════════════════════════════════════════════════
  console.log("\n[4/4] Updating BuybackVault router...");

  const BuybackVault = await ethers.getContractFactory("BuybackVault");
  const vault = BuybackVault.attach(BUYBACK_VAULT);

  // Read current params to preserve them
  const burnShareBps = await vault.burnShareBps();
  const cooldown = await vault.cooldown();
  const slippageBps = await vault.slippageBps();
  const treasury = await vault.treasury();

  console.log(`  Current params: burnShare=${burnShareBps}, cooldown=${cooldown}, slippage=${slippageBps}`);
  console.log(`  Treasury: ${treasury}`);
  console.log(`  Setting router to: ${ROUTER_ADDR}`);

  tx = await vault.setParams(burnShareBps, cooldown, slippageBps, ROUTER_ADDR, treasury);
  await tx.wait();

  // Verify
  const newRouter = await vault.router();
  console.log(`  Router updated: ${newRouter}`);

  // ══════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(60));
  console.log("LP PAIRING COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  LP Pair:           ${pairAddr}
  LP Tokens:         ${ethers.formatUnits(lpBalance, 18)}
  IFR in Pool:       ${ethers.formatUnits(IFR_AMOUNT, 9)} IFR
  ETH in Pool:       ${ethers.formatEther(ETH_AMOUNT)} ETH
  BuybackVault:      Router updated to ${ROUTER_ADDR}

  NEXT STEPS:
    1. Verify LP pair on Etherscan: https://sepolia.etherscan.io/address/${pairAddr}
    2. Transfer InfernoToken ownership to Governance
    3. (Optional) Lock LP tokens
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
