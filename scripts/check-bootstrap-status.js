require("dotenv").config({ quiet: true });
const { ethers } = require("ethers");

/**
 * INFERNO — Check BootstrapVaultV3 status
 *
 * Reads all relevant state from the mainnet Bootstrap contract.
 * No transactions, no private key needed — read-only.
 *
 * Usage:
 *   node scripts/check-bootstrap-status.js
 *   npx hardhat run scripts/check-bootstrap-status.js --network mainnet
 */

const BOOTSTRAP_V3 = "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141";
const IFR_TOKEN    = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";

const VAULT_ABI = [
  "function finalised() view returns (bool)",
  "function hasRefundOccurred() view returns (bool)",
  "function endTime() view returns (uint256)",
  "function startTime() view returns (uint256)",
  "function totalETHRaised() view returns (uint256)",
  "function ifrAllocation() view returns (uint256)",
  "function lpTokenAddress() view returns (address)",
  "function minContribution() view returns (uint256)",
  "function maxContribution() view returns (uint256)",
];

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

const DECIMALS = 9;
const fmt = (bn) => ethers.utils.formatUnits(bn, DECIMALS);
const fmtEth = (bn) => ethers.utils.formatEther(bn);
const PUBLIC_MAINNET_RPC = "https://ethereum-rpc.publicnode.com";

async function optionalBool(contract, fnName) {
  try {
    return await contract[fnName]();
  } catch (_) {
    return null;
  }
}

async function main() {
  const rpcUrl = process.env.MAINNET_RPC_URL || PUBLIC_MAINNET_RPC;
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const now = Math.floor(Date.now() / 1000);
  const nowDate = new Date(now * 1000).toISOString();

  console.log("=".repeat(60));
  console.log("  INFERNO — BootstrapVaultV3 Status Check");
  console.log("=".repeat(60));
  console.log(`  Network:   ${network.name} (chainId ${network.chainId})`);
  console.log(`  Vault:     ${BOOTSTRAP_V3}`);
  console.log(`  Now:       ${nowDate}`);

  const vault = new ethers.Contract(BOOTSTRAP_V3, VAULT_ABI, provider);
  const token = new ethers.Contract(IFR_TOKEN, TOKEN_ABI, provider);

  const [
    finalised, startTime, endTime,
    totalETH, ifrAlloc, lpAddr, minC, maxC,
  ] = await Promise.all([
    vault.finalised(),
    vault.startTime(),
    vault.endTime(),
    vault.totalETHRaised(),
    vault.ifrAllocation(),
    vault.lpTokenAddress(),
    vault.minContribution(),
    vault.maxContribution(),
  ]);
  const hasRefund = await optionalBool(vault, "hasRefundOccurred");

  const ifrBalance = await token.balanceOf(BOOTSTRAP_V3);
  const ifrRequired = ifrAlloc.mul(2);
  const ifrMissing = ifrRequired.gt(ifrBalance) ? ifrRequired.sub(ifrBalance) : ethers.BigNumber.from(0);

  const start = new Date(startTime.toNumber() * 1000).toISOString();
  const end = new Date(endTime.toNumber() * 1000).toISOString();
  const secondsLeft = endTime.toNumber() - now;
  const daysLeft = (secondsLeft / 86400).toFixed(1);
  const isActive = now >= startTime.toNumber() && now < endTime.toNumber() && !finalised;

  console.log("\n── STATE ─────────────────────────────────────────────");
  console.log(`  Finalised:         ${finalised ? "✅ YES" : "❌ NO"}`);
  console.log(`  Active:            ${isActive ? "✅ YES" : "❌ NO"}`);
  if (hasRefund === null) {
    console.log("  Refund occurred:   n/a (getter not exposed on deployed contract)");
  } else {
    console.log(`  Refund occurred:   ${hasRefund ? "⚠️  YES" : "✅ NO"}`);
  }

  console.log("\n── TIMING ────────────────────────────────────────────");
  console.log(`  Start:             ${start}`);
  console.log(`  End:               ${end}`);
  if (secondsLeft > 0) {
    console.log(`  Time remaining:    ${daysLeft} days (${secondsLeft}s)`);
  } else {
    console.log(`  Bootstrap ENDED    ${Math.abs(secondsLeft / 86400).toFixed(1)} days ago`);
  }

  console.log("\n── FINANCIAL ─────────────────────────────────────────");
  console.log(`  ETH raised:        ${fmtEth(totalETH)} ETH`);
  console.log(`  IFR in vault:      ${fmt(ifrBalance)} IFR`);
  console.log(`  IFR required:      ${fmt(ifrRequired)} IFR (2x ${fmt(ifrAlloc)} allocation)`);
  if (ifrMissing.gt(0)) {
    console.log(`  IFR missing:       ${fmt(ifrMissing)} IFR ⚠️`);
  } else {
    console.log(`  IFR sufficient:    ✅`);
  }
  console.log(`  Min contribution:  ${fmtEth(minC)} ETH`);
  console.log(`  Max contribution:  ${fmtEth(maxC)} ETH`);

  console.log("\n── RESULT ────────────────────────────────────────────");
  if (finalised) {
    console.log(`  LP Token:          ${lpAddr}`);
    console.log(`  Status:            ✅ FINALISED — LP created and locked`);
  } else if (hasRefund === true) {
    console.log(`  Status:            ❌ REFUND OCCURRED — finalise() permanently blocked`);
  } else if (secondsLeft > 0) {
    console.log(`  Status:            ⏳ Bootstrap active — ${daysLeft} days until finalise() possible`);
    console.log(`  Ready on:          ${end}`);
    if (ifrMissing.gt(0)) {
      console.log(`\n  ⚠️  ACTION NEEDED: Transfer ${fmt(ifrMissing)} more IFR to vault before endTime!`);
    }
  } else {
    console.log(`  Status:            ⚡ READY FOR FINALISE`);
    if (ifrMissing.gt(0)) {
      console.log(`\n  ⚠️  BLOCKER: ${fmt(ifrMissing)} IFR missing in vault. Must transfer before finalise().`);
    } else {
      console.log(`\n  Run: npx hardhat run scripts/finalise-bootstrap.js --network mainnet`);
    }
  }

  console.log("\n" + "=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e.message);
    process.exit(1);
  });
