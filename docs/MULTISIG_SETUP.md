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

---

## Gnosis Safe Setup — Schritt fuer Schritt

### Phase 1: 2-of-3 Multisig (Q3 2026)

#### Voraussetzungen

#### Wallet-Anforderungen pro Signer-Typ

| Slot | Rolle | Wallet-Typ | Begruendung |
|------|-------|-----------|------------|
| Gruender 1+2 | Core Team | Hardware Wallet (Ledger/Trezor) | Zwingend — hoechstes Risiko |
| Community 1+2 | Gewaehlt | Hardware Wallet empfohlen, MetaMask akzeptabel | |
| Partner 1+2 | Akkreditiert | MetaMask/WalletConnect akzeptabel | |
| Reserve | Cold Storage | Air-gapped Hardware Wallet | Zwingend |

> Fuer Testnet-Phase sind Hot Wallets (MetaMask) fuer alle Slots OK.
> Fuer Mainnet: Gruender-Slots MUESSEN Hardware Wallet sein.

- Sepolia ETH auf allen 3 Wallets fuer Gas
- Getrennte Geraete fuer jeden Signer

#### Setup
1. https://app.safe.global → "Create new Safe"
2. Network: Ethereum (Mainnet) oder Sepolia (Test)
3. Owners hinzufuegen: 3 Hardware Wallet Adressen
4. Threshold: 2 (2-of-3)
5. Safe Adresse notieren

#### Ownership Transfer (nach Safe Setup)

Scripts bereit:
```bash
npx hardhat run scripts/propose-ownership-transfer.js --network sepolia
```

Fuer Mainnet anpassen:
- Ziel-Adresse: Safe Multisig Adresse (nicht Timelock!)
- Erstmal: LiquidityReserve, BuybackVault, BurnReserve → Safe
- Dann: Token Owner → Safe (via Governance)

### Phase 2: 3-of-5 Multisig (Q4 2026)

Erweiterung um 2 Community-Vertreter:
1. Snapshot Vote: Community waehlt 2 Vertreter
2. Safe Settings → Add Owners
3. Threshold: 3-of-5

### Phase 3: 4-of-7 Multisig (Q1 2027)

Vollstaendige Dezentralisierung:
- 2 Gruender (Hardware Wallet)
- 2 Community (Snapshot gewaehlt)
- 2 Partner-Vertreter (erste akkreditierte Partner)
- 1 Reserve (Cold Storage)
- Threshold: 4-of-7

### Guardian Multisig (2-of-3)

Separates Safe fuer Emergency Cancel only:
- 1 Gruender
- 1 unabhaengiger Security Reviewer
- 1 Community Vertreter
- Threshold: 2-of-3
- Einzige Funktion: `governance.cancel(proposalId)`

---

## Sicherheits-Checkliste

- [ ] Jeder Signer hat eigenes Hardware Wallet (Mainnet)
- [ ] Seed Phrases getrennt und sicher verwahrt
- [ ] Test-Transaktion vor Ownership Transfer
- [ ] Safe Adresse auf Etherscan verifiziert
- [ ] Backup-Prozess dokumentiert
- [ ] Recovery-Plan: Mind. 2 Signers immer erreichbar
- [ ] Signer-Rotation alle 12 Monate geplant

---

## Gnosis Safe — Proposal Flow

1. Safe UI → "New Transaction" → "Contract Interaction"
2. Target: Governance Contract Adresse
3. ABI: Governance ABI einfuegen
4. Funktion: `propose(address target, bytes calldata)`
5. Parameter aus Governance Dashboard Calldata Generator kopieren
6. Submit → andere Signers bestaetigen → nach 48h: Execute

---

## Kosten (Ethereum Mainnet)

| Aktion | Geschaetzte Kosten |
|--------|-------------------|
| Safe Deployment | ~0.01 ETH (~$35) |
| Jede Transaktion | ~0.002-0.005 ETH |
| Ownership Transfer | ~0.005 ETH |
| **Budget pro Safe** | **mind. 0.1 ETH** |

> Sepolia: Kostenlos (Testnet ETH via Faucet)

---

## Wichtige Hinweise

- **Separation:** Owner-Multisig und Guardian-Multisig MUESSEN verschiedene Safes sein
- **Hardware:** Gruender-Slots immer Hardware Wallet auf Mainnet
- **Rotation:** Signer-Rotation alle 12 Monate empfohlen
- **Backup:** Alle Safe-Einstellungen dokumentieren
- **Recovery:** Mind. 2 Signers immer erreichbar halten

---
*Stand: Februar 2026 | Version 2.0*
