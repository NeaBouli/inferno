# Inferno ($IFR) — Tokenomics Model & Simulationen

## Grundparameter

| Parameter | Wert |
|-----------|------|
| Initial Supply | 1,000,000,000 IFR |
| Burn Rate | 2.5% pro Transfer |
| Pool Fee | 1.0% pro Transfer |
| Total Transfer Fee | 3.5% |
| Max Fee Cap | 5.0% (hard-coded) |
| Decimals | 9 |

## Deflations-Mechanismus

Jeder Transfer verbrennt 2.5% permanent:
- Transfer: 1,000 IFR
- Empfänger erhält: 965 IFR (nach 3.5% Fee)
- Burned: 25 IFR (permanent)
- Pool: 10 IFR (BuybackVault/PartnerPool)

### Deflationskurve (Simulation)

Annahme: 100,000 Transfers/Jahr à durchschnittlich 1,000 IFR

| Jahr | Transfers | Burned/Jahr | Supply End |
|------|-----------|-------------|------------|
| 1 | 100,000 | 2,500,000 | 997,500,000 |
| 2 | 120,000 | 3,000,000 | 994,500,000 |
| 3 | 150,000 | 3,750,000 | 990,750,000 |
| 5 | 200,000 | 5,000,000 | 980,000,000 |
| 10 | 300,000 | 7,500,000 | 940,000,000 |

*Konservative Annahmen. Bei höherem Volumen stärker deflationär.*

## Token Allocation

| Kategorie | % | IFR | Zweck |
|-----------|---|-----|-------|
| DEX Liquidity | 40% | 400,000,000 | Uniswap V2 LP |
| Reserve | 20% | 200,000,000 | Ökosystem-Reserve |
| Team | 15% | 150,000,000 | Vesting 12-48 Monate |
| Treasury | 15% | 150,000,000 | Governance-gesteuert |
| Community & Grants | 6% | 60,000,000 | Ökosystem-Wachstum |
| Partner Ecosystem | 4% | 40,000,000 | PartnerVault (Creator Rewards) |

## PartnerVault Emission Model

### Parameter (aktuell, Sepolia):
- rewardBps: 1500 (15%)
- annualEmissionCap: 4,000,000 IFR
- PartnerPool: 40,000,000 IFR total

### Laufzeit-Simulation:
Bei konstantem annualEmissionCap von 4M IFR:
- Pool reicht: 40M / 4M = **10 Jahre**
- Bei rewardBps-Senkung auf 10%: länger
- Bei Algo-Throttle: automatische Verlängerung

### Creator Reward Beispiel:
- User A sperrt: 10,000 IFR
- Creator B rewardBps: 1500 (15%)
- Creator B Reward: 1,500 IFR (aus PartnerPool)
- Net Effect: 10,000 gesperrt - 1,500 Reward = 8,500 net deflationary

**Wichtig: Reward < Lock → immer netto-deflationär**

## Lock Economics

### Tier-Schwellen:
| Tier | Min Lock | Vorteile |
|------|---------|---------|
| Bronze | 1,000 IFR | Partner-Rabatte |
| Silver | 2,500 IFR | Erhöhte Rabatte |
| Gold | 5,000 IFR | Premium Benefits |
| Platinum | 10,000 IFR | Maximale Benefits |

### Lock Supply Effekt:
Bei 5% der User-Wallets mit Lock (konservativ):
- Annahme: 10,000 aktive Wallets, 5% = 500 Locker
- Durchschnittlicher Lock: 3,000 IFR
- Total locked: 1,500,000 IFR = 0.15% des Supply
- Effektiv aus dem Markt: dauerhaft (bis Unlock)

## FeeRouter Protocol Fee

| Szenario | Fee | Wert bei $1 Swap |
|----------|-----|-----------------|
| Standard | 5 bps (0.05%) | $0.0005 |
| Mit Voucher (max) | 0 bps | $0.00 |
| Maximum (Cap) | 25 bps (0.25%) | $0.0025 |

**Fee-Einnahmen gehen an feeCollector (Governance-gesteuert)**

## Bootstrap Pricing (Phase 0)

- Kein Oracle, kein TWAP, kein USD-Preis vom Projekt
- Preis entsteht durch Markt (DEX AMM)
- Phase 2+: USD-Pricing wenn ausreichend LP vorhanden
- Aktuell: Token-denominierte Pricing-Mechanismen

---
*Stand: Februar 2026 | Version 1.0 | Alle Zahlen: Simulation/Illustration*
