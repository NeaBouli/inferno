# Inferno ($IFR) -- Press Kit

## Summary

Inferno ($IFR) is a deflationary ERC-20 utility token on Ethereum. Users lock IFR tokens on-chain and receive lifetime premium access to builder products -- no subscriptions, no recurring payments.

**Model:** Community Fair Launch (CFLM) -- no presale, no VC, no insider allocation.

## Key Facts

| Metric | Value |
|--------|-------|
| Token | $IFR (Inferno) |
| Standard | ERC-20, Ethereum |
| Decimals | 9 |
| Initial Supply | 1,000,000,000 IFR |
| Smart Contracts | 10 on-chain components (all verified) |
| Tests | 444 (99% coverage) |
| Network | Ethereum Mainnet (deployed 2026-03-05) |
| Launch Model | Community Fair Launch (CFLM) |
| Mint Function | None -- supply can only decrease |

## Token Allocation

| Category | Share | Amount | Mechanism |
|----------|-------|--------|-----------|
| DEX Liquidity | 40% | 400M IFR | Uniswap V2 Pairing |
| Liquidity Reserve | 20% | 200M IFR | 6-month lock, 50M/quarter |
| Team (Vested) | 15% | 150M IFR | 12-month cliff, 36-month linear |
| Treasury | 15% | 150M IFR | Multisig-controlled |
| Community & Grants | 6% | 60M IFR | Grants, Bounties, Ecosystem |
| Builder Ecosystem | 4% | 40M IFR | Milestone-based, 6-12 mo vesting |

## Deflation Mechanism

Every transfer: -2.5% permanently burned + 1% BuybackVault.

| Fee | Rate | Destination |
|-----|------|-------------|
| Sender Burn | 2.0% | Permanently burned (supply decreases) |
| Recipient Burn | 0.5% | Permanently burned (supply decreases) |
| Pool Fee | 1.0% | BuybackVault (buyback + burn) |
| **Total** | **3.5%** | Hard Cap: 5% max |

## Lock-to-Access Model

Users lock IFR tokens in the IFRLock contract -> receive lifetime premium access to builder products. Tokens remain owned by the user and can be unlocked at any time.

| Tier | Min. Lock | Example Access |
|------|-----------|----------------|
| Bronze | 1,000 IFR | Basic features |
| Silver | 2,500 IFR | Extended features |
| Gold | 5,000 IFR | Premium access |
| Platinum | 10,000 IFR | Full access + priority support |

## Builder Ecosystem

- **40M IFR** dedicated builder pool
- Lock-triggered Creator Rewards (algo-based)
- Milestone-based release + vesting
- Builder tokens = DAO voting rights (Phase 4)
- Open to all products -- permissionless integration

## Governance

- 48h Timelock on all changes
- Guardian Emergency Cancel
- Governance Proposals successfully executed (Sepolia testnet phase)
- Ownership of all contracts -> Governance Timelock
- Roadmap: Admin -> Multisig -> Full DAO

## Technology

| Component | Stack |
|-----------|-------|
| Contracts | Solidity 0.8.20, OpenZeppelin v5 |
| Framework | Hardhat v2, ethers v5 |
| Tests | Chai v4, 444 tests, 99% coverage |
| Dashboard | React 18 + Vite + ethers v5 |
| Governance UI | React 18 + TypeScript + Tailwind |
| AI Copilot | Claude Haiku 4.5 + RAG |
| Benefits Network | Next.js 14 + wagmi v2 (PWA) |

## Roadmap (Summary)

- **Q1 2026:** Testnet complete, 444 tests, all apps built, mainnet deployed (2026-03-05)
- **Q2 2026:** LP creation, security audit, first builders
- **Q3 2026:** 10+ builders, Creator Gateway MVP, apps live
- **Q4 2026:** Community governance, CEX outreach
- **Q2 2027+:** Full DAO, token voting

## Links

| Resource | URL |
|----------|-----|
| Website | https://neabouli.github.io/inferno/ |
| GitHub | https://github.com/NeaBouli/inferno |
| Wiki | https://neabouli.github.io/inferno/wiki/ |
| Transparency | docs/TRANSPARENCY.md |
| Whitepaper | docs/WHITEPAPER.md |
| Fair Launch | docs/FAIR_LAUNCH.md |
| Roadmap | docs/ROADMAP.md |

## Media Inquiries

GitHub Discussions or Issues:
https://github.com/NeaBouli/inferno/discussions

---
*Mainnet Live | March 2026 | Not financial advice*
