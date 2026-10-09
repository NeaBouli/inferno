# Governance and Product Decision Register

Status: canonical open-decision register, 28 September 2026. This register
records what is true today and what still has to be decided. It is not a
Council decision, a vote, a funding allocation or an authorization for any
on-chain, signer, treasury, deployment or publication action.

Scope and sources: [Governance Constitution](GOVERNANCE_CONSTITUTION.md),
[Governance concept](IFR_GOVERNANCE_KONZEPT.md), [Roadmap](ROADMAP.md),
[current functionality status](CURRENT_FUNCTIONALITY_STATUS.md), the
[CWA remediation register](community-audits/CWA_REMEDIATION_REGISTER.md) and
the lane-specific documents linked below. The public
[Council agenda](https://ifrunit.tech/wiki/governance.html#council-agenda)
remains the only place where agenda items and vote outcomes are published.

## Rules for every lane

- Historical vote outcomes and executed proposals remain historical facts.
- A proposal, memo or agenda draft is not approved policy until a recorded
  decision exists. Public surfaces must describe it as proposed.
- Binding protocol actions use the existing path only: TreasurySafe 3-of-5
  proposal to Governance, public 48-hour timelock, then execution. No portal,
  bot or backend executes that path automatically.
- Agenda entries and this register carry no proposer names, signer identities,
  wallet addresses or private security details.
- Gate order: security/audit gate, then testnet/staging gate, then an explicit
  production/on-chain authorization recorded as its own decision.
- Irreversible means the action cannot be undone by a later Governance call on
  the deployed contracts; reversible means a later governed call or an
  off-chain change can restore the previous state.

## Lane 1 — LendingVault oracle/borrow activation and overdue loans

- **Current truth:** V1 is retired by owner decision (3 October 2026, see the
  decision record below): borrowing stays disabled with `ifrPriceWei = 0` and
  lenders are withdrawing their offers. V1 cannot return the price to
  zero once set and has no pause, freshness check, borrow cap or allowlist.
  The 2026-07-31 safety review decided to keep V1 borrowing disabled
  ([runbook](LENDING_PRICE_GOVERNANCE_RUNBOOK.md); CWA-01, CWA-08).
- **Decision needed:** whether a LendingVault V2 is built at all; its price
  source (manual governed, TWAP or external oracle), freshness/deviation
  bounds, per-loan and protocol borrow caps, pause authority, fee receiver,
  and the overdue-loan policy (collateral return, expiry, default handling).
- **Prerequisites:** V2 specification covering all items above; lifecycle,
  expiry, hostile-recipient and oracle regression tests.
- **Dependencies:** liquidity depth of the IFR/WETH pool; Lane 2 oracle choice
  should be shared, not duplicated.
- **Impact:** setting a V1 price is irreversible (no disable path) and is
  excluded. A V2 deployment is reversible only through its own pause and
  migration controls.
- **Security/audit gate:** independent review of the V2 contract and price path.
- **Testnet/staging gate:** Sepolia V2 deployment with full borrow, repay,
  overdue and default scenarios.
- **Production gate:** separate recorded decision, then Safe proposal plus
  48-hour timelock for deployment wiring and any price activation.
- **Next evidence:** approved V2 specification and passing lifecycle test suite.
- **Decision record (3 October 2026, owner):** option A. LendingVault V1 is retired:
  borrowing stays disabled (`ifrPriceWei` stays unset; Governance could technically set it, but no activation is planned or authorized) and no V2 is planned for
  now. A V2 follows only after a reviewed price source shared with Lane 2. Before the withdrawals
  V1 held 52,155,440.952845656 IFR, all lender offers (C2 20,156,940.952845656, C1 16,999,000,
  C3 14,999,500), 0 loans; `withdrawOffer` returned the full amount for each on a Mainnet fork.
  The lenders are withdrawing their offers; these IFR are not lost.

## Lane 2 — CommitmentVault price-lock V2 and V1 fail-closed boundary

- **Current truth:** Mainnet CommitmentVault uses `TIME_ONLY` locks. Its
  `_getCurrentPrice()` returns `0`, so setting `priceOracle` alone cannot make
  price conditions work; price-conditioned locks stay disabled in Web3 and are
  excluded from Benefits eligibility
  ([oracle path](COMMITMENT_PRICE_LOCK_ORACLE_PATH.md); CWA-03).
- **Evidence (2026-10-02):** the deployed V1 bytecode does not contain the
  repository's `price conditions disabled` guard (added for future deployments
  in #131). On a Mainnet fork at block `26100144`, direct calls create
  `TIME_OR_PRICE` and `PRICE_ONLY` tranches. A `PRICE_ONLY` or `TIME_AND_PRICE`
  tranche can then never unlock while the price stays `0`. Only the Web3 UI
  blocks these calls. This raises the priority of the rescue path below
  (`test/fork/BenefitsVerifyFork.test.js`).
- **Realized impact (2026-10-02):** contributor wallets C1 and C3 hold 11 price-conditioned tranches,
  26,418,467.994338353 IFR in total, in V1.
  - The deployed bytecode contains no oracle call.
  - A fork simulation with a Governance-set oracle returning the maximum price, plus ten years, still
    reports `conditionMet = false`.
  - There is no rescue or upgrade path, so the tranches are permanently locked.
  - Urgent Council proposal CV-01 compensates from the LP Reserve Safe by each tranche's original
    conditions ([CV-01](wiki/commitment-vault-compensation.html)).
- **Decision needed:** none; decided 2026-10-03: Option B. A dedicated
  `PriceLockVault` is built and deployed later; price locks stay disabled
  until an on-chain readiness scope (pool WETH depth and/or TWAP) holds, and
  activation is a Governance proposal that reverts if the scope is not met. Price conditions use a
  7-day TWAP; every lock has a mandatory rescue time of at most 4 years
  ([specification](PRICE_LOCK_VAULT_SPEC.md)). CommitmentVault V2 stays
  `TIME_ONLY`.
- **Prerequisites:** proof contract with tests for zero reserves, stale
  observations, token order, decimal scaling and post-trigger price drops.
- **Dependencies:** Lane 1 oracle policy; pool liquidity depth.
- **Impact:** a `setPriceOracle` call on V1 without V2 is a misleading
  activation and is excluded. A new vault is additive; existing time locks
  stay in V1.
- **Security/audit gate:** independent review of the new vault and oracle.
- **Testnet/staging gate:** Sepolia deployment with every condition type.
- **Production gate:** separate recorded decision plus Safe proposal and
  48-hour timelock.
- **Next evidence:** Sepolia rehearsal log; readiness reaching the
  activation scope. The independent review of `PriceLockVault` is done
  (second review T-256); the vault is not deployed and not active.

## Lane 3 — FeeRouter sink/accrual and Governance/guardian redeployment

- **Current truth:** Since Proposal #21 new pool fees go to BuybackController. The
  734,545.074097347 IFR held by FeeRouterV1 were recovered to the Treasury Safe on 7 October 2026
  (CWA-02 batch with Proposals #22/#23, block 26143797); FeeRouterV1 held 0 IFR at block 26151369
  and still has no IFR withdrawal function. The recovered IFR is unallocated Treasury IFR. The FeeRouter voucher path is dormant (CWA-18). The Mainnet Governance
  contract predates a later source fix (CWA-25). All six mutable guardians are the Treasury
  Safe (CWA-09, Proposals #19/#20). The voucher signer is a dedicated key outside the Safe
  signer set (CWA-06, Proposal #18).
- **Decision needed:** accept FeeRouterV1 as a documented permanent sink, or
  route future fees to a governed recoverable receiver; scope of a bundled
  Governance redeploy and migration; accepted guardian model.
- **Prerequisites:** role inventory; migration plan covering ownership of every
  governed contract; two-step ownership transfer in new contracts (CWA-16).
- **Dependencies:** any redeploy should bundle Lane 1/2 V2 wiring where
  practical to limit repeated migrations.
- **Impact:** redirecting future fees is reversible by a later governed call;
  fees already accrued in V1 had no sweep path; they were recovered by the governed CWA-02 batch.
  Ownership migration to a new Governance contract is irreversible once
  accepted.
- **Security/audit gate:** independent review of the migration and new
  Governance/guardian contracts.
- **Testnet/staging gate:** full migration rehearsal on Sepolia with
  post-migration role checks.
- **Production gate:** separate recorded decision per migration step, each via
  Safe proposal and 48-hour timelock.
- **Next evidence:** sink-vs-receiver decision record; migration rehearsal log.
- **Decision record (3 October 2026, owner):** option B. Future IFR pool fees go to
  BuybackController through `InfernoToken.setPoolFeeReceiver` (Governance proposal, 48-hour
  timelock; executed 5 October 2026 as Proposal #21). The 724,992.668043224 IFR already in FeeRouterV1 (block
  26,108,134) stay permanently lost and are disclosed as lost, not burned. Guardian model
  decided the same day: Treasury Safe (CWA-09); voucher signer moves to a dedicated key (CWA-06).
- **Executed (5 October 2026):** the Treasury Safe executed #21 at 07:25:23 UTC, block 26124660
  (transaction in `docs/DEPLOYMENTS.md`); `poolFeeReceiver()` = BuybackController. FeeRouterV1 balance as of that block: 734,545.074097347 IFR. #18
  (block 26124623) and #19/#20 (block 26124647) executed in the same Safe round.
- **Executed (7 October 2026, CWA-02 recovery):** one Treasury Safe batch (Proposal #22, FeeRouterV1
  `swapWithFee`, Proposal #23), block 26143797 (transaction in `docs/DEPLOYMENTS.md`),
  moved the 734,545.074097347 IFR held by FeeRouterV1 to the Treasury Safe. This supersedes the
  "stay permanently lost" part of the 3 October record above. No allocation decision exists for the
  recovered IFR.
- **Execution status (4 October 2026):** option B is queued as Governance proposal #21
  (`InfernoToken.setPoolFeeReceiver(BuybackController)`, ETA 2026-10-05 00:18:23 UTC; read-only
  evidence at block 26119897). The step-2 execute batch is written only after on-chain
  exact-content verification of the queued proposal (`scripts/pool-fee-receiver-proposal.cjs
  --execute`, T-242); fork proof at exactly block 26119897 in
  `test/fork/PoolFeeReceiverFork.test.js`. Runbook: `docs/POOL_FEE_RECEIVER.md`.

## Lane 4 — PartnerVault/BuilderRegistry rewards and pilot-partner gate

- **Current truth:** BuilderRegistry has 0 registered builders. No authorized
  reward caller is active, so seller/builder rewards are disabled. The
  deployed formula pays a percentage of the lock amount. No deployed
  mechanism refills PartnerVault ([spec](PARTNER_REWARDS_SPEC.md);
  [memo](PARTNERVAULT_REWARD_MEMO_2026-09-15.md), discussion draft only).
- **Decision (2026-10-03, owner): model B.** Rewards are valued in EUR and paid
  in IFR only for verified checkout redemptions at a registered pilot partner,
  within a hard per-partner budget (PartnerVault allocation) and a global pilot
  budget; no lock-percentage reward, no refill. Settlement per period through a
  Governance `recordMilestone` proposal; no authorized caller. Rewards stay
  disabled until the first pilot partner, which is activated by its own Safe
  proposal ([policy](PARTNER_REWARDS_MODEL_B.md)).
- **Decision needed:** (remaining) EUR amount per redemption and budget per
  pilot partner; global pilot budget; vesting length by budget size;
  pilot-partner count and selection criteria. Formula, caller model and refill
  policy are decided (model B, no caller, no refill).
- **Prerequisites:** written reward policy; a per-period redemption export
  from the Benefits backend with reconciliation against seller-confirmed
  checkouts; the backend change that gates reward events on verified pilot
  redemptions instead of an authorized caller (T-275); a per-period
  `recordMilestone` proposal template bounded by the partner allocation.
- **Dependencies:** Lane 5 exchange-integration pilot draws on the same
  PartnerVault budget; Lane 7 SDK/Creator Gateway integrations produce the
  reward events.
- **Impact:** registering a builder or setting a caller is reversible by a
  later governed call; vested rewards already recorded are irreversible.
- **Security/audit gate:** review of the redemption export, reconciliation and
  double-settlement protection; independent review if a new reward contract is
  introduced.
- **Testnet/staging gate:** staging checkout-to-reward flow on Sepolia with the
  chosen formula and caps.
- **Production gate:** separate recorded decision, then Safe proposals for
  builder registration and partner activation per pilot partner, and one
  reconciled `recordMilestone` proposal per settlement period; no caller is
  activated.
- **Next evidence:** approved reward policy and pilot-partner criteria.

## Lane 5 — Exchange fee exemption, incentives and governance role

- **Current truth:** the CEX transfer-fee exemption policy was approved on
  26.08.2026 (vote 4-1); no exchange address is active yet. EX-01 was
  approved on 2026-10-04 with 3 YES votes: exchanges receive no IFR
  incentives from any project pool (policy decision, no on-chain action). The
  signer-level record is public on
  [Council Votes](wiki/council-votes.html).
  EX-02 (governance role) is open: three eligible signers abstained; with two
  signers outstanding no option can reach 3 votes unless votes change. Until a
  decision, the status quo applies: exchanges have no governance role. The owner
  is checking whether the outstanding signers want to vote. No exchange has
  Council membership or TreasurySafe permissions.
- **Decision needed:** EX-02 outcome: whether exchanges get no role (Option A)
  or at most two disclosed non-voting advisers without Safe permissions
  (Option B). Votes: [Council Votes](wiki/council-votes.html).
- **Prerequisites:** verified exchange addresses; conflict review;
  returnable/escrow terms for any liquidity mandate.
- **Dependencies:** Lane 4 (PartnerVault as a possible integration source);
  LiquidityReserve 90-day cap for any liquidity source.
- **Impact:** a fee exemption is reversible by a governed call; transferred
  incentives are irreversible unless escrowed and returnable.
- **Security/audit gate:** address-ownership verification and review of any
  escrow contract.
- **Testnet/staging gate:** proposal simulation for exemption calldata.
- **Production gate:** separate recorded decision per exchange, then Safe
  proposal and 48-hour timelock.
- **Next evidence:** EX-01/EX-02 ballot outcome recorded in the public vote
  log.

## Lane 6 — Council open/secret voting portal

- **Decision (2026-10-03):** eligibility is the Safe signer set with a fixed
  snapshot per ballot (a Council registry may follow); open ballots show
  consented initials only; open ballots now run through the Etherscan
  verified-signature procedure and are recorded publicly on
  [Council Votes](https://ifrunit.tech/wiki/council-votes.html), verified by
  `scripts/verify-council-votes.cjs`. Secret ballots are in planning as a
  separate milestone (anonymous credential or ZK membership, threshold tally)
  behind a threat model, scheme selection, independent cryptography/privacy
  review and staging. A portal that automates the open procedure is planned.
- **Current truth:** planned, not live. No Council login or web ballot creates
  a binding vote. The published requirements cover wallet challenge, EOA and
  EIP-1271 verification, a block-numbered eligibility snapshot, replay
  protection and fixed open/secret mode per ballot.
- **Decision needed:** eligibility source (Council registry and Safe-owner
  snapshot); public identity display in open mode (consented initials or a
  consented public pseudonym, never an unconsented wallet mapping); secret-mode
  scheme (anonymous credential or ZK membership, threshold tally).
- **Privacy limits:** zero retention of IP, user-agent, request body and wallet
  telemetry is a release requirement, not a verified property. Network,
  hosting, RPC and wallet providers may still see connection metadata. No
  surface may claim "no IP logging" beyond what infrastructure evidence
  proves, and no surface may promise on-chain or network-level anonymity.
- **Prerequisites:** threat model; scheme selection; verified retention
  configuration; multi-wallet and multi-device acceptance tests.
- **Dependencies:** Phase 4 voting-weight ratification (Council one vote per
  eligible member remains a proposal).
- **Impact:** off-chain only; a ballot never executes TreasurySafe or
  Governance actions. Published vote records are irreversible.
- **Security/audit gate:** independent cryptography, privacy and
  infrastructure review.
- **Testnet/staging gate:** staging portal with test wallets and a mock
  snapshot; retention configuration verified from logs.
- **Production gate:** separate recorded decision before the first real ballot.
- **Next evidence:** threat model and selected secret-ballot scheme.

## Lane 7 — Embedded wallet, SDK, Creator Gateway and private follow-on boundary

- **Current truth:** production Benefits uses external self-custody wallets.
  The embedded wallet is an isolated Sepolia prototype only
  ([decision](ifrp-commerce-app/EMBEDDED_WALLET_DECISION.md)). `ifr-sdk` is a
  tested local package and is not published
  ([runbook](runbooks/IFR_SDK_NPM_RELEASE.md)). Creator Gateway source exists
  in the repository; no production deployment record exists
  ([spec](CREATOR_GATEWAY.md)).
- **Decision (2026-10-03, project):** (1) external self-custody wallets only;
  no embedded wallet is planned and the Sepolia prototype stays a prototype
  (open-source, community-driven project). (2) Publish `ifr-sdk` under MIT from
  the project npm account `ifr-protocol` (project alias e-mail, 2FA), never a
  personal account: one manual bootstrap version, then only the fail-closed
  workflow dispatched on protected `main` with npm Trusted Publishing and owner
  approval ([runbook](runbooks/IFR_SDK_NPM_RELEASE.md)).
- **Decision needed:** Creator Gateway hosting model. Proposed: a public demo
  instance on the sandbox host with wallet and IFRLock checks only (no
  Google/YouTube OAuth, no personal data) plus a self-hosting quickstart;
  first creator pilot.
- **Private follow-on boundary:** a gated content product may follow as a
  separate private product. Public repositories only acknowledge that planned
  boundary; its implementation details stay outside this repository.
- **Prerequisites:** embedded-wallet acceptance matrix complete; approved
  `LICENSE` file; Creator Gateway deployment runbook.
- **Dependencies:** Lane 4 reward caller for creator rewards.
- **Decision (point 3, 2026-10-03):** use-case connection needs no partner or
  user server and no new project-run service. Discounts run through the existing
  IFR Benefits shop; partner websites may add the display-only serverless widget
  and communities use Guild.xyz or Collab.Land with an IFRLock contract-read
  condition ([guide](wiki/integrate-benefits.html)). The Creator Gateway stays
  optional self-hosting only.
- **Impact:** npm publication is irreversible for a published version; an
  embedded-wallet feature flag is reversible, but user wallets created under it
  must stay exportable.
- **Security/audit gate:** independent security review of the embedded-wallet
  integration; release review of the SDK tarball and README claims.
- **Testnet/staging gate:** Sepolia-only prototype and consumer install tests.
- **Production gate:** explicit action-time approval for each publication or
  feature-flag activation.
- **Next evidence:** filled embedded-wallet evidence matrix; license decision.
