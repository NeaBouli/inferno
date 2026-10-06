import { ethers } from "ethers";
import { pointsSecurityConfig } from "../config/security.js";
import { signVoucherTypedData, voucherDomain, type VoucherData } from "./voucher-eip712.js";

export type { VoucherData } from "./voucher-eip712.js";

const CHAIN_ID = pointsSecurityConfig.chainId;
/** Validated in loadPointsSecurityConfig: canonical on CHAIN_ID 1, required in production. */
export const FEE_ROUTER_ADDRESS = pointsSecurityConfig.feeRouterAddress;

const domain = voucherDomain(CHAIN_ID, FEE_ROUTER_ADDRESS);

export async function signVoucher(voucher: VoucherData): Promise<string> {
  const privateKey = process.env.VOUCHER_SIGNER_PRIVATE_KEY;
  if (!privateKey) throw new Error("VOUCHER_SIGNER_PRIVATE_KEY not configured");

  const signer = new ethers.Wallet(privateKey);
  return signVoucherTypedData(signer, domain, voucher);
}

export function getSignerAddress(): string {
  const privateKey = process.env.VOUCHER_SIGNER_PRIVATE_KEY;
  if (!privateKey) return ethers.ZeroAddress;
  return new ethers.Wallet(privateKey).address;
}
