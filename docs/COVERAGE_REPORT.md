# IFR Smart Contract — Test Coverage Report

Stand: 26. Februar 2026 | 276 Tests passing | solidity-coverage

## Zusammenfassung

| Metrik | Wert |
|--------|------|
| **Statements** | **95.01%** |
| **Branches** | **80.92%** |
| **Functions** | **94.78%** |
| **Lines** | **96.41%** |

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
| FeeRouterV1.sol | 67.44% | 62% | 72.73% | 78.43% | Verbesserungsbedarf |

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

### FeeRouterV1.sol (67.44% Stmts, 62% Branch)
- Uncovered Lines: 130, 131, 137, 141, 145, 156, 172, 181
- Fehlend: swapWithFee() Edge-Cases (Adapter-Interaktion, Slippage-Pfade, Voucher-Ablauf)
- **Empfehlung:** 5-8 zusaetzliche Tests fuer Adapter-Integration und Voucher-Validation

### BuybackVault.sol (61.76% Branch)
- Alle Statements + Functions 100%, aber Branch-Coverage niedrig
- Fehlend: Edge-Cases in executeBuyback() (Slippage, Cooldown-Overlap, Treasury-Split-Pfade)
- **Empfehlung:** 3-5 zusaetzliche Branch-Tests

### Vesting.sol (69.44% Branch)
- Fehlend: Grenzwerte bei Cliff-Uebergang, Zero-Duration, Partial-Release Edge-Cases
- **Empfehlung:** 2-3 zusaetzliche Tests

## Naechste Schritte

1. **FeeRouterV1 Tests erweitern** — Prioritaet Hoch (sicherheitskritisch)
2. **BuybackVault Branch-Tests** — Prioritaet Mittel
3. **Vesting Grenzwert-Tests** — Prioritaet Niedrig
4. **Coverage nach Fixes erneut laufen lassen**

## Coverage generieren

```bash
npx hardhat coverage
# Report: coverage/index.html (HTML)
# Report: coverage.json (JSON)
```

---
*Generiert mit solidity-coverage | 276 Tests | Solidity 0.8.20*
