# Inferno ($IFR) — Security Audit Brief

## Project Overview
Inferno ($IFR) is a deflationary ERC-20 utility token on Ethereum.
Core mechanisms: Fee-on-Transfer (2.5% Burn + 1% Pool), On-chain Lock for
Lifetime Access, Milestone-based PartnerVault, 48h Timelock Governance.

**Status:** Mainnet deployed and verified (2026-03-05).

## Audit Scope (9 Contracts)

| Contract | LOC | Criticality | Focus |
|----------|-----|-------------|-------|
| PartnerVault.sol | 549 | HIGH | Rewards, Vesting, authorizedCaller, anti-double-count, algo throttle |
| FeeRouterV1.sol | 228 | HIGH | EIP-712 Voucher, Protocol Fee, Replay Protection |
| BuybackVault.sol | 175 | HIGH | ETH→IFR swap, Slippage, Cooldown |
| Governance.sol | 150 | HIGH | Timelock, propose/execute/cancel, Guardian |
| LiquidityReserve.sol | 151 | MEDIUM | Staged Release, Lock |
| Vesting.sol | 132 | MEDIUM | Cliff, linear release, Beneficiary |
| IFRLock.sol | 127 | HIGH | Lock/Unlock, isLocked, totalLocked |
| InfernoToken.sol | 93 | HIGH | Fee-on-Transfer, Burn, feeExempt |
| BurnReserve.sol | 92 | MEDIUM | Token custody, Burn mechanism |

**Total:** 1,697 LOC Solidity (+ 4 Mock Contracts for tests)

## Tech Stack
- Solidity 0.8.20
- OpenZeppelin v5 (ERC20, Ownable, ReentrancyGuard, Pausable, SafeERC20)
- Hardhat v2
- ethers v5
- 556 tests (521 protocol + 35 ecosystem)

## Known Design Decisions (no finding expected)
- 9 Decimals (not 18) — intentional decision
- No Mint after deployment — by design
- Mainnet deployed with Gnosis Safe multisig
- No Token Voting — Flash Loan protection
- authorizedCaller in PartnerVault — Verify Backend Wallet
- Fee-on-Transfer breaks naive DeFi integrations — documented

## Prioritized Audit Areas
1. Fee-on-Transfer bypass possibilities
2. Reentrancy in PartnerVault.claim() and IFRLock.unlock()
3. Integer Overflow/Underflow in reward calculations (_effectiveRewardBps)
4. Governance: Proposal replay, Guardian abuse, setDelay manipulation
5. Anti-double-count mapping bypass (walletRewardClaimed)
6. Algo Throttle manipulation via totalLocked
7. Annual Emission Cap reset timing (yearStart + 365 days)
8. Vesting Cliff/Duration edge cases
9. Consistent SafeERC20 usage

## Previous Analysis
- Slither v0.11.5: 0 high/critical findings
- 15 fixes applied, 36 accepted informational
- ChatGPT independent audit: 15/15 PASS

## Recommended Auditors
- **Code4rena** (contest format, broad, cost-effective)
- **Sherlock** (contest + coverage)
- **Spearbit** (boutique, high quality)
- **Cyfrin** (DeFi specialist, good for smaller projects)

## Expected Deliverables
- [ ] Complete audit report (PDF)
- [ ] Findings: Critical / High / Medium / Low / Informational
- [ ] Recommendations for all findings
- [ ] Re-audit after fix implementation
- [ ] Public report for community

## Timeline Recommendation
- Audit request: immediately after code freeze
- Audit duration: 2-4 weeks
- Fix phase: 1-2 weeks
- Re-audit: 1 week
- Post-audit: LP creation and full decentralization

## Repository
- GitHub: https://github.com/NeaBouli/inferno
- Branch: `main`
- Mainnet deployment: all 9 contracts deployed + verified (+ 1 LP Pair)

---
*As of: March 2026*
