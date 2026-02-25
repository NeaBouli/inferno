const { ethers } = require("hardhat");

const ADDRESSES = {
  lp:   "0x2252e8bBDE0E50CD372748aC233A99C08627d9c7",
  dead: "0x000000000000000000000000000000000000dEaD",
};

const LP_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function totalSupply() view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const lp = await ethers.getContractAt(LP_ABI, ADDRESSES.lp);

  const balance = await lp.balanceOf(deployer.address);
  const total   = await lp.totalSupply();

  console.log(`LP Balance (Deployer): ${balance.toString()}`);
  console.log(`LP Total Supply:       ${total.toString()}`);
  console.log(`Percentage:            ${balance.mul(10000).div(total).toNumber()/100}%`);

  if (balance.isZero()) {
    console.log("Kein LP Balance — nichts zu burnen.");
    return;
  }

  if (process.env.EXECUTE !== "true") {
    console.log("\n[DRY RUN] Würde transferieren:");
    console.log(`  ${balance.toString()} LP Tokens → 0xdead`);
    console.log("\nUm wirklich zu burnen:");
    console.log("EXECUTE=true npx hardhat run scripts/burn-lp-tokens.js --network sepolia");
    return;
  }

  console.log("\n⚠️  BURNING LP TOKENS — IRREVERSIBEL!");
  console.log("3 Sekunden bis Ausführung...");
  await new Promise(r => setTimeout(r, 3000));

  const tx = await lp.transfer(ADDRESSES.dead, balance);
  await tx.wait();
  console.log(`✅ LP Tokens geburnt. TX: ${tx.hash}`);
  console.log(`   ${balance.toString()} LP → 0xdead`);
  console.log("   Liquidity ist jetzt permanent gesperrt.");
}

main().catch(console.error);
