# LendingVault V2 implementation notes

**Status:** Release candidate - ready, not activated. Ratified 2026-10-18.
Built and tested locally; not deployed as this release candidate and not externally
audited. Activation requires a Governance vote and Treasury Safe signer approval.
Existing deployed versions and custody remain unchanged.

## Remaining before activation

- Governance proposal for the exact release, wiring and activation scope.
- Treasury Safe signer approval; independently verify owner/guardian identities and thresholds.
- Reviewed constructor arguments, build hashes and the applicable evidence gates below.
- External audit: pending funding, deferred until the token has a stable price and
  funding is available. Disclose this deferral in the proposal; never claim audited.

Follow [V2_ACTIVATION_RUNBOOK.md](../V2_ACTIVATION_RUNBOOK.md). Source readiness is
not activation authorization or evidence of a live deployment.

The vault consumer is a release candidate; **market-priced lending remains
blocked before activation**. The shared cumulative
TWAP adapter described in the specification does not exist in this repository.
`ILendingV2Oracle` defines its ratified boundary; the test adapter fabricates
responses and is explicitly unsuitable for deployment. Adapter implementation,
independent review, fork evidence and economic research remain prerequisites.
Existing `PriceLockVault` is not used as a lending price source: only its existing
pair/factory interfaces are reused.

## Source and test locations

- [LendingVaultV2.sol](../../contracts/vault/LendingVaultV2.sol): new independent vault,
  adapter boundary and immutable WETH/IFR interfaces. Existing production sources
  are unchanged.
- [LendingVaultV2TestHelpers.sol](../../contracts/mocks/LendingVaultV2TestHelpers.sol):
  fabricated oracle, hostile receiver/controller, incompatible WETH and token
  helpers. Reuses `MockFeeOnTransferToken`, `MockReentrantToken` and `MockToken`.
  The suite also reuses `MockTwapPair`, `MockPairFactory` and actual `InfernoToken`.
- [LendingVaultV2.test.js](../../test/LendingVaultV2.test.js): 85 local tests. IDs below
  are literal test-name prefixes; parameterized cases include the field/value.
- [hardhat.config.js](../../hardhat.config.js): optimizer override only for the new
  vault and its test-helper source, solc 0.8.28, Cancun, 200 runs. Existing compiler
  settings and legacy artifact compilation remain unchanged. Unoptimized V2 was
  32,921 runtime bytes; the final optimized candidate is 21,799 bytes (EIP-170: 24,576).
  Do not infer a deployment build or verification record from this local check.

## Requirement traceability

`V2` below means `contracts/vault/LendingVaultV2.sol`; names identify exact
functions, structs or fields. `TEST` means verified on the local simulated chain.
`DEPENDENCY` means specified at the adapter boundary but not implemented or
proved here. `GATE` means future evidence/authorization, not a passing test.

| Specification requirement | Code location / disposition | Test name(s) or missing evidence |
| --- | --- | --- |
| Separate V2; never activate/rewrite V1 or migrate its assets | V2 independent contract; no V1 pointer, migration, sweep or broadcaster | D01; complete changed-file review; future pinned V1-state evidence is a GATE |
| IFR 9 decimals, WETH 18, wei per full IFR, checked integer arithmetic | V2 constructor, `IFR_UNIT`, `_value`, `_interest`; tests use bigint | D02, L01, L03, L04, H06 |
| Canonical manifest factory and exact token/pair identities, either order | V2 immutable assets, `_validateConfiguration`; existing `IUniswapV2FactoryPair` / `IUniswapV2PairTwap` | O04, D02; actual canonical chain manifest is a GATE |
| Direct IFR-to-WETH cumulative direction; no arithmetic inversion | `ILendingV2Oracle` semantic contract: DEPENDENCY | No real adapter test; future both-order cumulative tests required |
| Counterfactual accrual, uint32 timestamp wrap, uint256 cumulative wrap | Shared adapter: DEPENDENCY | No real adapter test; existing price-lock implementation is not accepted as evidence |
| Seven-day completed slow window and endpoints within one hour | V2 `_readOracle`: nonzero ordered endpoints, >=7 days elapsed, start <=7 days+1 hour old, end <=1 hour old | O01, O02 |
| Fresh newest checkpoint, nonfuture timestamps, no >1-hour coverage gap | V2 `_readOracle`, evidence `latestObservation`, `maxGap` | O01, O02 |
| Bounded sufficiently large retained buffer; recording spacing prevents churn; genuine observation age | Adapter: DEPENDENCY; `read` must not refresh age | O02 tests consumer read-age behavior only; buffer/churn/quiet-pair tests remain required |
| All covered checkpoints AND consumption meet both depth floors | Evidence `minWethDepth` and `minIfrDepth` must include every checkpoint AND current depth; V2 `_readOracle` requires >=50 WETH and explicit positive IFR floor | O01, O03; truthful depth aggregation/current reserve reads are a DEPENDENCY |
| Zero reserve, pair failure, missing history or invalid source fails closed | Adapter must set nonzero `reason` or revert; V2 catches `read` failures and validates evidence | O01, O02, L10; actual pair-to-adapter propagation is a DEPENDENCY |
| Completed 30-60-minute fast window and at least 30-minute cadence | V2 `_readOracle`, `fastStart`, `fastEnd`, `fastMaxGap<=1800`; adapter must retain separate endpoints | O01, O02; retention/cadence provenance is a DEPENDENCY |
| Fast/slow deviation <=20%, explicit absolute bounds; no manual/spot fallback | V2 `_readOracle`: exact difference bound relative to slow, config `minPrice/maxPrice`; no price setter | O01, O02, O03, A05 |
| Origination max(slow,fast); health/settlement min(slow,fast) | V2 `_readOracle`, `borrow`, `health`, `liquidate` | O03, L08 |
| Source/window/policy changes versioned and pause new borrowing | V2 immutable `_policies`, `policyId`, `setConfiguration`, `Loan.policyId`, oracleVersion | L14, A03, A07 |
| Full oracle warm-up after history/source/policy invalidation | Adapter must preserve immutable versions and report valid only after full new history; V2 also refuses incomplete windows: DEPENDENCY | O01/O02 reject incomplete evidence; no real re-warm/invalidated-buffer proof |
| Existing loans bind original adapter, policy and beneficiary | V2 `Loan.policyId`, immutable historical `_policies`; settlement never consults current config | L14; L10 proves oracle-independent repayment/default |
| Flash/same-block and sustained manipulation; temporary sample liquidity | Shared adapter and economics: GATE | No swaps/fork economic evidence; O03 only rejects the supplied 17.6M IFR/0.39 ETH depth scenario |
| Attack gain below reviewed cost with 10x margin, otherwise zero | Config `economicCap` is the final reviewed exposure ceiling AFTER this margin; zero by default; `_requireBudgets`, `_checkCaps` | A06, C01 economicCap, C06; no manipulation-cost proof or cross-product gain analysis is claimed |
| Total outstanding <=100,000 IFR AND <=10% lending principal | V2 `_checkCaps`; denominator `totalAvailable+totalLent`, excludes interest/donations | C01 totalCap, C05, C07 |
| Per-loan <=10,000; borrower <=20,000; offer <=25,000 IFR | Config bounded in `_validateConfiguration`; `_checkCaps` | A05, C01, C02, C03, C07 |
| At most two active loans per borrower | V2 `activeLoanCount`, `_checkCaps`, `_close` | C02, I01 |
| Gross rolling 24h <=25,000 IFR; no repayment reset; multiwallet/offer aggregation | V2 `_originations`, `_recordOrigination`, binary-search `rollingOriginations`, `_checkCaps` | C01 dailyCap, C03, C04, C07 |
| Default-ETH exposure <=min(0.5 ETH, 1% validated WETH depth) and economic ceiling | V2 `totalDefaultExposure`, `_checkCaps`, immutable `Loan.defaultETH` | C01 ethCap/economicCap, C06, C07; at >=50 WETH the 1% bound is already >=0.5 ETH |
| Caps initialize zero; increases/reactivation >=48h; decreases do not close loans | Policy 0 zero; both pauses true; `queueAction`, `setConfiguration`, `resume` | D01, A03, A06, A07, C05, L14 |
| Fixed lender rate/term bounds; snapshot accepted loan terms | V2 `Offer`, `createOffer`, `Loan`, `borrow`; no mutable offer-term setter | F01, F02, L01, L07, L14 |
| Full repayment/liquidation only; no refinancing, withdrawal of loan collateral or loss pooling | V2 API, `_paidSettlement`, `_close`, `expire` | L03, L06, L07, L08, I01; no partial/admin seizure entry point exists |
| Borrower max rate, min received, max collateral and deadline | V2 `BorrowRequest`, `borrow`; exact outgoing receipt is additionally required | L02, H04 |
| Per-second ceil interest; no minimum month; frozen at maturity; max rate/term | V2 `_interest` uses full-precision `Math.mulDiv(...,Ceil)`, `_debt`, constants | F02, L01, L03, L04, L05, L16 |
| Debt-inclusive origination collateral, ceil value and initial 30% LTV equality | V2 `_quote`, `_value`, `borrow` | L01, L02 |
| Warning >=40%, liquidation >=50%, include current interest; exact threshold | V2 `health`, `liquidate`; integer comparison to ceil(C*threshold/BPS) is equivalent to cross-product | L08, L09, O03 |
| Fund/increase actual IFR, exact received pilot, no stale reopen flags | V2 `createOffer`, `fundOffer`, `_receiveExact`; independent offer IDs and immutable terms | F01, F02, F03 |
| Lender withdraws available principal only, even in outage | V2 `withdrawOffer`, `_sendIFR`; outstanding principal stays in `lent` | F01, F02, F04, L10, C05 |
| Borrow moves available to lent, checks all caps/oracle/receiver/exemption, delivers exactly A | V2 `borrow`, `_checkCaps`, `_requireFeeExemption`, `_sendIFR` | L01/L02, C01-C07, H04, H05 |
| Repayment nets >=D(t), restores principal, credits full collateral without oracle/beneficiary calls | V2 `repay`, `_paidSettlement`, `_close`, `_creditETH`, `_creditIFR` | L03-L07, L10-L12, H01, H05, H06 |
| Top-up active loan during pause/outage; no debt/rate/default change | V2 `topUpCollateral` | L07, L10, L15, C06 |
| Price liquidation before expiry requires full net IFR debt and valid confirmed price | V2 `liquidate`, `_beforeExpiry`, `_paidSettlement` | L06, L08, L09, L16, O01 |
| Bonus <=5% of debt value, capped at C; ALL surplus goes to borrower | V2 `liquidate`, `_paidSettlement` | L08, L09 |
| Due=start+term, seven-day grace; repay/top-up/valid liquidation remain available | V2 `_debt`, `_beforeExpiry`, `topUpCollateral`, `liquidate` | L05, L10, L15, L16 |
| Exact due+grace excludes repayment/liquidation and permits permissionless expiry | V2 `_beforeExpiry`, `expire` | L06, L15, L16 |
| Default payment E=min(C,ceil(V(Dmax,Pborrow)*1.25)); top-ups cannot increase E | V2 `_quote`, `Loan.defaultETH`; at fixed initial 30% LTV E<=required C | L01, L07, L15, C06 |
| Default writes off principal separately, reduces lent once, no phantom IFR/interest or keeper bounty | V2 `expire`, `_close`, `totalLosses`, `Offer.losses`; credits lender E and borrower C-E | L06, L07, L10, L15, I01 |
| All terminal paths consume loan once and partition collateral exactly | V2 `_activeLoan`, `_close`, `_paidSettlement`, `expire` | L03, L06-L09, L15, I01 |
| Individual authorized-destination ETH credits; failed claim preserves entitlement and settlements | V2 `ethCredits`, `claimETH`, CEI + ReentrancyGuard; revert restores prior credit | H01, H02, H03, L10 |
| Optional WETH route for rejecting ETH recipient; actual WETH receipt checked | V2 `claimETH(asWETH=true)`, `_checkDestination` | H01, H03, L10, I01 |
| IFR interest is pull-claimed; admin cannot redirect credits | V2 `ifrCredits`, `claimIFR`; caller owns debit, caller chooses destination | L03, L04, L11, L12, H05 |
| Lender floor(interest/2), protocol gets remainder; received interest only | V2 `_paidSettlement`; all effects roll back on net shortfall | L03, L04, L08, L11, L12 |
| Nonzero distinct capable fee receiver; snapshot per loan; no loan-admin rights | V2 `_validateConfiguration`, `confirmFeeReceiver`, `Loan.policyId`, `_policies` | A06, L14, L03; handshake proves calling ability, production controller review remains a GATE |
| Revoked exemption blocks deposits/borrow but preserves taxed settlement | V2 `_requireFeeExemption` called only on funding/borrow/resume; `_receiveIFR` measures net | F03, L11, H06 |
| Payer explicitly bounds gross debt transfer; received excess becomes payer credit | V2 `repay/liquidate(grossAmount)`, `_paidSettlement` | L03, L08, L11 |
| Outgoing IFR gross entitlement and net tax disclosed, no treasury gross-up | V2 `_sendIFR`, `OfferWithdrawn`, `Claimed` | F04, L11 |
| False/reverting ERC20 and malicious callbacks atomic; expiry avoids token entirely | V2 SafeERC20, ReentrancyGuard, `expire` | L10, L12, H05; H06 exercises real repository IFR |
| Forced ETH/direct IFR never create principal/credits or relax caps | No payable receive/donation-credit path; accounting tracks only explicit operations | L13, C05 |
| Ownable2Step, nonzero owner, incumbent retains authority, correct acceptance | V2 inheritance, `transferOwnership`; OZ inherited `acceptOwnership` | D01, D02, A01, A02 |
| Explicit ownership cancel/replace, stale/wrong acceptor rejected, renounce disabled | V2 `cancelOwnershipTransfer`, zero nomination rejected; `renounceOwnership` always reverts | A01, A02 |
| Guardian is contract nominee, governed install, candidate acceptance, incumbent retained through cancellation | V2 `queueAction`, `nominateGuardian`, `acceptGuardian`, `cancelGuardianNomination` | A04; semantic two-step controller/code review is a GATE, not proven by code existence |
| Owner/accepted guardian may pause either price action immediately, nothing else | V2 `pause`, access checks and separate pause flags | A01, A04, A07, L10 |
| Only governance resumes after >=48h and readiness checks; incident cannot reuse old queued resume | V2 `resume`, `pauseNonce`, `_consumeAction`, `_readOracle` | A03, A04, A07 |
| Configuration prospective, bounded, delayed, no loan extension/seizure/sweep/upgrade | V2 exact-calldata limited queue; immutable historical `_policies`; no arbitrary executor | A03-A07, L07, L14, C05 |
| Role/config/pause/quote/lifecycle/loss/claim reconciliation events | V2 event declarations and emissions; `LoanCreated` stores accepted quote outcome, offer/loan getters expose terms | A01-A04, F01, F04, L03, L07, L15, L11; queued calldata, ETA and no-expiry marker emitted |
| IFR cash >=available+credits; ETH cash >=collateral+credits; principal/counts/losses reconcile | V2 explicit totals, `_close`, credit functions; test `invariant()` sums all tracked beneficiaries and every offer/loan | I01 and per-case invariant checks, C07, L03-L16, H01-H06 |
| Monitoring, ownership alerts, pause runbook | Operations: GATE, no monitoring service requested/added | No operational evidence |
| Pinned block+hash fork with real swaps, actual exemption governance route, V1 unchanged | Future fork: GATE, no network access/activation authorization | No fork, Sepolia or live-chain attestation claimed |
| Independent security/oracle/economic review and LV-C01-C09 disposition | Review/owner/Council: GATE | This local implementation and self-review close none of these gates |
| Separate production approval, exact-head CI, 48h Safe wiring and post-state evidence | Deployment: GATE; guarded deployment script added; no transactions produced | Not performed or authorized |

## Roles and constraints

| Principal | Capability | Immediate or delayed |
| --- | --- | --- |
| Current owner (future approved governance controller) | Queue/cancel bounded actions, install future policy, nominate guardian, resume, nominate/cancel own successor | Policy/guardian nomination/resume are also protected by the vault's own >=48h queue. Owner transfer/cancellation and guardian-nomination cancellation rely on the controller's timelock. |
| Pending owner | Accept its own nomination | No administration until acceptance |
| Accepted guardian controller | Pause borrowing and/or price liquidation | Immediate; cannot resume/configure/claim someone else's balances |
| Pending guardian | Accept its own nomination | No pause authority until acceptance |
| Fee receiver | Confirm receipt capability and claim its own credits | No admin rights |
| Lender | Create/fund fixed offers; withdraw available principal to its destination; claim own credits | No outstanding-principal or collateral withdrawal |
| Borrower | Accept bounded quote; full repayment; top-up; claim own credits | Repayment only before exact expiry; no extension |
| Any caller | Pay full IFR debt for eligible liquidation; default eligible expired loan | Price liquidation needs its pinned oracle; default needs no external interaction |

All asset-moving production entry points are guarded. Token-interacting flows
apply effects before interactions and revert atomically on short/failed receipt.
The final receipt-dependent excess credit is added after transfer measurement;
no subsequent external interaction occurs. ETH recipients are never called during
settlement. The WETH route is optional per claim, not an alternative price feed.
There are no approvals to routers or discretionary admin recovery powers.

## Ratified interpretations and remaining activation evidence

1. **LV-C01 / LV-C06 — product payoff:** fixed ETH default is intentionally
   non-recourse and can lose the lender IFR exposure. The owner ratified
   the 25% buffer, seven-day grace and no-bounty constants on 18 October 2026.
   Lender disclosure and the economic activation evidence remain required.
2. **LV-C02 / LV-C03 — shared adapter:** `read(version)` must preserve historical
   versions and return valid only after complete version-specific warm-up.
   Coverage/depth fields summarize every relevant checkpoint and current reserves;
   the vault cannot independently reconstruct that history from a summary.
   There is no production implementation, proven buffer, wrap test, flash-swap
   defense, sustained-manipulation bound, continuous-depth proof or independent
   source here. A malicious/incorrect adapter can fabricate evidence. Do not deploy
   the mock or substitute current `PriceLockVault`.
3. **LV-C02 — boundary interpretation:** slow history must be at least seven
   actual days and its start no more than seven days plus one hour old at
   consumption; fast elapsed time is 30-60 minutes. Slow gap <=1h and fast gap
   <=30m are distinct fields. Both prices must independently satisfy absolute
   Council bounds. Deviation uses slow price as denominator and exact floor
   comparison for the 20% limit. These stricter interpretations are ratified;
   adapter evidence remains required.
4. **LV-C04 — economics:** `economicCap` is a final explicitly reviewed ceiling
   after applying the proposed 10x cost margin and accounting for external/shared
   product gains, not an estimate of attack cost. The contract cannot establish
   that research from governance calldata. Keep it zero until a defensible bound
   exists. Its numeric range is 0..0.5 ETH; every other cap also starts zero.
5. **LV-C05 — rate/terms:** offers are independent and immutable; lenders can
   create another offer or refill an empty one without stale flags. Zero interest
   is allowed because the spec supplies only a maximum. No rate/term updates or
   admin adjustable LTV/bonus/grace exist. A changed payoff requires a new design,
   not retroactive mutation. Preserve V1's conservative self-borrow prohibition.
6. **Quote limits:** spec gives a transaction deadline without a maximum horizon;
   this release candidate conservatively limits it to one hour. `minReceived` must be positive;
   the stronger pilot rule still requires exactly principal IFR. `maxCollateral`
   bounds both required collateral and actual msg.value. No overpayment refund is
   invented: accepted extra ETH is loan collateral and all surplus is credited.
7. **LV-C07 — receipts and fee beneficiary:** payer selects one exact gross debit
   per call, bounded by its allowance; no automatic tax gross-up or repeated pull.
   Failed/insufficient net settlement reverts all effects. The beneficiary handshake
   proves ability to originate a vault call, not governance suitability or permanent
   ERC20/ETH receivability. A contract beneficiary must expose a controller path to
   claim, and its controller must satisfy Ownable2Step. Review/test actual code and
   queued calls before activation. Payout destinations are credit-holder authorized.
8. **LV-C08 — owner and guardian principals:** EOAs are used for local owner tests;
   that is not approval for a production EOA admin. Only contract guardians are
   accepted, but inheritance/timelock semantics cannot be proven by code length.
   Production requires reviewed Ownable2Step governance/guardian controllers and
   demonstrated contract acceptance. Existing repository `Governance` does not
   automatically become a compliant new two-step controller. The separately built
   GovernanceV2 controller still requires deployment-specific
   wiring and contract-acceptance rehearsal.
9. **Ownership cancellation conflict:** standards reject zero nominees whereas the
   spec permits zero only to cancel a pending transfer. The release candidate rejects zero in
   `transferOwnership` and provides explicit `cancelOwnershipTransfer`, preserving
   the incumbent. Renunciation is disabled even when temporarily empty.
10. **Timelock lifetime:** spec gives a >=48h delay but no queue expiry. Exact action
    data is public, cancellable and one-use; events explicitly mark no time expiry
    (`expiresAt=0`). Requeueing restarts the delay. Any incident pause/configuration
    changes `pauseNonce` and invalidates old resumptions. Guardian cancellation of
    governance actions is not granted. The owner ratified this no-expiry queue
    behavior; GovernanceV2 proposal expiry is a separate outer-controller rule.
11. **LV-C09 — build and verification:** scoped optimizer overrides keep the
    consumer within EIP-170. Mythril now explicitly includes 22 concrete
    contracts; Slither discovers 26 non-mock Solidity files with six reviewed
    baseline signals. Configuration self-tests do not establish engine-analysis
    success or external audit coverage. No production provenance approval follows.
12. **Future evidence:** all specification fork/economic/continuous-liquidity tests,
    review, pinned real-chain manifest, Sepolia
    full-window rehearsal, deployment/activation permission and operational checks
    remain open. A passing mock consumer test is not a substitute for those results.

## Verification

See the local-only report at `.fleet/reports/lendingvault-v2-20261018.md`
for exact commands, results, sandbox cache workaround, complete-suite outcome and
local evidence for the original implementation. The release preparation also
adds a deployment dry-run and static wiki notices; Benefits runtime is unchanged.

## Owner ratification (2026-10-18)

The owner ratified every conservative interpretation and open-question default
listed above. Activation still requires the applicable evidence gates and a separate
Governance vote plus Treasury Safe signer approval. External audit is deferred
pending funding and a stable token price; no audited claim is made.
