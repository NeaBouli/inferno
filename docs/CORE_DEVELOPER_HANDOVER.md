# Core Developer Handover

Repository checkpoint: 23 October 2026. This is a repository-based handover,
not a fresh production or on-chain measurement and not release authorization.
Use the dated evidence below; reverify live state before an authorized action.
Earlier `HANDOVER_*.md` files are historical session notes, not current runbooks.

## Start here

- [Current functionality](CURRENT_FUNCTIONALITY_STATUS.md): implemented,
  operational and pending capabilities; dated test and device evidence.
- [Deployments](DEPLOYMENTS.md): canonical Mainnet inventory, public addresses,
  ownership, executed proposals and dated off-chain runtime matrix.
- [Architecture map](architecture/MAP.md): scoped security and runtime traces,
  not a complete map of every application. Section 11 maps the Landing/Wiki
  render path: page shell to shared navigation and `redesign-skin.css`.
- [Governance/product decision register](GOVERNANCE_PRODUCT_DECISION_REGISTER.md),
  [CWA remediation register](community-audits/CWA_REMEDIATION_REGISTER.md) and
  [open-audit Wiki](https://ifrunit.tech/wiki/open-audit.html): decisions,
  remaining gates and evidence, rather than an implication that publication
  means remediation. Later execution entries supersede historical decisions.

## Architecture and operating boundaries

### Contracts and data

`contracts/` contains Solidity contracts; Hardhat/Ethers tooling lives in
`scripts/`, `test/` and `hardhat.config.js`. The deployed inventory is
15 protocol contracts plus 3 Safes, as defined in [DEPLOYMENTS](DEPLOYMENTS.md).
Repository-only successors and prototypes are not additional live deployments.

| Area | Source and responsibility | Current boundary |
| --- | --- | --- |
| Token | `contracts/token/InfernoToken.sol` | 9 decimals; default non-exempt transfer burns 2.5% and routes 1% to the pool receiver; no post-genesis mint function. Keep integer/base-unit arithmetic. |
| Access | `contracts/lock/IFRLock.sol`, `contracts/view/IFRTierView.sol` | Refundable access locks and read-only eligibility; lock balances are not burns. |
| Commitments/lending | `contracts/vault/` | TIME_ONLY commitments remain supported. V1 price conditions are unsafe; CV-01 records permanently locked IFR. Official interfaces retire LendingVault V1 creation/increase and borrowing; withdrawals and existing-loan maintenance remain. |
| Reserves/bootstrap | `contracts/liquidity/`, `vesting/`, `bootstrap/` | BootstrapV3 finalized; its LP custody is withdrawal-less. Reserve availability is not an automatic withdrawal or liquidity deployment. |
| Fees/buyback | `contracts/FeeRouterV1.sol`, `contracts/buyback/`, `contracts/burnreserve/` | Since proposal #21 pool fees go to BuybackController, recoverable by governed `withdrawIFR`. Buyback is dormant; sending IFR to BurnReserve is not itself a burn. |
| Builder rewards | `contracts/BuilderRegistry.sol`, `contracts/partner/PartnerVault.sol` | Model B rewards need registered pilot partners, budgets and reconciled Governance settlement. Seller profile creation does not activate rewards. |

Source presence can differ from deployed bytecode; consult the CWA register and
deployment records before relying on a later source fix. The
[flywheel Wiki](https://ifrunit.tech/wiki/flywheel.html) separates active transfer
mechanics from dormant buyback and planned ecosystem activation.

### Applications, hosts and release paths

The production runtime is on the Hetzner host under `/opt/inferno`, except
GitHub Pages. These are the repository's recorded routes, not a new health
check. The host Compose definition is operator-managed and is not the root
development `docker-compose.yml` in this repository.

| Surface/service | Source | Host and release path |
| --- | --- | --- |
| Landing/Wiki | `docs/`, including `docs/wiki/` | `ifrunit.tech`, GitHub Pages from `main`/`docs`; a merge publishes this surface. |
| Web3 PWA | `docs/web3/`, shared wallet/state assets | `web3.ifrunit.tech`, nginx copy at `/opt/inferno/web3-site/html`; `scripts/deploy-web3-site.sh` in gate mode. A Pages merge does not refresh it. |
| Benefits frontend/backend | `apps/benefits-network/` | `shop.ifrunit.tech` and `/api`; Next.js frontend, Express/TypeScript/Prisma/SQLite backend; `scripts/deploy-benefits-network.sh` in gate mode. |
| Telegram/verification | `apps/telegram/telegram-bot/` | `verify-api.ifrunit.tech`; `scripts/deploy-compose-service.sh telegram-bot` in gate mode. |
| Points backend | `apps/points-backend/` | `points-api.ifrunit.tech`; `scripts/deploy-compose-service.sh points-backend` in gate mode. |
| Protocol Data API | `apps/data-api/` | Retains `copilot-api.ifrunit.tech` for client compatibility. Replacement source is prepared; production rename/cutover is pending. Use `scripts/deploy-compose-service.sh data-api` only after authorized host bootstrap. |
| Creator Gateway | `apps/creator-gateway/` | Prepared, not deployed; proposed `creator-api.ifrunit.tech`. First release needs the separate [runbook](CREATOR_GATEWAY_DEPLOY.md), owner choices and host-gate onboarding. |

The [Data API cutover](COPILOT_CHAT_RETIREMENT.md) retains non-chat routes and
archives; source retirement is not evidence of a production service rename.
Dashboards and the embedded-wallet prototype are not primary production
surfaces. The local SDK source is `apps/sdk/`; the recorded published version
is `ifr-sdk` 0.4.1 with provenance. Later publication uses its own
[npm release gate](runbooks/IFR_SDK_NPM_RELEASE.md).

For data paths, read [Points → voucher → FeeRouter](E2E_FLOW.md) as a technical
flow whose FeeRouter voucher redemption path remains dormant (CWA-18), and
[Benefits data inventory](BENEFITS_PWA_AND_DATA_MINIMIZATION.md) with the
[accepted owner-B privacy migration](BENEFITS_CUSTOMER_PRIVACY_MIGRATION.md).
The Benefits backend no longer stores customer wallets/history; seller data,
Points wallet linkage, third-party exposure and off-chain availability still
need their documented controls. No standalone `DATA_FLOWS.md` exists at this
checkpoint; these are the retained flow/data references.

## Governance, Safes and continuity

Treasury, Community and LP Reserve Safes are documented as 3-of-5 with the
same five signers. Verify threshold and owner sets before relying on that
record; public addresses belong in [DEPLOYMENTS](DEPLOYMENTS.md), not in the
decision register. TreasurySafe owns Governance. Governed parameter changes
follow Safe proposal → public 48-hour timelock → execution. Council/Forum
records do not automatically execute this path; Forum results are advisory.

Do not imply that every privileged call is timelocked: deployed Governance
ownership transfer (`setOwner`, CWA-25) and guardian rotation (`setGuardian`)
are owner-only untimelocked paths. The mutable guardian migrations are recorded
in DEPLOYMENTS; BuybackVault/BuybackController retain immutable deployer
guardians. Guardian permissions differ per contract: for example IFRLock can
pause new locks while unlock stays available, and BurnReserve permits burns.

The [continuity policy](https://ifrunit.tech/wiki/multisig.html#project-continuity)
and [signer expansion plan](GOVERNANCE_SIGNER_EXPANSION_PLAN.md) distinguish
public code maintenance from signer authority. New maintainers reproduce
checks from lockfiles, take over approved hosting through the release gates
and obtain any needed signer changes through the existing Safe process.
Without a signing quorum, privileged governance cannot progress; public code
alone does not transfer control or guarantee hosted services.

## Decisions and acceptance still open

Use the [decision register](GOVERNANCE_PRODUCT_DECISION_REGISTER.md) as the
lane index, with current deployment/execution records taking precedence over
stale prerequisite bullets. In particular:

- Lending V1 retirement is decided; a replacement requires a reviewed oracle,
  lifecycle controls and a separate decision. Do not reactivate V1 interfaces.
- PriceLockVault's design decision is recorded; price-lock activation remains
  gated by readiness, review, staging and a separately authorized proposal.
- Governance/guardian replacement and migration scope, and the allocation of
  recovered Treasury IFR, are not authorized by the fee-receiver migration.
- Model B reward policy is decided; pilot partner selection, budgets, pricing
  evidence and per-period settlement remain gated. No automatic refill exists.
- EX-01 excludes exchange incentives; EX-02 exchange advisory/governance role
  remains open. Exchange exemptions require individual verification and approval.
- Council secret-ballot design and Forum ratification, duration/thresholds and
  Mainnet activation remain open. The Forum first slice is Sepolia-only and
  disabled pending acceptance.
- Creator Gateway first-release choices, the Data API host cutover, remaining
  Benefits physical-device acceptance and the independent professional audit
  remain separate follow-ups. See their runbooks and the CWA register.

## Release through the scoped gate

These are operator instructions for a separately approved release, not commands
to run as part of this documentation handover. Begin from a clean checkout at
the full reviewed commit; require CI for that exact head, focused tests and
the applicable visual/device evidence. Benefits changes require
`npm run preflight:benefits`. Inspect capacity and prepare a verified rollback
baseline before any production write. Never prune the shared host as a release
step or silently include a database migration.

```bash
export DEPLOY_MODE=gate
export EXPECTED_SHA=<full-40-character-reviewed-commit>

# Read-only host inspection/planning (requires authorized gate access):
scripts/deploy-web3-site.sh plan
scripts/deploy-compose-service.sh telegram-bot plan
scripts/deploy-benefits-network.sh status
scripts/deploy-benefits-network.sh capacity

# Only after explicit approval for the selected target and commit:
scripts/deploy-web3-site.sh deploy
scripts/deploy-compose-service.sh telegram-bot deploy
scripts/deploy-benefits-network.sh frontend

# Post-release public verification for the selected target:
scripts/deploy-web3-site.sh verify
scripts/deploy-compose-service.sh telegram-bot verify
scripts/deploy-benefits-network.sh verify
```

Choose only the affected target; the examples do not prescribe releasing all
services. The scripts archive the reviewed commit; gate uploads carry SHA-256
checksums and use the scoped forced-command interface. The diagnosis account
cannot write production or operate Docker; lack of access is not permission
to bypass the gate. Confirm the installed host tool's accepted behavior for
the service; client code alone does not prove automatic recovery.

Gate rollback takes the backup stamp printed by the host:
`scripts/deploy-web3-site.sh rollback <stamp>`,
`scripts/deploy-compose-service.sh <service> rollback <stamp>` or
`scripts/deploy-benefits-network.sh rollback <stamp>`. Preserve the backup and
verify restore plus health. See [Compose releases](COMPOSE_SERVICE_RELEASE.md#gate-mode),
[Web3 releases](WEB3_SITE_RELEASE.md), [Benefits capacity/rollback](BENEFITS_CAPACITY_RUNBOOK.md)
and [retention](BENEFITS_RETENTION_RUNBOOK.md) for target-specific constraints.

## Evidence and historical decisions

- Exact-head workflow definitions and logs: `.github/workflows/`; accepted
  test-run references in [current functionality](CURRENT_FUNCTIONALITY_STATUS.md).
  Historical counts are not fresh local test results or a coverage percentage.
- Contract execution evidence: [DEPLOYMENTS](DEPLOYMENTS.md), proposal runbooks,
  `test/fork/`, the CWA register and its linked reports. Pin observations to
  their date/block; do not publish a guessed live value.
- Release evidence: archived commit, tar checksum, `RELEASE_SHA` or Web3
  `web3-release.json`, image IDs, gate output, `/opt/inferno/backups/` stamps,
  health/smoke results and inspected screenshots. Keep secret/data backups
  outside public docs; retain only redacted evidence references here.
- Benefits privacy/device evidence: [privacy migration](BENEFITS_CUSTOMER_PRIVACY_MIGRATION.md)
  and [device/wallet runbook](runbooks/BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md).
- Coverage: [05 March report](COVERAGE_REPORT.md) is a historical
  solidity-coverage subset. Current contracts CI runs tests without a retained
  reproducible coverage baseline; a current coverage badge is deferred.

### Bootstrap Plan B decision date

Plan B replaced LiquidityReserve-funded Bootstrap with direct Treasury and
Community Safe funding of BootstrapVaultV3. The decision date is **8 March
2026**, recorded in [the Plan B changelog entry](CHANGELOG.md#plan-b-bootstrap-decision--2026-03-08).
That entry was added by commit `75994bb6d5810ec3d57d48351eb1e67c91ba4333`,
whose author and committer timestamp is **10 March 2026, 09:20:40 +02:00**
(07:20:40 UTC). This is the documentation timestamp, not the decision time.
The repository does not retain an exact time-of-day for the decision; neither
the commit timestamp nor the 11 March execution should be substituted for it.

Reproduce the documentary evidence locally:

```bash
git show --format=fuller 75994bb6d5810ec3d57d48351eb1e67c91ba4333 -- docs/CHANGELOG.md
```

The current changelog and [Bootstrap specification](BOOTSTRAP_VAULT_SPEC.md)
record the later funding/top-up separately. This historical Plan B is distinct
from the October Lane 3 fee-receiver option B and Benefits owner-B privacy model.
