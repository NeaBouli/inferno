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

- **Current truth:** deployed V1 lender offers are live; borrowing is
  intentionally disabled with `ifrPriceWei = 0`. V1 cannot return the price to
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
- **Next evidence:** independent review of `PriceLockVault`; Sepolia
  rehearsal log; readiness reaching the activation scope.

## Lane 3 — FeeRouter sink/accrual and Governance/guardian redeployment

- **Current truth:** FeeRouterV1 accumulates IFR pool fees with no automatic
  forwarding path (CWA-02). The FeeRouter voucher path is dormant (CWA-18).
  The Mainnet Governance contract predates a later source fix (CWA-25). The
  guardian is a single EOA with cancel power; a separate guardian multisig is
  planned (CWA-09). The voucher signer overlaps a Safe owner key (CWA-06).
- **Decision needed:** accept FeeRouterV1 as a documented permanent sink, or
  route future fees to a governed recoverable receiver; scope of a bundled
  Governance redeploy and migration; accepted guardian model.
- **Prerequisites:** role inventory; migration plan covering ownership of every
  governed contract; two-step ownership transfer in new contracts (CWA-16).
- **Dependencies:** any redeploy should bundle Lane 1/2 V2 wiring where
  practical to limit repeated migrations.
- **Impact:** redirecting future fees is reversible by a later governed call;
  fees already accrued in V1 cannot be recovered without a V1 sweep path.
  Ownership migration to a new Governance contract is irreversible once
  accepted.
- **Security/audit gate:** independent review of the migration and new
  Governance/guardian contracts.
- **Testnet/staging gate:** full migration rehearsal on Sepolia with
  post-migration role checks.
- **Production gate:** separate recorded decision per migration step, each via
  Safe proposal and 48-hour timelock.
- **Next evidence:** sink-vs-receiver decision record; migration rehearsal log.

## Lane 4 — PartnerVault/BuilderRegistry rewards and pilot-partner gate

- **Current truth:** BuilderRegistry has 0 registered builders. No authorized
  reward caller is active, so seller/builder rewards are disabled. The
  deployed formula pays a percentage of the lock amount. No deployed
  mechanism refills PartnerVault ([spec](PARTNER_REWARDS_SPEC.md);
  [memo](PARTNERVAULT_REWARD_MEMO_2026-09-15.md), discussion draft only).
- **Decision needed:** keep the lock-percentage formula or adopt a
  checkout-based budget model as proposed in the memo; reward caps and pause
  rule; vesting length by reward size; which backend or allowlist contract
  may act as authorized caller; refill policy (none, or a funded source that
  is actually implemented); pilot-partner count and selection criteria.
- **Prerequisites:** written reward policy; authorized-caller key custody
  separated from Safe signer keys; Benefits reward outbox tested against the
  chosen formula.
- **Dependencies:** Lane 5 exchange-integration pilot draws on the same
  PartnerVault budget; Lane 7 SDK/Creator Gateway integrations produce the
  reward events.
- **Impact:** registering a builder or setting a caller is reversible by a
  later governed call; vested rewards already recorded are irreversible.
- **Security/audit gate:** review of the caller service and anti-double-count
  path; independent review if a new reward contract is introduced.
- **Testnet/staging gate:** staging checkout-to-reward flow on Sepolia with the
  chosen formula and caps.
- **Production gate:** separate recorded decision, then Safe proposals for
  builder registration and caller activation per pilot partner.
- **Next evidence:** approved reward policy and pilot-partner criteria.

## Lane 5 — Exchange fee exemption, incentives and governance role

- **Current truth:** the CEX transfer-fee exemption policy was approved on
  26.08.2026 (vote 4-1); no exchange address is active yet. Exchange IFR
  incentives (EX-01) and any exchange governance role (EX-02) are undated
  discussion drafts. No exchange has Council membership or TreasurySafe
  permissions.
- **Decision needed:** per-exchange address verification procedure; whether
  any incentive exists (none, integration pilot or liquidity pilot) and its
  source and ceiling; whether exchanges get no role (Option A) or at most two
  disclosed non-voting advisers without Safe permissions (Option B).
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
- **Decision needed:** embedded-wallet provider and single recovery trust
  model, or continued external-wallet-only; SDK license owner, package name
  and npm owner; Creator Gateway hosting model and first creator pilot.
- **Private follow-on boundary:** a gated content product may follow as a
  separate private product. Public repositories only acknowledge that planned
  boundary; its implementation details stay outside this repository.
- **Prerequisites:** embedded-wallet acceptance matrix complete; approved
  `LICENSE` file; Creator Gateway deployment runbook.
- **Dependencies:** Lane 4 reward caller for creator rewards.
- **Impact:** npm publication is irreversible for a published version; an
  embedded-wallet feature flag is reversible, but user wallets created under it
  must stay exportable.
- **Security/audit gate:** independent security review of the embedded-wallet
  integration; release review of the SDK tarball and README claims.
- **Testnet/staging gate:** Sepolia-only prototype and consumer install tests.
- **Production gate:** explicit action-time approval for each publication or
  feature-flag activation.
- **Next evidence:** filled embedded-wallet evidence matrix; license decision.
