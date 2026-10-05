# ifr-benefits-verify

Reference implementation of [`ifr-benefits-verify/1`](../../docs/specs/ifr-benefits-verify-1.md) and
[`ifr-benefits-verify/2`](../../docs/specs/ifr-benefits-verify-2.md). It is a
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
  // spec: "ifr-benefits-verify/2" to also read CommitmentVault V2 (default: "ifr-benefits-verify/1")
});
// → { tier: "SILVER" | null, block: { number, hash }, source, tiersVersion: 1, spec, commitmentVaults, sources }
```

- **`/1` or `/2`.** `/2` reads CommitmentVault V1 **and** V2 and sums their active TIME_ONLY tranches; `/1`
  reads V1 only. `/1` stays the default so existing integrations keep their exact results. Move to `/2`
  explicitly; V2 accepts new time locks since Governance proposal #17 (executed 2026-10-04). For messages, pass
  `expected.specs: ["ifr-benefits-verify/1", "ifr-benefits-verify/2"]` during the transition and evaluate
  with `benefitMessageSpec(parseBenefitMessage(message), specs)`; build `/2` messages with
  `buildBenefitMessage({ …, spec: "ifr-benefits-verify/2" })`.

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

[`vectors/v1.json`](vectors/v1.json) (`/1`) and [`vectors/v2.json`](vectors/v2.json) (`/2`: V1 only, V2 only,
both summed, unlocked and price-conditioned tranches excluded, `EITHER` without adding IFRLock) hold
language-neutral cases. Other implementations should reproduce them:

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
- `test/fork/BenefitsVerifyV2Fork.test.js` makes a real TIME_ONLY lock in the **deployed** CommitmentVault V2
  on a Mainnet fork (fee exemption simulated as after proposal #17) and proves `/2` counts it while `/1`
  does not, and that V2 rejects price-conditioned locks.

The workflow `benefits-verify-live.yml` runs both, weekly and on change.

- **With archive RPC secrets** (`MAINNET_RPC_URL`, `SEPOLIA_RPC_URL`), the fork uses the pinned block.
- **Without them**, it falls back to a public RPC and forks a recent block. Public nodes serve only recent
  state.

## Develop

```sh
npm ci
npm test   # builds dist/ and runs the unit tests and vectors
```

`dist/` is committed so the package can be used straight from the repository. CI checks that it matches
`src/`.

"IFR" and "Inferno" are not licensed as trademarks. Describe your offer as "works with locked IFR".
