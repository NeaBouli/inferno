#!/usr/bin/env node
// CWA-09: move every changeable guardian role from the deployer EOA to the Treasury Safe (3-of-5).
// Steps 1-3 already ran on Mainnet (docs/GUARDIAN_MIGRATION.md): Governance proposals #19
// (LiquidityReserve.setGuardian) and #20 (BurnReserve.setGuardian) are queued with ETA
// 2026-10-04 23:56:11 UTC; only step 2 (execute) is still pending.
//
//   node scripts/guardian-migration-proposal.cjs --execute [outDir]   production step 2 (the only CLI mode)
//
// The CLI writes guardian-step2-execute.json only after a read-only
// on-chain check (MAINNET_RPC_URL or a public RPC) proves that proposals #19/#20 still exist with
// exactly the pinned target, calldata and ETA and are neither executed nor cancelled. Any drift, an
// unreachable RPC or a non-Mainnet chain refuses the write. The unverified build(firstId) fixture is a
// library export only (unit test and the pinned fork rehearsal); the CLI never writes it. BuybackVault/BuybackController guardians are immutable and
// cannot be migrated.
const fs = require("node:fs");
const path = require("node:path");
const { Interface, getAddress } = require("ethers");

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
const gov = new Interface([
  "function setGuardian(address)",
  "function propose(address,bytes) returns (uint256)",
  "function execute(uint256)",
  "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)",
]);

// Queued by the Treasury Safe in block 26108062; content verified read-only at block 26119897.
const QUEUED_ETA = 1791158171n; // 2026-10-04T23:56:11.000Z
const GUARDIAN_INNER = setGuardian.encodeFunctionData("setGuardian", [TREASURY_SAFE]);
const QUEUED = [
  { id: 19n, name: "LiquidityReserve", target: C.LiquidityReserve },
  { id: 20n, name: "BurnReserve", target: C.BurnReserve },
];

const batch = (name, description, transactions) =>
  ({ version: "1.0", chainId: CHAIN_ID, createdAt: 0, meta: { name, description, txBuilderVersion: "1.16.5" }, transactions });
const tx = (to, data) => ({ to, value: "0", data });

function executeBatch() {
  return batch(
    "CWA-09 step 2: execute LiquidityReserve/BurnReserve guardian proposals",
    `Executes Governance proposals 19 (LiquidityReserve) and 20 (BurnReserve) after ETA ${new Date(Number(QUEUED_ETA) * 1000).toISOString()}; the queued content was verified on-chain before this file was written.`,
    QUEUED.map((p) => tx(C.Governance, gov.encodeFunctionData("execute", [p.id])))
  );
}

// Offline fixture for tests and the fork rehearsal pinned to block 26108024. Library-only, never written by the CLI.
function build(firstId) {
  if (!/^\d+$/.test(String(firstId))) throw new Error("first proposalId must be a non-negative integer");
  const id0 = BigInt(firstId), id1 = id0 + 1n;
  return {
    "guardian-step1-safe.json": batch(
      "CWA-09 step 1: Governance guardian -> Treasury Safe; propose LiquidityReserve/BurnReserve guardian",
      `Governance.setGuardian(${TREASURY_SAFE}) now; queues proposals ${id0} (LiquidityReserve) and ${id1} (BurnReserve) setGuardian(${TREASURY_SAFE}).`,
      [
        tx(C.Governance, gov.encodeFunctionData("setGuardian", [TREASURY_SAFE])),
        tx(C.Governance, gov.encodeFunctionData("propose", [C.LiquidityReserve, GUARDIAN_INNER])),
        tx(C.Governance, gov.encodeFunctionData("propose", [C.BurnReserve, GUARDIAN_INNER])),
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
        { name: "IFRLock.setGuardian(TreasurySafe)", ...tx(C.IFRLock, GUARDIAN_INNER) },
        { name: "PartnerVault.setGuardian(TreasurySafe)", ...tx(C.PartnerVault, GUARDIAN_INNER) },
        { name: "Vesting.transferGuardian(TreasurySafe)", ...tx(C.Vesting, transferGuardian.encodeFunctionData("transferGuardian", [TREASURY_SAFE])) },
      ],
    },
  };
}

/**
 * Read-only check that the queued proposals are exactly the approved CWA-09 operations.
 * `call(to, data)` performs an eth_call and resolves to the hex result. Throws on any drift:
 * unknown id, wrong target, wrong calldata, wrong ETA, already executed, cancelled.
 */
async function verifyQueuedProposals(call) {
  for (const p of QUEUED) {
    const raw = await call(C.Governance, gov.encodeFunctionData("getProposal", [p.id]));
    const [target, data, eta, executed, cancelled] = gov.decodeFunctionResult("getProposal", raw);
    if (eta === 0n) throw new Error(`refusing: Governance proposal #${p.id} does not exist`);
    if (getAddress(target) !== getAddress(p.target)) throw new Error(`refusing: proposal #${p.id} targets ${target}, not ${p.name} ${p.target}`);
    if (data.toLowerCase() !== GUARDIAN_INNER.toLowerCase()) throw new Error(`refusing: proposal #${p.id} data is not ${p.name}.setGuardian(Treasury Safe)`);
    if (eta !== QUEUED_ETA) throw new Error(`refusing: proposal #${p.id} ETA ${eta} is not the pinned ${QUEUED_ETA} (${new Date(Number(QUEUED_ETA) * 1000).toISOString()})`);
    if (executed) throw new Error(`refusing: proposal #${p.id} is already executed`);
    if (cancelled) throw new Error(`refusing: proposal #${p.id} is cancelled`);
  }
  return { eta: QUEUED_ETA };
}

/** Production step 2: verify the pinned queued proposals on-chain, then write only the execute batch. */
async function buildVerifiedExecute(call) {
  await verifyQueuedProposals(call);
  return { "guardian-step2-execute.json": executeBatch() };
}

const RPC_TIMEOUT_MS = 10_000;

/**
 * Minimal JSON-RPC eth_call with a chainId 1 check. Every request is bounded by `timeoutMs`; a non-2xx
 * status, an unparsable body or any envelope other than {jsonrpc "2.0", matching id, hex result} refuses
 * with a generic error that never echoes the endpoint or its response.
 */
function rpcCaller(url, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
  let nextId = 0;
  const post = async (method, params) => {
    const id = ++nextId;
    let body;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error("http status");
      body = await res.json();
    } catch {
      throw new Error(`refusing: RPC ${method} failed`);
    }
    const valid = body !== null && typeof body === "object" && !Array.isArray(body) && body.jsonrpc === "2.0" &&
      body.id === id && !("error" in body) && typeof body.result === "string" && /^0x[0-9a-fA-F]*$/.test(body.result);
    if (!valid) throw new Error(`refusing: RPC ${method} returned an invalid response`);
    return body.result;
  };
  let checked = false;
  return async (to, data) => {
    if (!checked) {
      if ((await post("eth_chainId", [])) !== "0x1") throw new Error("refusing: RPC is not Ethereum Mainnet");
      checked = true;
    }
    return post("eth_call", [{ to, data }, "latest"]);
  };
}

module.exports = { build, buildVerifiedExecute, verifyQueuedProposals, rpcCaller, RPC_TIMEOUT_MS, C, IMMUTABLE, TREASURY_SAFE, DEPLOYER, QUEUED, QUEUED_ETA, GUARDIAN_INNER };

if (require.main === module) {
  const args = process.argv.slice(2);
  (async () => {
    // Only verified output is ever written; build() stays a library export for tests and fork rehearsals.
    if (args[0] !== "--execute" || args.length > 2 || (args[1] !== undefined && args[1].startsWith("-"))) {
      throw new Error("usage: --execute [outDir] (verified against the queued Mainnet proposals)");
    }
    const outDir = args[1] || ".";
    const files = await buildVerifiedExecute(rpcCaller(process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com"));
    console.log(`verified on-chain: proposals #19/#20 = LiquidityReserve/BurnReserve.setGuardian(Treasury Safe), queued, ETA ${new Date(Number(QUEUED_ETA) * 1000).toISOString()}`);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(content, null, 2) + "\n");
      console.log(`wrote ${path.join(outDir, name)}`);
    }
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
