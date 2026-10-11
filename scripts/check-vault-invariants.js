#!/usr/bin/env node

/**
 * Read-only Mainnet safety monitor for the IFR accounting vaults (IFRLock, CommitmentVault V1 and V2,
 * LendingVault).
 *
 * No signer is created and no transaction-capable method is present. The
 * command exits non-zero when a required fee exemption is missing or liquid
 * IFR custody no longer covers the corresponding on-chain accounting.
 *
 * RPC integrity (external audit IFRUNIT 2026-10-11, IFR-DEV-01): the RPC must report chain ID 1,
 * every read is pinned to one block CONFIRMATIONS behind the head, and that block's hash must be
 * identical before and after the reads; otherwise the run fails instead of reporting.
 */

const CHAIN_ID = 1;
const DEFAULT_RPC_URL = "https://ethereum-rpc.publicnode.com";
const REQUEST_TIMEOUT_MS = 15_000;
const CONFIRMATIONS = 64;
const ADDRESSES = Object.freeze({
  token: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
  commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
  commitmentVaultV2: "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F",
  lendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
});

const TOKEN_ABI = [
  "function feeExempt(address) view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
// IFRLock, CommitmentVault V1 and V2 all expose `uint256 public totalLocked`.
const COMMITMENT_ABI = ["function totalLocked() view returns (uint256)"];
const LENDING_ABI = [
  "function totalAvailable() view returns (uint256)",
  "function totalLent() view returns (uint256)",
];

function toBigInt(value, field) {
  try {
    const result = BigInt(value);
    if (result < 0n) throw new Error("negative");
    return result;
  } catch {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
}

function assertRpcIntegrity({ chainIdHex, head, pinned, hashBefore, hashAfter }) {
  if (typeof chainIdHex !== "string" || BigInt(chainIdHex) !== BigInt(CHAIN_ID)) {
    throw new Error(`RPC reports chain ${chainIdHex}, expected ${CHAIN_ID}`);
  }
  if (!Number.isSafeInteger(head) || !Number.isSafeInteger(pinned) || pinned !== head - CONFIRMATIONS || pinned < 0) {
    throw new Error(`pinned block must be ${CONFIRMATIONS} behind the head`);
  }
  const hash = /^0x[0-9a-f]{64}$/;
  if (!hash.test(String(hashBefore)) || !hash.test(String(hashAfter))) {
    throw new Error("RPC returned no valid block hash");
  }
  if (hashBefore !== hashAfter) {
    throw new Error("pinned block hash changed during the reads (reorg or inconsistent RPC)");
  }
}

function evaluateVaultInvariants(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError("snapshot must be an object");
  }
  for (const part of ["ifrLock", "commitment", "commitmentV2", "lending"]) {
    if (!snapshot[part] || typeof snapshot[part] !== "object") {
      throw new TypeError(`snapshot.${part} is required`);
    }
  }

  const commitmentBalance = toBigInt(snapshot.commitment.balance, "commitment.balance");
  const totalLocked = toBigInt(snapshot.commitment.totalLocked, "commitment.totalLocked");
  const lendingBalance = toBigInt(snapshot.lending.balance, "lending.balance");
  const totalAvailable = toBigInt(snapshot.lending.totalAvailable, "lending.totalAvailable");
  const totalLent = toBigInt(snapshot.lending.totalLent, "lending.totalLent");
  const lockBalance = toBigInt(snapshot.ifrLock.balance, "ifrLock.balance");
  const lockTotal = toBigInt(snapshot.ifrLock.totalLocked, "ifrLock.totalLocked");
  const problems = [];

  if (snapshot.ifrLock.feeExempt !== true) {
    problems.push("IFRLock fee exemption is not active");
  }
  if (lockBalance < lockTotal) {
    problems.push("IFRLock token balance is below totalLocked");
  }
  if (snapshot.commitment.feeExempt !== true) {
    problems.push("CommitmentVault fee exemption is not active");
  }
  if (commitmentBalance < totalLocked) {
    problems.push("CommitmentVault token balance is below totalLocked");
  }
  if (snapshot.lending.feeExempt !== true) {
    problems.push("LendingVault fee exemption is not active");
  }
  if (lendingBalance < totalAvailable) {
    problems.push("LendingVault token balance is below totalAvailable");
  }

  // CommitmentVault V2 (time-only locks): its fee exemption was executed with Governance proposal #17
  // (4 October 2026), so a missing exemption is a failure whether or not V2 holds locks.
  const v2Balance = toBigInt(snapshot.commitmentV2.balance, "commitmentV2.balance");
  const v2Locked = toBigInt(snapshot.commitmentV2.totalLocked, "commitmentV2.totalLocked");
  if (snapshot.commitmentV2.feeExempt !== true) {
    problems.push("CommitmentVault V2 fee exemption is not active");
  }
  if (v2Balance < v2Locked) problems.push("CommitmentVault V2 token balance is below totalLocked");

  return {
    ok: problems.length === 0,
    problems,
    ifrLockSurplus: lockBalance - lockTotal,
    commitmentSurplus: commitmentBalance - totalLocked,
    commitmentV2Surplus: v2Balance - v2Locked,
    lendingLiquidSurplus: lendingBalance - totalAvailable,
    lendingPrincipalAccounting: totalAvailable + totalLent,
    lendingTotalAssetCoverage: lendingBalance + totalLent,
  };
}

async function readMainnetSnapshot({ rpcUrl = process.env.MAINNET_RPC_URL || DEFAULT_RPC_URL } = {}) {
  if (!/^https?:\/\//i.test(rpcUrl)) {
    throw new Error("MAINNET_RPC_URL must use http or https");
  }

  const { Contract, FetchRequest, JsonRpcProvider } = require("ethers");
  const request = new FetchRequest(rpcUrl);
  request.timeout = REQUEST_TIMEOUT_MS;
  const provider = new JsonRpcProvider(request, CHAIN_ID, { staticNetwork: true });
  const token = new Contract(ADDRESSES.token, TOKEN_ABI, provider);
  const commitment = new Contract(ADDRESSES.commitmentVault, COMMITMENT_ABI, provider);
  const commitmentV2 = new Contract(ADDRESSES.commitmentVaultV2, COMMITMENT_ABI, provider);
  const lending = new Contract(ADDRESSES.lendingVault, LENDING_ABI, provider);
  const ifrLock = new Contract(ADDRESSES.ifrLock, COMMITMENT_ABI, provider);

  try {
    // staticNetwork skips ethers' own chain detection, so the chain ID is checked explicitly.
    const chainIdHex = await provider.send("eth_chainId", []);
    const head = await provider.getBlockNumber();
    const blockNumber = head - CONFIRMATIONS;
    const hashBefore = (await provider.getBlock(blockNumber))?.hash;
    const block = { blockTag: blockNumber };
    const [
      commitmentFeeExempt,
      commitmentBalance,
      totalLocked,
      lendingFeeExempt,
      lendingBalance,
      totalAvailable,
      totalLent,
      v2FeeExempt,
      v2Balance,
      v2TotalLocked,
      lockFeeExempt,
      lockBalance,
      lockTotal,
    ] = await Promise.all([
      token.feeExempt(ADDRESSES.commitmentVault, block),
      token.balanceOf(ADDRESSES.commitmentVault, block),
      commitment.totalLocked(block),
      token.feeExempt(ADDRESSES.lendingVault, block),
      token.balanceOf(ADDRESSES.lendingVault, block),
      lending.totalAvailable(block),
      lending.totalLent(block),
      token.feeExempt(ADDRESSES.commitmentVaultV2, block),
      token.balanceOf(ADDRESSES.commitmentVaultV2, block),
      commitmentV2.totalLocked(block),
      token.feeExempt(ADDRESSES.ifrLock, block),
      token.balanceOf(ADDRESSES.ifrLock, block),
      ifrLock.totalLocked(block),
    ]);
    const hashAfter = (await provider.getBlock(blockNumber))?.hash;
    assertRpcIntegrity({ chainIdHex, head, pinned: blockNumber, hashBefore, hashAfter });

    return {
      chainId: CHAIN_ID,
      blockNumber,
      blockHash: hashAfter,
      confirmations: CONFIRMATIONS,
      ifrLock: {
        address: ADDRESSES.ifrLock,
        feeExempt: lockFeeExempt,
        balance: lockBalance,
        totalLocked: lockTotal,
      },
      commitment: {
        address: ADDRESSES.commitmentVault,
        feeExempt: commitmentFeeExempt,
        balance: commitmentBalance,
        totalLocked,
      },
      commitmentV2: {
        address: ADDRESSES.commitmentVaultV2,
        feeExempt: v2FeeExempt,
        balance: v2Balance,
        totalLocked: v2TotalLocked,
      },
      lending: {
        address: ADDRESSES.lendingVault,
        feeExempt: lendingFeeExempt,
        balance: lendingBalance,
        totalAvailable,
        totalLent,
      },
    };
  } finally {
    provider.destroy();
  }
}

function serializeReport(snapshot, evaluation) {
  const amount = (value) => ({ raw: value.toString(), ifr: formatIfr(value) });
  return {
    monitor: "ifr-vault-invariants",
    version: 2,
    checkedAt: new Date().toISOString(),
    chainId: snapshot.chainId,
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash,
    confirmations: snapshot.confirmations,
    addresses: ADDRESSES,
    ok: evaluation.ok,
    problems: evaluation.problems,
    ifrLock: {
      feeExempt: snapshot.ifrLock.feeExempt,
      balance: amount(snapshot.ifrLock.balance),
      totalLocked: amount(snapshot.ifrLock.totalLocked),
      surplus: amount(evaluation.ifrLockSurplus),
    },
    commitment: {
      feeExempt: snapshot.commitment.feeExempt,
      balance: amount(snapshot.commitment.balance),
      totalLocked: amount(snapshot.commitment.totalLocked),
      surplus: amount(evaluation.commitmentSurplus),
    },
    commitmentV2: {
      feeExempt: snapshot.commitmentV2.feeExempt,
      balance: amount(snapshot.commitmentV2.balance),
      totalLocked: amount(snapshot.commitmentV2.totalLocked),
      surplus: amount(evaluation.commitmentV2Surplus),
    },
    lending: {
      feeExempt: snapshot.lending.feeExempt,
      balance: amount(snapshot.lending.balance),
      totalAvailable: amount(snapshot.lending.totalAvailable),
      totalLent: amount(snapshot.lending.totalLent),
      liquidSurplus: amount(evaluation.lendingLiquidSurplus),
      principalAccounting: amount(evaluation.lendingPrincipalAccounting),
      totalAssetCoverage: amount(evaluation.lendingTotalAssetCoverage),
    },
  };
}

function formatIfr(value) {
  const negative = value < 0n;
  const raw = (negative ? -value : value).toString().padStart(10, "0");
  const whole = raw.slice(0, -9);
  const fraction = raw.slice(-9).replace(/0+$/, "");
  const formatted = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${formatted}` : formatted;
}

async function run(options = {}) {
  const snapshot = await readMainnetSnapshot(options);
  const evaluation = evaluateVaultInvariants(snapshot);
  return serializeReport(snapshot, evaluation);
}

async function main() {
  try {
    const report = await run();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(`[vault-invariants] monitor error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  ADDRESSES,
  CHAIN_ID,
  CONFIRMATIONS,
  assertRpcIntegrity,
  DEFAULT_RPC_URL,
  REQUEST_TIMEOUT_MS,
  evaluateVaultInvariants,
  formatIfr,
  readMainnetSnapshot,
  serializeReport,
  run,
};
