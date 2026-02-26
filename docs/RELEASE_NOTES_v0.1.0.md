# Release Notes — v0.1.0

**Date:** 2026-02-26
**Tag:** `v0.1.0`
**Branch:** `main`

---

## Highlights

Inferno v0.1.0 marks the **first tagged release** of the protocol. All 10 smart contracts are deployed and verified on Sepolia testnet. The full application stack (8 apps) is operational. 330+ tests pass across all components.

### What's Included

**10 Smart Contracts** — all deployed and verified on Sepolia:
- InfernoToken (ERC-20, 9 decimals, fee-on-transfer)
- LiquidityReserve (6-month lock, staged release)
- Vesting (12-month cliff + 36-month linear)
- BuybackVault (ETH-to-IFR, 50/50 split)
- BurnReserve (permanent burn tracking)
- Governance (48h timelock, propose/execute/cancel)
- IFRLock (utility lock, tier system, lockType tags)
- PartnerVault v2 (authorizedCaller, anti-double-count, algo throttle)
- FeeRouterV1 (EIP-712 voucher verification, protocol fee)
- LP Pair IFR/WETH (Uniswap V2)

**8 Applications:**
- Token Dashboard (React + Vite, lock/unlock UI)
- Governance Dashboard (TypeScript + Tailwind, calldata generator)
- AI Copilot (Claude-powered, 3 modes, safety guards)
- Points Backend (SIWE auth, EIP-712 vouchers, anti-sybil)
- Creator Gateway (YouTube x IFR Lock bridge)
- Partner Directory (static, filter + cards)
- Benefits Network (QR verification, Next.js PWA)

**Testing:**
- 276 contract tests (Hardhat + Chai)
- 26 Creator Gateway tests (Jest)
- 20+ Points Backend tests
- Slither static analysis: 0 high/critical findings
- Branch coverage: 85%+

**Documentation:**
- 13 wiki pages (HTML, GitHub Pages)
- 30+ doc files (specs, guides, checklists)
- Landing page with tokenomics, FAQ, roadmap
- ChatGPT Audit V3: 12/12 PASS

### Governance

- Proposal #0: `setFeeExempt` — executed
- Proposal #1: `setFeeExempt(IFRLock)` — executed
- Proposal #3: `setFeeExempt(PartnerVault v2)` — executed
- Proposals #4-#6: Ownership transfer — scheduled

### Known Limitations

- **Testnet only** — no mainnet deployment yet
- Ownership partially at deployer (testnet phase), Governance owns InfernoToken
- Treasury/Community wallets use deployer address as placeholder
- LP tokens not yet locked/burned
- No professional security audit completed (Slither only)

### Pre-Mainnet Requirements

1. Professional security audit
2. Treasury multisig (Gnosis Safe)
3. Real beneficiary addresses
4. LP token lock/burn
5. Execute ownership transfer proposals (#4-#6)

---

## Upgrade Path

v0.1.0 is a Sepolia testnet release. The next milestone (v0.2.0) will target mainnet readiness with completed audit, multisig setup, and finalized addresses.

---

*Full changelog: [CHANGELOG.md](CHANGELOG.md)*
*Transparency report: [TRANSPARENCY.md](TRANSPARENCY.md)*
