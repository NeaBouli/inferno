import { ethers } from "ethers";

const CHAIN_ID = parseInt(process.env.CHAIN_ID || "11155111", 10);
const FEE_ROUTER_ADDRESS = process.env.FEE_ROUTER_ADDRESS || ethers.constants.AddressZero;

const domain = {
  name: "InfernoFeeRouter",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: FEE_ROUTER_ADDRESS,
};

const types = {
  Voucher: [
    { name: "user", type: "address" },
    { name: "discountBps", type: "uint16" },
    { name: "maxUses", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

export interface VoucherData {
  user: string;
  discountBps: number;
  maxUses: number;
  expiry: number;
  nonce: string;
}

export async function signVoucher(voucher: VoucherData): Promise<string> {
  const privateKey = process.env.VOUCHER_SIGNER_PRIVATE_KEY;
  if (!privateKey) throw new Error("VOUCHER_SIGNER_PRIVATE_KEY not configured");

  const signer = new ethers.Wallet(privateKey);
  return signer._signTypedData(domain, types, voucher);
}

export function getSignerAddress(): string {
  const privateKey = process.env.VOUCHER_SIGNER_PRIVATE_KEY;
  if (!privateKey) return ethers.constants.AddressZero;
  return new ethers.Wallet(privateKey).address;
}
