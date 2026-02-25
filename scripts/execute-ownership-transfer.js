const { ethers } = require("hardhat");

const ADDRESSES = {
  gov: "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
};

// Proposal IDs — set these after running propose-ownership-transfer.js
const PROPOSAL_IDS = [
  parseInt(process.env.PROP_RESERVE  || "0"),
  parseInt(process.env.PROP_BUYBACK  || "0"),
  parseInt(process.env.PROP_BURN     || "0"),
];
const NAMES = ["LiquidityReserve", "BuybackVault", "BurnReserve"];

async function main() {
  const gov = await ethers.getContractAt([
    "function execute(uint256 proposalId) external",
    "function getProposal(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)"
  ], ADDRESSES.gov);

  for (let i = 0; i < PROPOSAL_IDS.length; i++) {
    const id = PROPOSAL_IDS[i];
    if (id === 0) {
      console.log(`⚠️  ${NAMES[i]}: Skipped (set PROP_RESERVE/PROP_BUYBACK/PROP_BURN env vars)`);
      continue;
    }

    const [target, , eta, executed, cancelled] = await gov.getProposal(id);
    const now = Math.floor(Date.now() / 1000);

    console.log(`\n--- ${NAMES[i]} (Proposal #${id}) ---`);
    console.log(`Target: ${target}`);
    console.log(`ETA: ${new Date(eta.toNumber() * 1000).toISOString()}`);
    console.log(`Status: ${executed ? "EXECUTED" : cancelled ? "CANCELLED" : now >= eta.toNumber() ? "READY" : "PENDING"}`);

    if (executed || cancelled) {
      console.log(`⏭️  Skipping — already ${executed ? "executed" : "cancelled"}`);
      continue;
    }
    if (now < eta.toNumber()) {
      console.log(`⏳ Not ready yet — ${Math.ceil((eta.toNumber() - now) / 60)} min remaining`);
      continue;
    }

    const tx = await gov.execute(id);
    await tx.wait();
    console.log(`✅ ${NAMES[i]} ownership transferred. TX: ${tx.hash}`);
  }
}

main().catch(console.error);
