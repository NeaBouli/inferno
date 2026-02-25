# IFR Smart Contract — Test Coverage Report

Stand: 26. Februar 2026 | 276 Tests passing | solidity-coverage

## Zusammenfassung

| Metrik | Wert |
|--------|------|
| **Statements** | **98.89%** |
| **Branches** | **84.65%** |
| **Functions** | **97.39%** |
| **Lines** | **98.60%** |

## Coverage pro Contract

| Contract | Stmts | Branch | Funcs | Lines | Status |
|----------|-------|--------|-------|-------|--------|
| InfernoToken.sol | 100% | 92.86% | 100% | 100% | OK |
| LiquidityReserve.sol | 100% | 86.67% | 100% | 100% | OK |
| Vesting.sol | 96.55% | 69.44% | 88.89% | 97.5% | Akzeptabel |
| BuybackVault.sol | 100% | 61.76% | 100% | 100% | Branch-Luecken |
| BurnReserve.sol | 100% | 100% | 100% | 100% | Perfekt |
| Governance.sol | 100% | 97.92% | 100% | 100% | OK |
| IFRLock.sol | 100% | 85.71% | 100% | 100% | OK |
| PartnerVault.sol | 98.31% | 84.51% | 100% | 99.33% | OK |
| FeeRouterV1.sol | 100% | 96% | 100% | 100% | OK |

### Mocks (nicht sicherheitsrelevant)

| Contract | Stmts | Branch | Funcs | Lines |
|----------|-------|--------|-------|-------|
| MockAdapter.sol | 100% | 100% | 0% | 50% |
| MockInfernoToken.sol | 100% | 100% | 100% | 100% |
| MockRouter.sol | 90.91% | 50% | 83.33% | 83.33% |
| MockToken.sol | 100% | 100% | 100% | 100% |

## Interpretation

- **>80%**: Gut — ausreichend fuer Testnet + Audit-Vorbereitung
- **60-80%**: Akzeptabel — Branches pruefen, ggf. Tests ergaenzen
- **<60%**: Verbesserungsbedarf — vor Mainnet beheben

## Schwach abgedeckte Bereiche

### BuybackVault.sol (61.76% Branch)
- Alle Statements + Functions 100%, aber Branch-Coverage niedrig
- Fehlend: Edge-Cases in executeBuyback() (Slippage, Cooldown-Overlap, Treasury-Split-Pfade)
- **Empfehlung:** 3-5 zusaetzliche Branch-Tests

### Vesting.sol (69.44% Branch)
- Fehlend: Grenzwerte bei Cliff-Uebergang, Zero-Duration, Partial-Release Edge-Cases
- **Empfehlung:** 2-3 zusaetzliche Tests

## Naechste Schritte

1. **BuybackVault Branch-Tests** — Prioritaet Mittel
2. **Vesting Grenzwert-Tests** — Prioritaet Niedrig
3. **Coverage nach Fixes erneut laufen lassen**

## Coverage generieren

```bash
npx hardhat coverage
# Report: coverage/index.html (HTML)
# Report: coverage.json (JSON)
```

---
*Generiert mit solidity-coverage | 276 Tests | Solidity 0.8.20*
