# Inferno ($IFR) — Multisig Setup Guide

## Warum Multisig?
Auf Testnet: Single EOA (Deployer) als Governance Owner — akzeptabel fuer Tests.
Auf Mainnet: MUSS Multisig sein. Sonst: Single Point of Failure.
Ziel: Kein einzelner Key kann das Protokoll kontrollieren.

## Empfohlene Struktur

### Owner Multisig (Governance)
- **Typ:** Gnosis Safe (https://safe.global)
- **Threshold:** 4-of-7 (4 Signers muessen zustimmen)
- **Signer-Profile:**
  - 2x Gruender/Core-Team (Hardware Wallets)
  - 2x Trusted Community Members
  - 2x Partner-Vertreter (z.B. SecureCall)
  - 1x Reserve-Signer (Cold Storage)

### Guardian Multisig (Emergency Cancel)
- **Typ:** Gnosis Safe
- **Threshold:** 2-of-3
- **Zweck:** Nur cancel() — kann nicht propose oder execute
- **Signer-Profile:** Core-Team + 1 unabhaengiger Auditor

## Setup-Schritte

### Schritt 1: Gnosis Safe erstellen
1. https://app.safe.global → "Create new Safe"
2. Network: Ethereum Mainnet
3. Owners hinzufuegen (alle 7 Adressen)
4. Threshold: 4
5. Safe erstellen → Adresse notieren

### Schritt 2: Hardware Wallets vorbereiten
- Jeder Signer: Ledger oder Trezor
- MetaMask mit Hardware Wallet verbunden
- Test-Transaktion auf Sepolia vor Mainnet

### Schritt 3: Ownership Transfer
```bash
# Nach Mainnet-Deployment:
# Governance Owner = Deployer EOA → zu Multisig transferieren

npx hardhat run scripts/transfer-ownership.js --network mainnet
# Script setzt: governance.transferOwnership(MULTISIG_ADDRESS)
```

### Schritt 4: Verifikation
```javascript
// Pruefen ob Ownership korrekt uebertragen:
const owner = await governance.owner();
console.log("Owner:", owner);
// Muss MULTISIG_ADDRESS sein
```

### Schritt 5: Erster Multisig-Test
- Testproposal via Safe UI erstellen
- 4 Signers muessen bestaetigen
- 48h warten
- Execute via Safe UI

## Gnosis Safe — Proposal Flow
1. Safe UI → "New Transaction" → "Contract Interaction"
2. Target: Governance Contract Adresse
3. ABI: Governance ABI einfuegen
4. Funktion: `propose(address target, bytes calldata)`
5. Parameter aus Governance Dashboard Calldata Generator kopieren
6. Submit → andere Signers bestaetigen → nach 48h: Execute

## Wichtige Hinweise
- **Backup:** Alle Safe-Einstellungen dokumentieren
- **Recovery:** Mind. 2 Signers immer erreichbar halten
- **Rotation:** Signer-Rotation alle 12 Monate empfohlen
- **Hardware:** Niemals Software-Wallets als Signers auf Mainnet
- **Separation:** Owner-Multisig und Guardian-Multisig MUESSEN verschiedene Safes sein

---
*Stand: Februar 2026*
