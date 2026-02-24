# Inferno ($IFR) — Mainnet Deployment Checklist

## Phase 0: Vor dem Deployment (Vorbereitung)

### Security
- [ ] Third-party Security Audit abgeschlossen (empfohlen: Code4rena, Sherlock, oder Cyfrin)
- [ ] Alle Audit-Findings behoben und re-verified
- [ ] Slither nochmals laufen lassen auf finalem Code
- [ ] npx hardhat test — alle 243 Tests bestehen
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

### Schritt 7 — Ownership Transfer zu Multisig
- [ ] InfernoToken Ownership → Governance
- [ ] Governance Owner → MULTISIG_ADDRESS
- [ ] Guardian → GUARDIAN_ADDRESS
- [ ] Deployer feeExempt entfernen
- [ ] Deployer hat keine Admin-Rechte mehr
- [ ] Testproposal mit Multisig erfolgreich

---

## Phase 2: Post-Deployment Verification

- [ ] Alle 9 Contract-Adressen in docs/wiki/deployment.html aktualisiert
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
- [ ] Benefits Network Backend: IFRLOCK_ADDRESS auf Mainnet gesetzt
- [ ] Governance Dashboard: alle Adressen auf Mainnet gesetzt

---
*Stand: Februar 2026 | v1.0*
