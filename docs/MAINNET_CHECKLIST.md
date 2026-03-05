# Inferno ($IFR) — Mainnet Deployment Checklist

> **Status:** Mainnet Deployed (2026-03-05) | **Mainnet:** 9 Contracts deployed + verified | **Tests:** 367 Contract + 41 Creator Gateway + 20 Points + 16 Benefits = 444 Total | **Coverage:** 99% Stmts, 91% Branch

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

### Aktueller Stand (05.03.2026)
- Mainnet Deploy: 9/9 Contracts deployed + verified
- Token Distribution: 1B IFR korrekt verteilt (CFLM)
- Fee Exemptions: 8 Adressen gesetzt, Deployer entfernt
- OFFEN: LP Pairing, LP Lock, Ownership Transfer, Multisig

---

## Sepolia Testnet — Abgeschlossen

| Meilenstein | Status |
|-------------|--------|
| 14 Contracts deployed + verified | Done |
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
| feeExempt Proposals #7-9 executed (2026-03-02) | Done |

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
- [x] Gnosis Safe erstellt: https://safe.global
- [ ] Empfohlen: 4-of-7 Signers (aktuell 1-of-1, Phase 0)
- [ ] Alle Signers haben Hardware Wallets (Ledger/Trezor)
- [x] Multisig-Adresse notiert: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
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
- [x] InfernoToken.sol deployen
  - Adresse: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - Etherscan verifiziert
- [x] Governance (Timelock) deployen
  - admin = Deployer (temporaer, wird zu Multisig)
  - delay = 172800 (48h)
  - Adresse: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
  - Etherscan verifiziert

### Schritt 2 — Utility Contracts deployen
- [x] IFRLock.sol deployen
  - Adresse: `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`
  - Etherscan verifiziert
- [x] BurnReserve.sol deployen
  - Adresse: `0xaA1496133B6c274190A2113410B501C5802b6fCF`
  - Etherscan verifiziert
- [x] BuybackVault.sol deployen
  - Adresse: `0x670D293e3D65f96171c10DdC8d88B96b0570F812`
  - Etherscan verifiziert
- [x] PartnerVault.sol deployen
  - admin = Governance
  - rewardBps = 1500
  - annualEmissionCap = 4_000_000 * 10**9
  - Adresse: `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`
  - Etherscan verifiziert
- [x] FeeRouterV1.sol deployen
  - governance = Governance
  - feeCollector = Treasury
  - voucherSigner = `0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4`
  - Adresse: `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`
  - Etherscan verifiziert

### Schritt 3 — Vesting & Reserve
- [x] Vesting.sol deployen (beneficiary = `0x04FABC52c51d1F8ced6974E7C25a34249b1E6239`)
  - Adresse: `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`
  - Etherscan verifiziert
- [x] LiquidityReserve.sol deployen
  - Adresse: `0xdc0309804803b3A105154f6073061E3185018f64`
  - Etherscan verifiziert

### Schritt 4 — Fee Exemptions setzen (VOR Token-Verteilung!)
- [x] setFeeExempt(Vesting, true)
- [x] setFeeExempt(LiquidityReserve, true)
- [x] setFeeExempt(BuybackVault, true)
- [x] setFeeExempt(BurnReserve, true)
- [x] setFeeExempt(IFRLock, true)
- [x] setFeeExempt(PartnerVault, true)
- [x] setFeeExempt(Treasury, true)
- [x] KRITISCH: Alle Exemptions VOR Token-Transfers gesetzt (Sepolia-Lesson angewendet)

### Schritt 5 — Token-Verteilung (KRITISCH)
- [x] 400M IFR → Deployer (fuer LP Pairing)
- [x] 200M IFR → LiquidityReserve Contract
- [x] 150M IFR → Vesting Contract
- [x] 150M IFR → Treasury (`0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c`)
- [x] 60M IFR → Community & Grants (`0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E`)
- [x] 40M IFR → PartnerVault Contract
- [x] Gesamtcheck: 400+200+150+150+60+40 = 1,000,000,000
- [x] Deployer feeExempt entfernt

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
*Stand: Maerz 2026 | v1.2 — Mainnet Deployed*
