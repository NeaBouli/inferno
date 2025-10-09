# 🔥 Inferno – Whitepaper (DE)

## Kurzfassung
Inferno ($IFR) ist ein deflationärer Token auf einer EVM-kompatiblen Chain. Die Angebotsreduktion erfolgt über Gebühren-Burns bei Transfers sowie einen on-chain Buyback-Mechanismus, der Mittel aus dem Treasury nutzt, um IFR am Markt zurückzukaufen und (anteilig) zu verbrennen. Governance (Multi-Sig/DAO) steuert Parameter sicher über Timelocks.

## 1. Motivation & Ziel
- **Deflation:** Planbare, transparente Reduktion des zirkulierenden Angebots.
- **Sichtbarkeit:** On-chain nachvollziehbare Burns & Buybacks.
- **Sicherheit:** Klare Rollen (Governor/Guardian), Pausable, Param-Kontrolle.

## 2. Token-Spezifikation
- **Name/Ticker:** Inferno / IFR  
- **Decimals:** 9  
- **Gesamtangebot:** 1.000.000.000 IFR (fixed)  
- **Chain:** EVM-kompatible L2/Sidechain (Kasplex/Kaspa EVM in Planung)  
- **Quelle der Wahrheit:** On-chain Verträge & Events.

## 3. Gebühren- & Burn-Mechanik
- **Transfer Fees (Standard):**  
  - SenderBurn: **2.0%**  
  - RecipientBurn: **0.5%**  
  - PoolFee: **1.0%** (für Buyback/Treasury)  
- **FeeExempt:** Adressen wie Presale, Vesting, Treasury können ausgenommen werden.  
- **Invarianten:** Summe der Anteile ≤ max. Fee-Budget; Rundungen deterministisch.  
- **Events:** `FeesApplied(senderBurn, recipientBurn, poolFee)` + `Transfer`.

## 4. Presale (Fixpreis)
- **Funktion:** ETH ➜ IFR zum fixen `TOKEN_PRICE`.  
- **Eigenschaften:** Caps/Phasen optional; Reentrancy-Schutz; Pausable.  
- **FeeExempt:** Tokenauslieferung ohne Gebührenreduktion.  
- **Treasury:** Erhält ETH direkt, Presale verwahrt keine Mittel langfristig.

## 5. Vesting
- **Modell:** Cliff + lineare Freigabe; `release()` durch Begünstigte.  
- **FeeExempt:** Vesting-Transfers sind gebührenfrei.  
- **Rundungen:** deterministisch; Tests decken Randfälle ab.  
- **Events:** `Released(beneficiary, amount)`.

## 6. BurnReserve
- **Aufgabe:** Verwahrt/brennt endgültig.  
- **Steuerung:** Nur Governance (Timelock/Multi-Sig).  
- **Event:** `Burned(amount, caller)`.

## 7. Buyback-Vault & Strategie
- **Vault:** Nimmt ETH/Mittel an, `execute()` führt Rückkauf via DEX (z. B. UniswapV2) durch.  
- **Strategie-Parameter:**  
  - Slippage-Limit (Default **5%**, änderbar)  
  - Cooldown (min. **1h**)  
  - Burn/Treasury-Split (Default **50/50**, 0–100% möglich)  
- **Events:** `BuybackExecuted(ethIn, ifrOut, burned, toTreasury)`.  
- **Rollen:** Governor (Parameter), Guardian (Pause).  
- **Sicherheit:** Reentrancy-Schutz, Router-Quotenprüfung, Fail-Safes.

## 8. Governance
- **Rollen:** Governor (Multi-Sig/DAO), Guardian (Notfall-Pause).  
- **Timelock:** Parameteränderungen mit Verzögerung & On-chain-Nachweis.  
- **Upgrades:** Strategiewechsel (Vault ↔ Strategie).  
- **Prozesse:** ADRs dokumentieren jede relevante Änderung.

## 9. Sicherheit & Tests
- **Tooling:** Slither, Mythril, Echidna/Fuzz, Gas-Reports.  
- **Invarianten:** Gebühren-Summe, FeeExempt-Listen, Vesting-Rundungen.  
- **Integration:** Fork-Tests mit DEX-Router; Buyback-Dry-Runs.  
- **Audits:** Drittanbieter-Audits empfohlen vor Launch.

## 10. Roadmap & Meilensteine
- **MS-1:** Token-Core + Presale + Vesting (ABIs stabil)  
- **MS-2:** Governance aktiv (Timelock/Rollen)  
- **MS-3:** Indexer + Backend v1 live (Staging)  
- **MS-4:** Buyback-Vault integriert, Dry-Run bestanden (**aktuell: Tests 🔴**)  
- **MS-5:** Public Launch (Explorer, Observability, Compliance-Hinweise)

## 11. Compliance & Hinweise
- Dieses Dokument ist **keine Anlageberatung**.  
- Rechts-/Steuerprüfung der Presale-Flows und UI-Texte je Jurisdiktion empfohlen.  
- Geo-Fencing/KYC optional je nach Markt.

## 12. Zusammenfassung
Inferno kombiniert planbaren **Fee-Burn** mit einem **aktiven Buyback** unter Governance-Kontrolle. Ziel ist ein langfristig deflationäres, transparentes Token-Ökosystem mit sauberer Parametrisierung und Sicherheits-Gates.
