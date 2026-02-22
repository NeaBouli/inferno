# Project Handover – Inferno ($IFR)

## Current Status

**Date:** 2026-02-22
**Branch:** `main` at commit `45560512`
**Working tree:** Clean — no uncommitted changes. All pushed to `origin/main`.
**Phase:** Sepolia testnet fully deployed and verified. Pre-mainnet preparation phase.

All 8 smart contracts are deployed, verified on Etherscan, and operational on Sepolia. The Uniswap V2 LP pair is live. Ownership has been transferred from the deployer to the Governance timelock contract. The landing page (GitHub Pages), documentation wiki (8 pages), React dashboard (Phase 1 + Phase 2), and README are all up to date.

**TIME-CRITICAL pending action:** Governance Proposal #1 (setFeeExempt for IFRLock) reaches its 48h timelock ETA at **2026-02-22 21:15 CET**. After that time, execute it:
```bash
npx hardhat run scripts/execute-proposal.js --network sepolia
npx hardhat run scripts/test-lock.js --network sepolia   # full unlock test
```

## Architecture Decisions

### Token Design
- **ERC-20 with 9 decimals** (not 18) — deliberate choice for the token's intended use case.
- **Fee-on-transfer deflation:** Every transfer deducts 2% sender burn + 0.5% recipient burn + 1% pool fee = 3.5% total (2.5% permanently burned, 1% to poolFeeReceiver). Hard cap at 5% max total fee via `MAX_FEE_BPS`.
- **No mint function.** Supply can only decrease. Initial supply: 1,000,000,000 IFR.
- **Community Fair Launch Model (CFLM):** No presale, no VC, no seed round. All tokens distributed at deploy time.

### Token Allocation (6 categories)
| Allocation | Share | Amount | Mechanism |
|-----------|-------|--------|-----------|
| DEX Liquidity | 40% | 400M | Paired with ETH on Uniswap V2 |
| Liquidity Reserve | 20% | 200M | 6-month lock, 50M/quarter staged release |
| Team (Vested) | 15% | 150M | 12-month cliff + 36-month linear vesting |
| Treasury | 15% | 150M | Multisig-controlled |
| Community & Grants | 6% | 60M | Grants, bounties, ecosystem development |
| Partner Ecosystem | 4% | 40M | Milestone-based partner allocations, vested 6-12mo |

The 6%/4% split of the former "Community/Ecosystem 10%" was implemented on 2026-02-22 across all docs, landing page, and wiki.

### Partner Tier Model
- Launch Partner: up to 5M IFR (0.5%), 12-month vest
- Tier 1: up to 2M IFR, 12-month vest (5,000+ lock users)
- Tier 2: up to 1M IFR, 6-month vest (1,000+ lock users)
- Tier 3: up to 500K IFR, 6-month vest (new integrations)
- All milestone-based. Partner tokens grant DAO voting rights in Phase 4.

### Governance
- Timelock with 48h default delay (configurable 1h–30d via self-governance).
- Proposal lifecycle: `propose()` → 48h wait → `execute()`. Guardian can `cancel()`.
- Ownership of InfernoToken transferred to Governance contract. Deployer has no direct control.

### IFRLock (Utility Lock)
- Users lock IFR to get lifetime premium access to partner products. `isLocked(user, minAmount)` is the read function partners query.
- Requires `feeExempt` status on InfernoToken — without it, transfer fees cause `unlock()` to fail (contract holds less than recorded amount). This is set via Governance Proposal #1 (pending execution).
- ReentrancyGuard, Pausable, Guardian auth, multi-app `lockType` tag.

### Tech Stack
- **Contracts:** Solidity 0.8.20, Hardhat v2, ethers v5, OpenZeppelin v5, Chai v4
- **Hardhat is CJS-only** — no ESM. All scripts/tests use `require()`.
- **Dashboard:** React 18 + Vite + ethers v5 (ESM — separate from Hardhat)
- **Landing page:** Static HTML/CSS/JS served via GitHub Pages from `docs/` folder

### Why These Choices
- OpenZeppelin v5 for battle-tested base contracts (ERC20, Ownable, ReentrancyGuard, Pausable).
- Uniswap V2 (not V3) for simpler LP pairing and wider testnet support.
- 48h timelock chosen as balance between security and operational speed.
- No DAO from day one — phased approach (Admin → Multisig → DAO) to prevent governance attacks on immature protocol.

## Project Structure

```
inferno/
├── contracts/
│   ├── token/InfernoToken.sol        # 76 LOC — ERC20, fee-on-transfer, 9 decimals
│   ├── liquidity/LiquidityReserve.sol # 139 LOC — 6mo lock, 50M/quarter
│   ├── vesting/Vesting.sol           # 111 LOC — 12mo cliff, 36mo linear
│   ├── buyback/BuybackVault.sol      # 154 LOC — ETH→IFR, 50/50 split, 60d activation
│   ├── burnreserve/BurnReserve.sol   # 86 LOC — permanent burn, totalBurned tracking
│   ├── governance/Governance.sol     # 150 LOC — timelock, propose/execute/cancel
│   ├── lock/IFRLock.sol              # 127 LOC — utility lock, isLocked(), lockType
│   ├── mocks/                        # MockToken, MockRouter, MockInfernoToken
│   └── presale/                      # EMPTY — removed during CFLM migration
├── test/
│   ├── InfernoToken.test.js          # 21 tests
│   ├── LiquidityReserve.test.js      # 28 tests
│   ├── Vesting.test.js               # 7 tests
│   ├── BuybackVault.test.js          # 9 tests
│   ├── BurnReserve.test.js           # 21 tests
│   ├── Governance.test.js            # 36 tests
│   └── IFRLock.test.js               # 29 tests  (not 32 — 29 is correct)
│                                     # Total: 154 tests (not "151" or "125")
├── scripts/
│   ├── deploy-testnet.js             # 9-step CFLM deploy
│   ├── create-lp.js                  # 4-step LP pairing + router update
│   ├── transfer-ownership.js         # Ownership to Governance
│   ├── execute-proposal.js           # Check status / execute governance proposals
│   ├── deploy-lock.js                # Deploy IFRLock + create Governance proposal
│   ├── test-lock.js                  # Live IFRLock test (lock/unlock/isLocked)
│   ├── test-transfer.js              # Live fee verification (1000 IFR transfer)
│   └── sepolia-smoke-test.js         # Full protocol smoke test (11 checks)
├── apps/
│   └── dashboard/                    # React 18 + Vite (ESM)
│       ├── src/
│       │   ├── components/           # Header, TokenOverview, Transfer, Contracts, Governance
│       │   ├── config/               # abis.js, addresses.js
│       │   ├── hooks/                # useContracts.js, useWallet.js
│       │   └── utils/                # format.js
│       └── public/
│           ├── ifr_logo.png          # Logo
│           └── token.png             # Token symbol
├── docs/
│   ├── index.html                    # Landing page (GitHub Pages)
│   ├── assets/                       # ifr_logo.png, token.png, securecall_logo.png, banner.jpeg
│   ├── wiki/                         # 8 HTML pages (contracts, tokenomics, lock, governance, security, deployment, integration, index)
│   ├── DOCS.md                       # Project structure & module status (DE)
│   ├── DEPLOYMENTS.md                # All Sepolia addresses + constructor args
│   ├── SECURITY-AUDIT.md             # Slither audit report
│   ├── WHITEPAPER.md / WHITEPAPER_EN.md
│   ├── FAIR-LAUNCH-MIGRATION.md
│   └── CHANGELOG.md, KNOWN-ISSUES.md, PATCH-GUIDELINES.md, PROJECT-SUMMARY.md
├── README.md                         # Clean, rewritten 2026-02-22
├── STATUS-REPORT.md                  # Comprehensive status (slightly outdated — shows 125 tests, 6 contracts)
├── hardhat.config.js                 # Solidity 0.8.20, Sepolia network configured
├── package.json                      # Hardhat v2, ethers v5, OZ v5, Chai v4
├── .gitignore                        # node_modules/, artifacts/, cache/, .env
└── .env                              # NEVER COMMIT — contains DEPLOYER_PRIVATE_KEY, RPC URLs, API keys
```

### Sepolia Contract Addresses (all verified on Etherscan)
| Contract | Address |
|----------|---------|
| InfernoToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| LiquidityReserve | `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF` |
| Vesting | `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B` |
| BuybackVault | `0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C` |
| BurnReserve | `0x6D4582FCac792FD3880e252fC0a585A0c1823e80` |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| LP Pair (IFR/WETH) | `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7` |
| Deployer | `0x5Ecc668eab04C5bee81b5c7242e1077c946dE406` |
| Uniswap V2 Router | `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` |

### Governance Proposals
| # | Action | Status |
|---|--------|--------|
| 0 | `setFeeExempt(addr, true)` | **Executed** — TX `0x13ff46d8...` |
| 1 | `setFeeExempt(IFRLock, true)` | **Pending** — ETA 2026-02-22 21:15 CET |

## Open TODOs

### Immediate (today)
1. **Execute Governance Proposal #1** — ETA 2026-02-22 21:15 CET. Run `execute-proposal.js`, then `test-lock.js` for full lock/unlock verification.

### Pre-Mainnet
2. **Create Treasury Multisig** — Gnosis Safe on mainnet. Currently deployer address is used as placeholder for Treasury and Community wallets.
3. **Set real addresses** — Community wallet, Team beneficiary, Treasury multisig.
4. **Professional security audit** — Slither was run (0 high/critical), but a professional firm audit is recommended before mainnet.
5. **LP Token Lock/Burn** — LP tokens are currently held by deployer; should be locked or burned for trust.
6. **Mainnet deploy** — Add mainnet network to `hardhat.config.js`, deploy all 8 contracts, pair LP, verify, transfer ownership.
7. **Update STATUS-REPORT.md** — Currently shows 125 tests and 6 contracts; should reflect 154 tests and 8 contracts.

### Nice-to-Have
8. **Dashboard improvements** — Mobile responsiveness, error handling, loading states.
9. **Gas optimization** — Not critical but open as optional task.
10. **Clean up `contracts/presale/`** — Empty directory left over from CFLM migration. Can be deleted.
11. **Clean up `scripts/`** — Many `docs-*` autogen scripts that appear unused. Consider removing.

## Known Issues

- **STATUS-REPORT.md is outdated** — Shows 125 tests / 6 contracts. Actual: 154 tests / 8 contracts (including IFRLock). The file was last updated 2026-02-20 and has not been synced with recent changes.
- **`contracts/presale/` is an empty directory** — Presale was removed during CFLM migration. The directory still exists but contains no files.
- **Treasury and Community wallets are deployer placeholders** — On Sepolia, both Treasury (150M IFR) and Community (100M IFR) were sent to the deployer address. Real multisig addresses needed for mainnet.
- **IFRLock unlock() fails without feeExempt** — By design. Governance Proposal #1 (pending) fixes this. Until executed, `test-lock.js` skips the unlock step and runs partial tests only (lock + isLocked).
- **Vesting test timing** — Block timestamps can be 1 second past target in Hardhat. Tests must use tolerance, not exact equality.
- **BuybackVault 60-day activation delay** — The vault cannot execute buybacks until 60 days after deployment. This is by design.
- **Fee-on-transfer breaks naive DeFi integrations** — Protocols that don't check `balanceOf` before/after transfer will receive fewer tokens than expected. This is documented in the wiki security page.
- **Many unused scripts in `scripts/`** — `docs-autobuild.js`, `docs-autosync.js`, `docs-badge-generator.js`, etc. appear to be auto-generated tooling that may not all be functional.
- **`apps/dashboard/dist/` is untracked** — Build output. Not committed (intentional).
- **Loose image files in project root** — `ifr_400x400.png`, `token.png`, `lstealthPartner.png`, `1500x500_Banner.jpeg` are source files not committed to git. The copies in `docs/assets/` are the committed versions.

## Explicit Non-Goals

- **No multi-chain deployment** — Ethereum only. No L2, no bridges, no cross-chain. Any "Multi-Chain" references in old docs were incorrect and have been removed.
- **No presale** — CFLM model. The `contracts/presale/` directory is a historical artifact.
- **No staking rewards / yield farming** — IFRLock is a utility lock (lock → access), not staking.
- **No token minting after deployment** — There is no mint function. Supply only decreases.
- **No DAO governance yet** — Current governance is admin + timelock. DAO is Phase 4/5 on the roadmap.
- **No automated docs generation as part of normal workflow** — The `docs-*` scripts in `scripts/` are legacy tooling; documentation is maintained manually.
- **Dashboard is Sepolia-only** — No mainnet support until mainnet deployment.

## Code Conventions

### Solidity
- Solidity 0.8.20, pragma `^0.8.20`.
- OpenZeppelin v5 imports (e.g., `@openzeppelin/contracts/token/ERC20/ERC20.sol`).
- Fee rates stored as basis points (bps). 200 bps = 2.0%.
- 9 decimals for all IFR amounts. Use `parseUnits("amount", 9)` in scripts/tests.
- Guardian pattern: separate role from owner for emergency pause/cancel.

### JavaScript (Hardhat / Tests / Scripts)
- **CommonJS only** — `require()`, not `import`. Hardhat v2 does not support ESM.
- ethers v5 syntax: `ethers.utils.parseUnits()`, `ethers.getContractFactory()`.
- Test framework: Chai v4 with Waffle matchers (`expect(...).to.be.revertedWith()`).
- Helper pattern in tests: `deployVault(activationDelay)` for BuybackVault setup.
- Scripts use `const { ethers } = require("hardhat");` and `main().catch(...)` pattern.
- `DECIMALS = 9`, `fmt()` and `parse()` helpers in scripts for formatting.

### Dashboard (React)
- **ESM** — `import/export` (Vite). This is separate from the Hardhat CJS codebase.
- React 18, functional components, hooks (`useWallet`, `useContracts`).
- ethers v5 for blockchain interaction.
- Config in `src/config/addresses.js` and `src/config/abis.js`.
- `VITE_SEPOLIA_RPC_URL` env var for Alchemy RPC.

### Documentation
- User communicates in German; code, comments, and docs are mixed German/English.
- Landing page and wiki are English.
- `docs/DOCS.md` and `STATUS-REPORT.md` are German.
- GitHub Pages served from `docs/` folder on `main` branch.
- `.nojekyll` file in `docs/` prevents Jekyll processing.
- Every commit that changes functionality must update README.md and docs/DOCS.md.

### Git
- All work on `main` branch (no feature branches used so far).
- Commit messages: conventional style (`feat:`, `fix:`, `docs:`).
- Co-authored commits with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.
- Never commit `.env` (contains private keys).

## Next Immediate Step

**Execute Governance Proposal #1** after 21:15 CET on 2026-02-22:

```bash
npx hardhat run scripts/execute-proposal.js --network sepolia
```

This sets `feeExempt(IFRLock, true)` on InfernoToken, enabling fee-free lock/unlock operations. Then verify with the full test:

```bash
npx hardhat run scripts/test-lock.js --network sepolia
```

This time all 8 checks should pass (including unlock), compared to the previous 5/5 partial run. After that, the Sepolia testnet deployment is fully operational and the project moves to mainnet preparation.
