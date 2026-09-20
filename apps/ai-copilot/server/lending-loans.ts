import { formatEther, formatUnits, isAddress } from "ethers";
import { IFR_DECIMALS } from "../src/context/copilot-policy.js";

export const LENDING_LOAN_COMPONENTS = [
  "borrower",
  "offerId",
  "ifrAmount",
  "ethCollateral",
  "startTime",
  "duration",
  "monthlyRateBps",
  "active",
] as const;

export const LENDING_LOAN_ABI = [
  "function getLoanCount() view returns (uint256)",
  "function getLoan(uint256 loanId) view returns (tuple(address borrower, uint256 offerId, uint256 ifrAmount, uint256 ethCollateral, uint256 startTime, uint256 duration, uint256 monthlyRateBps, bool active))",
  "function getCollateralRatio(uint256 loanId) view returns (uint256)",
] as const;

export interface LendingLoan {
  readonly borrower: string;
  readonly offerId: bigint;
  readonly ifrAmount: bigint;
  readonly ethCollateral: bigint;
  readonly startTime: bigint;
  readonly duration: bigint;
  readonly monthlyRateBps: bigint;
  readonly active: boolean;
}

export interface SerializedLendingLoan {
  readonly id: number;
  readonly borrower: string;
  readonly offerId: string;
  readonly ifrAmount: string;
  readonly ethCollateral: string;
  readonly startTime: number;
  readonly duration: number;
  readonly dueDate: string;
  readonly monthlyRate: string;
  readonly active: boolean;
}

function readTuple(raw: unknown): readonly unknown[] {
  if (!Array.isArray(raw) || raw.length !== LENDING_LOAN_COMPONENTS.length) {
    throw new TypeError(`LendingVault Loan must contain exactly ${LENDING_LOAN_COMPONENTS.length} fields`);
  }
  return raw;
}

function readUint(value: unknown, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new TypeError(`LendingVault Loan ${field} must be an unsigned bigint`);
  }
  return value;
}

function toSafeNumber(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`LendingVault Loan ${field} exceeds the safe integer range`);
  }
  return Number(value);
}

export function parseLendingLoan(raw: unknown): LendingLoan {
  const tuple = readTuple(raw);
  const borrower = tuple[0];
  const active = tuple[7];
  if (typeof borrower !== "string" || !isAddress(borrower)) {
    throw new TypeError("LendingVault Loan borrower must be a valid address");
  }
  if (typeof active !== "boolean") {
    throw new TypeError("LendingVault Loan active must be boolean");
  }

  return {
    borrower,
    offerId: readUint(tuple[1], "offerId"),
    ifrAmount: readUint(tuple[2], "ifrAmount"),
    ethCollateral: readUint(tuple[3], "ethCollateral"),
    startTime: readUint(tuple[4], "startTime"),
    duration: readUint(tuple[5], "duration"),
    monthlyRateBps: readUint(tuple[6], "monthlyRateBps"),
    active,
  };
}

export function serializeLendingLoan(id: number, raw: unknown): SerializedLendingLoan {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new RangeError("LendingVault loan ID must be a non-negative safe integer");
  }
  const loan = parseLendingLoan(raw);
  const startTime = toSafeNumber(loan.startTime, "startTime");
  const duration = toSafeNumber(loan.duration, "duration");
  const monthlyRateBps = toSafeNumber(loan.monthlyRateBps, "monthlyRateBps");
  const dueTime = startTime + duration;
  if (!Number.isSafeInteger(dueTime)) {
    throw new RangeError("LendingVault Loan due time exceeds the safe integer range");
  }
  const dueDate = new Date(dueTime * 1_000);
  if (Number.isNaN(dueDate.getTime())) {
    throw new RangeError("LendingVault Loan due time is outside the supported date range");
  }

  return {
    id,
    borrower: loan.borrower,
    offerId: loan.offerId.toString(),
    ifrAmount: formatUnits(loan.ifrAmount, IFR_DECIMALS),
    ethCollateral: formatEther(loan.ethCollateral),
    startTime,
    duration,
    dueDate: dueDate.toISOString().slice(0, 10),
    monthlyRate: `${monthlyRateBps / 100}%`,
    active: loan.active,
  };
}
