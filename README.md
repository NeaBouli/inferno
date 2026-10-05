<p align="center">
  <img src="https://raw.githubusercontent.com/NeaBouli/inferno/main/docs/assets/ifr_icon_256.png" alt="Inferno $IFR" width="200" />
</p>

# Inferno Protocol ($IFR)

> Deflationary ERC-20 utility token on Ethereum Mainnet.
> Every standard transfer between non-exempt addresses burns 2.5% permanently.
> Lock IFR once — activate premium access while the required IFR remains locked and the integration remains available.

**Contract:** [`0x77e99917Eca8539c62F509ED1193ac36580A6e7B`](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code) | **Network:** Ethereum Mainnet | **Bootstrap:** FINALIZED ✅ June 5, 2026 | **LP Token:** [`0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`](https://etherscan.io/address/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0)

**[18 documented on-chain components](docs/DEPLOYMENTS.md#canonical-mainnet-component-count-18)** (15 deployed protocol contracts + 3 Gnosis Safes) | **Full internal audits** | **Public automated test evidence** | **Independent professional third-party audit pending**

### Quick Links

| Resource | Link |
|---|---|
| Website | [ifrunit.tech](https://ifrunit.tech) |
| Wiki/Docs | [ifrunit.tech/wiki](https://ifrunit.tech/wiki/index.html) |
| Web3 App | [web3.ifrunit.tech](https://web3.ifrunit.tech/) |
| IFR Benefits | [shop.ifrunit.tech](https://shop.ifrunit.tech/) |
| Current Functionality | [Verified surface and app status](docs/CURRENT_FUNCTIONALITY_STATUS.md) |
| Whitepaper | [One-Pager](https://ifrunit.tech/wiki/one-pager.html) |
| Bootstrap | [Bootstrap Event](https://ifrunit.tech/wiki/bootstrap.html) |
| Security | [Security Audit](https://ifrunit.tech/wiki/security.html) |
| Telegram | [t.me/IFRtoken](https://t.me/IFRtoken) |
| Twitter/X | [x.com/IFRtoken](https://x.com/IFRtoken) |
| Etherscan | [Token Page](https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B) |
| Token List | [ifrunit.tech/token-list.json](https://ifrunit.tech/token-list.json) |
| GitHub | [NeaBouli/inferno](https://github.com/NeaBouli/inferno) |

---

## What is Inferno?

Inferno (IFR) is a deflationary ERC-20 utility token on Ethereum. Every standard transfer between non-exempt addresses burns 2.5% permanently, reducing total supply over time. Users lock IFR tokens on-chain to activate builder-product access without a recurring subscription; access remains active while each product's required IFR stays locked and that integration remains available.

**Community Fair Launch Model** — No presale, no VC, no insider allocations.

> Inferno Protocol is fully open source and community-owned. No single entity controls the protocol. All contracts are verified on Ethereum Mainnet and protected by Gnosis Safe multisig. Protocol parameter changes go through Governance proposals with a 48-hour timelock. The deployed Governance contract's ownership itself can be transferred directly by its owner, the Treasury Safe (3-of-5), without that delay (tracked as CWA-25). The protocol lives on-chain — permanently.

## Token Economics

| Property | Value |
|---|---|
| Symbol | $IFR |
| Network | Ethereum Mainnet |
| Decimals | 9 |
| Genesis Supply | 1,000,000,000 IFR |
| Current Supply | ~997.67M (decreasing; verified 22 August 2026) |
| Burned | ~2.33M IFR since genesis (verified 22 August 2026) |
| Burn Rate | 2.5% per transfer (permanent) |
| Default Transfer Fee | 3.5% total (2.5% burn + 1% pool fee; hardcoded cap: 5%) |

## Key Features

- **Deflationary**: 2.5% burned per standard transfer between non-exempt addresses (2% sender + 0.5% recipient), plus a 1% pool fee; transfers where either side is fee-exempt pay no fee. Hard cap: 5% max.
- **Utility Lock**: Lock IFR → access while the required amount remains locked and the integration remains available → unlock anytime.
- **Timelock Governance**: 48-hour delay on protocol parameter changes via Governance proposals. Guardian cancel. The deployed Governance contract's ownership itself can be transferred directly by its owner, the Treasury Safe (3-of-5), without that delay (tracked as CWA-25).
- **No Mint Function**: Supply can only decrease, never increase.
- **Fair Launch**: No presale, no VC. Transparent allocation from day one.

## Token Allocation

| Allocation | Share | Amount | Note |
| --- | --- | --- | --- |
| DEX Liquidity | 40% | 400M IFR | Original intent: governance-controlled LP expansion. Current custody: the LP Reserve Safe (3-of-5, `0x5D93...C04`) holds 400.6M IFR, received from the Deployer on 18.03.2026; it does not hold the Treasury or Community allocations. The Bootstrap pool was created separately with 100M IFR + 0.030 ETH. |
| Liquidity Reserve | 20% | 200M IFR | Initial timelock ended 01.09.2026. The contract still holds all 200M IFR; the current withdrawal cap is 50M IFR per 90-day period — a Governance parameter (`setMaxWithdrawPerPeriod`, 48h timelock), not an immutable limit; only the 90-day period length is immutable. No withdrawal or LP deployment has occurred. NOT used for Bootstrap. |
| Team Vesting | 15% | 150M IFR | 12-month cliff, 36-month linear vesting. 0 tokens available before March 2027. |
| Treasury | 15% | 150M IFR | Original intent: genesis allocation to the Treasury Safe (3-of-5, `0x5ad6193...`). Current custody: the Treasury Safe holds 0 IFR — the full 150M funded BootstrapVaultV3 (144.75M IFR initial funding plus a 5.25M IFR top-up). No automatic refill path is deployed. |
| Community & Grants | 6% | 60M IFR | Original intent: genesis allocation to the Community Safe (3-of-5); 57.9M arrived after the 2.5% burn and 1% pool fee on the non-exempt migration transfer. Current custody: 50M funded BootstrapVaultV3 (Plan B, 11.03.2026); the Community Safe holds the remaining 7.9M operational reserve. |
| Builder Ecosystem | 4% | 40M IFR | PartnerVault contract. Partner rewards not active; planned only for verified checkout redemptions (model B). |

Custody figures verified on-chain at block 26,065,893; the block-pinned breakdown lives on the [transparency page](https://ifrunit.tech/wiki/transparency.html).

Until 5 October 2026 the 1% IFR transfer-pool fee accrued to FeeRouterV1, which has no IFR withdrawal or forwarding function: these fees stay there as a de-facto sink and are not forwarded to BuybackVault or BurnReserve (at block 26,065,893 both held 0 IFR while FeeRouterV1 held 722,304.949548316 IFR). No buyback/burn flywheel is fed by the pool fee today. Since Governance Proposal #21 (executed 5 October 2026, block 26,124,660) new pool fees go to BuybackController, where Governance can recover the IFR through `withdrawIFR`; the 734,545.074097347 IFR in FeeRouterV1 as of that block stay there.
Team tokens: 48-month vesting, 12-month cliff. Liquidity reserve: initial lock ended 01.09.2026; staged Governance-controlled withdrawals remain unused.

## Fair Launch

No presale, no VC, no IDO. Direct Uniswap V2 listing.
Team allocation (15%) is locked in a vesting contract for 4 years
with a 1-year cliff. See [Fair Launch Statement](docs/FAIR_LAUNCH.md).

## Smart Contracts (Ethereum Mainnet)

| Contract | Mainnet Address |
|----------|----------------|
| InfernoToken | [`0x77e99917Eca8539c62F509ED1193ac36580A6e7B`](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code) |
| Governance | [`0xc43d48E7FDA576C5022d0670B652A622E8caD041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#code) |
| IFRLock | [`0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`](https://etherscan.io/address/0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb#code) |
| BurnReserve | [`0xaA1496133B6c274190A2113410B501C5802b6fCF`](https://etherscan.io/address/0xaA1496133B6c274190A2113410B501C5802b6fCF#code) |
| BuybackVault | [`0x670D293e3D65f96171c10DdC8d88B96b0570F812`](https://etherscan.io/address/0x670D293e3D65f96171c10DdC8d88B96b0570F812#code) |
| PartnerVault | [`0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`](https://etherscan.io/address/0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D#code) |
| FeeRouterV1 | [`0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`](https://etherscan.io/address/0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a#code) |
| Vesting | [`0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`](https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271#code) |
| LiquidityReserve | [`0xdc0309804803b3A105154f6073061E3185018f64`](https://etherscan.io/address/0xdc0309804803b3A105154f6073061E3185018f64#code) |
| BootstrapVaultV3 | [`0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141`](https://etherscan.io/address/0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141#code) **[FINALIZED ✅ 05.06.2026]** |
| LP Token (IFR/WETH) | [`0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`](https://etherscan.io/address/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0) — retained in BootstrapVaultV3; Mainnet Team.Finance locker disabled and the vault exposes no LP withdrawal function |
| CommitmentVault (V1, legacy) | [`0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3`](https://etherscan.io/address/0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3#code) — existing tranches unlock through V1 |
| CommitmentVault V2 | [`0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F`](https://etherscan.io/address/0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F#code) — CV-01 repair, TIME_ONLY, fee-exempt since proposal #17 |
| BuilderRegistry | [`0xdfe6636DA47F8949330697e1dC5391267CEf0EE3`](https://etherscan.io/address/0xdfe6636DA47F8949330697e1dC5391267CEf0EE3#code) |
| LendingVault | [`0x974305Ab0EC905172e697271C3d7d385194EB9DF`](https://etherscan.io/address/0x974305Ab0EC905172e697271C3d7d385194EB9DF#code) |
| BuybackController | [`0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`](https://etherscan.io/address/0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c#code) |
| BootstrapVault V1 | [`0xA820540936d18e1377C39dd9445E5b36F3F1261a`](https://etherscan.io/address/0xA820540936d18e1377C39dd9445E5b36F3F1261a#code) **[DEPRECATED]** |

### Gnosis Safe (Mainnet)

| Role | Address |
| --- | --- |
| Treasury Safe (Governance owner) | [`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`](https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b) |
| Community Safe | [`0xaC5687547B2B21d80F8fd345B51e608d476667C7`](https://app.safe.global/home?safe=eth:0xaC5687547B2B21d80F8fd345B51e608d476667C7) |
| LP Reserve Safe | [`0x5D93E7919a71d725054e31017eCA86B026F86C04`](https://app.safe.global/home?safe=eth:0x5D93E7919a71d725054e31017eCA86B026F86C04) |

Documented threshold for all three Safes: 3-of-5 (5 active signers: G.M., M.G., A.M., Y.K., A.P.).
The 15 deployed protocol contracts above (LP token and deprecated BootstrapVault V1 excluded) plus these
3 Safes form the [18 documented on-chain components](docs/DEPLOYMENTS.md#canonical-mainnet-component-count-18).
The count lists deployed components, not a claim that all of them are active.

## Builder Ecosystem

Partner rewards are not active. Decided model (2026-10-03): pilot partners receive IFR from the 40M Builder Ecosystem Pool only for verified checkout redemptions, valued in EUR, within a fixed per-partner budget; a lock alone earns nothing ([policy](docs/PARTNER_REWARDS_MODEL_B.md)).

- Settlement: per period by Governance proposal (`recordMilestone`), capped by the partner allocation
- Vesting: 180-365 days per partner (contract bounds)
- No refill of the 40M pool; no authorized caller
- Unused contract path: `recordLockReward` (lock amount × `rewardBps`, 1500 bps configured, bounds 500-2500,
  annual cap 4M IFR); the algorithmic throttle is inactive because `ifrLock` is unset

Token holdings grant future DAO voting rights.

The ecosystem is open and permissionless. Any product can integrate IFR Lock.

[Integration Guide →](https://ifrunit.tech/wiki/integration.html)

## Testing & Security

**Automated test evidence** — current exact results are recorded by CI and release preflights. The tables below preserve an older internal inventory and must not be read as a current deduplicated total.

**Current canonical matrix:** contracts **690/690**, Generator Engine **30/30**,
IFR SDK **36/36**, Landing/Wiki browser **26/26**, Web3 browser **45/45**.
See [Current Functionality Status](docs/CURRENT_FUNCTIONALITY_STATUS.md) for
scope and limitations.

### Protocol Tests — 521

| Suite | Count | Framework |
|---|---|---|
| Smart Contracts | 367 | Hardhat/Mocha |
| BuilderRegistry | 27 | Hardhat |
| App Backend | 77 | Mocha |
| Bootstrap Suite | 50 | Hardhat |

### Ecosystem Tests — 57
| Suite | Count | Framework |
|---|---|---|
| Wallet Verification + OnChain | 23 | Mocha |
| Vote Announcements | 12 | Mocha |
| Bot Announcements | 10 | Mocha |
| Browser / WalletConnect | 12 | Playwright |

- Historical coverage snapshot: 90.79% branches / 99.45% statements (solidity-coverage, 544 tests, 05.03.2026) for the contract subset recorded in `docs/COVERAGE_REPORT.md`; not a current full-repository coverage claim. Current Hardhat 3 native coverage reports lines and statements only, so no current branch-coverage figure is published
- GitHub Actions CI contains scoped workflows for contracts/tooling, Benefits Network, SDK, Creator Gateway, Points Backend, AI Copilot, dashboards, Telegram bot, wallet prototype, documentation and security checks. Deployment availability is verified separately and must not be inferred from a passing source-validation workflow.
- Slither CI analyzes all 21 production Solidity sources and fails on every
  Critical signal and every new, changed or stale High signal. The current baseline contains five reviewed
  signals with an explicit classification and rationale. Under the pinned
  toolchain there are no unreviewed High signals and no reported Critical
  signals. See [`audit/slither-high-baseline.json`](audit/slither-high-baseline.json).
- The complementary Mythril CI gate performs bounded symbolic execution
  over all 17 concrete production contracts with pinned Mythril 0.24.8 and
  solc 0.8.28. The verified local run reported no signals at any severity; the
  gate fails closed on tool/compiler errors and every Critical, High or Medium
  signal. It runs for relevant contract/tooling changes, weekly and manually;
  this is bounded evidence, not a complete execution proof. The gate was
  integrated through PR #77 after exact-head and Main CI passed.
- Internal security audit: 0 FAIL, 20 active WARN, 1 fixed, 81 PASS ([full report](docs/SECURITY_AUDIT_SKYWALKER.md))
- App security review: 12 findings (2 CRITICAL, 5 HIGH — all fixed) ([full report](docs/APP_SECURITY_REVIEW.md))
- **Bootstrap security review (13.03.2026):** BootstrapVaultV3 + InfernoToken + FeeRouterV1 + Governance — 11/14 secure, 3/14 low risk, 0 critical ([full report](audit/BOOTSTRAP_SECURITY_REVIEW_13032026.md))
- Full Sepolia testnet deployment with verified contracts
- Governance lifecycle tested: propose → 48h wait → execute

## Community Audit

All smart contracts are open source and community review is explicitly encouraged.

- **Internal Audit:** [docs/SECURITY_AUDIT_SKYWALKER.md](docs/SECURITY_AUDIT_SKYWALKER.md) — 0 FAIL, 20 active WARN, 1 fixed, 81 PASS
- **OKComputer Community Audit (27.07.2026):** [current finding-by-finding status](docs/community-audits/JULY_2026_REMEDIATION_REGISTER.md) · [preserved original and provenance](docs/community-audits/README.md) — 12 fixed and verified, 3 partially remediated, 1 outdated snapshot corrected, 4 governance/future-version gated, 2 accepted or monitored and 1 open actionable; not a professional third-party certification
- **Collateral Web3 Open Audits (14.09.2026):** [seven reports and provenance](docs/community-audits/README.md) · [CWA-01…CWA-82 remediation register](docs/community-audits/CWA_REMEDIATION_REGISTER.md) · [consolidated PDF](docs/community-audits/IFR_Protocol_CWA_Consolidated_Audit_Report_2026-09-14.pdf) — 56 fixed and verified; 5 findings remain directly actionable
- **Submit a Finding:** [GitHub Private Vulnerability Reporting](https://github.com/NeaBouli/inferno/security/advisories/new)
- **Security Policy:** [SECURITY.md](SECURITY.md)

## Applications

| App | Path | Port | Stack |
|-----|------|------|-------|
| Token Dashboard | `apps/dashboard/` | 5173 | React 18 + Vite + ethers v6 + wagmi v2 |
| Governance Dashboard | `apps/governance-dashboard/` | 5174 | React 18 + Vite + TypeScript + Tailwind + ethers v6 |
| AI Copilot | `apps/ai-copilot/` | 5175 | React 18 + Vite + TypeScript + Tailwind + Express + ethers v6 |
| Points Backend | `apps/points-backend/` | 3004 | Express + Prisma 7 + SQLite + ethers v6 + siwe + jose |
| Creator Gateway | `apps/creator-gateway/` | 3005 | Express + ethers v6 + googleapis + JWT |
| Benefits Network Backend | `apps/benefits-network/backend/` | 3001 | Express + Prisma + SQLite + ethers v6 |
| Benefits Network Frontend | `apps/benefits-network/frontend/` | 3000 | Next.js 15 + Tailwind + wagmi v3 (PWA) |
| Benefits Wallet Prototype | `apps/benefits-wallet-prototype/` | 3012 | Isolated prototype; not used in production |
| IFR SDK | `apps/sdk/` | — | TypeScript package; tested locally, npm publication pending |
| Integration Builder Engine | `apps/builder/engine/` | — | Code/config generator; 30 focused tests |
| Telegram Bot | `apps/telegram/telegram-bot/` | — | Telegraf + ethers v6 + Railway (16 commands, moderation, governance notifier) |

Deployment and acceptance vary by package. The authoritative status for each
public surface and repository application is the
[Current Functionality Status](docs/CURRENT_FUNCTIONALITY_STATUS.md).
`apps/admin-console/` and `apps/investor-web/` are placeholders, not implemented
applications.

### Token Dashboard

Token dashboard for monitoring balances, transfers, lock management, and contract status.

**Start:** `cd apps/dashboard && npm ci && npm run dev` → http://localhost:5173

### Benefits Network

The IFR Benefits Network lets any business verify on-chain IFR lock status to grant discounts and premium access. QR-based flow — no accounts, no subscriptions.

**Routes:** `/` (role chooser and wallet/seller workspace) · `/b/:businessIdOrSlug` (seller console) · `/s/:businessIdOrSlug` (public catalog) · `/p/:passId` (customer pass) · `/r/:sessionId` (customer verification) · `/scan` (QR/manual entry) · `/guide` · `/support` · `/privacy`

### Governance Dashboard

Read-only governance dashboard for monitoring PartnerVault, proposals, and generating calldata.

**Tabs:** Overview · Builders · Timelock Queue · Calldata Generator

**Start:** `cd apps/governance-dashboard && npm run dev` → <http://localhost:5174>

### Council agenda and voting plans

The [Council agenda](docs/wiki/governance.html#council-agenda) separates current discussion drafts from the proposal procedure and historical records. The web voting portal is planned, not live; open and secret ballots require separate security and privacy acceptance. Network-level IP non-correlation is not guaranteed. Voting-weight alternatives remain unratified, and a ballot does not authorize or execute a Safe transaction. See the [Phase 4 roadmap](docs/wiki/roadmap.html) and [privacy requirements](docs/wiki/governance.html#council-privacy).

### User-provided IFR / ETH liquidity

The [liquidity guide](docs/wiki/liquidity.html) is discoverable from the landing Quick Start wizard and Wiki navigation. Its read-only calculator verifies Ethereum pool identities, same-block reserves, freshness and the pair's fee exemption before estimating matching ETH using integer IFR amounts (9 decimals).

Below the landing protocol summary, liquidity depth displays verified ETH buy capacity at 0.5/1/2/5% curve-only price impact, paired reserves and block time. An editable ETH buy determines the WETH reserve needed at the 1% comparison threshold and proportional additional ETH/IFR liquidity. The dial compares current reserves to this calculated requirement, not a fixed 1 WETH target. It is not a safety or return score. The 0.30% V2 fee is separate from curve impact; gas, interface and route-dependent token fees are excluded. A status LED distinguishes verified, updating and unavailable data. Reads refresh every minute while visible; expired data hides calculations. All calculations are read-only bigint planning estimates, not execution quotes. Tests: `node scripts/test-liquidity-gauge.mjs` and `node scripts/test-liquidity-browser.mjs`.

Deposits, LP approvals and withdrawals take place **externally on Uniswap V2**, not inside this site. LP tokens represent a share of current reserves; they are not IFRLock access or automatic Builder rewards. Withdrawal routes through non-exempt intermediaries can incur IFR transfer fees. No return, fixed withdrawal amount or fee-free router path is promised.

Checks: `node scripts/test-liquidity-guide.mjs`, `node scripts/test-liquidity-integration.cjs`, `node scripts/test-liquidity-browser.mjs`. Browser tests use mocked chain data; `RUN_LIVE_POOL=1` adds a public read-only RPC smoke check. No real wallet signing is performed.

### AI Copilot

Embedded chat widget with RAG knowledge base — helps users, builders, and developers understand IFR.

**Modes:** Customer · Builder · Developer

**Safety:** No surface runs an automatic seed-phrase or private-key detector. The served chat widget (`copilot-api.ifrunit.tech`, embedded on the site) shows a static "never share private keys" notice, and the system prompts instruct the model never to ask for or accept seed phrases, private keys or mnemonics. The standalone React component (`apps/ai-copilot/src/components/IFRCopilot.tsx`) adds a client-side keyword warning for the phrases "seed phrase", "private key", "mnemonic" and "secret recovery"; it does not recognise raw keys or word lists. Source citation tags.

**Start:** `cd apps/ai-copilot && npm ci && cp .env.example .env && npm run dev` → http://localhost:5175

### Points Backend

SIWE authentication, points tracking, and EIP-712 signed voucher issuance for protocol fee discounts.

**IFR Points are not a token** — no transfer value, no monetary promise. Points only reduce the protocol fee on a single swap (via EIP-712 discount voucher).

**Endpoints:** `/auth/siwe/*` (SIWE auth) · `/points/*` (events + balance) · `/voucher/issue` (EIP-712 voucher)

**Anti-Sybil:** Rate limiting per IP + per wallet + global daily caps.

**Start:** `cd apps/points-backend && npm ci && npx prisma migrate dev --name init && npm run dev` → http://localhost:3004

## Documentation

- [Landing Page](https://ifrunit.tech/)
- [Technical Wiki](https://ifrunit.tech/wiki/)
- [Contracts Reference](https://ifrunit.tech/wiki/contracts.html)
- [Integration Guide](https://ifrunit.tech/wiki/integration.html)
- [Security Audit](https://ifrunit.tech/wiki/security.html)
- [Governance Constitution](docs/GOVERNANCE_CONSTITUTION.md) — Hard bounds, roles, upgrade path
- [Business Onboarding](docs/BUSINESS_ONBOARDING.md) — Benefits Network setup & go-live checklist
- [Builder Integration Spec](docs/PARTNER_INTEGRATION_SPEC.md) — Technical spec: IFRLock + PartnerVault ABI, Rewards, Algo Throttle
- [Mainnet Checklist](docs/MAINNET_CHECKLIST.md) — Deployment order, verification, post-deploy
- [Security Audit Brief](docs/AUDIT_BRIEF.md) — Scope, audit areas, auditor recommendations
- [OKComputer Community Audit Status](docs/community-audits/JULY_2026_REMEDIATION_REGISTER.md) — Current evidence-backed status for all 23 normalized findings; original report preserved (one owner-requested company-name redaction)
- [CWA Remediation Register](docs/community-audits/CWA_REMEDIATION_REGISTER.md) — Authoritative CWA-01…CWA-82 status, ownership, next action and verification requirement
- [CWA Consolidated PDF](docs/community-audits/IFR_Protocol_CWA_Consolidated_Audit_Report_2026-09-14.pdf) — Seven-report community audit series with disclosed aggregate correction
- [Multisig Setup Guide](docs/MULTISIG_SETUP.md) — Gnosis Safe, signer structure, ownership transfer
- [Whitepaper / One-Pager](docs/WHITEPAPER.md) — Project overview for builders & investors
- [Creator Gateway Spec](docs/CREATOR_GATEWAY.md) — YouTube Hybrid Model, Docker Quickstart, Entitlement Engine
- [SDK / Developer Quickstart](docs/SDK_QUICKSTART.md) — ethers.js, wagmi, Python, Tier System, Wallet Verification
- [Testnet E2E Guide](docs/TESTNET_GUIDE.md) — Full Lock/Benefit/Governance/FeeRouter flow on Sepolia
- [Changelog](docs/CHANGELOG.md) — All changes chronologically
- [Internal Audit Checklist V3](docs/CHATGPT_AUDIT_PROMPT_V3.md) — Internal checklist (12 audit areas)
- [Internal Audit Checklist V4](docs/CHATGPT_AUDIT_PROMPT_V4.md) — Anti-Sybil, SIWE, integration and number-consistency checks
- [Investor One-Pager](docs/ONE-PAGER.md) — Key numbers, products, technology, pre-mainnet checklist
- [E2E Flow: Points → Voucher → FeeRouter](docs/E2E_FLOW.md) — Complete end-to-end flow
- [YouTube Integration Guide](docs/YOUTUBE_INTEGRATION.md) — Hybrid Model B, Creator Gateway, Entitlement Config
- [Security Policy](docs/SECURITY_POLICY.md) — Responsible Disclosure, bug bounty status (no program), Scope
- [Tokenomics Model](docs/TOKENOMICS_MODEL.md) — Deflation curve, emission model, lock economics
- [Partner Rewards Model B](docs/PARTNER_REWARDS_MODEL_B.md) — Current reward policy (verified checkout redemptions, budgets, settlement)
- [Builder Rewards Spec](docs/PARTNER_REWARDS_SPEC.md) — PartnerVault contract mechanics (lock formula not used as policy)
- [Benefits Network Test Guide](docs/BENEFITS_NETWORK_TEST.md) — E2E test, API endpoints, lock tiers
- [Coverage Report](docs/COVERAGE_REPORT.md) — historical solidity-coverage snapshot, 05.03.2026 (99.45% Stmts, 90.79% Branch)
- [Patch Guidelines](docs/PATCH-GUIDELINES.md) — Patch process, severity, versioning
- [Contributing Guide](docs/CONTRIBUTING.md) — Bug reports, code standards, git conventions
- [Transparency Report](docs/TRANSPARENCY.md) — On-chain audit (8 checks), supply distribution, vesting, LP status
- [Fair Launch Statement](docs/FAIR_LAUNCH.md) — No presale, no VC, team allocation comparison, on-chain evidence
- [Fee Design](docs/FEE_DESIGN.md) — Why 3.5%, fee-exempt addresses, CEX strategy, MEV/slippage
- [Off-Chain Security](docs/OFFCHAIN_SECURITY.md) — VoucherSigner key management, JWT, SIWE, rate limiting
- [Audit Submission](docs/AUDIT_SUBMISSION.md) — Code4rena/Sherlock prep (9 contracts, 1697 SLOC, scope, known issues)
- [Press Kit](docs/PRESS_KIT.md) — Key facts, token allocation, roadmap, links
- [GitHub Secrets Guide](docs/GITHUB_SECRETS.md) — Required secrets for GitHub Actions CI/CD
- [Internal Audit V3 Results](docs/CHATGPT_AUDIT_V3_RESULTS.md) — Internal V3 self-check record
- [Railway Env Guide](docs/RAILWAY_ENV.md) — Points Backend Railway deploy (env vars, CLI setup)
- [Vercel Env Guide](docs/VERCEL_ENV.md) — AI Copilot Vercel + Railway deploy (two-app, proxy config)
- [Roadmap](docs/ROADMAP.md) — 6-phase roadmap (Foundation → Governance → Ecosystem → Mainnet → Growth → DAO)
- [Page Update Checklist](docs/PAGE_UPDATE_CHECKLIST.md) — Which files to update for each event
- [Deployment Stats](docs/stats.json) — Auto-generated on-chain stats (via update-stats.js)
- [Project Summary](docs/PROJECT-SUMMARY.md) — Historical project snapshot; use current Wiki, CI and release records for live counts
- [Release Notes v0.1.0](docs/RELEASE_NOTES_v0.1.0.md) — First tagged release (Sepolia testnet)
- [Lighthouse Report](docs/LIGHTHOUSE_REPORT.md) — SEO optimizations (OG, Twitter Card, meta tags, sitemap, robots.txt)
- [AI Copilot Test Results](docs/COPILOT_TEST_RESULTS.md) — RAG system test (6 questions, 3 modes, safety guards)
- [Roadmap v0.2.0](docs/ROADMAP_v0.2.0.md) — Mainnet-ready milestones (audit, multisig, deploy, post-launch)
- [Internal Audit V4 Results](docs/CHATGPT_AUDIT_V4_RESULTS.md) — Internal V4 self-check record
- [Internal Audit V5 Results](docs/CHATGPT_AUDIT_V5_RESULTS.md) — Internal cross-audit record for W15-W21
- [GitHub Setup](docs/GITHUB_SETUP.md) — Repository settings (Discussions, Topics, Pages)
- [App Security Review](docs/APP_SECURITY_REVIEW.md) — Full app review (12 findings, 7 fixed: CORS, JWT, ABI, wallet validation)

## Development

### Hardhat Admin Tasks

```bash
# Sepolia (historical/testing) — use --network mainnet for production
npx hardhat lock-check --wallet 0x... --network sepolia
npx hardhat vault-status --network sepolia
npx hardhat feerouter-status --network sepolia
npx hardhat token-stats --network sepolia
npx hardhat gov-queue --network sepolia
```

### Mainnet Preparation Scripts

```bash
# Mainnet deploy — DRY RUN (all 9 contracts, 12 steps)
npx hardhat run scripts/deploy-mainnet.js --network hardhat

# Mainnet deploy — LIVE (requires env vars: TREASURY_ADDRESS, COMMUNITY_ADDRESS, TEAM_BENEFICIARY, VOUCHER_SIGNER_ADDRESS)
npx hardhat run scripts/deploy-mainnet.js --network mainnet

# On-chain audit (8 checks) — use --network mainnet for production
npx hardhat run scripts/onchain-audit.js --network sepolia

# Propose ownership transfer (historical/testing)
npx hardhat run scripts/propose-ownership-transfer.js --network sepolia

# Execute ownership transfer (after 48h timelock, historical/testing)
PROP_RESERVE=4 PROP_BUYBACK=5 PROP_BURN=6 npx hardhat run scripts/execute-ownership-transfer.js --network sepolia

# Burn LP tokens (historical/testing)
npx hardhat run scripts/burn-lp-tokens.js --network sepolia

# Governance: set poolFeeReceiver to FeeRouterV1 (Proposal #6)
npx hardhat run scripts/propose-set-pool-fee-receiver.js --network mainnet
```

## Team

Inferno Protocol is developed by a pseudonymous team in the open-source DeFi tradition.

**Transparency through:**
- All contracts open source + Etherscan verified
- On-chain governance (48h timelock)
- Treasury: 3-of-5 Gnosis Safe multisig
- Public audit: [security.html](https://ifrunit.tech/wiki/security.html)
- Contact: GitHub Issues or Telegram @IFR_token

## Integrated Builder Products

| Project | Category | Integration |
|---|---|---|
| K-9 Academy | Education | IFR Lock for course access |
| StealthX/SecureCall/SecureChat/Chameleon | Privacy | IFR holder verification for 50% checkout discount |
| NEXUS GR | B2B Marketplace | Coming Soon |

## License

The source code in this repository is released under the [MIT License](LICENSE).
The names "Inferno", "Inferno Protocol" and "IFR", and the project logos, are not
licensed for use as trademarks.
