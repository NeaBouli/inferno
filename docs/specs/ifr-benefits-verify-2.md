# IFR open benefits verification — `ifr-benefits-verify/2`

| Field | Value |
| --- | --- |
| Identifier | `ifr-benefits-verify/2` |
| Status | Published, version 2 |
| Published | 2026-10-04 |
| Replaces | nothing; [`ifr-benefits-verify/1`](ifr-benefits-verify-1.md) stays valid |
| Licence | MIT (this document and the reference library `apps/benefits-verify`) |
| Reference library | [`apps/benefits-verify`](../../apps/benefits-verify/README.md) (TypeScript), `spec: "ifr-benefits-verify/2"` |
| Tier data | unchanged: [`ifr-benefits-tiers.v1.json`](ifr-benefits-tiers.v1.json) |

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## Why a version 2

Version 1 names exactly one CommitmentVault per chain (§2 of `/1`) and has no rule for adding
contracts. On Mainnet a second vault exists: **CommitmentVault V2**, which accepts only TIME_ONLY
tranches. New time locks move to V2 once its fee exemption is executed by Governance. A `/1` verifier
never reads V2, so it under-reports such holders (it never over-reports). Version 2 reads both vaults.

## What is identical to version 1

Everything in [`ifr-benefits-verify/1`](ifr-benefits-verify-1.md) applies unchanged, except the
sections replaced below: purpose and scope (§1), amounts and tiers (§3), block pinning and freshness (§5),
the EIP-4361 message profile (§6) except its spec resource, the tier file (§7), fail closed (§8) and
privacy (§9).

## 2. Contracts (replaces `/1` §2)

| Chain | Chain ID | IFR token | IFRLock | CommitmentVaults (in read order) |
| --- | --- | --- | --- | --- |
| Ethereum Mainnet | `1` | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | V1 `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3`, V2 `0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F` |
| Sepolia (test) | `11155111` | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` | `0x0Cab0A9440643128540222acC6eF5028736675d3` | — |

The identity rules of `/1` §2 apply to **every** listed vault: it has code at the pinned block and its
`ifrToken()` equals the IFR token. A failure on any listed vault fails the whole check.

## 4. Lock sources (replaces `/1` §4)

| Source | Counts |
| --- | --- |
| `IFRLOCK` | the wallet's lock in IFRLock |
| `COMMITMENT_TIME_ONLY` | the sum, over **all listed CommitmentVaults**, of the wallet's tranches with `cType == 0` (TIME_ONLY) **and** `unlocked == false` **and** `amount > 0` |
| `EITHER` | qualifies for a tier if **either** source alone meets the threshold |

All rules of `/1` §4 apply, with these clarifications:

- **One source across vaults.** The vaults form one source: their active TIME_ONLY amounts are added.
- **No adding across sources.** In `EITHER` mode the vault sum is **not** added to IFRLock. The result is
  the higher of the two per-source tiers.
- **Price-conditioned tranches never count**, in any vault. V1 accepts them on direct calls and V2 rejects
  them (`price conditions disabled`), so the exclusion matters only for V1, but it is applied everywhere.
- **Amounts are the recorded tranche amounts.** V2 is fee-exempt once Governance proposal #17 is executed,
  so the recorded amount equals the amount the vault received.

## 6. Message resource (amends `/1` §6)

The message is the `/1` profile with one change: `Resources` contains
`urn:ifr-benefits:spec:ifr-benefits-verify/2` instead of the `/1` resource. `Version` stays `1` (the
EIP-4361 version). A verifier MUST evaluate a message with a spec version the message names and the
integrator accepts.

## Transition

- **Both versions stay valid.** A `/1` result reads V1 only and is never higher than the `/2` result for
  the same wallet and block.
- **Integrators SHOULD move to `/2`** once V2 accepts new time locks (after Governance proposal #17).
  During the move an integrator MAY accept `/1` and `/2` messages and evaluate each with the version it
  names (reference library: `expected.specs` and `benefitMessageSpec`).
- **No silent switch.** The reference library keeps `/1` as its default. A verifier changes to `/2`
  explicitly, like a tier file change (`/1` §7).

## 10. Test vectors (amends `/1` §10)

[`apps/benefits-verify/vectors/v2.json`](../../apps/benefits-verify/vectors/v2.json) is part of this
specification. It covers:

- V1 only;
- V2 only;
- V1 and V2 summed;
- unlocked tranches excluded;
- price-conditioned tranches excluded;
- `EITHER` without adding IFRLock;
- the `/1` result for the same state;
- fail-closed cases for a codeless V2, a wrong V2 token link and a failed V2 read.

A conforming `/2` implementation MUST produce the same results. The `/1` vectors stay valid for `/1`.
