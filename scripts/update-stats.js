const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ADDRESSES = {
  token:    "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  lock:     "0x0Cab0A9440643128540222acC6eF5028736675d3",
  vault:    "0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39",
  feerouter:"0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4",
  vesting:  "0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B",
  reserve:  "0xF7E90D0d17f8232365186AA085D26eaEfAf011aF",
  lp:       "0x2252e8bBDE0E50CD372748aC233A99C08627d9c7",
  dead:     "0x000000000000000000000000000000000000dEaD",
};

const fmt = (n, d=9) => parseFloat(ethers.utils.formatUnits(n, d)).toLocaleString("de-DE");
const fmtRaw = (n, d=9) => parseFloat(ethers.utils.formatUnits(n, d)).toFixed(0);

async function fetchStats() {
  const token = await ethers.getContractAt("InfernoToken", ADDRESSES.token);
  const vault = await ethers.getContractAt([
    "function rewardBps() view returns (uint256)",
    "function totalRewarded() view returns (uint256)",
    "function annualEmissionCap() view returns (uint256)"
  ], ADDRESSES.vault);
  const router = await ethers.getContractAt([
    "function protocolFeeBps() view returns (uint256)",
    "function paused() view returns (bool)"
  ], ADDRESSES.feerouter);

  const supply      = await token.totalSupply();
  const initial     = ethers.utils.parseUnits("1000000000", 9);
  const burned      = initial.sub(supply);
  const lpBal       = await token.balanceOf(ADDRESSES.lp);
  const vaultBal    = await token.balanceOf(ADDRESSES.vault);
  const reserveBal  = await token.balanceOf(ADDRESSES.reserve);
  const vestingBal  = await token.balanceOf(ADDRESSES.vesting);
  const rewardBps   = await vault.rewardBps();
  const totalRew    = await vault.totalRewarded();
  const annualCap   = await vault.annualEmissionCap();
  const feeBps      = await router.protocolFeeBps();
  const paused      = await router.paused();

  return {
    timestamp: new Date().toISOString(),
    network: "sepolia",
    token: {
      supply: fmtRaw(supply),
      supplyFormatted: fmt(supply),
      burned: fmtRaw(burned),
      burnedFormatted: fmt(burned),
      burnedPct: (burned.mul(10000).div(initial).toNumber()/100).toFixed(2),
    },
    distribution: {
      lp: fmtRaw(lpBal),
      vault: fmtRaw(vaultBal),
      reserve: fmtRaw(reserveBal),
      vesting: fmtRaw(vestingBal),
    },
    partnerVault: {
      rewardBps: rewardBps.toNumber(),
      totalRewarded: fmtRaw(totalRew),
      annualCap: fmtRaw(annualCap),
    },
    feeRouter: {
      protocolFeeBps: feeBps.toNumber(),
      paused: paused,
    },
  };
}

function updateFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  for (const [pattern, replacement] of replacements) {
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log(`✅ Updated: ${filePath}`);
  } else {
    console.log(`⏭  No change: ${filePath}`);
  }
}

async function main() {
  console.log("Fetching on-chain stats...");
  const stats = await fetchStats();
  console.log("Stats:", JSON.stringify(stats, null, 2));

  // Save stats to JSON
  const statsPath = path.join(__dirname, "../docs/stats.json");
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  console.log(`✅ Saved: docs/stats.json`);

  // Update TRANSPARENCY.md
  updateFile("docs/TRANSPARENCY.md", [
    [/Total Supply \| [\d,.]+ IFR/, `Total Supply | ${stats.token.supplyFormatted} IFR`],
    [/Verbrannt.*\| [\d,.]+ IFR \([\d.]+%\)/, `Verbrannt (Deflation) | ${stats.token.burnedFormatted} IFR (${stats.token.burnedPct}%)`],
    [/PartnerVault \| [\d,.]+ IFR/, `PartnerVault | ${parseFloat(stats.distribution.vault).toLocaleString("de-DE")} IFR`],
  ]);

  // Update STATUS-REPORT.md
  updateFile("STATUS-REPORT.md", [
    [/Supply: [\d,.]+ IFR/, `Supply: ${stats.token.supplyFormatted} IFR`],
    [/Burned: [\d,.]+ IFR/, `Burned: ${stats.token.burnedFormatted} IFR`],
  ]);

  // Update docs/index.html Transparency Cards
  updateFile("docs/index.html", [
    [/>[\d,.]+M\+ IFR<\/div>\s*<div[^>]*>Bereits verbrannt/,
     `>${(parseInt(stats.token.burned)/1e6).toFixed(1)}M+ IFR</div>\n          <div style="color:var(--text-muted);font-size:13px;margin-top:4px;">Bereits verbrannt`],
  ]);

  console.log("\n=== UPDATE COMPLETE ===");
  console.log(`Timestamp: ${stats.timestamp}`);
  console.log(`Supply: ${stats.token.supplyFormatted} IFR`);
  console.log(`Burned: ${stats.token.burnedFormatted} IFR (${stats.token.burnedPct}%)`);
}

main().catch(console.error);
