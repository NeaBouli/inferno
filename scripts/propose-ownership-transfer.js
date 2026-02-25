const { ethers } = require("hardhat");

const ADDRESSES = {
  token:    "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
  reserve:  "0xF7E90D0d17f8232365186AA085D26eaEfAf011aF",
  buyback:  "0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C",
  burn:     "0x6D4582FCac792FD3880e252fC0a585A0c1823e80",
  gov:      "0x6050b22E4EAF3f414d1155fBaF30B868E0107017",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const iface = new ethers.utils.Interface([
    "function transferOwnership(address newOwner)"
  ]);

  const targets = [
    ADDRESSES.reserve,
    ADDRESSES.buyback,
    ADDRESSES.burn,
  ];
  const names = ["LiquidityReserve", "BuybackVault", "BurnReserve"];

  const gov = await ethers.getContractAt([
    "function propose(address target, bytes calldata data) external returns (uint256)",
    "function delay() view returns (uint256)",
    "function proposalCount() view returns (uint256)"
  ], ADDRESSES.gov);

  const delay = await gov.delay();
  const count = await gov.proposalCount();
  console.log(`Timelock delay: ${delay.toNumber()}s (${delay.toNumber()/3600}h)`);
  console.log(`Current proposalCount: ${count.toNumber()}`);

  for (let i = 0; i < targets.length; i++) {
    const calldata = iface.encodeFunctionData("transferOwnership", [ADDRESSES.gov]);

    console.log(`\n--- ${names[i]} ---`);
    console.log(`Target: ${targets[i]}`);
    console.log(`Calldata: ${calldata}`);
    console.log(`[DRY RUN] propose(${targets[i]}, calldata)`);
    console.log(`Will become Proposal #${count.toNumber() + i}`);
  }

  console.log("\n=== DRY RUN COMPLETE ===");
  console.log("Um die Proposals zu erstellen:");
  console.log("EXECUTE=true npx hardhat run scripts/propose-ownership-transfer.js --network sepolia");

  if (process.env.EXECUTE === "true") {
    for (let i = 0; i < targets.length; i++) {
      const calldata = iface.encodeFunctionData("transferOwnership", [ADDRESSES.gov]);
      const tx = await gov.propose(targets[i], calldata);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ProposalCreated");
      const proposalId = event ? event.args.id.toNumber() : "?";
      console.log(`✅ ${names[i]} proposed (Proposal #${proposalId}). TX: ${tx.hash}`);
    }
  }
}

main().catch(console.error);
