# IFR Protocol (Inferno / IFR) — Security Audit Report

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** 2026-09-14 (evidence gathered 2026-09-13 21:29–22:30 UTC)
**Scope baseline:** repo `NeaBouli/inferno` @ commit `eb538a355001b042b343bfb19221af2407a96e63` · Ethereum mainnet block `25971217` (`0x18c4a11`, pinned 2026-09-13T21:29:57Z via two independent RPCs) · web surfaces as of 2026-09-13
**Report version:** 1.0

---

## 1. Executive Summary

IFR Protocol is a deflationary ERC-20 ecosystem with 14 deployed mainnet contracts, a static
website + wiki (36 pages), a wallet dApp, a Next.js shop PWA, and three backend APIs. This audit
performed a full manual review of all 14 deployed contract sources at the pinned commit,
reproduced the complete test suite (644 contract + 30 builder + 36 SDK tests, all passing),
verified the security-relevant on-chain state at block 25971217 with direct RPC reads, and
checked the web/API surface read-only.

The codebase is in good shape: modern Solidity (0.8.20, OpenZeppelin v5), consistent Checks-
Effects-Interactions or guarded patterns, no delegatecall/selfdestruct/assembly anywhere, bounded
parameters nearly everywhere, strong CI hygiene (SHA-pinned actions, minimal workflow
permissions, green Slither/Mythril/gitleaks gates), and a mature known-issues culture whose
register we verified item by item. No Critical issues were found.

The single most important finding is **dormant**: LendingVault's entire collateral math depends
on one governance-set price (`ifrPriceWei`). It is currently `0` (borrowing fail-closed —
verified on-chain), but any future activation without a bounded/TWAP oracle would allow a single
timelocked proposal to drain all 52.16M IFR held in the vault with dust collateral. Activation
must be gated on the remediation in CWA-01.

The single most important *new* finding is that the documented fee flywheel is broken in
practice: 371,543 IFR of pool fees are permanently stranded in FeeRouterV1, which has no token
withdrawal function (CWA-02). The strongest operational strengths: the 3-of-5 Safe ownership of
governance (verified on-chain for all three Safes), the genuinely irreversible LP lock inside
BootstrapVaultV3 (verified: vault holds all LP except the 1000-wei minimum, no withdrawal
function exists), and the reproducible test/CI evidence.

**Bottom line:** shippable in its current fail-closed configuration, subject to the Medium
findings. Do **not** activate lending or price-conditioned commitments before CWA-01/CWA-03
remediations. Fix the documentation drift (§6) — several public claims no longer match chain
state in both directions (overstatements *and* unreported improvements).

**Verdict overview:**

| Area | Result | Findings |
|---|---|---|
| Smart contracts (14 mainnet) | PASS w/ findings | C:0 H:1* M:3 L:6 I:2 (*H dormant) |
| On-chain state & roles | PASS w/ findings | M:2 L:1 |
| Web surfaces (apex, web3, shop, wiki) | PASS w/ findings | L:1 I:2 |
| APIs (copilot, points, verify, shop) | PASS w/ findings | M:3 L:3 |
| Repository & supply chain | PASS w/ findings | M:1 I:2 |
| Documentation & claims consistency | WARN | I: cluster (11 entries) |
| Governance & centralization | PASS w/ findings | covered above |

Totals: **0 Critical · 1 High (dormant) · 7 Medium · 12 Low · Informational cluster**

## 2. Scope and Methodology

**In scope:**
- All 14 deployed mainnet contracts (full manual source review at `eb538a35`): InfernoToken,
  Governance, IFRLock, Vesting, LiquidityReserve, BuybackVault, BurnReserve, PartnerVault,
  FeeRouterV1, BootstrapVaultV3, BuilderRegistry, CommitmentVault, LendingVault,
  BuybackController — plus the Uniswap V2 LP pair and 3 Gnosis Safes (on-chain state).
- On-chain state at block 25971217: ~80 `cast call` reads (roles, parameters, feeExempt map,
  balances, Safe thresholds/owners, proposals #15/#16, C2 tranches, LP custody).
- Repo hygiene: branch protection, 16 CI workflows (pinning, permissions, run history), secret
  sweep, `npm audit`, full local test run.
- Web surfaces: header matrix on 6 hosts, address-integrity extraction from
  homepage/`/web3/`(apex+subdomain)/`builder.html`, XSS-sink inspection, SRI check.
- APIs: copilot-api (full `server/index.ts` review, 1,966 lines), points-backend (auth, voucher,
  rate-limit, lockProof, voucher-signer), live GET endpoint re-checks.
- Claims register verification (§6).

**Out of scope:** Sepolia deployments beyond spot-checks; `patches/` historical archive (299
diffs); `apps/` sub-apps other than the three named backends (dashboard, governance-dashboard,
creator-gateway, telegram bot, SDK, wallet prototype — CI-green at HEAD but not manually
reviewed); benefits-network route-level business logic (middleware/config level only); private
infrastructure (Hetzner hosts, Railway project, Telegram bot runtime); third-party services
(Uniswap, Etherscan, GitHub Pages).

**Methods:** manual line-by-line source review at the pinned commit; read-only on-chain calls
(`cast 1.7.1`, drpc/publicnode, block-pinned); local reproduction of the full test suite
(`npm ci` + `npm run test:contracts:all`, exit 0); public GET/HEAD observation of live surfaces;
GitHub API metadata inspection; documentation cross-consistency analysis.

**Limitations:** Slither/Mythril were **not re-run locally** (toolchain not installed); their
evidence is CI-attested (green runs at/around the pinned commit — see §9) plus baseline file
review. Etherscan verification was spot-checked on InfernoToken only (verified source:
v0.8.20+commit.a1b79de6, paris, no optimization); the remaining "16/16 verified" claim rests on
project docs + CI. No active probing, no authenticated API tests, no transactions, no POSTs to
live services. The Gitleaks scan is CI-attested (green at HEAD) plus a local pattern sweep
(gitleaks binary not installed locally).

## 3. System Overview

IFR is a 1,000,000,000-supply ERC-20 (9 decimals) with fee-on-transfer: 2.0% sender burn + 0.5%
recipient burn + 1.0% pool fee, hard-capped at 5% total. All protocol parameters are owned by a
custom `Governance` timelock (48h delay, verified on-chain), whose owner is the Treasury Gnosis
Safe (3-of-5, verified). Safes are the only proxy-capable components; all 14 protocol contracts
are immutable, non-upgradeable, no-proxy.

Access/gating: `IFRLock` (simple accumulating lock; unlock always available, even when paused —
source-verified), `CommitmentVault` (4 condition types; price paths currently fail-closed),
`Vesting` (team 150M, cliff ends ~2027-03-05). Liquidity: `LiquidityReserve` (200M, 180d lock
ended 2026-09-01, 50M/90d staged withdrawals — live but unused), `BootstrapVaultV3` (finalized;
LP permanently held by the vault itself). Ecosystem: `PartnerVault` (40M, bounded rewards),
`FeeRouterV1` (0.05% ETH swap fee, EIP-712 vouchers), `BuilderRegistry` (0 builders),
`BuybackVault`/`BuybackController` (ETH→IFR buyback; both currently unfunded, 0 ETH at
baseline). Web: GitHub Pages apex + 36-page wiki, nginx-hosted `web3` dApp, Next.js `shop`,
Express APIs (`copilot-api`, `points-api`, `verify-api`).

**Roles at block 25971217 (all chain-verified):**

| Role | Holder | Powers | Delay/Threshold |
|---|---|---|---|
| Governance owner | Treasury Safe `0x5ad6…cE3b` | propose/execute/cancel timelock | 3-of-5 |
| Governance guardian | Deployer EOA `0x6b36…ed67` | cancel proposals only | none (EOA) |
| Timelock delay | — | 172,800 s (48h) | MIN 1h / MAX 30d (onlySelf) |
| All contract owners/admins | Governance `0xc43d…D041` | parameters, feeExempt, price, adapters | 48h timelock |
| Contract guardians (IFRLock, Vesting, LiquidityReserve, PartnerVault, BurnReserve, BuybackVault+Controller) | Deployer EOA `0x6b36…ed67` | pause only (burn also for BurnReserve) | none (EOA) |
| FeeRouter voucherSigner | `0x17F8…2d4` (= Safe owner M.G.) | sign EIP-712 discount vouchers | hot key |
| Vesting beneficiary | `0x04FA…6239` (immutable) | claim vested team tokens | none |

## 4. Findings

### Critical

None.

### High

#### [CWA-01] LendingVault activation risk: single governance-set price controls all collateral math
- **Severity:** High (dormant) · **Likelihood:** — (currently impossible; activates on price set) · **Status:** Accepted risk — verified fail-closed
- **Component:** `LendingVault.sol` (`0x9743…EB9DF`) — `setIFRPrice()`, `getRequiredCollateral()`, `getCollateralRatio()`
- **Cross-refs:** OPS-001; extends OKComputer "manual-oracle risk"
- **Description:** `ifrPriceWei` is set by a plain `onlyOwner` call with no bounds, no freshness,
  no oracle. Every borrow and every liquidation derives from this single number.
  **Verified closed:** `ifrPriceWei() = 0` at block 25971217, and `getRequiredCollateral`
  reverts `"price not set"` while zero — borrowing is impossible today.
- **Impact / exploit path (post-activation):** after any executed proposal
  `setIFRPrice(X)`:
  1. If X is set far below market: `requiredCollateral = amount * X * 200 / 1e11` collapses —
     borrowing the entire `totalAvailable` (**52,155,440.95 IFR**, verified) costs dust ETH
     (at X = 1 wei: ≈ 1,043 wei of collateral). One transaction drains the vault.
  2. If X is set far above market: every existing loan's collateral ratio collapses →
     permissionless `liquidate()` hands all borrower collateral to liquidator (5%) and lender.
  Mitigations today: 48h timelock (public visibility), guardian cancel, the 4-hour CI invariant
  monitor. None of these *prevent* execution — they only allow reaction.
- **Evidence:** source `LendingVault.sol:350-355,358-367,395-399` @ `eb538a35`; chain reads
  block 25971217 (`ifrPriceWei() = 0`, `totalAvailable() = 52,155,440.952845656e9`).
- **Recommendation:** before any activation: (a) bound `setIFRPrice` to a sanity band or replace
  with a Uniswap TWAP read (the repo already documents this as Phase-2 requirement); (b) add a
  per-tx borrow cap and per-price-change rate limit (e.g. max ±20% per update, min 24h between
  updates); (c) set `protocolFeeReceiver` (CWA-08) and document the activation checklist as a
  governance-gated runbook. Until then, keep `ifrPriceWei = 0`.

### Medium

#### [CWA-02] 371,543 IFR of pool fees permanently stranded in FeeRouterV1 — documented flywheel cannot happen
- **Severity:** Medium · **Likelihood:** certain (already the case) · **Status:** Open — new finding
- **Component:** `FeeRouterV1.sol` (`0x4807…667C7`), token `poolFeeReceiver`
- **Description:** InfernoToken routes the 1% pool fee (in IFR) to `poolFeeReceiver`, which is
  FeeRouterV1 (Proposal #6). FeeRouterV1 has **no token withdrawal/sweep/rescue function** (full
  source reviewed; grep for `withdraw|sweep|rescue|recover` finds only ECDSA `recovered`
  variables). Its only outward value flow is ETH (`feeCollector.call{value:}`). IFR tokens
  therefore accumulate with no extraction path — not even governance can move them.
- **Impact:** **371,543.991017522 IFR** (≈ 0.037% of supply) are unrecoverable at the baseline,
  and every future non-exempt transfer grows the sink. Worse, the docs describe a live flywheel:
  FEE_DESIGN.md claims pool fees "flow directly into the 50/50 buyback+burn / LP-deepening
  flywheel"; transparency.html states "all pool fees route correctly to FeeRouterV1 →
  BuybackVault + BurnReserve"; press-kit repeats it. That flow does not exist for the IFR-denominated
  pool fee — only for ETH swap fees.
- **Evidence:** chain reads block 25971217 (`poolFeeReceiver() = 0x4807…667C7`,
  `balanceOf(FeeRouterV1) = 371,543.991…e9`); source `FeeRouterV1.sol` (full read);
  `docs/FEE_DESIGN.md:63`, `docs/wiki/transparency.html:1365`, `docs/wiki/press-kit.html:709`.
- **Recommendation:** either (a) accept and document FeeRouterV1 as a permanent IFR sink
  (economically a slow burn — but it does *not* reduce `totalSupply`), correcting the three doc
  locations; or (b) route `poolFeeReceiver` to a contract with a governed sweep (e.g.
  BuybackController, which has `withdrawIFR`), via timelock proposal. Never deploy a
  value-holding contract without an extraction path.

#### [CWA-03] CommitmentVault: price-conditioned tranches lock funds permanently — docs understate as "fail-closed"
- **Severity:** Medium · **Likelihood:** medium (permissionless, reachable via raw contract or any
  UI exposing the type) · **Status:** Open — extends OPS-002
- **Component:** `CommitmentVault.sol` (`0x0719…73d3`) — `_getCurrentPrice()`, `isConditionMet()`
- **Description:** `_getCurrentPrice()` is a stub that **always returns 0** (the TWAP call is
  commented out), and `isConditionMet` additionally requires `priceOracle != 0`. Setting the
  oracle later via `setPriceOracle` changes nothing — price can never be "met". For
  `PRICE_ONLY` and `TIME_AND_PRICE` tranches this means **no unlock path exists at all**:
  owner-unlock requires the condition, and the 30-day permissionless auto-unlock also requires
  the condition. There is no admin rescue. On-chain, C2's 10 tranches are all `TIME_ONLY`
  (verified tranche 0: `cType=0`, `unlockTime=1785283200` = 2026-07-29 ✓), so no funds are
  currently affected — but any user can `lock()` a price-conditioned tranche today.
- **Impact:** irreversible loss of the locked amount for the user; reputational damage framed as
  "the contract ate my tokens". Current exposure: 47,952,476.87 IFR total locked (all
  time-conditioned, safe).
- **Evidence:** source `CommitmentVault.sol:124-142,164-186,238-243` @ `eb538a35`; chain reads
  block 25971217 (`priceOracle() = 0x0`, `p0() = 300,000,000`, C2 tranche probe).
- **Recommendation:** until a real oracle ships, revert on lock attempts with `cType !=
  TIME_ONLY` (one-line guard), or add an owner-governed rescue for price-tranches after a long
  grace period. Update wiki wording from "fail-closed" to "price locks are currently unavailable;
  do not create them — funds cannot be recovered."

#### [CWA-04] points-backend: SIWE verification lacks domain binding (cross-domain replay)
- **Severity:** Medium · **Likelihood:** medium (requires victim to sign on a malicious site) · **Status:** Open — new finding
- **Component:** `apps/points-backend/src/routes/auth.ts:38`
- **Description:** `siweMessage.verify({ signature })` is called **without** `{ domain, nonce }`
  expectations. The code separately checks the nonce against its own store (good), but never
  verifies that the signed message's `domain` is `points-api.ifrunit.tech` (or the intended
  origin). A phishing page can request a nonce from the public `/auth/siwe/nonce` endpoint, ask
  the victim to "Sign in with Ethereum" on the attacker's domain, and replay the signature to
  `/auth/siwe/verify` to obtain a 24h JWT for the victim's wallet.
- **Impact:** impersonation within the points/voucher system under the victim's wallet: posting
  points events, and — if the victim also satisfies the lock proof (CWA-05 caveats) — claiming
  the daily voucher. No on-chain fund movement is possible with the JWT alone, which caps the
  severity.
- **Evidence:** `auth.ts:37-51` @ `eb538a35` (no domain check); JWT issuance
  `middleware/auth.ts:14-20` (HS256, 24h — matches docs).
- **Recommendation:** pass `{ domain: <expected>, nonce: <from store> }` into
  `siweMessage.verify()` and reject mismatches; also bind `uri`/origin if multiple frontends are
  intended. This is the standard SIWE hardening step and costs two lines.

#### [CWA-05] points-backend lock proof defaults to Sepolia IFRLock — mainnet gating depends on unset env vars
- **Severity:** Medium · **Likelihood:** unknown (production env not observable read-only) · **Status:** Open — config-dependent
- **Component:** `apps/points-backend/src/middleware/lockProof.ts:5-6`
- **Description:** `RPC_URL` defaults to `https://rpc.sepolia.org` and `IFR_LOCK_ADDRESS`
  defaults to the **Sepolia** IFRLock (`0x0Cab…75d3`). If the production deployment of
  points-api does not explicitly override both, the voucher-issuing lock proof checks testnet
  locks — and Sepolia IFR is free, so the "min 1,000 IFR locked" Sybil barrier collapses.
- **Impact:** bypass of the voucher lock requirement → unlimited-fee-discount eligibility
  (bounded per-wallet/day and by the global daily cap) without real mainnet commitment. No
  direct fund risk; the 15-bps voucher discount is economically small. The positive parts:
  `SKIP_LOCK_PROOF` is correctly disabled in production, RPC failure fails closed (503), and
  results are cached 5 min.
- **Evidence:** `lockProof.ts:5-13,23-66` @ `eb538a35`; mainnet IFRLock is
  `0x7699…54Eb` (chain-verified).
- **Recommendation:** production-throw on missing `IFR_LOCK_ADDRESS`/mainnet RPC (same pattern
  already used for `JWT_SECRET` in `auth.ts:5`), and add a startup log line asserting chainId=1.

#### [CWA-06] Voucher signer key doubles as Gnosis Safe owner key (hot-key/multisig overlap)
- **Severity:** Medium · **Likelihood:** low–medium (requires server/key compromise) · **Status:** Open — verified on-chain overlap
- **Component:** FeeRouterV1 `voucherSigner` vs. Safe owner sets
- **Description:** chain reads show `FeeRouterV1.voucherSigner() = 0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4`
  — the **same address** is an owner of all three 3-of-5 Safes (getOwners() verified on all
  three). The voucher signing key must be available to the points-backend at runtime
  (`VOUCHER_SIGNER_PRIVATE_KEY` env, `voucher-signer.ts:35-39`). If that env holds the key for
  `0x17F8…2d4`, a single backend compromise yields one of the three keys needed to move the
  protocol Safes (400.6M IFR in LP Reserve Safe alone) — and erodes the multisig's
  independence assumption (one person/key, two security domains).
- **Evidence:** chain reads block 25971217 (`voucherSigner()`, `getOwners()` ×3);
  `apps/points-backend/src/services/voucher-signer.ts` @ `eb538a35`; the project transparency
  page itself labels `0x17F8…` as both "Signer M.G." and "Voucher Signer".
- **Recommendation:** rotate `voucherSigner` to a dedicated hot key that owns nothing else
  (`setVoucherSigner` via timelock), and state publicly that no Safe owner key is ever stored on
  a server. If the deployed key is already distinct from the Safe key (i.e. the on-chain
  voucherSigner address is operated differently than assumed), document the key-management
  separation in OFFCHAIN_SECURITY.md.

#### [CWA-07] Branch protection on `main` does not require the CI gates the project advertises
- **Severity:** Medium · **Likelihood:** n/a (process gap) · **Status:** Open
- **Component:** GitHub repo settings (`gh api repos/NeaBouli/inferno/branches/main/protection`)
- **Description:** protection requires 1 approving review + linear history and blocks
  force-pushes, but **`required_status_checks` is null and `enforce_admins` is false**. Every
  gate the security story leans on — Slither baseline, Mythril, contract tests, gitleaks,
  dependency audit — can be bypassed by an admin pushing straight to main or merging a red PR.
  The gates run and are green (verified), but they are advisory, not enforced.
- **Impact:** one compromised or careless admin action silently lands un-gated code on main, and
  the public "0 unreviewed High / CI-gated" claims would no longer hold for that code.
- **Evidence:** API response captured in `evidence/repo-ci.txt` (2026-09-13).
- **Recommendation:** require the `contracts.yml`, `security-audit.yml` (and ideally
  `mythril-analysis.yml`) checks on main, and enable `enforce_admins`.

### Low

#### [CWA-08] LendingVault: pre-activation configuration gaps (protocolFeeReceiver unset; 2300-gas collateral returns; no loan-expiry enforcement)
- **Severity:** Low (dormant) · **Likelihood:** — · **Status:** Open
- **Component:** `LendingVault.sol` (`repay()` :245-247, :255; `liquidate()` :297-299; no expiry path)
- **Description:** (a) `protocolFeeReceiver() = 0x0` at baseline — once loans repay with the
  receiver unset, the protocol's 50% interest share accumulates inside the vault with **no sweep
  function** (same anti-pattern class as CWA-02). (b) Collateral returns use
  `payable(x).transfer()` (2300 gas): a borrower whose address is a contract with a
  gas-hungry/reverting `receive()` can never `repay()` (collateral frozen), and a *lender* with
  such an address makes its loans **un-liquidatable** (`liquidate()` reverts on the lender
  transfer). (c) Loans past `duration` accrue at the same rate with no default/liquidation
  trigger — expiry is not enforced.
- **Recommendation:** (a) set `protocolFeeReceiver` in the same activation proposal as the price
  (or add a governed sweep); (b) replace `.transfer` with `.call` + reentrancy guard (already
  present) or pull-payments; (c) decide and document the intended overdue-loan path before
  activation (e.g. liquidatable after `startTime + duration + grace` regardless of ratio).

#### [CWA-09] Guardian powers concentrated in a single EOA across all contracts
- **Severity:** Low · **Likelihood:** low · **Status:** Acknowledged by project (Guardian-multisig
  migration listed as Pending in mainnet-checklist) — verified still EOA everywhere
- **Component:** Governance `guardian`, IFRLock/Vesting/LiquidityReserve/PartnerVault/
  BurnReserve/BuybackVault/BuybackController guardians — all `0x6b36…ed67` (block 25971217)
- **Description:** the Deployer EOA can cancel any timelock proposal and pause new locks,
  vesting releases, reserve withdrawals, partner claims and buybacks. It cannot move funds, but
  a compromised key = indefinite protocol-wide griefing. Additionally `Governance.setGuardian()`
  is `onlyOwner` but **not routed through the timelock** (W15, confirmed at
  `Governance.sol:120-125`) — the 3-of-5 Safe can swap the guardian instantly; symmetric, but
  worth a line in the trust model.
- **Recommendation:** complete the planned guardian-multisig migration; meanwhile publish the
  guardian key-storage policy. Timelock the guardian change or document why instant rotation is
  deliberate (rapid response cuts both ways).

#### [CWA-10] web3.ifrunit.tech serves the wallet dApp with no hardening headers
- **Severity:** Low · **Likelihood:** low · **Status:** Open (re-verified this run)
- **Component:** `web3.ifrunit.tech` (nginx) — and, immutably, GitHub Pages apex
- **Description:** no CSP, no frame protection, no HSTS, no nosniff on the host that embeds the
  wallet-connect and lock/unlock UI (re-checked 2026-09-13: only `cache-control: no-store`).
  The shop subdomain shows the project can do this well (full CSP, XFO DENY, HSTS 2y,
  Referrer/Permissions-Policy). Clickjacking the dApp is mitigated by wallet-native confirmation
  dialogs but remains a real phishing-adjacent risk. GitHub Pages cannot set custom headers —
  the nginx host can.
- **Recommendation:** ship the shop's header set on web3.ifrunit.tech (nginx config), at minimum
  `frame-ancestors 'none'` + HSTS + nosniff; consider a long-term note that the apex surface is
  header-limited by the Pages platform.

#### [CWA-11] copilot-api `/api/health` discloses backend configuration
- **Severity:** Low · **Likelihood:** n/a · **Status:** Open (observed live)
- **Component:** `apps/ai-copilot/server/index.ts:546-553`
- **Description:** the public health endpoint reveals `apiKeySet:true`, `etherscanKeySet:true`
  and a deploy version string. Useful to an attacker mapping backend capabilities; zero direct
  impact. Also observed: `/api/ifr/price` returning 502 at audit time (upstream RPC/Etherscan
  failure mode — correctly errors rather than serving stale data; the frontend honestly displays
  "pool data could not be verified" — good fail-closed behavior).
- **Recommendation:** reduce `/api/health` to `{"status":"ok"}` publicly; keep key-state
  diagnostics on an internal/flagged endpoint.

#### [CWA-12] copilot-api: LLM cost guard is warn-only; per-IP limits don't bound aggregate spend
- **Severity:** Low · **Likelihood:** medium under targeted abuse · **Status:** Open
- **Component:** `apps/ai-copilot/server/index.ts:62-78` + rate limiter :23-60
- **Description:** 5 msg/min + 20 msg/hour per IP, in-memory; the $1/day "cost warning" only
  logs. A distributed abuser (many IPs) can drive Anthropic spend without hitting any per-IP
  limit. In-memory buckets also reset on every deploy/restart.
- **Recommendation:** add a hard global daily cutoff (429 once the budget is spent), and/or a
  global concurrent-request cap; keep per-IP limits as-is.

#### [CWA-13] `/api/bootstrap/vote` accepts votes for any contributor wallet without a signature
- **Severity:** Low · **Likelihood:** — (bootstrap concluded) · **Status:** Open (live code path)
- **Component:** `apps/ai-copilot/server/index.ts:1202-1226`
- **Description:** the endpoint checks the wallet's on-chain bootstrap contribution (good) but
  requires no proof of key control — anyone can cast/flip a vote *as* any contributor. The poll
  is historical (vault finalized, verified), so impact is nil today; the pattern is live code
  and could be copied into a future vote where it would matter.
- **Recommendation:** require an EIP-191 signature over the vote, or retire the endpoint.

#### [CWA-14] points-backend: voucher issuance doesn't redeem points; `/voucher/validate/:nonce` exposes the voucher's wallet
- **Severity:** Low · **Likelihood:** low · **Status:** Open
- **Component:** `apps/points-backend/src/routes/voucher.ts:23,83-116`
- **Description:** (a) the 100-point threshold is a gate, not a payment — points are never
  decremented, so 100 points = one voucher per day forever (bounded by the daily per-wallet and
  global caps; possibly intended — docs read like redemption). (b) The public validate endpoint
  returns the owning wallet address for any known nonce; nonces are 256-bit random so this is
  not enumerable, but a leaked nonce (e.g. from mempool/tx data when used on-chain) deanonymizes
  the linkage.
- **Recommendation:** confirm intended economics (gate vs. redeem) and document; omit the wallet
  from the public validate response (or hash it).

#### [CWA-15] LiquidityReserve: withdrawal cap is governance-mutable, not an invariant
- **Severity:** Low · **Likelihood:** low · **Status:** Open
- **Component:** `LiquidityReserve.sol:125-129`
- **Description:** the publicly communicated "50M IFR per 90 days" safety cap is a `onlyOwner`
  setter away from any value (via 48h timelock). Verified current state: `maxWithdrawPerPeriod =
  50M`, `totalWithdrawn = 0`, lock ended 2026-09-01 (`lockEnd = 1788222659`). The timelock makes
  changes visible; just don't present the cap as hardcoded.
- **Recommendation:** docs should say "cap changeable via 48h governance"; optionally emit an
  off-chain alert hook on `MaxWithdrawPerPeriodUpdated`.

#### [CWA-16] Single-step `transferOwnership` across reserve contracts
- **Severity:** Low · **Likelihood:** low · **Status:** Open
- **Component:** `LiquidityReserve.sol:155-160`, `BurnReserve.sol:96-101`,
  `BuybackVault.sol:165-172`, `BuybackController.sol:249-254`
- **Description:** one transaction to a mistyped address bricks the contract's administration
  (owner=0 checks exist, but no two-step accept). Current owner is Governance, so a transfer
  itself requires the timelock — residual risk is a bad `data` payload, which the 48h window and
  guardian cancel mitigate.
- **Recommendation:** adopt OZ `Ownable2Step` in any future contract version.

#### [CWA-17] LP Reserve Safe is not feeExempt — LP operations from it pay ~3.5%
- **Severity:** Low · **Likelihood:** certain when used · **Status:** Open — verified on-chain
- **Component:** token `feeExempt` map vs. LP Reserve Safe `0x5D93…C04` (holds 400.6M IFR)
- **Description:** `feeExempt[LPReserveSafe] = false` (block 25971217) while the other two Safes
  are exempt. Any LP-deepening transfer from this Safe pays the full transfer fee (50M ⇒ ~1.75M
  IFR burned+fees). This may be deliberate (deflationary on ops moves) — it is not documented
  either way, and the fee-exempt table in the wiki predates these entries.
- **Recommendation:** decide deliberately; if exempted, note that the Safe then also skips the
  *burn*, changing the deflation accounting for large moves.

#### [CWA-18] FeeRouterV1: zero-address setters can burn user fees; voucher `maxUses` is dead code
- **Severity:** Low · **Likelihood:** low (requires governance error) · **Status:** Known (W10,
  W19) — source-verified
- **Component:** `FeeRouterV1.sol:208-223` (no zero checks on `setVoucherSigner`/
  `setFeeCollector`), `:42-48,123-155` (`maxUses` never enforced)
- **Description:** (a) if governance ever sets `feeCollector = 0x0`, the fee
  `.call{value:}` to address(0) **succeeds** and burns users' ETH fees silently; (b) `maxUses`
  is signed and stored but never checked — practically moot because the nonce mechanism already
  enforces single-use, but the field misleads integrators reading the typehash.
- **Recommendation:** add `!= address(0)` requires (one line each); drop `maxUses` from a V2
  typehash or enforce it.

#### [CWA-19] Dormant design notes on Buyback path (no nonReentrant; unchecked transfer; MEV window)
- **Severity:** Low · **Likelihood:** low while unfunded · **Status:** Known (W3/W4/W11-class +
  Slither baseline entries) — source-verified
- **Component:** `BuybackVault.sol:105-137`, `BuybackController.sol:128-147,243-247`
- **Description:** neither buyback executor has a reentrancy guard (external calls to a
  governance-set router; bounded by cooldown/owner gates); `BuybackController.withdrawIFR`
  ignores the ERC20 return value (safe with the known IFR token, fragile as a pattern);
  permissionless `execute()` with 5% slippage on a thin pool is sandwichable. All currently
  moot: both contracts hold 0 ETH / 0 IFR at baseline (verified).
- **Recommendation:** keep the Slither baseline entries; add `nonReentrant` + return checks in
  the next contract version; don't fund either contract before that.

### Informational

- **[CWA-20] Documentation drift cluster** (details in §6): test counts 642 (homepage) vs 644
  (actual, wiki) vs 544 (copilot dev-mode welcome, live in production); four divergent tier
  tables across wiki/integration/press-kit/API (`/api/ifr/check` uses 500/2,000/10,000 — a
  fourth variant); `rewardBps` 1000 (docs) vs 1500 (chain); PartnerVault throttle described as
  active but `ifrLock = 0x0` on-chain; Community Safe 57.9M (docs) vs 7.9M (chain — ~50M moved,
  consistent with LP-strategy milestones but not reflected in the pages reviewed); LP phase
  figures 150/100/150M vs 100/100/100M; signer #1 named "A.K." vs "G.M. (Kaspartizan)";
  vesting wiki `start: 1741168424` (a 2025 date, impossible) vs on-chain `1772670647`
  (= 2026-03-05T00:27 UTC, matching genesis); DEPLOYMENTS.md lists BuybackController owner =
  Deployer EOA while chain shows Governance (an *unreported improvement*); wiki fee-exempt table
  (10 entries) vs chain (15 exempt among audited set, incl. Vesting — resolving W6 in practice);
  Etherscan token info text still says "Community Bootstrap active".
- **[CWA-21] License inconsistency:** all contracts carry `SPDX-License-Identifier: MIT`; the
  README states "© 2026 Inferno Protocol. All rights reserved."; no LICENSE file exists. Pick
  one and align all three locations.
- **[CWA-22] Process surface:** no security.txt on any host; security contact = GitHub Private
  Vulnerability Reporting only; no bug bounty (planned Phase 5); three dependabot PRs open at
  audit time (#81–#83, non-security version bumps); Etherscan "16/16 verified" spot-confirmed
  for the token only.
- **[CWA-23] `deployments/mainnet.json` records only BuybackController** — tooling trusting that
  file sees an incomplete deployment truth; authoritative mapping lives in docs.
- **[CWA-24] Copilot trust chain:** the copilot server fetches live wiki HTML hourly and injects
  it into the LLM system context (`index.ts:90-159`) — a GitHub Pages content compromise
  translates into copilot answers. Accepted as design; worth a sentence in the threat model.

## 5. Known-Issues Verification

Every register entry was verified against source @ `eb538a35` and chain state @ block 25971217:

| Item | Documented status | Audit verification |
|---|---|---|
| W1 `setOwner()` timelock bypass | fixed (onlySelf via timelock) | **Confirmed fixed** — `Governance.sol:128-133`; owner = Safe since 20.03.2026 |
| W3 unbounded `setParams` (BuybackVault) | partially addressed | **Confirmed** — bounds present (`≤100%`, non-zero addresses); cooldown unbounded (owner-only) |
| W4 MEV on buyback/bootstrap | accepted | **Confirmed open**, dormant (contracts unfunded); see CWA-19 |
| W6 Vesting releases pay 3.5% fees | accepted | **Superseded on-chain:** `feeExempt[Vesting] = true` — docs stale (CWA-20) |
| W10 FeeRouter zero-address setters | open | **Confirmed open** (CWA-18) |
| W11 FeeRouter/Buyback no nonReentrant | open | **Confirmed open**, bounded (CWA-18/19) |
| W13 bootstrap 0-min LP add | accepted | **Confirmed** — one-time, executed 05.06.2026 |
| W15 `setGuardian` not timelocked | open | **Confirmed open** (CWA-09) |
| W17 LP stranded in BootstrapVaultV3 | accepted | **Verified on-chain:** `lpLockId = 0` (Team.Finance unused), vault holds 54,772,255.750515611 of 54,772,255.750516611 LP (rest = 1000-wei Uniswap minimum); no withdrawal function exists. This is a *feature* (permanent lock) — correctly documented |
| W18 Vesting guardian not rotatable | open | **Outdated:** `transferGuardian(address)` exists on-chain (selector probe reverts `OnlyGuardian()` for strangers) and in source |
| W19 voucher `maxUses` unenforced | open | **Confirmed open**, impact reframed: nonce single-use dominates (CWA-18) |
| OPS-001 lending fail-closed (`ifrPriceWei = 0`) | active | **Verified on-chain** (CWA-01) |
| OPS-002 commitment price fail-closed (`priceOracle = 0x0`) | active | **Verified on-chain**; extended by CWA-03 (permanence not documented) |
| OPS-005 BuilderRegistry empty | active | **Verified on-chain:** `getActiveBuilders() = []` |
| Slither baseline (6 reviewed High) | CI-gated | **Confirmed present** in repo; CI gate green at HEAD; not re-run locally (limitation §2) |
| Mythril bounded runs (0 signals claimed) | CI-gated | **CI history green** (latest 2026-09-12 push: success); not re-run locally |
| ~21,000 IFR legacy pool fees on Deployer | accepted, "not re-routed" | **Resolved on-chain:** Deployer IFR balance = 0 at baseline; docs' decision note remains historically accurate |

## 6. Documentation & Claims Consistency

Register results (claim → verdict → evidence):

| Claim | Verdict | Evidence |
|---|---|---|
| 644 contract tests / 30 builder / 36 SDK pass | **Confirmed** | local run at `eb538a35`: `644 passing (22s)` + `30 passing` + `36 passing`, exit 0 (`evidence/test-run.log`) |
| Homepage "642 tests" | **Diverged (stale, under-reports)** | actual 644 |
| Copilot dev-mode "544 documented tests" | **Diverged (stale)** | live widget string vs. 644+30+36 |
| Coverage 99% stmt / 91% branch | **Unverifiable as current** | historical snapshot (05.03.2026) only; no current coverage run in CI |
| "17 on-chain components" | **Plausible, definition-dependent** | 14 protocol contracts + LP pair + …; recommend publishing the counted list |
| Etherscan "16/16 verified" | **Spot-confirmed** | token page shows verified source (v0.8.20 paris); full set not individually fetched |
| Supply 997,571,140.02 / burned 2,428,859.98 | **Confirmed exactly** | chain `totalSupply()` = 997,571,140.022456196 IFR @ 25971217; API matches to the unit |
| LiquidityReserve 200M / 0 withdrawn / 50M-90d cap | **Confirmed** | chain reads; `totalWithdrawn = 0` |
| Vault invariant snapshot (CV 47,952,476.87 / LV 52,155,440.95, 0 lent) | **Confirmed exactly** | chain balances + `getOfferCount()=3`, `getLoanCount()=0` |
| C2 lock: 10 tranches, 20,156,940.95 IFR, unlock 29.07.2026 | **Confirmed** | `getTrancheCount(C2)=10`; tranche 0 TIME_ONLY, `unlockTime=1785283200` |
| "All contracts governed by 48h timelock + Safe" | **Mostly confirmed, with named exceptions** | every contract owner/admin = Governance (incl. BuybackController — docs stale in the *safe* direction); delay 172,800 s; 3× Safe 3-of-5 with identical 5 owners. Exceptions: all guardian roles = single EOA; `setGuardian` untimelocked; voucher signer = hot role |
| Bootstrap finalized, 3 contributors, 0.03 ETH, LP retained | **Confirmed** | `getBootstrapStatus() = (false, true, 0.03e18, 0, 3)`; LP custody verified (W17) |
| "Unlock always available, even when paused" (IFRLock) | **Confirmed (source)** | `unlock()` has no `whenNotPaused`; `_lock` does |
| Vesting cliff ~03.2027, 150M, beneficiary immutable | **Confirmed** — wiki `start` value is a typo | chain: `beneficiary = 0x04FA…6239`, `start = 1772670647` (2026-03-05T00:27 UTC), `released = 0` |
| Slither 0 unreviewed High / 0 Critical; Mythril clean | **CI-attested** | `security-audit.yml` green at HEAD push (13:15Z); `mythril-analysis.yml` green (12.09) |
| No secrets in repo | **Confirmed (sweep + CI)** | no tracked `.env`; zero 32-byte-hex hits outside docs/patches; dummy CI secrets only; gitleaks gate green |
| npm audit clean | **Confirmed at moderate+** | 8 low (transitive `@ethersproject/*` via hardhat-verify), 0 moderate+ |
| Fee tiers 200/50/100 bps, cap 500 | **Confirmed on-chain** | token reads @ 25971217 |
| Fee-exempt list (10 entries, docs) | **Diverged** | chain: 15 exempt of the audited 18 (incl. Vesting, BootstrapVaultV3, both big Safes, Deployer); LP Reserve Safe, Governance, BuilderRegistry not exempt |
| PartnerVault rewardBps 1000 / throttle active | **Diverged** | chain: `rewardBps = 1500`, `ifrLock = 0x0` (throttle disabled); annual cap 4M ✓ |
| Lending "audited smart contract" wording | **Overstatement** | only internal/AI/community reviews exist; this report is the first external one |

## 7. Governance & Centralization Risk

Verified roles matrix: see §3. Scenario analysis:

- **Single malicious proposal:** any protocol parameter change is visible on-chain 48h ahead;
  guardian cancel is the reactive backstop — held by one EOA (CWA-09). The highest-impact single
  proposal is `setIFRPrice` (CWA-01). With lending disabled, no proposal can directly move user
  funds; the largest movable balances are LiquidityReserve withdrawals (50M/period cap, CWA-15)
  and reserve/buyback parameters.
- **Compromised guardian EOA:** can cancel all proposals and pause every pausable contract —
  sustained griefing, no theft. Recovery requires Safe actions (unpause via new guardian
  rotation, which is instant).
- **Compromised voucher-signer hot key:** forged discount vouchers (bounded: 15 bps off a 5 bps
  fee — economically near-zero) — but if that key is also the Safe owner key (CWA-06), the
  blast radius jumps to "1 of 3 required Safe keys".
- **Signer set:** 5 pseudonymous signers, identical across all 3 Safes (verified). Documented
  expansion to 4-of-7 is not yet on-chain. One signer's EOA doubles as the public infrastructure
  donation address (disclosed) — noted as an opsec correlation point, not a vuln.
- **Proposal audit trail:** `proposalCount() = 17` matches the documented #0–#16 log;
  spot-decoded #15 (`setFeeExempt(LP pair, true)`) and #16 (`setP0(300,000,000)`) match the
  wiki's governance log exactly — the on-chain record and the public log agree.

## 8. Web & API Security

- **Header matrix (re-verified 2026-09-13):** shop = strong (enforced CSP + report-only, XFO
  DENY, HSTS 2y incl. subdomains, nosniff, no-referrer, restrictive Permissions-Policy); apex
  Pages = platform-limited (no custom headers possible; `ACAO: *` is Pages default on a static
  site — harmless); web3 = none (CWA-10); verify-api = `ACAO: *` + `default-src 'none'`
  (acceptable for a POST-only service; preflight-only exposure); points-api = `default-src
  'none'` + nosniff; copilot-api = `vary: Origin` allowlist (verified in source).
- **Address integrity:** every address embedded in homepage (21 unique), `/web3/` (apex and
  subdomain — byte-identical, confirmed via `cmp`), and `builder.html` matches the verified
  deployment map. No rogue or swapped addresses. `c2Addr` hard-coding is consistent with the
  transparency page.
- **XSS review:** copilot widget renders all dynamic chat content via `textContent` (safe);
  web3 `innerHTML` usages interpolate only numeric/hex contract data and static page constants —
  no attacker-controlled strings reach a sink on the reviewed paths. No external `<script>` tags
  without SRI on the homepage (only CSS/fonts).
- **API behavior:** all reviewed endpoints validate addresses (`/^0x[0-9a-fA-F]{40}$/`), bound
  pagination, and fail closed (502 with generic error; the price endpoint's live 502 confirms
  the no-stale-data behavior). API-reported supply/balances matched chain reads to the unit at
  baseline (single-source RPC caveat: the API reads `latest`, we pinned a block — figures
  agreed). Copilot health endpoint disclosure: CWA-11. points/verify source findings: CWA-04/05/14.
- **Not done:** authenticated flows, POST endpoints, and robots-disallowed shop paths
  (`/api/ /b/ /p/ /r/`) were not probed (read-only policy); shop backend business logic reviewed
  at middleware level only.

## 9. Repository & Supply Chain

- Tests: full suite reproduced (`npm ci` clean install → 644 + 30 + 36 passing, exit 0) at the
  pinned commit — the strongest claims-verification result of this audit.
- CI: 16 workflows, **all actions SHA-pinned**, `permissions: contents: read` (one adds
  `pull-requests: read`), Node 22; green runs at/around HEAD for contracts, security-audit,
  Mythril, docs, and the 4-hour vault-invariant monitor (last success 18:49Z, matching the
  claimed cadence). Enforcement gap: CWA-07.
- Secrets: no `.env` tracked (12 `.env.example` files, placeholders only); pattern sweep for
  private-key/mnemonic/API-key shapes found zero real secrets outside docs/patches; CI-only
  dummy secrets are clearly labeled; `.gitleaks.toml` has sensible custom rules; CI gitleaks gate
  green at HEAD. Note `.env.example`'s `DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE` + "TODO:
  REMOVE after governance transfers" — transfers appear complete (owner=Governance everywhere),
  so the TODO's precondition looks met: remove the placeholder key name entirely.
- Dependencies: `npm audit --audit-level=moderate` → 0 findings (8 low, transitive via
  hardhat-verify). Dependabot active; 3 version-bump PRs open.
- Branch protection: 1 approval + linear history + no force-push, but no required status checks
  and `enforce_admins: false` (CWA-07); no required commit signatures (optional hardening).

## 10. Recommendations (prioritized)

1. **Keep lending fail-closed** until CWA-01 remediations ship (bounded/TWAP price, borrow caps,
   `protocolFeeReceiver`, overdue-loan path, `.call` collateral returns). Publish the activation
   runbook as a governance prerequisite.
2. **Resolve the FeeRouterV1 sink (CWA-02):** decide sink-vs-sweep, then either re-point
   `poolFeeReceiver` via timelock or correct the three doc locations that promise a flywheel.
3. **Guard CommitmentVault price tranches (CWA-03):** revert on non-TIME_ONLY until a real
   oracle exists; fix the wiki wording.
4. **Fix the points-backend auth trio (CWA-04/05/06):** SIWE domain binding, production-throw on
   Sepolia defaults, dedicated voucher-signer key.
5. **Enforce the CI gates on main (CWA-07)** and enable `enforce_admins`.
6. **Complete the guardian-multisig migration** (CWA-09) — the single remaining broad EOA power.
7. **Documentation pass (CWA-20/21):** regenerate every number from chain state at publish time
   (the project already has `update-stats.yml` — extend it to tier tables, test counts, fee-exempt
   table, and the copilot welcome strings), fix the vesting `start` typo, align the license.
8. Low-effort hardening: web3 headers (CWA-10), `/api/health` minimization (CWA-11), zero-address
   requires (CWA-18), two-step ownership in future versions (CWA-16), header/secret hygiene for
   `.env.example` TODO (§9).

## 11. Conclusion

The project's self-assessment — "internal audits done, professional audit pending, lending
deliberately fail-closed" — is **confirmed as accurate** by this first external review. The code
quality, test reproducibility, CI discipline, and the honesty of the known-issues register are
above the norm for a project of this size, and every load-bearing safety claim (timelock,
multisig, fail-closed states, LP lock, test counts) was verified true on-chain or in execution.

The gaps are concentrated where the project itself signals they would be: the dormant lending
price mechanism (do not activate as-is), one real accounting dead-end (FeeRouterV1 IFR sink),
young off-chain components (points/voucher auth hardening), and a documentation layer whose
numbers drift in both directions — overstated in places (tier tables, "audited" wording, stale
supply/fee tables) and *understated* in others (BuybackController ownership migration, Vesting
fee exemption, W18 fix). None of the findings puts user funds at risk in the current
configuration.

## 12. Disclaimer

This report is a point-in-time security review limited to the scope and baselines stated above
(repo commit `eb538a35…`, mainnet block 25971217, surfaces as of 2026-09-13). It is based on
read-only analysis of public source code, public on-chain state, and public web surfaces. It does
not guarantee the absence of vulnerabilities, does not cover private infrastructure or
operational security, and does not constitute financial advice, an endorsement, or a legal
compliance opinion (notably not on §5 DDG/DSGVO/MiCA questions raised by the community audit).
On-chain state changes with every block; readers must re-verify roles and balances before relying
on them.

## Appendix A — Address & endpoint inventory

Verified against chain state at block 25971217 unless noted:

| Address | Component | Owner/Admin | Verified state highlights |
|---|---|---|---|
| `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | InfernoToken | Governance | fees 200/50/100 bps; poolFeeReceiver = FeeRouterV1; supply 997,571,140.022456196 |
| `0xc43d48E7FDA576C5022d0670B652A622E8caD041` | Governance | Treasury Safe | delay 172,800 s; guardian = Deployer EOA; proposalCount 17 |
| `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | IFRLock | — (guardian Deployer) | totalLocked 2,000 IFR; not paused |
| `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271` | Vesting | immutable beneficiary | 150M; start 1772670647; released 0; feeExempt = true |
| `0xdc0309804803b3A105154f6073061E3185018f64` | LiquidityReserve | Governance | 200M; lockEnd 1788222659 (passed); 50M/90d; withdrawn 0 |
| `0x670D293e3D65f96171c10DdC8d88B96b0570F812` | BuybackVault | Governance | 0 ETH / 0 IFR |
| `0xaA1496133B6c274190A2113410B501C5802b6fCF` | BurnReserve | Governance + guardian | totalBurned 0 |
| `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` | PartnerVault | Governance | 40M; rewardBps 1500; cap 4M; ifrLock unset |
| `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` | FeeRouterV1 | Governance (immutable) | fee 5 bps; feeCollector = BuybackController; **371,543.99 IFR stranded** |
| `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` | BootstrapVaultV3 | none | finalised; 0.03 ETH; 3 contributors; holds 54,772,255.75 LP (all minus 1000 wei) |
| `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3` | BuilderRegistry | Governance | 0 builders |
| `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3` | CommitmentVault | Governance | 47,952,476.87 IFR; p0 = 3e8; priceOracle = 0 |
| `0x974305Ab0EC905172e697271C3d7d385194EB9DF` | LendingVault | Governance | 52,155,440.95 IFR over 3 offers; 0 loans; ifrPriceWei = 0; protocolFeeReceiver = 0 |
| `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` | BuybackController | **Governance** (docs stale) | 0 ETH; cooldown 86,400 s; slippage 500 |
| `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` | Uniswap V2 pair | — | feeExempt = true (Proposal #15, decoded on-chain) |
| `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` | Treasury Safe | 3-of-5 (owners listed §3) | = Governance owner |
| `0xaC5687547B2B21d80F8fd345B51e608d476667C7` | Community Safe | 3-of-5 (same set) | 7.9M IFR |
| `0x5D93E7919a71d725054e31017eCA86B026F86C04` | LP Reserve Safe | 3-of-5 (same set) | 400.6M IFR; **not feeExempt** |

Endpoints: copilot-api (`/api/health`, `/api/ifr/{supply,balances,check,price,txfeed,vault}`,
`/api/locks/events`, `/api/lending/*`, `/api/commitment/*`, `/api/builder/generate`,
`/api/bootstrap/vote[s]`, `/api/builders/*`); points-api (`/health` live; SIWE/points/voucher per
source); verify-api (404 on `/`, preflight only); shop (`/api/health` 200 chainId 1).

## Appendix B — Tooling

cast/foundry 1.7.1 (drpc + publicnode, block-pinned reads) · node v22.22.2 / npm 10.9.7 (clean
`npm ci` + `npm run test:contracts:all`, exit 0) · `gh` API (repo metadata, protection, CI run
history) · curl (header/endpoint matrix) · CI attestations: `contracts.yml`/`security-audit.yml`
success @ HEAD push 2026-09-13T13:15:20Z; `mythril-analysis.yml` success 2026-09-12T22:21:33Z;
`vault-invariant-monitor.yml` success 2026-09-13T18:49:10Z. Not locally executed: Slither 0.11.5,
Mythril 0.24.8, gitleaks (CI-attested instead — see §2 Limitations).

## Appendix C — Verification commands

All chain reads were executed as:
```bash
cast call --block 25971217 --rpc-url https://eth.drpc.org <address> "<signature>" [args]
```
Full labeled outputs: `evidence/chain-reads-correct-block.txt`,
`evidence/chain-reads-extended.txt`, `evidence/final-onchain-checks.txt`,
`evidence/governance-c2-checks.txt`. Test reproduction: `evidence/test-run.log`. Web/API
observations: `evidence/web-api-recheck.txt`, `evidence/web-address-integrity.txt`. Repo/CI:
`evidence/repo-ci.txt`, `evidence/repo-secrets-deps.txt`. Baselines: `evidence/baseline-*.txt`.

— Collateral Web3 Open Audits, 2026-09-14
