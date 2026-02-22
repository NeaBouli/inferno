<p align="center">
  <img src="docs/assets/ifr_logo.png" alt="Inferno $IFR" width="200" />
</p>

# Inferno ($IFR)

**The Deflationary Utility Token**

[Website](https://neabouli.github.io/inferno/) · [Documentation](https://neabouli.github.io/inferno/wiki/) · [X / Twitter](https://x.com/IFRtoken) · [Etherscan (Sepolia)](https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4#code)

---

## What is Inferno?

Inferno (IFR) is a deflationary ERC-20 utility token on Ethereum. Every transfer burns 2.5% permanently, reducing total supply over time. Users lock IFR tokens on-chain to unlock lifetime premium access to partner products — no subscriptions, no recurring payments.

**Community Fair Launch Model** — No presale, no VC, no insider allocations.

## Key Features

- **Deflationary**: 2.5% burned per transfer (2% sender + 0.5% recipient). 1% pool fee. Hard cap: 5% max.
- **Utility Lock**: Lock IFR → lifetime premium access across partner products → unlock anytime.
- **Timelock Governance**: 48-hour delay on all changes. Guardian cancel. No instant admin access.
- **No Mint Function**: Supply can only decrease, never increase.
- **Fair Launch**: No presale, no VC. Transparent allocation from day one.

## Token Allocation

| Allocation | Share | Amount |
|-----------|-------|--------|
| DEX Liquidity | 40% | 400M IFR |
| Liquidity Reserve | 20% | 200M IFR |
| Team (Vested) | 15% | 150M IFR |
| Treasury | 15% | 150M IFR |
| Community & Grants | 6% | 60M IFR |
| Partner Ecosystem | 4% | 40M IFR |

Team tokens: 48-month vesting, 12-month cliff. Liquidity reserve: 6-month lock.

## Smart Contracts (9)

| Contract | Sepolia Address |
|----------|----------------|
| InfernoToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| LiquidityReserve | `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF` |
| Vesting | `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B` |
| BuybackVault | `0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C` |
| BurnReserve | `0x6D4582FCac792FD3880e252fC0a585A0c1823e80` |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| PartnerVault | *Pending Sepolia deploy* |
| LP Pair (IFR/WETH) | `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7` |

## Partner Ecosystem

Partner rewards are driven by user engagement: when a user locks IFR for a creator's product, the creator earns 10-20% from the Partner Ecosystem Pool (40M IFR), vested over 6-12 months. Token holdings grant future DAO voting rights.

**Launch Partner:** [SecureCall](https://neabouli.github.io/stealth/) — Privacy-first communication platform.

[Integration Guide →](https://neabouli.github.io/inferno/wiki/integration.html)

## Testing & Security

- 221+ unit tests across 9 contracts — all passing
- Slither security audit: 0 high/critical findings
- Full Sepolia testnet deployment with verified contracts
- Governance lifecycle tested: propose → 48h wait → execute

## Documentation

- [Landing Page](https://neabouli.github.io/inferno/)
- [Technical Wiki](https://neabouli.github.io/inferno/wiki/)
- [Contracts Reference](https://neabouli.github.io/inferno/wiki/contracts.html)
- [Integration Guide](https://neabouli.github.io/inferno/wiki/integration.html)
- [Security Audit](https://neabouli.github.io/inferno/wiki/security.html)

## License

© 2026 Inferno Protocol. All rights reserved.
