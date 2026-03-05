const { ethers } = require("hardhat");

// ── Mainnet Addresses ──────────────────────────────────────
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";

// Contracts that use transferOwnership(address)
const ownerContracts = [
  { name: "InfernoToken",     addr: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B" },
  { name: "LiquidityReserve", addr: "0xdc0309804803b3A105154f6073061E3185018f64" },
  { name: "BurnReserve",      addr: "0xaA1496133B6c274190A2113410B501C5802b6fCF" },
  { name: "BuybackVault",     addr: "0x670D293e3D65f96171c10DdC8d88B96b0570F812" },
];

// Contracts that use setAdmin(address)
const adminContracts = [
  { name: "PartnerVault", addr: "0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D" },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("INFERNO — Ownership Transfer to Governance (Mainnet)");
  console.log("=".repeat(60));
  console.log(`Network:     ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer:    ${deployer.address}`);
  console.log(`Governance:  ${GOVERNANCE}`);
  console.log("-".repeat(60));

  const ownerAbi = [
    "function owner() view returns (address)",
    "function transferOwnership(address newOwner)",
  ];
  const adminAbi = [
    "function admin() view returns (address)",
    "function setAdmin(address newAdmin)",
  ];

  let transferred = 0;
  let skipped = 0;
  let totalGas = ethers.BigNumber.from(0);

  // ── Transfer owner contracts ────────────────────────────
  for (const c of ownerContracts) {
    console.log(`\n[${c.name}]`);
    const contract = new ethers.Contract(c.addr, ownerAbi, deployer);
    const currentOwner = await contract.owner();

    if (currentOwner.toLowerCase() === GOVERNANCE.toLowerCase()) {
      console.log(`  SKIP — already owned by Governance`);
      skipped++;
      continue;
    }

    if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log(`  ERROR — owner is ${currentOwner}, not deployer. Cannot transfer.`);
      continue;
    }

    console.log(`  Current owner: ${currentOwner} (deployer)`);
    console.log(`  Transferring to Governance...`);

    const tx = await contract.transferOwnership(GOVERNANCE);
    const receipt = await tx.wait();
    console.log(`  TX: ${receipt.transactionHash}`);
    console.log(`  Gas: ${receipt.gasUsed.toString()}`);
    totalGas = totalGas.add(receipt.gasUsed);

    // Verify
    const newOwner = await contract.owner();
    if (newOwner.toLowerCase() === GOVERNANCE.toLowerCase()) {
      console.log(`  CONFIRMED — Governance is now owner`);
      transferred++;
    } else {
      console.log(`  WARNING — owner is ${newOwner}, expected Governance`);
    }
  }

  // ── Transfer admin contracts ────────────────────────────
  for (const c of adminContracts) {
    console.log(`\n[${c.name}]`);
    const contract = new ethers.Contract(c.addr, adminAbi, deployer);
    const currentAdmin = await contract.admin();

    if (currentAdmin.toLowerCase() === GOVERNANCE.toLowerCase()) {
      console.log(`  SKIP — already admin'd by Governance`);
      skipped++;
      continue;
    }

    if (currentAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log(`  ERROR — admin is ${currentAdmin}, not deployer. Cannot transfer.`);
      continue;
    }

    console.log(`  Current admin: ${currentAdmin} (deployer)`);
    console.log(`  Setting admin to Governance...`);

    const tx = await contract.setAdmin(GOVERNANCE);
    const receipt = await tx.wait();
    console.log(`  TX: ${receipt.transactionHash}`);
    console.log(`  Gas: ${receipt.gasUsed.toString()}`);
    totalGas = totalGas.add(receipt.gasUsed);

    // Verify
    const newAdmin = await contract.admin();
    if (newAdmin.toLowerCase() === GOVERNANCE.toLowerCase()) {
      console.log(`  CONFIRMED — Governance is now admin`);
      transferred++;
    } else {
      console.log(`  WARNING — admin is ${newAdmin}, expected Governance`);
    }
  }

  // ── Summary ─────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Transferred: ${transferred}`);
  console.log(`  Skipped:     ${skipped} (already Governance)`);
  console.log(`  Total Gas:   ${totalGas.toString()}`);

  if (network.chainId === 31337) {
    // Hardhat fork — estimate ETH cost
    const gasPrice = await ethers.provider.getGasPrice();
    const cost = totalGas.mul(gasPrice);
    console.log(`  Gas Price:   ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
    console.log(`  Est. Cost:   ${ethers.utils.formatEther(cost)} ETH`);
  }

  console.log("=".repeat(60));
  console.log("\nAfter transfer, parameter changes require:");
  console.log("  1. governance.propose(target, encodedCalldata)");
  console.log("  2. Wait 48 hours");
  console.log("  3. governance.execute(proposalId)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
