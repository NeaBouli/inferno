# Voucher Signer Rotation (CWA-06)

**Status:** prepared. Every Mainnet and production step below is performed by the host operator or the Safe
signers, never by automation.

## Why

`FeeRouterV1.voucherSigner()` is `0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4`, which is also an owner of all three
project Safes. The points backend signs discount vouchers with `VOUCHER_SIGNER_PRIVATE_KEY`, so that Safe owner key
sits on an internet-facing host. A host compromise would yield one of the three Safe signatures needed.

The voucher key can only grant protocol-fee discounts (`discountBps`, bounded uses and expiry). It cannot move funds.
A dedicated key that owns nothing else keeps that small blast radius and separates it from Safe custody.

## Steps

1. **Prepare (host operator).** `bash scripts/ops/rotate-voucher-signer.sh prepare` generates a new key inside the
   points-backend container on the host, stores it in a root-only file and prints only its address.
2. **Generate the Safe batch files (anyone).**
   `node scripts/voucher-signer-rotation-proposal.cjs <new address> <Governance.proposalCount()> ./cwa06-safe`.
   The script refuses every Safe owner, the Safes, Governance and FeeRouterV1.
3. **Propose (Treasury Safe, 3-of-5).** Import `cwa06-voucher-step1-propose.json`; check target Governance, inner
   target FeeRouterV1, `setVoucherSigner(<new address>)`.
4. **Execute after 48 hours (Treasury Safe).** Import `cwa06-voucher-step2-execute.json`.
5. **Activate (host operator).** `bash scripts/ops/rotate-voucher-signer.sh activate` refuses unless a Mainnet RPC
   (chainId 1, well-formed response) reports the prepared key as the on-chain signer. It then switches
   `.env.points-backend`, recreates the container, and requires a healthy `/health` and the expected active signer
   address. Only then does it shred the env backup made by this run and the staging key file. Other copies, such as
   older env or release backups and host snapshots, are not checked and must be reviewed separately.
   If health or the signer check fails, nothing is shredded: restore with
   `mv "$(cat .voucher-signer-last-backup)" .env.points-backend` in the host root, recreate the container, and retry.
6. **Replace the Safe owner key.** The former signer swaps `0x17F8…72d4` for a fresh wallet in all three Safes,
   because that key was stored on the host.

Between steps 4 and 5, vouchers signed with the old key are rejected on-chain; run step 5 promptly.

## Tests

- `node scripts/test-voucher-signer-rotation-proposal.cjs` (CI, contracts workflow)
- `HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent> MAINNET_RPC_URL=<rpc> npx hardhat test test/fork/VoucherSignerRotationFork.test.js`
- `FORK_RPC=<local fork node> bash scripts/test-rotate-voucher-signer.sh`: host script end to end with ssh/docker shims
