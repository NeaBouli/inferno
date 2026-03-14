# IFR Smart Contract — Test Coverage Report

As of: 05 March 2026 | 578 tests passing | solidity-coverage

## Summary

| Metric | Value |
|--------|-------|
| **Statements** | **99.45%** |
| **Branches** | **90.79%** |
| **Functions** | **98.26%** |
| **Lines** | **99%** |

## Coverage per Contract

| Contract | Stmts | Branch | Funcs | Lines | Status |
|----------|-------|--------|-------|-------|--------|
| InfernoToken.sol | 100% | 92.86% | 100% | 100% | OK |
| LiquidityReserve.sol | 100% | 96.67% | 100% | 100% | OK |
| Vesting.sol | 100% | 97.22% | 100% | 100% | OK |
| BuybackVault.sol | 100% | 94.12% | 100% | 100% | OK |
| BurnReserve.sol | 100% | 100% | 100% | 100% | Perfect |
| Governance.sol | 100% | 97.92% | 100% | 100% | OK |
| IFRLock.sol | 100% | 85.71% | 100% | 100% | OK |
| PartnerVault.sol | 99.15% | 85.21% | 100% | 100% | OK |
| FeeRouterV1.sol | 100% | 96% | 100% | 100% | OK |

### Mocks (not security-relevant)

| Contract | Stmts | Branch | Funcs | Lines |
|----------|-------|--------|-------|-------|
| MockAdapter.sol | 100% | 100% | 0% | 50% |
| MockInfernoToken.sol | 100% | 100% | 100% | 100% |
| MockRouter.sol | 90.91% | 50% | 83.33% | 83.33% |
| MockToken.sol | 100% | 100% | 100% | 100% |

## Interpretation

- **>90%**: Very good — audit-ready
- **80-90%**: Good — sufficient for testnet + audit preparation
- **<80%**: Needs improvement — fix before mainnet

All 9 contracts have >85% branch coverage. 6 of 9 have >94% branch.

## Improvements over v0.0.x

| Contract | Branch old | Branch new | Delta |
|----------|-----------|-----------|-------|
| BuybackVault | 61.76% | 94.12% | +32.36% |
| Vesting | 69.44% | 97.22% | +27.78% |
| LiquidityReserve | 86.67% | 96.67% | +10.00% |

## Generating Coverage

```bash
npx hardhat coverage
# Report: coverage/index.html (HTML)
# Report: coverage.json (JSON)
```

---
*Generated with solidity-coverage | 578 tests | Solidity 0.8.20*
