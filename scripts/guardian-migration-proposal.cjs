#!/usr/bin/env node
// CWA-09: move every changeable guardian role from the deployer EOA to the Treasury Safe (3-of-5).
// Writes three Safe Transaction Builder files and one JSON list of deployer transactions:
//   guardian-step1-safe.json      Treasury Safe: Governance.setGuardian(Safe) + propose LiquidityReserve/BurnReserve.setGuardian(Safe)
//   guardian-step2-execute.json   Treasury Safe, after the 48h delay: execute both proposals
//   guardian-deployer-txs.json    deployer EOA: IFRLock.setGuardian, PartnerVault.setGuardian, Vesting.transferGuardian
// BuybackVault and BuybackController have an immutable guardian and cannot be migrated.
//
//   node scripts/guardian-migration-proposal.cjs <first proposalId = Governance.proposalCount()> [outDir]
const fs = require("node:fs");
const path = require("node:path");
const { Interface } = require("ethers");

const CHAIN_ID = "1";
const TREASURY_SAFE = "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b";
const DEPLOYER = "0x6b36687b0cd4386fb14cf565B67D7862110Fed67";
const C = {
  Governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
  IFRLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
  Vesting: "0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271",
  LiquidityReserve: "0xdc0309804803b3A105154f6073061E3185018f64",
  PartnerVault: "0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D",
  BurnReserve: "0xaA1496133B6c274190A2113410B501C5802b6fCF",
};
const IMMUTABLE = { BuybackVault: "0x670D293e3D65f96171c10DdC8d88B96b0570F812", BuybackController: "0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c" };

const setGuardian = new Interface(["function setGuardian(address)"]);
const transferGuardian = new Interface(["function transferGuardian(address)"]);
const gov = new Interface(["function setGuardian(address)", "function propose(address,bytes) returns (uint256)", "function execute(uint256)"]);

const batch = (name, description, transactions) =>
  ({ version: "1.0", chainId: CHAIN_ID, createdAt: 0, meta: { name, description, txBuilderVersion: "1.16.5" }, transactions });
const tx = (to, data) => ({ to, value: "0", data });

function build(firstId) {
  if (!/^\d+$/.test(String(firstId))) throw new Error("first proposalId must be a non-negative integer");
  const id0 = BigInt(firstId), id1 = id0 + 1n;
  const inner = setGuardian.encodeFunctionData("setGuardian", [TREASURY_SAFE]);
  return {
    "guardian-step1-safe.json": batch(
      "CWA-09 step 1: Governance guardian -> Treasury Safe; propose LiquidityReserve/BurnReserve guardian",
      `Governance.setGuardian(${TREASURY_SAFE}) now; queues proposals ${id0} (LiquidityReserve) and ${id1} (BurnReserve) setGuardian(${TREASURY_SAFE}).`,
      [
        tx(C.Governance, gov.encodeFunctionData("setGuardian", [TREASURY_SAFE])),
        tx(C.Governance, gov.encodeFunctionData("propose", [C.LiquidityReserve, inner])),
        tx(C.Governance, gov.encodeFunctionData("propose", [C.BurnReserve, inner])),
      ]
    ),
    "guardian-step2-execute.json": batch(
      "CWA-09 step 2: execute LiquidityReserve/BurnReserve guardian proposals",
      `Executes Governance proposals ${id0} and ${id1} after the 48h delay.`,
      [tx(C.Governance, gov.encodeFunctionData("execute", [id0])), tx(C.Governance, gov.encodeFunctionData("execute", [id1]))]
    ),
    "guardian-deployer-txs.json": {
      chainId: 1,
      from: DEPLOYER,
      note: "Sent by the current guardian (deployer EOA). Each call hands that contract's guardian role to the Treasury Safe.",
      transactions: [
        { name: "IFRLock.setGuardian(TreasurySafe)", ...tx(C.IFRLock, inner) },
        { name: "PartnerVault.setGuardian(TreasurySafe)", ...tx(C.PartnerVault, inner) },
        { name: "Vesting.transferGuardian(TreasurySafe)", ...tx(C.Vesting, transferGuardian.encodeFunctionData("transferGuardian", [TREASURY_SAFE])) },
      ],
    },
  };
}

module.exports = { build, C, IMMUTABLE, TREASURY_SAFE, DEPLOYER };

if (require.main === module) {
  const [idArg, outArg] = process.argv.slice(2);
  try {
    const files = build(idArg);
    const outDir = outArg || ".";
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
      console.log(`wrote ${path.join(outDir, name)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
