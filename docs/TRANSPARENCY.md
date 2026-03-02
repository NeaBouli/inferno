# Inferno ($IFR) — On-Chain Transparency Report

Stand: 03. Maerz 2026 | Netzwerk: Sepolia Testnet

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
| LiquidityReserve (v2) | 0x6050b22E4EAF3f414d1155fBaF30B868E0107017 (Governance) | OK — redeployed with transferOwnership, ownership transferred |
| BuybackVault (v2) | 0x6050b22E4EAF3f414d1155fBaF30B868E0107017 (Governance) | OK — redeployed with transferOwnership, ownership transferred |
| BurnReserve (v2) | 0x6050b22E4EAF3f414d1155fBaF30B868E0107017 (Governance) | OK — redeployed with transferOwnership, ownership transferred |

> Alle Contracts unter Governance-Kontrolle. v1 Proposals #4-6 cancelled
> (immutable owner). v2 Contracts redeployed (28.02.2026), Ownership
> direkt bei Deploy an Governance transferiert. feeExempt via Proposals #7-9 (03.03.2026).

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
| Adresse (v1) | 0xF7E90D0d17f8232365186AA085D26eaEfAf011aF |
| Adresse (v2) | 0x344720eA0cd1654e2bDB41ecC1cCb11eD60f1957 |
| v1 IFR Balance | 200,000,000 IFR (20% des Supply, locked) |
| v2 IFR Balance | 0 IFR (neu deployed, unfunded) |

200M IFR (20%) in v1 Reserve (locked). v2 wurde mit transferOwnership redeployed.

---

## CHECK 5: BuybackVault

| Parameter | Wert |
|-----------|------|
| Adresse (v2) | 0x2E61b720c220ce85dA24b05a476903Ec709Cb68c |
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
| PartnerVault v2 | true (executed 26.02.2026, TX 0x3f28690a...57de6e8) |
| LiquidityReserve v2 | true (executed 03.03.2026, Proposal #7) |
| BuybackVault v2 | true (executed 03.03.2026, Proposal #8) |
| BurnReserve v2 | true (executed 03.03.2026, Proposal #9) |

---

## CHECK 7: PartnerVault

| Parameter | Wert |
|-----------|------|
| Adresse | 0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39 |
| IFR Balance | 40,000,000 IFR (4.0%) |
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
| Total Supply | 997.999.575 IFR | 100% |
| LP Pair | 400,000,000 IFR | 40.08% |
| LiquidityReserve | 200,000,000 IFR | 20.04% |
| Vesting (Team) | 150,000,000 IFR | 15.03% |
| Deployer (Treasury+Community) | 169,387,995 IFR | 16.97% |
| PartnerVault | 40.000.000 IFR | 4.01% |
| Verbrannt (seit Deploy) | 2,000,425 IFR | 0.20% |

2,000,425 IFR wurden seit dem Deploy permanent verbrannt.
Deflation funktioniert on-chain nachweisbar.

---

## Bekannte TODOs vor Mainnet

| # | Action | Prioritaet |
|---|--------|-----------|
| 1 | LP Tokens locken/burnen (Unicrypt oder 0xdead) | Kritisch |
| 2 | LiquidityReserve Ownership an Governance | Erledigt (v2 redeployed, 28.02.2026) |
| 3 | BuybackVault Ownership an Governance | Erledigt (v2 redeployed, 28.02.2026) |
| 4 | BurnReserve Ownership an Governance | Erledigt (v2 redeployed, 28.02.2026) |
| 5 | PartnerVault feeExempt setzen (Proposal #3) | Erledigt (26.02.2026) |
| 6 | feeExempt v2 Contracts (Proposals #7-9) | Erledigt (03.03.2026) |
| 7 | Third-party Security Audit | Kritisch |
| 8 | Gnosis Safe 4-of-7 Multisig | Hoch |

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
*Stand: 03. Maerz 2026 | Version 1.1*
