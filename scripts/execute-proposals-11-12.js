/**
 * Execute Governance Proposals #11 + #12
 * - #11: setFeeExempt(CommitmentVault, true)
 * - #12: setFeeExempt(LendingVault, true)
 *
 * Prerequisites: Proposals submitted via TreasurySafe 3-of-5 + 48h timelock passed
 * Anyone can call execute() after timelock — no Safe signature needed.
 *
 * Usage:
 *   node scripts/execute-proposals-11-12.js
 */
require("dotenv").config();
const { ethers } = require("ethers");

const GOV_ADDR = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const TOKEN_ADDR = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const CV_ADDR = "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
const LV_ADDR = "0x974305Ab0EC905172e697271C3d7d385194EB9DF";

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com"
  );
  const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  const gov = new ethers.Contract(GOV_ADDR, [
    "function execute(uint256 proposalId) external",
    "function getProposal(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)",
    "function proposalCount() view returns (uint256)",
  ], signer);

  const token = new ethers.Contract(TOKEN_ADDR, [
    "function feeExempt(address) view returns (bool)",
  ], provider);

  console.log("=== Execute Proposals #11 + #12 ===");
  console.log("Signer:", signer.address);
  console.log("Proposal count:", (await gov.proposalCount()).toString());
  console.log("");

  // Check current feeExempt state
  const cvBefore = await token.feeExempt(CV_ADDR);
  const lvBefore = await token.feeExempt(LV_ADDR);
  console.log("CV feeExempt before:", cvBefore);
  console.log("LV feeExempt before:", lvBefore);
  console.log("");

  // Execute #11
  if (!cvBefore) {
    console.log("Executing Proposal #11 (CommitmentVault feeExempt)...");
    try {
      const tx = await gov.execute(11);
      console.log("TX sent:", tx.hash);
      const receipt = await tx.wait();
      console.log("TX confirmed, block:", receipt.blockNumber);
    } catch (e) {
      console.error("#11 failed:", e.reason || e.message);
      if (e.message.includes("eta")) console.error("Timelock not passed yet — wait until 48h after proposal submission.");
    }
  } else {
    console.log("#11 already executed — CV is feeExempt");
  }

  // Execute #12
  if (!lvBefore) {
    console.log("Executing Proposal #12 (LendingVault feeExempt)...");
    try {
      const tx = await gov.execute(12);
      console.log("TX sent:", tx.hash);
      const receipt = await tx.wait();
      console.log("TX confirmed, block:", receipt.blockNumber);
    } catch (e) {
      console.error("#12 failed:", e.reason || e.message);
      if (e.message.includes("eta")) console.error("Timelock not passed yet — wait until 48h after proposal submission.");
    }
  } else {
    console.log("#12 already executed — LV is feeExempt");
  }

  // Final verify
  console.log("");
  console.log("=== VERIFICATION ===");
  const cvAfter = await token.feeExempt(CV_ADDR);
  const lvAfter = await token.feeExempt(LV_ADDR);
  console.log("CommitmentVault feeExempt:", cvAfter ? "CONFIRMED" : "NOT YET");
  console.log("LendingVault feeExempt:   ", lvAfter ? "CONFIRMED" : "NOT YET");

  if (cvAfter && lvAfter) {
    console.log("");
    console.log("Both contracts are feeExempt — users can now lock and borrow without fee loss!");
  }
}

main().catch(console.error);
