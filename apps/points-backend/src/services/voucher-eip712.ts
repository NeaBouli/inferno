// EIP-712 voucher format shared by the points backend and the FeeRouterV1 parity test.
// This module has no imports so the Hardhat suite can load it directly; keep it that way.

export interface VoucherData {
  user: string;
  discountBps: number;
  maxUses: number;
  expiry: number;
  nonce: string;
}

export interface VoucherDomain {
  name: string;
  version: string;
  chainId: number | bigint;
  verifyingContract: string;
}

export interface TypedDataSigner {
  signTypedData(
    domain: VoucherDomain,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<string>;
}

/** Hard cap enforced by FeeRouterV1.setFeeBps (FEE_CAP_BPS). */
export const FEE_ROUTER_FEE_CAP_BPS = 25;

// The primary type name is part of the EIP-712 type hash and must equal the contract's
// VOUCHER_TYPEHASH: "DiscountVoucher(address user,uint16 discountBps,uint32 maxUses,uint64 expiry,uint256 nonce)".
export const VOUCHER_EIP712_TYPES = {
  DiscountVoucher: [
    { name: "user", type: "address" },
    { name: "discountBps", type: "uint16" },
    { name: "maxUses", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

export function voucherDomain(chainId: number | bigint, verifyingContract: string): VoucherDomain {
  return { name: "InfernoFeeRouter", version: "1", chainId, verifyingContract };
}

export function signVoucherTypedData(
  signer: TypedDataSigner,
  domain: VoucherDomain,
  voucher: VoucherData,
): Promise<string> {
  return signer.signTypedData(domain, VOUCHER_EIP712_TYPES, { ...voucher });
}

/**
 * Discount to sign at issue time: the configured discount, never above the FeeRouterV1
 * protocol fee read on-chain (the contract reverts with "Discount exceeds fee" otherwise).
 * A voucher only waives the FeeRouter swap fee; it never affects the IFR transfer burn.
 * Returns 0 when the on-chain fee is 0; callers must then refuse to issue.
 */
export function capVoucherDiscountBps(
  configured: { discountBps: number; maxDiscountBps: number },
  protocolFeeBps: number,
): number {
  if (!Number.isInteger(protocolFeeBps) || protocolFeeBps < 0 || protocolFeeBps > FEE_ROUTER_FEE_CAP_BPS) {
    throw new Error(`Invalid FeeRouter protocolFeeBps: ${protocolFeeBps}`);
  }
  return Math.max(0, Math.min(configured.discountBps, configured.maxDiscountBps, protocolFeeBps));
}
