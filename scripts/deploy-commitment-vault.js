/**
 * Deploy CommitmentVault
 * Owner = Governance (Timelock)
 * Constructor: (ifrToken, governance)
 *
 * Usage:
 *   Sepolia:  npx hardhat run scripts/deploy-commitment-vault.js --network sepolia
 *   Mainnet:  npx hardhat run scripts/deploy-commitment-vault.js --network mainnet
 */
const { connectHardhat } = require("./lib/hardhat-runtime");

(async () => {
const hre = await connectHardhat();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const network = hre.network.name;
  console.log("Network:", network);

  // Addresses — same on Sepolia and Mainnet
  const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
  const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";

  console.log("IFR Token:", IFR_TOKEN);
  console.log("Governance (owner):", GOVERNANCE);

  const CommitmentVault = await hre.ethers.getContractFactory("CommitmentVault");
  const cv = await CommitmentVault.deploy(IFR_TOKEN, GOVERNANCE);
  await cv.waitForDeployment();

  console.log("CommitmentVault deployed:", cv.target);
  console.log("");
  console.log("NOTE: the CV-01 repair vault is ALREADY deployed: CommitmentVault V2 0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F");
  console.log("(block 26107296, Governance proposal #17 queued). This new deployment is NOT part of the CV-01 repair.");
  console.log("scripts/commitment-vault-v2-proposal.cjs is pinned to that V2 and to proposal #17 and refuses this address;");
  console.log("wiring a different vault needs its own reviewed proposal and Safe batch (docs/COMMITMENT_VAULT_V2_REPAIR.md).");
  console.log("Do NOT call setP0 or setPriceOracle: price conditions are disabled in this vault.");
  console.log("");

  // Etherscan verification
  if (
    network !== "default" &&
    network !== "hardhat" &&
    network !== "localhost"
  ) {
    console.log("Waiting 30s for Etherscan indexing...");
    await new Promise(r => setTimeout(r, 30000));
    try {
      await hre.run("verify:verify", {
        address: cv.target,
        constructorArguments: [IFR_TOKEN, GOVERNANCE],
      });
      console.log("Verified on Etherscan ✅");
    } catch (e) {
      console.error("Verification failed (can retry manually):", e.message);
    }
  }

  return cv.target;
}

main().catch(err => { console.error(err); process.exit(1); });

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
