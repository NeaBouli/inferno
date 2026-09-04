#!/usr/bin/env node

/**
 * Read-only Mainnet safety monitor for the two IFR accounting vaults.
 *
 * No signer is created and no transaction-capable method is present. The
 * command exits non-zero when a required fee exemption is missing or liquid
 * IFR custody no longer covers the corresponding on-chain accounting.
 */

const CHAIN_ID = 1;
const DEFAULT_RPC_URL = "https://ethereum-rpc.publicnode.com";
const REQUEST_TIMEOUT_MS = 15_000;
const ADDRESSES = Object.freeze({
  token: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
  lendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
});

const TOKEN_ABI = [
  "function feeExempt(address) view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
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

function evaluateVaultInvariants(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError("snapshot must be an object");
  }

  const commitmentBalance = toBigInt(snapshot.commitment.balance, "commitment.balance");
  const totalLocked = toBigInt(snapshot.commitment.totalLocked, "commitment.totalLocked");
  const lendingBalance = toBigInt(snapshot.lending.balance, "lending.balance");
  const totalAvailable = toBigInt(snapshot.lending.totalAvailable, "lending.totalAvailable");
  const totalLent = toBigInt(snapshot.lending.totalLent, "lending.totalLent");
  const problems = [];

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

  return {
    ok: problems.length === 0,
    problems,
    commitmentSurplus: commitmentBalance - totalLocked,
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
  const lending = new Contract(ADDRESSES.lendingVault, LENDING_ABI, provider);

  try {
    const blockNumber = await provider.getBlockNumber();
    const block = { blockTag: blockNumber };
    const [
      commitmentFeeExempt,
      commitmentBalance,
      totalLocked,
      lendingFeeExempt,
      lendingBalance,
      totalAvailable,
      totalLent,
    ] = await Promise.all([
      token.feeExempt(ADDRESSES.commitmentVault, block),
      token.balanceOf(ADDRESSES.commitmentVault, block),
      commitment.totalLocked(block),
      token.feeExempt(ADDRESSES.lendingVault, block),
      token.balanceOf(ADDRESSES.lendingVault, block),
      lending.totalAvailable(block),
      lending.totalLent(block),
    ]);

    return {
      chainId: CHAIN_ID,
      blockNumber,
      commitment: {
        address: ADDRESSES.commitmentVault,
        feeExempt: commitmentFeeExempt,
        balance: commitmentBalance,
        totalLocked,
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
    version: 1,
    checkedAt: new Date().toISOString(),
    chainId: snapshot.chainId,
    blockNumber: snapshot.blockNumber,
    addresses: ADDRESSES,
    ok: evaluation.ok,
    problems: evaluation.problems,
    commitment: {
      feeExempt: snapshot.commitment.feeExempt,
      balance: amount(snapshot.commitment.balance),
      totalLocked: amount(snapshot.commitment.totalLocked),
      surplus: amount(evaluation.commitmentSurplus),
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
  DEFAULT_RPC_URL,
  REQUEST_TIMEOUT_MS,
  evaluateVaultInvariants,
  formatIfr,
  readMainnetSnapshot,
  serializeReport,
  run,
};
