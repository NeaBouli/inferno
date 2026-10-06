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

export const VOUCHER_EIP712_TYPES = {
  Voucher: [
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
