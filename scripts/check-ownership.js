const { ethers } = require("ethers");
require("dotenv").config();

// ── Mainnet Addresses ──────────────────────────────────────
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const DEPLOYER   = "0x6b36687b0cd4386fb14cf565B67D7862110Fed67";

const ownerContracts = [
  { name: "InfernoToken",     addr: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B" },
  { name: "LiquidityReserve", addr: "0xdc0309804803b3A105154f6073061E3185018f64" },
  { name: "BurnReserve",      addr: "0xaA1496133B6c274190A2113410B501C5802b6fCF" },
  { name: "BuybackVault",     addr: "0x670D293e3D65f96171c10DdC8d88B96b0570F812" },
];

const adminContracts = [
  { name: "PartnerVault", addr: "0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D" },
];

const governanceContracts = [
  { name: "FeeRouterV1", addr: "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a" },
];

const guardianContracts = [
  { name: "IFRLock", addr: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb" },
  { name: "Vesting", addr: "0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271" },
];

async function main() {
  // Use MAINNET_RPC_URL or fallback to public endpoint
  const rpcUrl = process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  console.log("=".repeat(60));
  console.log("INFERNO — Ownership Status Check");
  console.log("=".repeat(60));
  console.log(`Network:     ${network.name} (chainId: ${network.chainId})`);
  console.log(`RPC:         ${rpcUrl.substring(0, 40)}...`);
  console.log(`Governance:  ${GOVERNANCE}`);
  console.log(`Deployer:    ${DEPLOYER}`);
  console.log("-".repeat(60));

  const needsTransfer = [];

  // 1. Check owner() contracts
  console.log("\n--- Contracts with owner() ---");
  const ownerAbi = ["function owner() view returns (address)"];
  for (const c of ownerContracts) {
    const contract = new ethers.Contract(c.addr, ownerAbi, provider);
    const owner = await contract.owner();
    const isGov = owner.toLowerCase() === GOVERNANCE.toLowerCase();
    const label = isGov ? "Governance" : owner;
    console.log(`  ${c.name.padEnd(20)} ${isGov ? "OK" : "NEEDS TRANSFER"}  owner=${label}`);
    if (!isGov) needsTransfer.push({ ...c, method: "transferOwnership", current: owner });
  }

  // 2. Check admin() contracts
  console.log("\n--- Contracts with admin() ---");
  const adminAbi = ["function admin() view returns (address)"];
  for (const c of adminContracts) {
    const contract = new ethers.Contract(c.addr, adminAbi, provider);
    const admin = await contract.admin();
    const isGov = admin.toLowerCase() === GOVERNANCE.toLowerCase();
    const label = isGov ? "Governance" : admin;
    console.log(`  ${c.name.padEnd(20)} ${isGov ? "OK" : "NEEDS TRANSFER"}  admin=${label}`);
    if (!isGov) needsTransfer.push({ ...c, method: "setAdmin", current: admin });
  }

  // 3. Check governance() contracts (immutable at deploy)
  console.log("\n--- Contracts with governance() (immutable at deploy) ---");
  const govAbi = ["function governance() view returns (address)"];
  for (const c of governanceContracts) {
    const contract = new ethers.Contract(c.addr, govAbi, provider);
    const gov = await contract.governance();
    const isGov = gov.toLowerCase() === GOVERNANCE.toLowerCase();
    const label = isGov ? "Governance" : gov;
    console.log(`  ${c.name.padEnd(20)} ${isGov ? "OK" : "MISMATCH"}  governance=${label}`);
  }

  // 4. Check guardian() contracts (emergency pause role only)
  console.log("\n--- Contracts with guardian() (emergency pause only) ---");
  const guardianAbi = ["function guardian() view returns (address)"];
  for (const c of guardianContracts) {
    const contract = new ethers.Contract(c.addr, guardianAbi, provider);
    const g = await contract.guardian();
    const isDep = g.toLowerCase() === DEPLOYER.toLowerCase();
    console.log(`  ${c.name.padEnd(20)} guardian=${isDep ? "Deployer" : g}`);
  }

  // 5. Check Governance contract owner
  console.log("\n--- Governance Contract ---");
  const govOwnerAbi = ["function owner() view returns (address)"];
  const govContract = new ethers.Contract(GOVERNANCE, govOwnerAbi, provider);
  const govOwner = await govContract.owner();
  const isDep = govOwner.toLowerCase() === DEPLOYER.toLowerCase();
  console.log(`  Governance.owner() = ${isDep ? "Deployer" : govOwner}`);
  console.log(`  (Will be transferred to Gnosis Safe in a separate step)`);

  // Summary
  console.log("\n" + "=".repeat(60));
  if (needsTransfer.length === 0) {
    console.log("ALL CONTRACTS ALREADY GOVERNED — no transfers needed");
  } else {
    console.log(`${needsTransfer.length} CONTRACT(S) NEED OWNERSHIP TRANSFER:`);
    for (const c of needsTransfer) {
      console.log(`  - ${c.name}: ${c.method}(${GOVERNANCE})`);
      console.log(`    Current: ${c.current}`);
    }
  }
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
