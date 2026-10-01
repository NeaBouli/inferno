# IFR open benefits verification — `ifr-benefits-verify/1`

| Field | Value |
|---|---|
| Identifier | `ifr-benefits-verify/1` |
| Status | Published, version 1 |
| Published | 2026-10-01 |
| Licence | MIT (this document, `ifr-benefits-tiers.v1.json` and the reference library `apps/benefits-verify`) |
| Reference library | [`apps/benefits-verify`](../../apps/benefits-verify/README.md) (TypeScript) |
| Tier data | [`ifr-benefits-tiers.v1.json`](ifr-benefits-tiers.v1.json), SHA-256 `aaba67e43e8a2236d2c986a2aed308b8d58e0ebfddd484df3110e490b643d00b` |

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Purpose and scope

Any shop, app or service MAY grant a benefit (discount, access, perk) to holders of locked IFR. It does
this by reading the public IFR contracts. Nobody has to be asked, informed or registered. This
specification defines how such a check is done, so that every integrator gets the same answer for the
same wallet at the same block.

**In scope:**

- the lock sources and how they combine;
- tier thresholds as versioned data;
- the block-pinned read;
- the wallet-ownership message;
- fail-closed behaviour.

**Not in scope, and not provided by the IFR project:**

- an API or hosted verification service;
- a registration or onboarding flow;
- any per-shop setup;
- any promise about IFR price or value.

A benefit is the integrator's own offer.

## 2. Contracts

| Chain | Chain ID | IFR token | IFRLock | CommitmentVault |
|---|---|---|---|---|
| Ethereum Mainnet | `1` | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3` |
| Sepolia (test) | `11155111` | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` | `0x0Cab0A9440643128540222acC6eF5028736675d3` | — |

Rules for the contracts:

- **No other chain.** A verifier MUST reject every chain ID not listed here.
- **Identity checks before trusting a result.** At the pinned block, a verifier MUST check:
  - the node reports the requested chain ID (`eth_chainId`);
  - each contract it reads has code;
  - `IFRLock.token()` equals the IFR token;
  - for the vault source, `CommitmentVault.ifrToken()` equals the IFR token;
  - `decimals()` of the IFR token is `9`.

## 3. Amounts and tiers

1. **Amounts are base units.** IFR has **9 decimals**: `minBaseUnits = minIFR × 10^9`.
2. **Thresholds are positive.** Every threshold MUST be greater than zero. `IFRLock.isLocked(wallet, 0)` is
   always true, so a verifier MUST NOT call it with `0` and MUST reject tier data that contains a zero
   or negative threshold.
3. **Tiers are data.** Tiers come from a versioned tier file (§7). Within a file:
   - tier keys are unique;
   - thresholds strictly increase in the listed order;
   - the evaluated tier is the **highest** tier whose threshold is met (`amount ≥ minBaseUnits`).
4. **No tier.** If no threshold is met, the result is "no tier" (`null`). This is not an error.
5. **Benefits are offered per tier key.** An integrator SHOULD offer benefits per tier key (for example
   "from SILVER"), not per IFR amount. A threshold change in a new tier file then applies without editing
   any offer.

## 4. Lock sources

| Source | Counts |
|---|---|
| `IFRLOCK` | the wallet's lock in IFRLock |
| `COMMITMENT_TIME_ONLY` | the sum of the wallet's CommitmentVault tranches with `cType == 0` (TIME_ONLY) **and** `unlocked == false` **and** `amount > 0` |
| `EITHER` | qualifies for a tier if **either** source alone meets the threshold |

Rules for the sources:

- **No adding.** In `EITHER` mode the two sources are **not added together**. The result is the higher of
  the two per-source tiers.
- **Price-conditioned tranches never count.** These are `TIME_OR_PRICE`, `PRICE_ONLY` and
  `TIME_AND_PRICE`. Whether they are released depends on a price oracle, not on the holder.
- **A due TIME_ONLY tranche still counts until it is unlocked.** That is a TIME_ONLY tranche whose
  `unlockTime` has passed but which is not yet unlocked. This matches IFRLock, which can also be unlocked
  at any time.
- **Use `isLocked` for IFRLock.** A verifier SHOULD evaluate IFRLock with `isLocked(wallet, minBaseUnits)`
  per threshold, highest first. It then learns only the tier, never the locked amount.
- **The vault discloses amounts.** The vault source needs `getTranches(wallet)`, which reveals amounts. A
  verifier MUST NOT store or log them.

The default source is `IFRLOCK`.

## 5. Block pinning and freshness

1. **One block per check.** All reads of one check MUST use the same block number. The verifier MUST
   record that block's number **and** hash. A result is a statement about that block only.
2. **The check is momentary.** IFRLock can be unlocked at any time, all or nothing. A verifier MUST NOT
   treat a past result as current.
   - A benefit that is redeemed later (for example at a till) MUST repeat the check at a block that is at
     least the block of the first check, normally the current head.
   - The benefit is then decided by the second result.
3. **Caching.** A result MAY be cached for at most **60 seconds**, and only for the same block. A cached
   result MUST NOT be reused for a newer block.
4. **Use `latest`.** Integrators SHOULD read at `latest` rather than `finalized`. Freshness matters more
   than finality here, because an unlock must stop the benefit quickly.

## 6. Wallet ownership message (EIP-4361 profile)

When the wallet is not connected to the integrator's own page, the holder proves control of it. They sign
an [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361) message with EIP-191 `personal_sign`. The message
**does not move funds** and costs no gas.

```text
shop.example wants you to sign in with your Ethereum account:
0xA11CE0000000000000000000000000000000BEEF

Show my IFR benefit tier. This signature does not move funds and costs no gas.

URI: https://shop.example/benefit
Version: 1
Chain ID: 1
Nonce: 9f3c6a1e5b7d4c20a8e1f0b2
Issued At: 2026-11-03T08:14:05Z
Expiration Time: 2026-11-03T08:19:05Z
Resources:
- urn:ifr-benefits:spec:ifr-benefits-verify/1
- urn:ifr-benefits:purpose:BENEFIT
```

A verifier MUST check every point:

1. **Domain.** `domain` equals the integrator's public host, and the host of `URI` equals `domain`.
2. **Statement.** The statement contains `This signature does not move funds`.
3. **Version and chain.** `Version` is `1`, and `Chain ID` is the chain the lock is read on.
4. **Nonce.** `Nonce` was issued by the integrator, has at least 96 bits of entropy (at least 24 hex
   characters), and is **single use**. The integrator consumes it atomically when verifying.
5. **Times.**
   - `Expiration Time` is present.
   - It is at most **5 minutes** after `Issued At`, and in the future when verifying.
   - If `Not Before` is present, it has passed.
6. **Resources.** `Resources` contains `urn:ifr-benefits:spec:ifr-benefits-verify/1` and exactly one
   purpose `urn:ifr-benefits:purpose:<PURPOSE>` (upper case, `A-Z0-9_`, expected by the integrator).
   Other resources MAY follow, for example a device binding.
7. **Signer.** The recovered EIP-191 signer equals the address in the message. Contract wallets (EIP-1271)
   MAY be supported. If they are, the check MUST use the same pinned block.

After a valid message, the verifier runs the lock check (§4, §5) for the signing address.

## 7. Tier file

Tier data is published as JSON, one file per version. Version 1 is
[`ifr-benefits-tiers.v1.json`](ifr-benefits-tiers.v1.json):

| Key | Label | IFR | `minBaseUnits` |
|---|---|---|---|
| `BRONZE` | Bronze | 1,000 | `1000000000000` |
| `SILVER` | Silver | 2,500 | `2500000000000` |
| `GOLD` | Gold | 5,000 | `5000000000000` |
| `PLATINUM` | Platinum | 10,000 | `10000000000000` |

Format of the file:

- `schema` (`"ifr-benefits-tiers/1"`), `spec`, `version` (positive integer);
- `valid_from` (ISO 8601, UTC);
- `decimals` (`9`);
- `tiers`: a list of `key`, `label`, `minIFR`, `minBaseUnits`. The amounts are decimal strings, and
  `minBaseUnits` MUST equal `minIFR × 10^9`.

How the file is published and changed:

- **Integrity.** The SHA-256 of each published file is listed in this specification and pinned in the
  reference library. An integrator SHOULD pin the version and hash it uses.
- **Changes create a new file.** A threshold change creates a new file `ifr-benefits-tiers.v<N>.json`
  with a later `valid_from`. It is announced in this specification and in `docs/CHANGELOG.md`.
  Published files are never edited.
- **Versions are explicit.** A verifier MUST NOT switch to a newer file implicitly. It switches when it
  chooses to, at or after `valid_from`.

| Version | Valid from | SHA-256 |
|---|---|---|
| 1 | 2026-10-01T00:00:00Z | `aaba67e43e8a2236d2c986a2aed308b8d58e0ebfddd484df3110e490b643d00b` |

### Relation to other tier tables

- **Older access-tier helpers.** The SDK `ifr-sdk` (`apps/sdk`) and the AI Copilot `/api/ifr/check` still
  expose a separate, older access-tier helper: Basic/Premium/Pro at 500/2,000/10,000 IFR. It is not a
  benefit tier scheme. A later release aligns it with this file (tracked as audit finding CWA-77).
- **Product-specific thresholds.** An integrator MAY still gate a single product feature on any threshold
  greater than zero. Such a threshold is not a tier.

## 8. Fail closed

If any of the following happens, the verifier MUST return **no benefit** and an error, never a tier:

- an RPC error or timeout;
- a chain ID mismatch;
- a failed contract identity check;
- an unknown or inconsistent block;
- invalid tier data;
- an invalid or reused message.

The reference library uses these error codes:

| Code | Meaning |
|---|---|
| `WRONG_CHAIN` | unsupported chain ID, or the node reports another chain |
| `CONTRACT_MISMATCH` | missing code, wrong token link, or wrong decimals |
| `RPC_UNAVAILABLE` | a read failed |
| `BLOCK_MISMATCH` | the block cannot be resolved, or its hash differs from the requested hash |
| `INVALID_TIERS` | the tier data violates §3 or §7 |
| `INVALID_MESSAGE` | the message violates §6 |

## 9. Privacy

- **Store only what is needed.** An integrator SHOULD store no wallet address and no lock amount. A
  keyed hash of the wallet, the tier, and the block number are enough to prevent double use.
- **Prefer the tier.** The IFRLock check by `isLocked` reveals only the tier.

## 10. Reference implementation and test vectors

- **Reference implementation.** [`apps/benefits-verify`](../../apps/benefits-verify/README.md) implements this
  specification. Its test vectors cover the cases below and are part of the specification. A conforming
  implementation MUST produce the same results.
  - tier boundaries;
  - `min = 0` rejection;
  - unlock between two checks;
  - TIME_ONLY versus price-conditioned tranches;
  - `EITHER` without adding;
  - wrong chain ID.
- **Other implementations.** Implementations in other languages are welcome.
- **Name.** "IFR" and "Inferno" are not licensed as trademarks (see the repository README). An integrator
  describes its offer as "works with locked IFR".
