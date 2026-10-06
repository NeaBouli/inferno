/** Fixed log categories for voucher issuance failures. Nothing else from an error reaches the log. */
export type VoucherIssueErrorCategory =
  | "voucher_error:signer"
  | "voucher_error:database"
  | "voucher_error:unknown";

/** Issuance failure tagged with its fixed log category; the original error is dropped. */
export class VoucherIssueFailure extends Error {
  constructor(readonly category: VoucherIssueErrorCategory) {
    super(category);
    this.name = "VoucherIssueFailure";
  }
}

const DATABASE_ERROR_NAMES = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
  "PrismaClientValidationError",
]);

/**
 * Map a voucher issuance failure to a constant log category. Only the error class and
 * its constant class name are inspected; message text, wallet, keys and any other
 * free-form content are never returned. Unknown -> "voucher_error:unknown".
 */
export function categorizeVoucherIssueError(err: unknown): VoucherIssueErrorCategory {
  if (err instanceof VoucherIssueFailure) return err.category;
  if (err instanceof Error && DATABASE_ERROR_NAMES.has(err.name)) return "voucher_error:database";
  return "voucher_error:unknown";
}
