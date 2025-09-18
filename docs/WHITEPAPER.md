# 🔥 Inferno – Whitepaper

## 1. Einleitung
Inferno ist ein deflationärer Token mit einem klaren Fokus: stetige Angebotsreduktion durch Burn-Mechanismen und Buyback-Strategien.
Das Projekt kombiniert Presale, Vesting und eine on-chain Buyback- und Burn-Logik, die den Tokenwert langfristig stützen soll.

## 2. Tokenomics

### 2.1 Grunddaten
- Name: Inferno
- Ticker: $IFR
- Decimals: 9
- Supply: Fester Gesamt-Supply (Initialmint an Owner bei Deployment).
- Chain: Ziel EVM-kompatible L2 (Kasplex/Kaspa EVM Layer geplant).

### 2.2 Gebührenstruktur (Burn-Mechanik)
- Jeder Transfer (außer FeeExempt-Adressen) löst Burn-Fee aus.
- Burned Tokens → BurnReserve.
- DAO/Owner kann Tokens vollständig verbrennen.
- Ergebnis: deflationärer Supply.

### 2.3 FeeExempt-Regelungen
- Bestimmte Adressen (Presale, Vesting, Treasury) können exempt sein.
- Presale/Vesting werden nicht durch Gebühren reduziert.

## 3. Verteilungslogik

### 3.1 Presale
- Fixer Tokenpreis (TOKEN_PRICE).
- ETH → Token Swap direkt im Presale-Contract.
- Treasury erhält ETH gebührenfrei.
- Presale ist FeeExempt.

### 3.2 Vesting
- Lineares Vesting mit Cliff + Duration.
- Tokens bei Deployment in Vesting-Contract.
- release() abrufbar durch Begünstigte.
- Empfehlung: Vesting-Contracts FeeExempt halten.

## 4. Buyback-Mechanismus

### 4.1 Motivation
Aktiver Buyback beschleunigt Deflation und nutzt Treasury-Mittel.

### 4.2 Architektur
- BuybackVault: sammelt ETH-Einnahmen, führt Buybacks aus.
- BuybackStrategyUniV2ETH: UniswapV2-Router für ETH → $IFR Swaps.
- Verteilung: X% Burn, (100–X)% Treasury. Default: 50/50.

### 4.3 Parameter
- Burn-Anteil: Default 50%, bis 100% möglich.
- Slippage-Schutz: 5%, parametrisierbar.
- Cooldown: min. 1h.
- Rollen: Governor (DAO/MultiSig), Guardian (Pause).

### 4.4 Trigger
- Zeitintervall.
- Manuell (DAO/Treasury).
- Event-basiert (große Einnahmen).

## 5. Governance & Sicherheit
- Governor (DAO/MultiSig): Parametersteuerung.
- Guardian: Notfall-Pause.
- Upgradebar: Strategy austauschbar.
- Events: BuybackExecuted, Deposited, VaultFunded, ParamsUpdated.

## 6. Roadmap
1. ✅ Deployment: Token, BurnReserve, Presale, Vesting.
2. ✅ Testsuite: Core-Mechaniken.
3. 🚧 Integration BuybackVault + Strategy.
4. 🚧 Erweiterte Tests.
5. 🚀 Launch Zielnetzwerk (Kasplex).
6. 🌐 DAO Setup.

## 7. Zusammenfassung
Inferno kombiniert deflationäre Token-Mechanismen mit aktivem Buyback-System.
Durch Governance & modulare Architektur bleibt es sicher, erweiterbar und deflationär.
