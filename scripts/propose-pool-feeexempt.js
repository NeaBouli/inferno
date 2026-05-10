const { ethers } = require("hardhat");

/**
 * INFERNO — Propose setFeeExempt for Uniswap LP Token (Proposal #11)
 *
 * CRITICAL: Must be run immediately after BootstrapVaultV3.finalise() creates the LP.
 *           Without feeExempt, the LP token cannot trade IFR on Uniswap (fees block swaps).
 *
 * Usage:
 *   LP_TOKEN=0x<address> npx hardhat run scripts/propose-pool-feeexempt.js --network mainnet
 *
 * Or set LP_TOKEN in your .env:
 *   LP_TOKEN=0x...
 *
 * The LP token address is printed by finalise-bootstrap.js after successful execution.
 * It can also be read from: BootstrapVaultV3.lpTokenAddress()
 */

const TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOV   = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";

const GOV_ABI = [
  "function propose(address target, bytes calldata calldata_) external returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function getProposal(uint256 id) view returns (address proposer, address target, bytes memory calldata_, uint256 eta, bool executed, bool cancelled)",
];

const TOKEN_ABI = [
  "function setFeeExempt(address account, bool exempt) external",
  "function feeExempt(address account) view returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  // Resolve LP token address from env or environment variable
  const lpToken = process.env.LP_TOKEN;
  if (!lpToken || !ethers.utils.isAddress(lpToken)) {
    throw new Error(
      "LP_TOKEN environment variable not set or invalid.\n" +
      "Set LP_TOKEN=0x<address> before running.\n" +
      "Get the address from: BootstrapVaultV3.lpTokenAddress() after finalise()."
    );
  }

  console.log("=".repeat(60));
  console.log("  INFERNO — Propose feeExempt for Uniswap LP (Proposal #11)");
  console.log("=".repeat(60));
  console.log(`  Proposer:    ${deployer.address}`);
  console.log(`  Network:     ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Balance:     ${ethers.utils.formatEther(await deployer.getBalance())} ETH`);
  console.log(`  Governance:  ${GOV}`);
  console.log(`  Token:       ${TOKEN}`);
  console.log(`  LP Token:    ${lpToken}`);

  const governance = new ethers.Contract(GOV, GOV_ABI, deployer);
  const iface = new ethers.utils.Interface(TOKEN_ABI);
  const token = new ethers.Contract(TOKEN, TOKEN_ABI, deployer.provider);

  // Pre-check: is LP already exempt?
  const alreadyExempt = await token.feeExempt(lpToken);
  if (alreadyExempt) {
    console.log(`\n✅ Uniswap LP (${lpToken}) is already feeExempt. Nothing to propose.`);
    return;
  }

  console.log(`\n  LP feeExempt status: false (proposal needed)`);

  const calldata = iface.encodeFunctionData("setFeeExempt", [lpToken, true]);
  console.log(`  Calldata:    ${calldata}`);

  console.log("\n  Submitting proposal...");
  const tx = await governance.propose(TOKEN, calldata);
  const receipt = await tx.wait();

  console.log(`  TX hash:   ${tx.hash}`);
  console.log(`  Gas used:  ${receipt.gasUsed.toString()}`);

  const count = await governance.proposalCount();
  const proposalId = count.toNumber() - 1;
  const p = await governance.getProposal(proposalId);
  const eta = new Date(p.eta.toNumber() * 1000);

  console.log(`\n  Proposal:  #${proposalId}`);
  console.log(`  ETA:       ${eta.toISOString()} (48h timelock)`);
  console.log(`  Etherscan: https://etherscan.io/tx/${tx.hash}`);

  console.log("\n" + "=".repeat(60));
  console.log("  ✅ PROPOSAL #11 SUBMITTED");
  console.log("=".repeat(60));
  console.log("\n  NEXT STEPS:");
  console.log(`  1. Wait until: ${eta.toISOString()}`);
  console.log("  2. Execute Proposal #11 (any wallet can call execute)");
  console.log("  3. After execution: IFR is tradeable on Uniswap ✅");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e.message);
    process.exit(1);
  });
