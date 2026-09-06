# Current Functionality Status

**Verified:** 6 September 2026
**Repository baseline:** current release branch
**Network:** Ethereum Mainnet

This document is the canonical boundary between implemented, operational and
still-pending functionality. Historical test counts and roadmap snapshots do
not override this status.

## Public Surfaces

| Surface | Current capability | Boundary still open |
|---|---|---|
| [Landing](https://ifrunit.tech/) | Public protocol overview, live/read-only status, Uniswap handoff, token import and the established minimal injected-wallet flow. | The landing intentionally does not provide the broad connector set or all protocol writes. Those belong to Web3. |
| [Wiki](https://ifrunit.tech/wiki/) | Technical documentation, Mainnet reads and focused wallet interactions on the relevant contract pages. | Documentation pages are not a substitute for governance activation. Lending borrowing and price-conditioned commitments remain unavailable while their Mainnet price inputs are unset. |
| [Web3](https://web3.ifrunit.tech/) | Injected-wallet and WalletConnect selection, connector identity, disconnect, IFR balance, token import, IFRLock lock/unlock, CommitmentVault tranche management, LendingVault offer creation/withdrawal and live lending reads. | Mainnet borrowing is disabled because `LendingVault.ifrPriceWei = 0`. CommitmentVault price-only, time-or-price and time-and-price locks are disabled because `priceOracle` is the zero address. TIME_ONLY locks remain available. |
| [IFR Benefits](https://shop.ifrunit.tech/) | Installable customer/seller PWA, external-wallet connection, seller profiles and catalogs, benefit rules, customer passes, QR scan/manual entry, proof approval, one-time redemption and guarded seller-reward configuration. | Production uses external self-custody wallets. The embedded-wallet package is a prototype only. Automated release gates pass, but the physical device/wallet acceptance matrix is 1/10 and remains an explicit release follow-up. PartnerVault rewards require separate on-chain registration, allocation and authorized processing; profile creation alone does not activate rewards. |

## Mainnet Capability Snapshot

Base read-only verification at Ethereum block `25812380`; the
LiquidityReserve row was refreshed at block `25918433`:

| Component | Verified state | Operational meaning |
|---|---|---|
| InfernoToken | `997,673,879.091903855 IFR` total supply | Live; supply has decreased from the 1B genesis supply. |
| LiquidityReserve | Initial timelock ended 01.09.2026; `200,000,000 IFR` held; `50,000,000 IFR` currently withdrawable under the 90-day cap; `0 IFR` withdrawn as verified at block `25918433` | Availability is staged, not an automatic transfer or LP addition. Any use requires Governance proposal, 48-hour timelock and execution; no LiquidityReserve proposal was pending at block `25918433`. |
| IFRLock | `2,000 IFR` locked | Simple refundable access lock is operational. |
| CommitmentVault | `47,952,476.871794375 IFR` locked; `priceOracle = 0x0` | TIME_ONLY commitments are operational. Price-conditioned commitments fail closed. |
| LendingVault | 3 offers; `52,155,440.952845656 IFR` available; `0 IFR` lent; `ifrPriceWei = 0` | Lender offer management is operational. Borrowing is intentionally disabled. |
| BuilderRegistry | 0 registered and 0 active builders | Builder and PartnerVault reward activation remains governance work; public Benefits seller profiles are not automatically on-chain builders. |

## Repository Applications

| Application/package | Status |
|---|---|
| Web3 static PWA (`docs/web3`) | Public Mainnet interface; automated wallet/write-path tests pass. |
| Benefits frontend/backend (`apps/benefits-network`) | Public production application; full automated preflight passes. Physical wallet/device acceptance remains incomplete. |
| Benefits embedded wallet (`apps/benefits-wallet-prototype`) | Isolated prototype; not used by production and not approved for custody or recovery. |
| IFR SDK (`apps/sdk`) | Tested local package; public npm publication remains a separate release gate. |
| Dashboard and governance dashboard | Repository applications; not represented as the primary production user interface. |
| Creator Gateway, Points Backend and AI Copilot | Implemented repository services with their own configuration/deployment requirements; availability must not be inferred from source presence alone. |
| Admin console and investor web placeholders | Not implemented applications. |

## Verification Evidence

The current baseline combines clean-install audits, contract tests and the
browser/application verification retained by the release gates:

- Smart contracts: `644/644` passing, including the CommitmentVault and
  LendingVault fee-exemption deficit regressions.
- Generator Engine: `30/30` passing.
- IFR SDK legacy suite: `36/36` passing.
- Landing/Wiki wallet browser suite: `20/20` passing.
- Web3 write-path browser suite: `24/24` passing.
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
2. Keep LendingVault borrowing disabled until a separately audited price/oracle,
   pause, freshness, cap and emergency-control design is deployed.
3. Keep CommitmentVault price-conditioned locks disabled until a real oracle
   path is deployed and tested; use TIME_ONLY for current commitments.
4. Register and activate builders/reward wallets only through the documented
   governance-controlled BuilderRegistry and PartnerVault process.
5. Publish the SDK only through its separate package release gate.
6. Complete the independent professional third-party audit.
