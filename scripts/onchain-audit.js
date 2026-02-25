const { ethers } = require("hardhat");

const ADDRESSES = {
  token:    "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  lock:     "0x0Cab0A9440643128540222acC6eF5028736675d3",
  vesting:  "0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B",
  reserve:  "0xF7E90D0d17f8232365186AA085D26eaEfAf011aF",
  buyback:  "0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C",
  burn:     "0x6D4582FCac792FD3880e252fC0a585A0c1823e80",
  gov:      "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
  vault:    "0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39",
  feerouter:"0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4",
  lp:       "0x2252e8bBDE0E50CD372748aC233A99C08627d9c7",
};

async function main() {
  const fmt = (n) => ethers.utils.formatUnits(n, 9);
  const token = await ethers.getContractAt("InfernoToken", ADDRESSES.token);

  console.log("\n========== IFR ON-CHAIN AUDIT (Sepolia) ==========\n");

  // CHECK 1: Ownership aller Contracts
  console.log("=== CHECK 1: Ownership ===");
  for (const [name, addr] of Object.entries(ADDRESSES)) {
    try {
      const c = await ethers.getContractAt(
        ["function owner() view returns (address)"], addr
      );
      const owner = await c.owner();
      console.log(`${name}: owner = ${owner}`);
    } catch {
      console.log(`${name}: kein owner() (nicht Ownable oder LP)`);
    }
  }

  // CHECK 2: LP Token Ownership
  console.log("\n=== CHECK 2: LP Token Balance ===");
  const lp = await ethers.getContractAt([
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)"
  ], ADDRESSES.lp);
  const lpTotal = await lp.totalSupply();
  console.log(`LP Total Supply: ${lpTotal.toString()}`);
  const deployer = (await ethers.getSigners())[0];
  const deployerLP = await lp.balanceOf(deployer.address);
  console.log(`Deployer LP Balance: ${deployerLP.toString()}`);
  const burnLP = await lp.balanceOf("0x000000000000000000000000000000000000dEaD");
  console.log(`Burned LP (dead): ${burnLP.toString()}`);

  // CHECK 3: Vesting Contract
  console.log("\n=== CHECK 3: Vesting Contract ===");
  const vestingBalance = await token.balanceOf(ADDRESSES.vesting);
  console.log(`Vesting IFR Balance: ${fmt(vestingBalance)} IFR`);
  try {
    const vesting = await ethers.getContractAt([
      "function beneficiary() view returns (address)",
      "function start() view returns (uint256)",
      "function duration() view returns (uint256)",
      "function cliffDuration() view returns (uint256)",
      "function released() view returns (uint256)",
      "function releasableAmount() view returns (uint256)",
      "function paused() view returns (bool)"
    ], ADDRESSES.vesting);
    const beneficiary = await vesting.beneficiary();
    const start = await vesting.start();
    const duration = await vesting.duration();
    const cliff = await vesting.cliffDuration();
    const released = await vesting.released();
    const releasable = await vesting.releasableAmount();
    const vPaused = await vesting.paused();
    console.log(`Beneficiary: ${beneficiary}`);
    console.log(`Start: ${new Date(start.toNumber()*1000).toISOString()}`);
    console.log(`Cliff: ${cliff.toNumber()/86400} days`);
    console.log(`Duration: ${duration.toNumber()/86400} days`);
    console.log(`Released: ${fmt(released)} IFR`);
    console.log(`Releasable now: ${fmt(releasable)} IFR`);
    console.log(`Paused: ${vPaused}`);
  } catch(e) {
    console.log(`Vesting ABI error: ${e.message}`);
  }

  // CHECK 4: LiquidityReserve
  console.log("\n=== CHECK 4: LiquidityReserve ===");
  const reserveBalance = await token.balanceOf(ADDRESSES.reserve);
  console.log(`Reserve IFR Balance: ${fmt(reserveBalance)} IFR`);

  // CHECK 5: BuybackVault
  console.log("\n=== CHECK 5: BuybackVault ===");
  const buybackBalance = await token.balanceOf(ADDRESSES.buyback);
  console.log(`BuybackVault IFR Balance: ${fmt(buybackBalance)} IFR`);
  try {
    const buyback = await ethers.getContractAt([
      "function router() view returns (address)",
      "function slippageBps() view returns (uint256)",
      "function cooldown() view returns (uint256)",
      "function burnShareBps() view returns (uint256)",
      "function activationTime() view returns (uint256)",
      "function paused() view returns (bool)"
    ], ADDRESSES.buyback);
    const router = await buyback.router();
    const slippage = await buyback.slippageBps();
    const cool = await buyback.cooldown();
    const burnShare = await buyback.burnShareBps();
    const activation = await buyback.activationTime();
    const bPaused = await buyback.paused();
    console.log(`Router: ${router}`);
    console.log(`SlippageBps: ${slippage} (${slippage/100}%)`);
    console.log(`Cooldown: ${cool}s`);
    console.log(`BurnShare: ${burnShare/100}%`);
    console.log(`ActivationTime: ${new Date(activation.toNumber()*1000).toISOString()}`);
    console.log(`Paused: ${bPaused}`);
  } catch(e) {
    console.log(`BuybackVault detail error: ${e.message}`);
  }

  // CHECK 6: FeeExempt Liste
  console.log("\n=== CHECK 6: FeeExempt Status ===");
  const exemptCheck = [
    ["token", ADDRESSES.token],
    ["lock", ADDRESSES.lock],
    ["reserve", ADDRESSES.reserve],
    ["buyback", ADDRESSES.buyback],
    ["burn", ADDRESSES.burn],
    ["gov", ADDRESSES.gov],
    ["vault", ADDRESSES.vault],
    ["feerouter", ADDRESSES.feerouter],
    ["lp", ADDRESSES.lp],
  ];
  for (const [name, addr] of exemptCheck) {
    try {
      const exempt = await token.feeExempt(addr);
      console.log(`${name}: feeExempt = ${exempt}`);
    } catch {
      console.log(`${name}: feeExempt() nicht verfügbar`);
    }
  }

  // CHECK 7: PartnerVault Status
  console.log("\n=== CHECK 7: PartnerVault ===");
  const vaultBalance = await token.balanceOf(ADDRESSES.vault);
  console.log(`PartnerVault IFR Balance: ${fmt(vaultBalance)} IFR`);
  try {
    const vault = await ethers.getContractAt([
      "function rewardBps() view returns (uint256)",
      "function annualEmissionCap() view returns (uint256)",
      "function totalRewarded() view returns (uint256)",
      "function ifrLock() view returns (address)",
      "function admin() view returns (address)"
    ], ADDRESSES.vault);
    const bps = await vault.rewardBps();
    const cap = await vault.annualEmissionCap();
    const total = await vault.totalRewarded();
    const lockAddr = await vault.ifrLock();
    const admin = await vault.admin();
    console.log(`Admin: ${admin}`);
    console.log(`rewardBps: ${bps} (${bps/100}%)`);
    console.log(`annualCap: ${fmt(cap)} IFR`);
    console.log(`totalRewarded: ${fmt(total)} IFR`);
    console.log(`ifrLock: ${lockAddr} (algo throttle ${lockAddr !== ethers.constants.AddressZero ? 'ACTIVE' : 'OFF'})`);
  } catch(e) {
    console.log(`PartnerVault detail error: ${e.message}`);
  }

  // CHECK 8: Token Supply Verteilung
  console.log("\n=== CHECK 8: Token Supply Verteilung ===");
  const totalSupply = await token.totalSupply();
  console.log(`Total Supply: ${fmt(totalSupply)} IFR`);
  const balances = [
    ["Deployer", deployer.address],
    ["LiquidityReserve", ADDRESSES.reserve],
    ["Vesting", ADDRESSES.vesting],
    ["BuybackVault", ADDRESSES.buyback],
    ["BurnReserve", ADDRESSES.burn],
    ["Governance", ADDRESSES.gov],
    ["PartnerVault", ADDRESSES.vault],
    ["LP Pair", ADDRESSES.lp],
  ];
  for (const [name, addr] of balances) {
    const bal = await token.balanceOf(addr);
    const pct = bal.mul(10000).div(totalSupply);
    console.log(`${name}: ${fmt(bal)} IFR (${pct/100}%)`);
  }

  console.log("\n========== AUDIT COMPLETE ==========\n");
}

main().catch(console.error);
