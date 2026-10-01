# ifr-benefits-verify

Reference implementation of [`ifr-benefits-verify/1`](../../docs/specs/ifr-benefits-verify-1.md). It is a
permissionless check of a wallet's IFR lock tier at one pinned Ethereum block, read directly from the public
IFR contracts.

There is no API, no hosted service and no registration. You need an Ethereum RPC endpoint, nothing else.

Licence: MIT.

## Use

```js
const { verifyIfrBenefit } = require("ifr-benefits-verify");

const result = await verifyIfrBenefit({
  wallet: "0x…",
  chainId: 1,                     // 1 = Ethereum Mainnet, 11155111 = Sepolia
  rpc: "https://your-rpc.example", // HTTPS URL or any EIP-1193 provider (window.ethereum, viem, ethers …)
  source: "IFRLOCK",              // or "COMMITMENT_TIME_ONLY" | "EITHER"
  // block: "latest" | 23456789n | { number: 23456789n, hash: "0x…" }
  // tiers: a newer tier file, once you decide to switch (default: tier file v1)
});
// → { tier: "SILVER" | null, block: { number, hash }, source, tiersVersion: 1, spec, sources }
```

- **A result is a fact about one block.** At redemption, call `verifyIfrBenefit` again (spec §5). Cache a
  result for at most 60 seconds, and only for the same block.
- **Errors mean no benefit.** Every failure throws an `IfrBenefitVerifyError` with a `code`:
  `WRONG_CHAIN`, `CONTRACT_MISMATCH`, `RPC_UNAVAILABLE`, `BLOCK_MISMATCH`, `INVALID_TIERS`,
  `INVALID_MESSAGE` or `INVALID_INPUT`.
- **IFRLock reveals only the tier.** It is read with `isLocked(wallet, threshold)`, highest threshold
  first, so the locked amount itself is never read.

## Wallet ownership (when the wallet is not connected to your page)

```js
const { buildBenefitMessage, verifyBenefitMessage } = require("ifr-benefits-verify");

const message = buildBenefitMessage({
  domain: "shop.example", address, uri: "https://shop.example/benefit", chainId: 1,
  nonce, issuedAt, expirationTime, purpose: "BENEFIT",
});
// … the holder signs `message` with personal_sign …
const signer = verifyBenefitMessage({
  message, signature,
  expected: { domain: "shop.example", chainId: 1, purpose: "BENEFIT", nonce },
});
```

Your side of the job:

- **Single-use nonce.** Issue the nonce yourself and consume it once.
- **Short lifetime.** The message lifetime is at most 5 minutes.

## Tiers

| Key | IFR |
| --- | --- |
| `BRONZE` | 1,000 |
| `SILVER` | 2,500 |
| `GOLD` | 5,000 |
| `PLATINUM` | 10,000 |

The tiers come from [`tiers.v1.json`](tiers.v1.json) (SHA-256 pinned as `TIER_FILE_SHA256[1]`).

- **Offer benefits per tier key**, not per amount.
- **Threshold changes ship as a new tier file**, with a later `valid_from`.

## Conformance vectors

[`vectors/v1.json`](vectors/v1.json) holds language-neutral cases. Other implementations should reproduce
them:

- tier boundaries;
- TIME_ONLY versus price-conditioned tranches;
- `EITHER` without adding the sources;
- failure cases.

They run twice:

- `npm test` runs them against a simulated node;
- the repository test `test/BenefitsVerify.test.js` runs them against the real `IFRLock` and
  `CommitmentVault` contracts in Hardhat.

Two further checks run against real networks:

- `test/live.test.cjs` reads the deployed contracts on Mainnet and Sepolia at a pinned block, using
  read-only calls.
- `test/fork/BenefitsVerifyFork.test.js` locks, raises and unlocks against the **deployed** `IFRLock` and
  `CommitmentVault` on a Mainnet fork at block `26100144`. It also proves that price-conditioned tranches,
  which the deployed V1 vault still accepts, never count.

The workflow `benefits-verify-live.yml` runs both with the repository RPC secrets, weekly and on change.

## Develop

```sh
npm ci
npm test   # builds dist/ and runs the unit tests and vectors
```

`dist/` is committed so the package can be used straight from the repository. CI checks that it matches
`src/`.

"IFR" and "Inferno" are not licensed as trademarks. Describe your offer as "works with locked IFR".
