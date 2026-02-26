# IFR Smart Contract — Test Coverage Report

Stand: 26. Februar 2026 | 321 Tests passing | solidity-coverage

## Zusammenfassung

| Metrik | Wert |
|--------|------|
| **Statements** | **99.45%** |
| **Branches** | **90.79%** |
| **Functions** | **98.26%** |
| **Lines** | **99%** |

## Coverage pro Contract

| Contract | Stmts | Branch | Funcs | Lines | Status |
|----------|-------|--------|-------|-------|--------|
| InfernoToken.sol | 100% | 92.86% | 100% | 100% | OK |
| LiquidityReserve.sol | 100% | 96.67% | 100% | 100% | OK |
| Vesting.sol | 100% | 97.22% | 100% | 100% | OK |
| BuybackVault.sol | 100% | 94.12% | 100% | 100% | OK |
| BurnReserve.sol | 100% | 100% | 100% | 100% | Perfekt |
| Governance.sol | 100% | 97.92% | 100% | 100% | OK |
| IFRLock.sol | 100% | 85.71% | 100% | 100% | OK |
| PartnerVault.sol | 99.15% | 85.21% | 100% | 100% | OK |
| FeeRouterV1.sol | 100% | 96% | 100% | 100% | OK |

### Mocks (nicht sicherheitsrelevant)

| Contract | Stmts | Branch | Funcs | Lines |
|----------|-------|--------|-------|-------|
| MockAdapter.sol | 100% | 100% | 0% | 50% |
| MockInfernoToken.sol | 100% | 100% | 100% | 100% |
| MockRouter.sol | 90.91% | 50% | 83.33% | 83.33% |
| MockToken.sol | 100% | 100% | 100% | 100% |

## Interpretation

- **>90%**: Sehr gut — Audit-ready
- **80-90%**: Gut — ausreichend fuer Testnet + Audit-Vorbereitung
- **<80%**: Verbesserungsbedarf — vor Mainnet beheben

Alle 9 Contracts haben >85% Branch Coverage. 6 von 9 haben >94% Branch.

## Verbesserungen gegenueber v0.0.x

| Contract | Branch alt | Branch neu | Delta |
|----------|-----------|-----------|-------|
| BuybackVault | 61.76% | 94.12% | +32.36% |
| Vesting | 69.44% | 97.22% | +27.78% |
| LiquidityReserve | 86.67% | 96.67% | +10.00% |

## Coverage generieren

```bash
npx hardhat coverage
# Report: coverage/index.html (HTML)
# Report: coverage.json (JSON)
```

---
*Generiert mit solidity-coverage | 321 Tests | Solidity 0.8.20*
