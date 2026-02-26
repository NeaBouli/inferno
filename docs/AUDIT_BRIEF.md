# Inferno ($IFR) — Security Audit Brief

## Projekt-Uebersicht
Inferno ($IFR) ist ein deflationaerer ERC-20 Utility Token auf Ethereum.
Kern-Mechanismen: Fee-on-Transfer (2.5% Burn + 1% Pool), On-chain Lock fuer
Lifetime-Access, Milestone-basierter PartnerVault, 48h Timelock Governance.

## Audit-Scope (9 Contracts)

| Contract | LOC | Kritikalitaet | Schwerpunkt |
|----------|-----|---------------|-------------|
| PartnerVault.sol | 549 | HOCH | Rewards, Vesting, authorizedCaller, anti-double-count, algo throttle |
| FeeRouterV1.sol | 228 | HOCH | EIP-712 Voucher, Protocol Fee, Replay-Protection |
| BuybackVault.sol | 175 | HOCH | ETH→IFR swap, Slippage, Cooldown |
| Governance.sol | 150 | HOCH | Timelock, propose/execute/cancel, Guardian |
| LiquidityReserve.sol | 151 | MITTEL | Staged Release, Lock |
| Vesting.sol | 132 | MITTEL | Cliff, lineare Freigabe, Beneficiary |
| IFRLock.sol | 127 | HOCH | Lock/Unlock, isLocked, totalLocked |
| InfernoToken.sol | 93 | HOCH | Fee-on-Transfer, Burn, feeExempt |
| BurnReserve.sol | 92 | MITTEL | Token-Verwahrung, Burn-Mechanismus |

**Total:** 1,697 LOC Solidity (+ 4 Mock Contracts fuer Tests)

## Tech Stack
- Solidity 0.8.20
- OpenZeppelin v5 (ERC20, Ownable, ReentrancyGuard, Pausable, SafeERC20)
- Hardhat v2
- ethers v5
- 321 Unit Tests (Chai v4 + Waffle)

## Bekannte Design-Entscheidungen (kein Finding erwartet)
- 9 Decimals (nicht 18) — bewusste Entscheidung
- Kein Mint nach Deployment — by design
- Single EOA Owner auf Testnet — wird Multisig auf Mainnet
- Kein Token-Voting — Flash-Loan-Schutz
- authorizedCaller in PartnerVault — Verify Backend Wallet
- Fee-on-Transfer bricht naive DeFi-Integrationen — dokumentiert

## Priorisierte Pruefbereiche
1. Fee-on-Transfer Bypass-Moeglichkeiten
2. Reentrancy in PartnerVault.claim() und IFRLock.unlock()
3. Integer Overflow/Underflow in Reward-Berechnungen (_effectiveRewardBps)
4. Governance: Proposal-Replay, Guardian-Missbrauch, setDelay-Manipulation
5. Anti-double-count Mapping Bypass (walletRewardClaimed)
6. Algo Throttle Manipulation via totalLocked
7. Annual Emission Cap Reset Timing (yearStart + 365 days)
8. Vesting Cliff/Duration Edge Cases
9. SafeERC20 Verwendung konsistent

## Bisherige Analyse
- Slither v0.11.5: 0 high/critical findings
- 15 Fixes applied, 36 accepted informational
- ChatGPT independent Audit: 15/15 PASS

## Empfohlene Auditoren
- **Code4rena** (Contest-Format, breit, kostenguenstig)
- **Sherlock** (Contest + Coverage)
- **Spearbit** (Boutique, hohe Qualitaet)
- **Cyfrin** (Spezialist DeFi, gut fuer kleinere Projekte)

## Deliverables erwartet
- [ ] Vollstaendiger Audit-Report (PDF)
- [ ] Findings: Critical / High / Medium / Low / Informational
- [ ] Empfehlungen fuer alle Findings
- [ ] Re-Audit nach Fix-Implementierung
- [ ] Oeffentlicher Report fuer Community

## Zeitplan-Empfehlung
- Audit-Anfrage: sofort nach Code-Freeze
- Audit-Dauer: 2-4 Wochen
- Fix-Phase: 1-2 Wochen
- Re-Audit: 1 Woche
- Mainnet-Deploy: nach Re-Audit-Freigabe

## Repository
- GitHub: https://github.com/NeaBouli/inferno
- Branch: `main`
- Sepolia Deployment: alle 9 Contracts deployed + verified (+ 1 LP Pair)

---
*Stand: Februar 2026*
