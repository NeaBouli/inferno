# Business Onboarding SOP — IFR Benefits Network

Standard Operating Procedure für die Aufnahme neuer Partner-Businesses
in das IFR Benefits Network.

## Übersicht
Das IFR Benefits Network ermöglicht Businesses, IFR-Token-Inhabern
exklusive Rabatte und Benefits anzubieten — verifiziert durch
On-Chain-Lock-Status, ohne Crypto-Kenntnisse beim Kassenpersonal.

## Schritt 1: Erstkontakt & Eignung

### Mindestanforderungen
- [ ] Legales Business mit Gewerbeanmeldung
- [ ] Bereitschaft zur IFR-Lock-Anforderung für Kunden (mind. 1.000 IFR)
- [ ] Technische Basis: Smartphone oder Tablet für QR-Scanner
- [ ] Akzeptanz der IFR Partner Terms of Service

### Ausschlusskriterien
- Glücksspiel, Tabak, Waffen
- Businesses ohne physischen/digitalen Standort
- Bereits gesperrte/gemeldete Entities

## Schritt 2: Technisches Setup

### Option A: Hosted Solution (empfohlen)
1. Business erhält Zugang zum IFR Partner Dashboard
2. Registrierung: Name, Logo, Discount %, Required Lock
3. QR-Code wird generiert (eindeutige businessId)
4. Kassenpersonal öffnet Scanner-URL auf Smartphone
5. Fertig — kein technisches Wissen nötig

### Option B: Self-Hosted (für Developer)
1. Docker Image klonen: `git clone https://github.com/NeaBouli/inferno`
2. `cd apps/benefits-network && cp .env.example .env`
3. RPC URL + Contract Adressen konfigurieren
4. `docker-compose up -d`
5. Eigene businessId anlegen via Admin API

## Schritt 3: Tier-Konfiguration

| Tier | Mindest-Lock | Empfohlener Rabatt |
|------|-------------|-------------------|
| Bronze | 1.000 IFR | 5–10% |
| Silver | 2.500 IFR | 10–15% |
| Gold | 5.000 IFR | 15–20% |
| Platinum | 10.000 IFR | 20–25% |

Business wählt: Welches Tier (oder mehrere) akzeptiert werden.
Empfehlung: Mindestens Bronze anbieten (niedrigste Hürde für Kunden).

## Schritt 4: Kassenpersonal Training (5 Minuten)

### Der QR-Flow (3 Schritte):
1. **Business öffnet** Scanner-URL auf Tablet/Smartphone
2. **Kunde scannt** QR-Code mit seiner Wallet-App
3. **Bildschirm zeigt**: APPROVED (grün) oder DENIED (rot)
4. **Optional**: "Einlösen" klicken → Status REDEEMED

### Was Kassenpersonal NICHT braucht:
- Keine Crypto-Kenntnisse
- Kein MetaMask/Wallet
- Kein Verständnis von Blockchain
- Kein Internet-Banking-Zugang

## Schritt 5: Go-Live Checkliste

- [ ] businessId erstellt und verifiziert
- [ ] QR-Code auf Smartphone/Tablet gespeichert
- [ ] Test-Scan mit eigenem Wallet durchgeführt (Sepolia zuerst)
- [ ] Kassenpersonal briefed (5-Minuten-Training)
- [ ] Discount in POS/Kasse konfiguriert
- [ ] IFR Partner Badge auf Website/Schaufenster angebracht
- [ ] Eintrag im IFR Partner Directory bestätigt

## Schritt 6: Laufender Betrieb

### Monatliche Checks:
- QR-Code noch aktiv? (Test-Scan)
- Discount-Bedingungen noch passend?
- Neue Tier-Optionen verfügbar?

### Support-Kanäle:
- Technisch: GitHub Issues → https://github.com/NeaBouli/inferno/issues
- Allgemein: Partner-Dokumentation → docs/PARTNER_INTEGRATION_SPEC.md

## FAQ für Businesses

**Kostet das Programm etwas?**
Nein — das IFR Benefits Network ist kostenlos für Partner.
Businesses zahlen nur für ihr eigenes Hosting (Option B).

**Was wenn ein Kunde seinen Lock aufhebt?**
Der nächste Scan zeigt DENIED automatisch — kein manueller Eingriff nötig.

**Können wir selbst entscheiden welches Tier wir akzeptieren?**
Ja — jedes Business konfiguriert eigenständig Tier und Rabatt.

**Ist die Kundenverifizierung DSGVO-konform?**
Ja — es werden keine persönlichen Daten gespeichert.
Nur: Wallet-Adresse (öffentlich on-chain), Lock-Status (öffentlich on-chain),
Zeitstempel der Verifizierung (temporär, 60s TTL).

---
*Stand: Februar 2026 | Version 1.0*
