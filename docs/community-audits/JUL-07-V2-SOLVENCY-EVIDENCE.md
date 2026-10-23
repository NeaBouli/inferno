# JUL-07: V2 vault solvency under IFR transfer fees

Evidence date: 2026-10-23. Source revision: `72280741840ef493472d955649b73404a69386fc`.
Scope: local source and precompiled artifacts, without network or fork access.
Tests: [VaultV2.jul07.test.js](../../test/VaultV2.jul07.test.js).

The tested CommitmentVaultV2 and LendingVaultV2 candidates maintain liquid
claim coverage through the exercised fee/exemption transitions. Their entry
policy is **exact receipt or complete revert**, rather than accepting a taxed
deposit and crediting its smaller net amount. Runtime exemption checks reject
new exposure. Existing exits and lending settlements deliberately remain usable
after revocation, so the older requirement to fail closed on *every* affected
flow is not implemented. The two conditional receipt risks below remain visible;
neither is a reproduced liquid-solvency failure in these tests.

## Sources and artifact identity

All three production contracts named `*VaultV2` that hold IFR are covered:

| Contract | SHA-256 of source |
| --- | --- |
| `contracts/vault/CommitmentVaultV2.sol` | `910568a617c0cf592e203c7b9c1252c034c0990b117cd7d0793d6466d3f60674` |
| `contracts/vault/LendingVaultV2.sol` | `f88d0eb6b211a720b91e7c825e2ce167ac2644c1819473b94faa7f5e948c2e41` |
| `contracts/bootstrap/BootstrapVaultV2.sol` | `842104f46bc3c28dd25947a97d3027ac994b9a1340518c6c93446f9bcbdf32d5` |

For each artifact, its `buildInfoId` and `inputSourceName` resolve to compiler
input whose source content matches the current file byte for byte. The same
comparison passed for `InfernoToken.sol` and `MockCommitmentV2Tokens.sol`.
This binds the precompiled test targets to the reviewed sources. It makes no
assertion about deployed bytecode or current chain exemptions. In particular,
the repository candidate named `CommitmentVaultV2` must not be confused with
the historical deployed V2 discussed in the hardening document.

## What the tests establish

| Tests | Evidence |
| --- | --- |
| `J07-C1.350/500/10000` | An existing mock reports exemption while charging 3.5%, 5% or 100%. Lock receipt mismatch reverts balances, allowance, burn/supply, tranche history, wallet/global claims and entry-budget reservations. A subsequent exact receipt creates a claim equal to the measured balance increase. |
| `J07-C2.false/true` | False or reverting exemption metadata rejects both each lock and queued configuration execution. Failed execution preserves the queue and custody state. |
| `J07-C3` | Three users, three rounds and nine permissionless mature exits use real nine-decimal IFR. Revoked exemption blocks a new lock; alternating taxed/exempt exits retire only the gross claim and report the measured net receipt. Independent tranche sums, wallet totals and token coverage are checked after each successful financial operation. A 17-base-unit donation remains unclaimed. Double release fails. |
| `J07-L1` | The same three adversarial fee levels reject createOffer, fundOffer and short outgoing borrow delivery despite a true exemption report. Full ledger/token snapshots prove rollback. Successful funding adds claims equal to the actual balance increase. |
| `J07-L2.false/true` | False or unreadable exemption metadata rejects createOffer, fundOffer, borrow and borrowing resumption. Borrowing stays paused after failed resumption. |
| `J07-L3.*` | Four real-IFR cases cover repayment and liquidation with and without exemption. Underpayment reverts all settlement effects. Successful principal restoration plus lender/protocol interest and payer excess credits equals measured net receipt, including per-component fee rounding. ETH collateral is partitioned without an immediate external payout. Repeated settlement/claims fail. |
| `J07-L4` | Three lenders, three borrowers and a liquidator run six rounds of funding, borrowing, partial withdrawal, alternating taxed/exempt repayment/liquidation and IFR claims, followed by default, full lender withdrawals and ETH claims. The invariant is checked after each financial operation and rejected underpayment. Over-withdrawal cannot consume another lender's pooled cash. Final custody contains only the 19-base-unit donation and zero ETH. |
| `J07-B1` | A real taxed prefunding transfer of nominal `2 * allocation` leaves less than the required actual balance. Bootstrap finalisation reverts without consuming ETH, tokens or the finalisation flag. |
| `J07-B2` | Three bootstrap contributors claim under alternating revoked/restored exemption. Remaining nominal allocations stay covered, but taxed claims receive less than the nominal `Claimed` event amount. Repeated claims fail; only integer allocation dust remains. |
| `J07-V1.*` | Both V1 contracts accept a 1,000 IFR taxed deposit after an exempt 1,000 IFR deposit. Claims become 2,000 IFR against 1,965 IFR held, reproducing the 35 IFR deficit. |

The positive taxed-settlement cases use the actual repository `InfernoToken`,
not a simplified aggregate fee model. Expected net receipts subtract each of
the 200, 50 and 100 basis-point fee components separately using integer floors.
Every IFR amount and claim calculation uses `bigint` base units (`10^9` per IFR).
Only EVM timestamps are converted to JavaScript numbers.

## Invariants and limits of the proof

The tests enumerate individual claims and reconcile them with stored totals:

- Commitment: `sum(unreleased tranche amounts) = sum(wallet locked balances)
  = totalLocked <= token balance`.
- Lending IFR: `sum(offer.available) + sum(ifrCredits) = totalAvailable +
  totalIFRCredits <= token balance`.
- Lending ETH: `sum(active loan collateral) + sum(ethCredits) = totalCollateral +
  totalETHCredits <= vault ETH balance`.
- Bootstrap after finalisation: `sum(unclaimed floor(contribution * allocation
  / totalETHRaised)) <= token balance`.

Lent principal is a borrower receivable, not a second immediately withdrawable
IFR claim. Active loan principal is reconciled to `totalLent`, offer lent
balances and borrower counters, and defaults are recognized as losses rather
than new liquid claims. Comparing `totalAvailable + totalLent` directly with
custodied IFR would incorrectly treat normal borrowing as insolvency.

Successful outgoing transfers are checked against pre-transfer custody and the
actual vault/recipient deltas; they consume the gross entitlement without
subsidizing tax from other claims. Short inflows and repeated settlements do
not create usable claims. Donations never inflate user entitlements.

These are bounded deterministic invariant-style sequences, not an exhaustive
formal proof or a general guarantee for rebasing tokens, confiscation, malicious
token implementations or sender debits exceeding the requested transfer.
The oracle, pair, WETH and bootstrap router are existing local mocks. They
establish vault accounting behavior only, not a production TWAP, real router
compatibility, economic security or deployment readiness. No new mock was needed.

## FINDING JUL07-V2-01 — Medium: exemption revocation still taxes existing users

Classification: conditional user-receipt risk and older-requirement discrepancy;
**explicitly accepted candidate policy**, not a newly discovered accounting defect.

Locations:

- [CommitmentVaultV2.sol:248](../../contracts/vault/CommitmentVaultV2.sol#L248),
  especially the unguarded transfer at line 259.
- [LendingVaultV2.sol:402](../../contracts/vault/LendingVaultV2.sol#L402),
  [claimIFR:533](../../contracts/vault/LendingVaultV2.sol#L533),
  [repay:462](../../contracts/vault/LendingVaultV2.sol#L462) and
  [liquidate:482](../../contracts/vault/LendingVaultV2.sol#L482).

If token governance removes the vault's exemption while the counterparty is
also non-exempt, unlock/withdraw/IFR claims remain callable and the user bears
the transfer tax. For example, a gross 1,000 IFR claim can deliver only 965 IFR
at the repository token's default rates. Repayment/liquidation likewise remain
callable, but a nominal debt-sized taxed transfer fails; the payer must explicitly
authorize a larger gross amount whose measured receipt covers the debt.
`J07-C3`, all `J07-L3` cases and `J07-L4` demonstrate the distinction between
user net receipt and internal solvency. Exit events expose gross and measured
net amounts; lending settlement credits only net excess after full debt coverage.

The blanket all-flow fail-closed language in
[VAULT_FEE_EXEMPT_HARDENING.md](../VAULT_FEE_EXEMPT_HARDENING.md) differs from
the newer ratified [PL-C06 policy](../specs/COMMITMENTVAULT_V2_PRICE_LOCKS_SPEC_IMPLEMENTATION_NOTES.md#owner-ratification-2026-10-18)
and [LV-C07 settlement policy](../specs/LENDINGVAULT_V2_SPEC.md#interest-and-protocol-fee-handling).
Those specifications preserve exits/settlement under revocation and forbid a
treasury gross-up promise. Before any remediation closure, reconcile the older
wording with that policy and retain explicit user tax disclosures. Adding exit
guards would change that policy and can trap mature claims; it is not an
accounting fix authorized by this evidence task.

## FINDING JUL07-V2-02 — Medium: BootstrapVaultV2 has no runtime exemption guard or net claim disclosure

Locations: [BootstrapVaultV2.sol:130](../../contracts/bootstrap/BootstrapVaultV2.sol#L130)
and [BootstrapVaultV2.sol:178](../../contracts/bootstrap/BootstrapVaultV2.sol#L178),
especially the nominal transfer/event at lines 184–187.

BootstrapVaultV2 never queries `feeExempt`. Its actual-balance gate at finalisation
prevents nominal short prefunding from satisfying the allocation requirement,
and IFR's gross-debit fee model preserves the tested remaining claim coverage.
It nevertheless allows claims after revocation, marks each gross allocation fully
claimed, and emits only that nominal allocation even when the recipient receives
less. `J07-B2` reproduces the haircut with real IFR and checks all three users'
remaining claims after each payout. The underlying exemption change requires
token administration; ordinary claimants cannot revoke it.

A separately scoped hardening/design decision should address exemption policy
and gross/net disclosure for this contract. This evidence does not claim that
the mocked bootstrap liquidity path validates real Uniswap execution under tax.

## V1 comparison

| V1 risk | V2 change and remaining boundary |
| --- | --- |
| CommitmentVault credits nominal `amount` after transferFrom ([line 105](../../contracts/vault/CommitmentVault.sol#L105)); a revoked exemption can leave claims larger than custody. | CommitmentVaultV2 checks exemption on entry ([line 218](../../contracts/vault/CommitmentVaultV2.sol#L218)) and verifies the measured receipt ([line 227](../../contracts/vault/CommitmentVaultV2.sol#L227)). Any mismatch rolls back all reservations. V1's entry deficit is closed in the tested candidate paths. |
| LendingVault create/increaseOffer credits nominal deposits ([line 111](../../contracts/vault/LendingVault.sol#L111), [line 137](../../contracts/vault/LendingVault.sol#L137)). | LendingVaultV2 create/fund check exemption and `_receiveExact` ([line 377](../../contracts/vault/LendingVaultV2.sol#L377), [line 389](../../contracts/vault/LendingVaultV2.sol#L389), [line 713](../../contracts/vault/LendingVaultV2.sol#L713)); taxed receipts cannot overcredit lender liquidity. |
| V1 borrow records full principal despite an unchecked net delivery ([line 212](../../contracts/vault/LendingVault.sol#L212)); V1 repay assumes the requested repayment arrived ([line 227](../../contracts/vault/LendingVault.sol#L227)). | V2 borrow requires exact recipient delivery ([line 454](../../contracts/vault/LendingVaultV2.sol#L454)); repayment/liquidation restore principal and credits only after measured receipt covers debt ([line 655](../../contracts/vault/LendingVaultV2.sol#L655)). A short repayment cannot consume another offer's cash. V1 liquidation is an ETH loss settlement, not an IFR repayment path; it is not credited with the same fix. |
| V1 outgoing transfers can reduce recipient net receipt without reporting it. | Commitment/Lending V2 expose gross/net payout amounts and never gross up another user's funds. The conditional tax exposure remains as JUL07-V2-01. Bootstrap V2's prefunded model separately checks actual reserves but retains JUL07-V2-02. |

## Verification

Node: `v22.22.2`. Existing local dependencies and artifacts were used. Environment
was cleared with `env -i`, retaining only `PATH`, `TMPDIR` and the settings shown
below; `.env` loading and mainnet forking were disabled explicitly.

```sh
env -i PATH="$PATH" TMPDIR="$TMPDIR" DOTENV_CONFIG_PATH=/dev/null \
  HARDHAT_FORK=false HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
  ./node_modules/.bin/hardhat test --no-compile test/VaultV2.jul07.test.js

env -i PATH="$PATH" TMPDIR="$TMPDIR" DOTENV_CONFIG_PATH=/dev/null \
  HARDHAT_FORK=false HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
  npm run test:contracts -- --no-compile
```

- Focused evidence suite: **18 passing, 0 failing**.
- Full contract suite: result recorded after completion below.

`--no-compile` uses the supplied precompiled contracts and avoids compiler
downloads; source/artifact matching is recorded above. No production contract,
existing test, remediation register, generated document or deployment was changed.
