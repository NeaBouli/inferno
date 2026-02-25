# Inferno ($IFR) — On-Chain Transparency Report

Stand: 26. Februar 2026 | Netzwerk: Sepolia Testnet

Alle Angaben sind on-chain verifizierbar. Script:
`npx hardhat run scripts/onchain-audit.js --network sepolia`

---

## CHECK 1: Contract Ownership

| Contract | Owner | Status |
|----------|-------|--------|
| InfernoToken | 0x6050b22E4EAF3f414d1155fBaF30B868E0107017 (Governance) | OK |
| IFRLock | admin-Pattern (kein Ownable) | OK |
| PartnerVault | admin-Pattern (Governance) | OK |
| FeeRouterV1 | admin-Pattern (Governance) | OK |
| LiquidityReserve | 0x5Ecc668eab04C5bee81b5c7242e1077c946dE406 (Deployer) | Testnet |
| BuybackVault | 0x5Ecc668eab04C5bee81b5c7242e1077c946dE406 (Deployer) | Testnet |
| BurnReserve | 0x5Ecc668eab04C5bee81b5c7242e1077c946dE406 (Deployer) | Testnet |

> LiquidityReserve, BuybackVault, BurnReserve sind auf Testnet noch
> beim Deployer. Vor Mainnet werden alle drei via Governance Proposal
> an den Timelock uebertragen.

**Verifizieren:**
https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4#readContract

---

## CHECK 2: LP Token Ownership

| Metrik | Wert |
|--------|------|
| LP Total Supply | 63,245,553,203,367,586 |
| Deployer LP Balance | ~100% |
| Burned LP (0xdead) | 0 |

> LP Tokens befinden sich aktuell beim Deployer (Testnet-Phase).
> Vor Mainnet: LP Tokens werden via Unicrypt/UNCX gelockt oder
> permanent geburnt (0xdead). Dieser Schritt ist in der
> Mainnet-Checklist als KRITISCH markiert.

---

## CHECK 3: Vesting Contract

| Parameter | Wert |
|-----------|------|
| Adresse | 0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B |
| IFR Balance | 150,000,000 IFR (15% des Supply) |
| Beneficiary | Deployer (Team) |
| Cliff | 365 Tage ab Deploy |
| Duration | 1,460 Tage (4 Jahre) |
| Released | 0 IFR |
| Releasable | 0 IFR (Cliff nicht erreicht) |

150M IFR sind im Contract gesperrt. Kein Token wurde vorzeitig
freigegeben. Cliff laeuft bis ca. Januar 2027.

**Verifizieren:**
https://sepolia.etherscan.io/address/0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B

---

## CHECK 4: LiquidityReserve

| Metrik | Wert |
|--------|------|
| Adresse | 0xF7E90D0d17f8232365186AA085D26eaEfAf011aF |
| IFR Balance | 200,000,000 IFR (20% des Supply) |

200M IFR (20%) korrekt in der Reserve.

---

## CHECK 5: BuybackVault

| Parameter | Wert |
|-----------|------|
| Adresse | 0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C |
| IFR Balance | 0 IFR (Testnet) |
| Router | Uniswap V2 Router02 |
| Slippage | 5% |
| BurnShare | 50% |
| Activation | 16. April 2026 (60 Tage nach Deploy) |

BuybackVault ist auf Testnet leer — wird durch Pool-Fees befuellt.
Activation-Datum stellt sicher dass kein vorzeitiger Buyback moeglich ist.

---

## CHECK 6: FeeExempt Status

| Contract | feeExempt |
|----------|-----------|
| IFRLock | true |
| LiquidityReserve | true |
| BuybackVault | true |
| BurnReserve | true |
| PartnerVault v2 | Proposal #3 pending (26.02.2026 08:41 CET) |
| FeeRouterV1 | Geplant nach Proposal #3 |

---

## CHECK 7: PartnerVault

| Parameter | Wert |
|-----------|------|
| Adresse | 0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39 |
| IFR Balance | 38,600,000 IFR (3.86%) |
| Admin | Governance (Timelock) |
| rewardBps | 1,500 (15%) |
| annualEmissionCap | 4,000,000 IFR |
| totalRewarded | 0 IFR |
| algoThrottle | OFF (wird mit erstem Partner aktiviert) |

Admin ist Governance — kein Deployer-Zugriff moeglich.

---

## CHECK 8: Token Supply Verteilung

| Wallet | IFR | % |
|--------|-----|---|
| Total Supply | 997,999,575 IFR | 100% |
| LP Pair | 400,000,000 IFR | 40.08% |
| LiquidityReserve | 200,000,000 IFR | 20.04% |
| Vesting (Team) | 150,000,000 IFR | 15.03% |
| Deployer (Treasury+Community) | 170,787,995 IFR | 17.11% |
| PartnerVault | 38,600,000 IFR | 3.86% |
| Verbrannt (seit Deploy) | 2,000,425 IFR | 0.20% |

2,000,425 IFR wurden seit dem Deploy permanent verbrannt.
Deflation funktioniert on-chain nachweisbar.

---

## Bekannte TODOs vor Mainnet

| # | Action | Prioritaet |
|---|--------|-----------|
| 1 | LP Tokens locken/burnen (Unicrypt oder 0xdead) | Kritisch |
| 2 | LiquidityReserve Ownership an Governance | Hoch |
| 3 | BuybackVault Ownership an Governance | Hoch |
| 4 | BurnReserve Ownership an Governance | Hoch |
| 5 | PartnerVault feeExempt setzen (Proposal #3) | Pending |
| 6 | Third-party Security Audit | Kritisch |
| 7 | Gnosis Safe 4-of-7 Multisig | Hoch |

---

## Wie verifizieren?

```bash
git clone https://github.com/NeaBouli/inferno
cd inferno
npm install
cp .env.example .env
# RPC_URL in .env eintragen
npx hardhat run scripts/onchain-audit.js --network sepolia
```

*Alle Angaben ohne Gewaehr. Testnet-Daten — Mainnet-Werte werden
nach Mainnet-Deploy aktualisiert.*

---
*Stand: 26. Februar 2026 | Version 1.0*
