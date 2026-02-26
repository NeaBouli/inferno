# Audit Submission — Inferno ($IFR)

Dieses Dokument bereitet die Submission für Code4rena oder
Sherlock vor. Auditoren finden hier alle relevanten Informationen.

## Projekt-Übersicht

| Parameter | Wert |
|-----------|------|
| Projekt | Inferno ($IFR) |
| Netzwerk | Ethereum (Sepolia Testnet) |
| Sprache | Solidity 0.8.20 |
| Framework | Hardhat |
| Bibliotheken | OpenZeppelin 5.x |
| Tests | 321 (99% Statement Coverage) |

## Audit-Scope (In Scope)

Folgende Contracts sind im Audit-Scope:

| Contract | Pfad | SLOC | Priorität |
|----------|------|------|-----------|
| PartnerVault | contracts/partner/PartnerVault.sol | 549 | Hoch |
| FeeRouterV1 | contracts/FeeRouterV1.sol | 228 | Hoch |
| BuybackVault | contracts/buyback/BuybackVault.sol | 175 | Hoch |
| Governance | contracts/governance/Governance.sol | 150 | Mittel |
| LiquidityReserve | contracts/liquidity/LiquidityReserve.sol | 151 | Mittel |
| IFRLock | contracts/lock/IFRLock.sol | 127 | Hoch |
| Vesting | contracts/vesting/Vesting.sol | 132 | Mittel |
| BurnReserve | contracts/burnreserve/BurnReserve.sol | 92 | Niedrig |
| InfernoToken | contracts/token/InfernoToken.sol | 93 | Hoch |
| **Gesamt** | | **1697** | |

## Out of Scope

- OpenZeppelin Basis-Contracts (ERC20, Ownable, ReentrancyGuard, Pausable)
- Uniswap V2 Contracts (Router, Factory, Pair)
- Test-Mocks (MockToken, MockRouter, MockAdapter, MockInfernoToken)
- Off-chain Apps (Points Backend, AI Copilot, Creator Gateway, Benefits Network)

## Bekannte Issues (kein Finding)

| Issue | Begründung |
|-------|------------|
| Single EOA Testnet | Phase 0 Bootstrap — Multisig Phase 1+ |
| LP nicht gelockt | Testnet-Phase — Mainnet: burn zu 0xdead |
| Reserve/Buyback/Burn Owner = Deployer | Testnet — Mainnet: Governance |
| 9 Decimals | Absichtlich — IFR-spezifisch |
| Keine Oracle | Phase 0 — USD-Pricing Phase 2+ |
| Fee-on-transfer bricht naive Integrationen | Dokumentiert — Partner müssen balanceOf prüfen |

## Kritische Funktionen (Fokus für Auditoren)

### InfernoToken._update()
Fee-on-transfer Logik. Kritisch: korrekte Fee-Berechnung,
kein Rounding-Exploit, Fee-Exempt korrekt geprüft.

### IFRLock.lock() / unlock()
Token-Custody. Kritisch: kein Drain möglich,
korrekte Balance-Buchführung, Reentrancy.

### PartnerVault.recordLockReward()
Emission-Logik. Kritisch: authorizedCaller,
anti-double-count, annualEmissionCap.

### FeeRouterV1.swapWithFee()
EIP-712 Voucher + Fee-Routing. Kritisch:
Replay-Schutz, Signer-Verifikation, Discount-Clamp.

### Governance.propose() / execute()
Timelock-Logik. Kritisch: ETA-Berechnung,
doppelte Ausführung, Cancel-Logik.

## Code4rena Submission Checklist

- [x] GitHub Repo public
- [x] README vollständig
- [x] Hardhat Tests laufen: `npx hardhat test`
- [x] Coverage Report: `npx hardhat coverage`
- [x] NatSpec Kommentare für alle public Functions
- [x] Known Issues dokumentiert (oben)
- [x] Deployment Adressen verifiziert (Etherscan)
- [ ] Contest Duration: 7-14 Tage empfohlen
- [ ] Prize Pool: mind. $15,000 für seriöse Auditoren

## Bug Bounty (nach Audit)

Geplant: 5% des Treasury für kritische Mainnet-Findings.
Details: docs/SECURITY_POLICY.md

## Kontakt

GitHub: https://github.com/NeaBouli/inferno
Security: GitHub Security Advisories (privat)

---
*Version 1.0 | Februar 2026*
