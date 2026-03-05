const { ethers } = require("hardhat");

// ── Monkey-patch ethers v5 Formatter ─────────────────────────
// Alchemy returns to="" for contract creation TXs instead of to=null.
const { Formatter } = require("@ethersproject/providers");
const _origTxResponse = Formatter.prototype.transactionResponse;
Formatter.prototype.transactionResponse = function (tx) {
  if (tx.to === "" || tx.to === "0x") tx.to = null;
  return _origTxResponse.call(this, tx);
};

/**
 * INFERNO — Create Uniswap V2 LP Pair (IFR/ETH) on Mainnet
 *
 * 1. Approve Uniswap Router for 400M IFR
 * 2. addLiquidityETH() with 400M IFR + ETH
 * 3. Verify LP pair creation
 *
 * Usage:
 *   DRY RUN:  MAINNET_RPC_URL=... npx hardhat run scripts/create-lp-mainnet.js
 *   MAINNET:  npx hardhat run scripts/create-lp-mainnet.js --network mainnet
 *
 * Set ETH_AMOUNT env var to override ETH liquidity (default: 0.03 ETH)
 */

const DECIMALS = 9;
const parse = (n) => ethers.utils.parseUnits(String(n), DECIMALS);
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);

// ── Mainnet Addresses ────────────────────────────────────────
const IFR_TOKEN       = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const UNISWAP_ROUTER  = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNISWAP_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6F";

// ── LP Parameters ────────────────────────────────────────────
const IFR_AMOUNT      = parse(400_000_000);                   // 400M IFR
const IFR_MIN         = parse(398_000_000);                   // 99.5% slippage protection
const ETH_AMOUNT      = ethers.utils.parseEther(process.env.ETH_AMOUNT || "0.03");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const ethBalance = await ethers.provider.getBalance(deployer.address);

  const ethMin = ETH_AMOUNT.mul(95).div(100); // 95% slippage protection

  console.log("=".repeat(60));
  console.log("  INFERNO — Create Uniswap V2 LP (IFR/ETH)");
  console.log("=".repeat(60));
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  ETH Balance: ${ethers.utils.formatEther(ethBalance)} ETH`);
  console.log(`  Network:    ${network.name} (chainId: ${network.chainId})`);
  console.log("-".repeat(60));
  console.log(`  IFR Amount:  ${fmt(IFR_AMOUNT)} IFR`);
  console.log(`  IFR Min:     ${fmt(IFR_MIN)} IFR (99.5%)`);
  console.log(`  ETH Amount:  ${ethers.utils.formatEther(ETH_AMOUNT)} ETH`);
  console.log(`  ETH Min:     ${ethers.utils.formatEther(ethMin)} ETH (95%)`);
  console.log("-".repeat(60));

  // Sanity checks
  const token = await ethers.getContractAt("InfernoToken", IFR_TOKEN);
  const ifrBalance = await token.balanceOf(deployer.address);
  console.log(`\n  Deployer IFR: ${fmt(ifrBalance)} IFR`);

  if (ifrBalance.lt(IFR_AMOUNT)) {
    console.error(`  ERROR: Insufficient IFR. Need ${fmt(IFR_AMOUNT)}, have ${fmt(ifrBalance)}`);
    process.exit(1);
  }

  if (ethBalance.lt(ETH_AMOUNT)) {
    console.error(`  ERROR: Insufficient ETH. Need ${ethers.utils.formatEther(ETH_AMOUNT)}, have ${ethers.utils.formatEther(ethBalance)}`);
    process.exit(1);
  }

  // Check if LP pair already exists
  const factoryAbi = ["function getPair(address, address) view returns (address)"];
  const factory = new ethers.Contract(UNISWAP_FACTORY, factoryAbi, deployer);
  const routerAbi = ["function WETH() view returns (address)"];
  const router = new ethers.Contract(UNISWAP_ROUTER, routerAbi, deployer);
  const weth = await router.WETH();
  const existingPair = await factory.getPair(IFR_TOKEN, weth);

  if (existingPair !== ethers.constants.AddressZero) {
    console.log(`\n  WARNING: LP Pair already exists at ${existingPair}`);
    console.log(`  addLiquidityETH will add to existing pair.`);
  }

  // ── Step 1: Approve Router ─────────────────────────────────
  console.log("\n[1/3] Approving Uniswap Router for IFR...");
  const approveTx = await token.approve(UNISWAP_ROUTER, IFR_AMOUNT);
  const approveReceipt = await approveTx.wait();
  console.log(`  TX:   ${approveTx.hash}`);
  console.log(`  Gas:  ${approveReceipt.gasUsed.toString()}`);

  // Verify allowance
  const allowance = await token.allowance(deployer.address, UNISWAP_ROUTER);
  console.log(`  Allowance: ${fmt(allowance)} IFR`);

  // ── Step 2: addLiquidityETH ────────────────────────────────
  console.log("\n[2/3] Adding liquidity (IFR + ETH)...");

  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
  const routerFull = await ethers.getContractAt(
    [
      "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
      "function factory() view returns (address)",
      "function WETH() view returns (address)",
    ],
    UNISWAP_ROUTER
  );

  const lpTx = await routerFull.addLiquidityETH(
    IFR_TOKEN,
    IFR_AMOUNT,
    IFR_MIN,
    ethMin,
    deployer.address,
    deadline,
    { value: ETH_AMOUNT }
  );
  const lpReceipt = await lpTx.wait();
  console.log(`  TX:    ${lpTx.hash}`);
  console.log(`  Block: ${lpReceipt.blockNumber}`);
  console.log(`  Gas:   ${lpReceipt.gasUsed.toString()}`);

  // ── Step 3: Verify LP Pair ─────────────────────────────────
  console.log("\n[3/3] Verifying LP pair...");

  const lpPair = await factory.getPair(IFR_TOKEN, weth);
  console.log(`  LP Pair:  ${lpPair}`);

  const pairAbi = [
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function getReserves() view returns (uint112, uint112, uint32)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
  ];
  const pair = new ethers.Contract(lpPair, pairAbi, deployer);

  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const lpTotal = await pair.totalSupply();
  const lpBalance = await pair.balanceOf(deployer.address);

  const ifrIsToken0 = token0.toLowerCase() === IFR_TOKEN.toLowerCase();
  const ifrReserve = ifrIsToken0 ? reserve0 : reserve1;
  const ethReserve = ifrIsToken0 ? reserve1 : reserve0;

  console.log(`  Token0:      ${token0} (${ifrIsToken0 ? "IFR" : "WETH"})`);
  console.log(`  IFR Reserve: ${fmt(ifrReserve)} IFR`);
  console.log(`  ETH Reserve: ${ethers.utils.formatEther(ethReserve)} ETH`);
  console.log(`  LP Total:    ${lpTotal.toString()}`);
  console.log(`  LP (Deployer): ${lpBalance.toString()}`);

  // Price calculation
  const priceIFRperETH = ifrReserve.mul(ethers.utils.parseEther("1")).div(ethReserve);
  console.log(`  Price:       1 ETH = ${fmt(priceIFRperETH)} IFR`);

  // Remaining balances
  const ethAfter = await ethers.provider.getBalance(deployer.address);
  const ifrAfter = await token.balanceOf(deployer.address);

  // ── Summary ────────────────────────────────────────────────
  const totalGas = approveReceipt.gasUsed.add(lpReceipt.gasUsed);
  console.log("\n" + "=".repeat(60));
  console.log("  LP CREATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`  LP Pair:       ${lpPair}`);
  console.log(`  IFR in Pool:   ${fmt(ifrReserve)} IFR`);
  console.log(`  ETH in Pool:   ${ethers.utils.formatEther(ethReserve)} ETH`);
  console.log(`  Price:         1 ETH = ${fmt(priceIFRperETH)} IFR`);
  console.log(`  LP Tokens:     ${lpBalance.toString()}`);
  console.log(`  Total Gas:     ${totalGas.toString()}`);
  console.log(`  ETH remaining: ${ethers.utils.formatEther(ethAfter)} ETH`);
  console.log(`  IFR remaining: ${fmt(ifrAfter)} IFR`);
  console.log("=".repeat(60));
  console.log(`
  Next steps:
  1. Lock LP tokens (min 12 months via Unicrypt or burn to 0xdead)
  2. Update DEPLOYMENTS.md with LP Pair address
  3. Verify LP on Etherscan: https://etherscan.io/address/${lpPair}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
