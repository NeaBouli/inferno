# Current Functionality Status

**Verified:** 6 September 2026
**Repository baseline:** current release branch
**Network:** Ethereum Mainnet

This document is the canonical boundary between implemented, operational and
still-pending functionality. Historical test counts and roadmap snapshots do
not override this status.

**Audit remediation checkpoint:** 5 October 2026. The seven CWA reports are
published, but publication is not remediation. The authoritative
[CWA-01…CWA-82 register](community-audits/CWA_REMEDIATION_REGISTER.md) records
56 fixed and verified, 8 governance or owner gated, 2 accepted or monitored,
5 open actionable and 11 informational findings.

## Public Surfaces

| Surface | Current capability | Boundary still open |
|---|---|---|
| [Landing](https://ifrunit.tech/) | Public protocol overview, live/read-only status, Uniswap handoff, token import and the established minimal injected-wallet flow. | The landing intentionally does not provide the broad connector set or all protocol writes. Those belong to Web3. |
| [Wiki](https://ifrunit.tech/wiki/) | Technical documentation, Mainnet reads and focused wallet interactions on the relevant contract pages. | Documentation pages are not a substitute for governance activation. Official interfaces permanently retire LendingVault V1 creation/increase and new borrowing under owner policy (#209/#211), regardless of price; underlying contract functions are not removed. Full-available lender withdrawal and existing-loan repayment/top-up remain available. Price-conditioned CommitmentVault locks remain unavailable while their Mainnet price input is unset. |
| [Web3](https://web3.ifrunit.tech/) | Injected-wallet and WalletConnect selection, connector identity, disconnect, IFR balance, token import, IFRLock lock/unlock, CommitmentVault tranche management, LendingVault full-available lender withdrawal, existing-loan repayment/top-up and live lending reads. | Official interfaces permanently retire LendingVault V1 creation/increase and new borrowing under owner policy (#209/#211), regardless of price (accepted frontend release `50af`). Underlying contract functions are not removed. The retained contract-input snapshot `LendingVault.ifrPriceWei = 0` is separate from permanent interface retirement. CommitmentVault price-only, time-or-price and time-and-price locks are disabled because `priceOracle` is the zero address. TIME_ONLY locks remain available. |
| [IFR Benefits](https://shop.ifrunit.tech/) | Installable customer/seller PWA, external-wallet connection, seller profiles and catalogs, benefit rules, customer passes, QR scan/manual entry, proof approval, one-time redemption and guarded seller-reward configuration. | Owner-B source is merged (#238), but production backend activation remains HOLD pending the customer-privacy migration. The production backend is unchanged; storage-free customer-wallet/history handling is a post-migration contract, not a production guarantee. Production uses external self-custody wallets. The embedded-wallet package is a prototype only. Automated release gates pass, but the physical device/wallet acceptance matrix is 1/10 and remains an explicit release follow-up. PartnerVault Model B rewards require registration, allocation and per-period Governance `recordMilestone`, not an authorized-caller path; no pilot partner is activated. Profile creation alone does not activate rewards. |

## Mainnet Capability Snapshot

Base read-only verification at Ethereum block `25812380`; the
LiquidityReserve row was refreshed at block `25918433`:

| Component | Verified state | Operational meaning |
|---|---|---|
| InfernoToken | `997,673,879.091903855 IFR` total supply | Live; supply has decreased from the 1B genesis supply. |
| LiquidityReserve | Initial timelock ended 01.09.2026; `200,000,000 IFR` held; `50,000,000 IFR` currently withdrawable under the 90-day cap; `0 IFR` withdrawn as verified at block `25918433` | Availability is staged, not an automatic transfer or LP addition. Any use requires Governance proposal, 48-hour timelock and execution; no LiquidityReserve proposal was pending at block `25918433`. |
| IFRLock | `2,000 IFR` locked | Simple refundable access lock is operational. |
| CommitmentVault | `47,952,476.871794375 IFR` locked; `priceOracle = 0x0` | TIME_ONLY commitments are operational. Price-conditioned commitments fail closed. |
| LendingVault | 3 offers; `52,155,440.952845656 IFR` available; `0 IFR` lent; `ifrPriceWei = 0` | Dated contract-input snapshot, not a fresh measurement or intrinsic contract disablement. Official interfaces permanently retire V1 creation/increase and new borrowing regardless of price; full-available withdrawal and existing-loan repayment/top-up remain available. |
| BuilderRegistry | 0 registered and 0 active builders | Builder and PartnerVault reward activation remains governance work; public Benefits seller profiles are not automatically on-chain builders. |

## Repository Applications

| Application/package | Status |
|---|---|
| Web3 static PWA (`docs/web3`) | Public Mainnet interface; automated wallet/write-path tests pass. |
| Benefits frontend/backend (`apps/benefits-network`) | Public production application; owner-B source is merged (#238), not activated in production. Production backend activation remains HOLD pending the customer-privacy migration; the frontend-only release did not migrate or restart the backend. Storage-free handling is not a production guarantee. Physical wallet/device acceptance remains incomplete. |
| Benefits embedded wallet (`apps/benefits-wallet-prototype`) | Isolated prototype; not used by production and not approved for custody or recovery. |
| IFR SDK (`apps/sdk`) | Published npm `ifr-sdk` **0.4.0**; source/docs **0.4.1** is unpublished. Publisher validation and the separate npm release gate remain pending; source presence is not publication or #238 backend cutover. |
| Dashboard and governance dashboard | Repository applications; not represented as the primary production user interface. |
| Points Backend, AI Copilot and Telegram bot | Deployed services listed under Deployed Application Inventory below. |
| Creator Gateway | Implemented repository service; the repository holds no production deployment record, so availability must not be inferred from source presence alone. |
| Admin console and investor web placeholders | Not implemented applications. |

## Deployed Application Inventory

The "four" public surfaces in the table above (Landing, Wiki, Web3, IFR
Benefits) are what users open directly. They run as seven deployment units.
The repository evidence below shows where each unit is configured. It records
deployment, not current health: live availability needs the release/health
evidence of the respective deploy.

| # | Deployment unit | Host | Repository evidence |
| --- | --- | --- | --- |
| 1 | Landing and Wiki (static, GitHub Pages) | `ifrunit.tech` | `docs/CNAME` |
| 2 | Web3 static PWA (nginx) | `web3.ifrunit.tech` | `infra/web3/web3-security-headers.conf` |
| 3 | IFR Benefits frontend | `shop.ifrunit.tech` | `scripts/deploy-benefits-network.sh` |
| 4 | IFR Benefits backend | `shop.ifrunit.tech/api` | `scripts/deploy-benefits-network.sh` |
| 5 | Points Backend | `points-api.ifrunit.tech` | `docs/POINTS_BACKEND_MIGRATION.md`, `docs/runbooks/SERVER_CAPACITY_RUNBOOK.md` |
| 6 | AI Copilot | `copilot-api.ifrunit.tech` | embedded by Web3 via `infra/web3/web3-security-headers.conf` |
| 7 | Telegram bot and wallet-verification API | `verify-api.ifrunit.tech` | `docs/wiki/verify.html` |

Creator Gateway, the dashboards, the SDK and the embedded-wallet prototype are
not deployment units in this inventory.

## Verification Evidence

The current baseline combines clean-install audits, contract tests and the
browser/application verification retained by the release gates:

- Smart contracts: `700/700` passing in accepted CI run `37998031908`,
  step "Run contract and tooling tests", 9 October 2026 at
  `22:14:36.8215428Z`, source `d095ff4b73ea78466b3aa45ff10e7621f5d2eb57`.
  This is the prior 693 plus exactly 7 FeeRouter parity tests, including the
  existing CommitmentVault and LendingVault fee-exemption deficit regressions,
  PriceLockVault (#172), Builder fee-on-transfer (#178) and PartnerVault Model B
  template (#216) suites. The log reports `700 passing (16s)` / `700 passing (700 mocha)`.
  The Mocha serializer selfcheck runs separately in `.github/workflows/contracts.yml`
  and is not part of the contract total; it must not turn 700 into 701.
- Generator Engine: `30/30` passing.
- IFR SDK legacy suite: `36/36` passing.
- Landing/Wiki wallet browser suite: `26/26` passing in retained T-274 evidence.
- Web3 write-path browser suite: `85/85` passing in retained T-274 evidence.
  Browser evidence is dated 6 October 2026 (`eead5086`, see the
  [T-274 changelog](CHANGELOG.md)); no new browser run is claimed by the
  9 October Contract CI run or this documentation correction.
- Surface routing, wiki head integrity, wiki RAG freshness, content trust,
  status baseline and dependency-advisory checks: passing.
- Benefits full preflight: frontend/backend dependency audits, TypeScript,
  production build, migrations, unit/integration/full-stack/browser/security
  gates and SDK consumer tests passing.
- Benefits physical device/wallet checklist: `1/10` passed, `9` pending.
- AI Copilot, dashboard, governance dashboard, Creator Gateway, Points Backend,
  SDK, Telegram bot and wallet-prototype package gates were exercised from
  their lockfiles. The governance-dashboard `nanoid` advisory was remediated;
  remaining non-primary-app warnings are recorded in `KNOWN-ISSUES.md`.

Automated tests validate deterministic code paths and emulated browser flows.
They do not replace a real-device wallet signature, on-chain governance action,
production monitoring or an independent professional third-party audit.

## Open Activation And Acceptance Work

1. Complete the remaining Benefits iOS, Android and desktop wallet/device
   evidence, including an eligible APPROVED-to-REDEEMED path and replay block.
2. Keep official-interface LendingVault V1 creation/increase and new borrowing
   permanently retired under owner policy (#209/#211), regardless of price.
   Full-available lender withdrawal and existing-loan repayment/top-up remain;
   a future replacement requires separate design, audit and authorization,
   not reactivation of the retired V1 frontend path.
3. Keep CommitmentVault price-conditioned locks disabled until a real oracle
   path is deployed and tested; use TIME_ONLY for current commitments.
4. Register and activate builders/reward wallets only through the documented
   governance-controlled BuilderRegistry and PartnerVault process.
5. Publish source/docs `ifr-sdk` 0.4.1 only through its separate package release
   gate and publisher validation; npm 0.4.0 is already published. Preserve the
   #238 compatibility/cutover HOLD until the customer-privacy migration is authorized.
6. Complete the independent professional third-party audit.
