import { Wallet, ZeroAddress } from "ethers";

process.env.SKIP_LOCK_PROOF = "true";
process.env.VOUCHER_SIGNER_PRIVATE_KEY = Wallet.createRandom().privateKey;
process.env.FEE_ROUTER_ADDRESS = ZeroAddress;
