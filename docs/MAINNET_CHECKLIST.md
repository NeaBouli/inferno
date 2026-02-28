# Inferno ($IFR) — Mainnet Deployment Checklist

> **Status:** Pre-Mainnet | **Sepolia:** 10 Contracts deployed + verified | **Tests:** 339 Contract + 32 Creator Gateway + 35 Points + 8 Benefits = 414 Total | **Coverage:** 99% Stmts, 91% Branch

## KRITISCH — Vor jedem Public Launch

Diese Punkte muessen ZWINGEND vor Mainnet erledigt sein:

### LP Token Lock (HOECHSTE PRIORITAET)
- [ ] LP Tokens via Unicrypt (https://app.unicrypt.network) locken
  - Mindest-Lock-Dauer: 12 Monate
  - Oder: LP Tokens permanent burnen (0x000...dEaD)
- [ ] LP Lock Transaction auf Etherscan verifizieren
- [ ] LP Lock Beweis in TRANSPARENCY.md eintragen
- [ ] LP Lock Link auf Landing Page + Wiki

### Ownership Transfer → Governance
- [ ] InfernoToken.transferOwnership(timelockAddress)
- [ ] LiquidityReserve.transferOwnership(timelockAddress)
- [ ] BuybackVault.transferOwnership(timelockAddress)
- [ ] BurnReserve.transferOwnership(timelockAddress)

### Deployer Wallet
- [ ] Deployer Wallet Treasury-Anteil an Governance Treasury transferieren
- [ ] Community-Anteil an Community Multisig transferieren
- [ ] Deployer Wallet auf Minimum reduzieren (nur Gas)

### Aktueller Stand (26.02.2026)
- 14/20 Punkte abgeschlossen (Testnet-Phase)
- 3 kritische Mainnet-Punkte identifiziert (LP Lock, Ownership, Deployer)
- Keine Mainnet-Deployment ohne LP Lock + Ownership Transfer

---

## Sepolia Testnet — Abgeschlossen

| Meilenstein | Status |
|-------------|--------|
| 10 Contracts deployed + verified | Done |
| Uniswap V2 LP Pair live | Done |
| Ownership an Governance transferiert | Done |
| Governance Proposals #0, #1 executed | Done |
| Governance Proposal #2 cancelled (v1 deprecated) | Done |
| Governance Proposal #3 executed (PartnerVault v2 feeExempt) + 1.4M Top-up | Done |
| Full Lock/Unlock Cycle verified (8/8) | Done |
| Slither Audit: 0 high/critical | Done |
| solidity-coverage: 99% Stmts, 91% Branch | Done |
| LiquidityReserve/BuybackVault/BurnReserve v2 redeployed (transferOwnership) | Done |
| Ownership v2 → Governance (direct transfer) | Done |
| feeExempt Proposals #7-9 queued (ETA 2026-03-02) | Pending |

---

## Phase 0: Vor dem Deployment (Vorbereitung)

### Security
- [x] Slither Audit abgeschlossen (0 high/critical, 15 Fixes applied)
- [x] solidity-coverage Report generiert (99% Stmts, 91% Branch)
- [ ] Third-party Security Audit abgeschlossen (empfohlen: Code4rena, Sherlock, oder Cyfrin)
- [ ] Alle Audit-Findings behoben und re-verified
- [ ] Slither nochmals laufen lassen auf finalem Code
- [ ] npx hardhat test — alle Tests bestehen
- [ ] Code Freeze: kein Commit nach Audit-Abschluss ohne Re-Audit

### Multisig Setup (MUSS vor Deployment fertig sein)
- [ ] Gnosis Safe erstellt: https://safe.global
- [ ] Empfohlen: 4-of-7 Signers
- [ ] Alle Signers haben Hardware Wallets (Ledger/Trezor)
- [ ] Multisig-Adresse notiert: [MULTISIG_ADDRESS]
- [ ] Guardian-Multisig erstellt (separates Safe, 2-of-3 empfohlen)
- [ ] Guardian-Adresse notiert: [GUARDIAN_ADDRESS]
- [ ] Test-Transaktion auf Sepolia mit Multisig erfolgreich

### Wallets & Keys
- [ ] Deployer-Wallet mit ausreichend ETH fuer Gas (min. 0.5 ETH empfohlen)
- [ ] Alle privaten Keys auf Hardware Wallets, nicht auf Rechner
- [ ] Backup-Phrasen sicher verwahrt (offline, mehrfach)
- [ ] Team-Beneficiary Adresse fuer Vesting festgelegt
- [ ] Treasury-Adresse festgelegt

### Contract-Parameter final bestaetigt
- [ ] rewardBps = 1500 (15%)
- [ ] annualEmissionCap = 4,000,000 IFR
- [ ] Timelock delay = 172800 (48h)
- [ ] Team Vesting: 150M IFR, 48 Monate, 12 Monate Cliff
- [ ] Liquidity Reserve: 200M IFR, 6 Monate Lock
- [ ] FeeRouterV1: protocolFeeBps = 5, FEE_CAP_BPS = 25

---

## Phase 1: Deployment (Reihenfolge einhalten!)

### Schritt 1 — Core Contracts deployen
- [ ] InfernoToken.sol deployen
  - Adresse notieren: [TOKEN_ADDRESS]
  - Etherscan verifizieren
- [ ] Governance (Timelock) deployen
  - admin = Deployer (temporaer, wird zu Multisig)
  - delay = 172800 (48h)
  - Adresse: [GOVERNANCE_ADDRESS]
  - Etherscan verifizieren

### Schritt 2 — Utility Contracts deployen
- [ ] IFRLock.sol deployen (ifrToken = TOKEN_ADDRESS)
  - Adresse: [IFRLOCK_ADDRESS]
  - Etherscan verifizieren
- [ ] BurnReserve.sol deployen
  - Adresse: [BURNRESERVE_ADDRESS]
  - Etherscan verifizieren
- [ ] BuybackVault.sol deployen
  - Adresse: [BUYBACKVAULT_ADDRESS]
  - Etherscan verifizieren
- [ ] PartnerVault.sol deployen
  - admin = GOVERNANCE_ADDRESS
  - rewardBps = 1500
  - annualEmissionCap = 4_000_000 * 10**9
  - Adresse: [PARTNERVAULT_ADDRESS]
  - Etherscan verifizieren
- [ ] FeeRouterV1.sol deployen
  - governance = GOVERNANCE_ADDRESS
  - feeCollector = Treasury Multisig
  - voucherSigner = Points Backend Signer
  - Adresse: [FEEROUTER_ADDRESS]
  - Etherscan verifizieren

### Schritt 3 — Vesting & Reserve
- [ ] Vesting.sol deployen (beneficiary = Team-Adresse)
  - Adresse: [VESTING_ADDRESS]
  - Etherscan verifizieren
- [ ] LiquidityReserve.sol deployen
  - Adresse: [LIQUIDITYRESERVE_ADDRESS]
  - Etherscan verifizieren

### Schritt 4 — Fee Exemptions setzen (VOR Token-Verteilung!)
- [ ] setFeeExempt(Vesting, true)
- [ ] setFeeExempt(LiquidityReserve, true)
- [ ] setFeeExempt(BuybackVault, true)
- [ ] setFeeExempt(BurnReserve, true)
- [ ] setFeeExempt(IFRLock, true)
- [ ] setFeeExempt(PartnerVault, true)
- [ ] KRITISCH: Alle Exemptions MUESSEN vor Token-Transfers gesetzt sein (Sepolia-Lesson: 1.4M IFR Verlust)

### Schritt 5 — Token-Verteilung (KRITISCH)
- [ ] 400M IFR → DEX Liquidity Wallet (fuer LP)
- [ ] 200M IFR → LiquidityReserve Contract
- [ ] 150M IFR → Vesting Contract
- [ ] 150M IFR → Treasury Multisig
- [ ] 60M IFR → Community & Grants Wallet
- [ ] 40M IFR → PartnerVault Contract
- [ ] Gesamtcheck: 400+200+150+150+60+40 = 1,000,000,000
- [ ] Deployer-Balance danach: 0 IFR

### Schritt 6 — Uniswap V2 LP
- [ ] DEX Liquidity Wallet genehmigt Router fuer 400M IFR
- [ ] LP erstellt: IFR/ETH Pair
- [ ] LP Tokens gesperrt (Liquiditaets-Lock-Service, min. 6 Monate)
- [ ] LP Pair Adresse notiert: [LP_PAIR_ADDRESS]

### Schritt 7 — FeeRouter Setup
- [ ] Swap-Adapter deployen und whitelisten (setAdapter)
- [ ] Voucher Signer Adresse setzen (Points Backend Key)
- [ ] Test-Swap mit Voucher Discount verifizieren

### Schritt 8 — Ownership Transfer zu Multisig
- [ ] InfernoToken Ownership → Governance
- [ ] Governance Owner → MULTISIG_ADDRESS
- [ ] Guardian → GUARDIAN_ADDRESS
- [ ] Deployer feeExempt entfernen
- [ ] Deployer hat keine Admin-Rechte mehr
- [ ] Testproposal mit Multisig erfolgreich

---

## Phase 2: Post-Deployment Verification

- [ ] Alle 10 Contract-Adressen in docs/wiki/deployment.html aktualisiert
- [ ] Landing Page Etherscan-Links aktualisiert
- [ ] README Contract-Adressen aktualisiert
- [ ] docs/DEPLOYMENTS.md Mainnet-Sektion hinzugefuegt
- [ ] End-to-End Smoke Test:
  - [ ] Transfer: Fees korrekt abgezogen
  - [ ] Lock: IFR sperren funktioniert
  - [ ] isLocked: gibt true zurueck
  - [ ] Unlock: IFR entsperren funktioniert
  - [ ] Governance: Proposal → 48h → Execute
  - [ ] PartnerVault: claim() funktioniert
  - [ ] FeeRouter: swapWithFee mit/ohne Voucher funktioniert
- [ ] Benefits Network Backend: IFRLOCK_ADDRESS auf Mainnet gesetzt
- [ ] Governance Dashboard: alle Adressen auf Mainnet gesetzt
- [ ] Points Backend: voucherSigner + FeeRouter Adresse auf Mainnet

---
*Stand: Februar 2026 | v1.1*
