# ChatGPT Independent Audit — Prompt V2

Copy this entire prompt into a new ChatGPT window (GPT-4). Then paste the contents of the referenced files as context.

---

## Task

You are an independent auditor for the Inferno ($IFR) project. Check ALL referenced sources for consistency, correctness, and completeness. Respond in English.

## Project Facts (Reference)

- **Token:** Inferno ($IFR), ERC-20, 9 Decimals, 1B Supply, deflationary (2.5% burn + 1% pool fee)
- **Model:** Community Fair Launch (CFLM) — no presale, no VC
- **On-Chain Components:** 10 (9 repo contracts + 1 Uniswap V2 LP Pair)
- **Tests:** 444 (9 test suites + app tests), all passing
- **Contracts:**
  1. InfernoToken — `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`
  2. LiquidityReserve — `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF`
  3. Vesting — `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B`
  4. BuybackVault — `0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C`
  5. BurnReserve — `0x6D4582FCac792FD3880e252fC0a585A0c1823e80`
  6. Governance — `0x6050b22E4EAF3f414d1155fBaF30B868E0107017`
  7. IFRLock — `0x0Cab0A9440643128540222acC6eF5028736675d3`
  8. PartnerVault — `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`
  9. FeeRouterV1 — `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4`
  10. LP Pair (IFR/WETH) — `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`
- **Token Allocation:** 40% DEX, 20% Reserve, 15% Team (vested), 15% Treasury, 6% Community & Grants, 4% Partner Ecosystem
- **FeeRouter:** protocolFeeBps=5 (0.05%), FEE_CAP_BPS=25 (0.25%), EIP-712 Voucher Discounts
- **Points System:** Off-chain (Express + Prisma + SQLite), SIWE Auth, no token, protocol fee discount only

## Audit Areas

### A) Number Consistency
Check in ALL files whether the following numbers are consistent:
- "14 on-chain components" (not 10, not 8)
- "9 repo contracts" (not 8)
- "444 tests" (not 276, not 256, not 243)
- "9 test suites" (not 8, not 7)
- Token Allocation: 40/20/15/15/6/4 (sum = 100%)
- Contract addresses match everywhere

### B) FeeRouter Parameters
Check whether FeeRouter parameters are correctly documented:
- protocolFeeBps = 5 (0.05%) — not 50, not 0.5%
- FEE_CAP_BPS = 25 (0.25%) — hard cap
- Voucher discount: max 15 bps (from Points Config)
- EIP-712 Domain: name="InfernoFeeRouter", version="1", chainId=11155111

### C) Points System Communication
Check whether it is clearly communicated:
- Points are NOT a token
- Not transferable, no trading value
- Only discount on protocol fee
- No promise of future rewards
- Daily limits documented

### D) All New Documents Linked?
Check whether all these files are referenced in README.md and/or DOCS.md:
- docs/WHITEPAPER.md
- docs/SDK_QUICKSTART.md
- docs/TESTNET_GUIDE.md
- docs/CREATOR_GATEWAY.md
- docs/GOVERNANCE_CONSTITUTION.md
- docs/BUSINESS_ONBOARDING.md
- docs/PARTNER_INTEGRATION_SPEC.md
- docs/MAINNET_CHECKLIST.md
- docs/AUDIT_BRIEF.md
- docs/MULTISIG_SETUP.md

### E) Wiki Navigation
Check whether:
- agent.html is linked in the sidebar of all wiki pages
- AI Copilot Widget is embedded in all wiki pages + landing page
- All wiki links work (no dead links)

### F) No Old Addresses
Check whether the following OLD addresses appear NOWHERE:
- `0x6EF0...6A36f90` (old PartnerVault v1)
- `0xA4A1ea...6A36f90` (old test address)
- All "9 contracts" / "256 tests" / "243 tests" / "8 repo" references removed

### G) Apps Section
Check whether all apps are correctly documented:
- apps/dashboard/ — React Dashboard (Port 5173)
- apps/governance-dashboard/ — Governance Dashboard (Port 5174)
- apps/ai-copilot/ — AI Copilot (Port 5175/3003)
- apps/points-backend/ — Points Backend (Port 3004)
- apps/benefits-network/backend/ — Benefits Network Backend (Port 3001)
- apps/benefits-network/frontend/ — Benefits Network Frontend (Port 3000)

## Files to Check

Copy the contents of these files into the chat:
1. README.md
2. docs/DOCS.md
3. docs/DEPLOYMENTS.md
4. docs/index.html (only the Stats section, Roadmap, FAQ, Trust section)
5. docs/wiki/index.html (only Quick Stats + Card Descriptions)
6. docs/wiki/security.html (only Test Stats Callout)
7. docs/wiki/contracts.html (only the intro line with count)

## Response Format

For EACH audit area (A-G):
```
## [Area]: [PASS/FAIL]
- Finding 1
- Finding 2
...
```

At the end:
```
## Overall Result: X/7 PASS
[Summary of findings]
```
