# IFR Benefits Network — Business Onboarding Guide

## Übersicht
Das IFR Benefits Network ermöglicht jedem Business (offline oder online),
Kunden mit gesperrten IFR-Token Vorteile zu gewähren — ohne Crypto-Kenntnisse,
ohne Wallet, ohne Installation.

## Voraussetzungen
- IFR Benefits Network Backend läuft (Port 3001)
- ADMIN_SECRET bekannt (aus .env)
- Kunden haben IFR-Tokens und eine Wallet (MetaMask oder WalletConnect-kompatibel)

## Schritt 1: Business anlegen
```bash
curl -X POST http://localhost:3001/api/admin/businesses \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mein Business Berlin",
    "discountPercent": 15,
    "requiredLockIFR": 2500,
    "tierLabel": "Silver"
  }'
```

**Antwort:**
```json
{
  "id": "cmlzlzf0s0000cdvt2t2mfh6k",
  "verifyUrl": "/b/cmlzlzf0s0000cdvt2t2mfh6k"
}
```

**Merchant-URL:** `http://localhost:3000/b/{id}`

## Schritt 2: Tier wählen (Standard-Empfehlung)

| Tier | IFR Lock Minimum | Beispiel-Vorteil | requiredLockIFR |
|------|-----------------|-----------------|-----------------|
| Bronze | 1.000 IFR | 5% Rabatt | 1000 |
| Silver | 2.500 IFR | 10% Rabatt | 2500 |
| Gold | 5.000 IFR | 15% Rabatt | 5000 |
| Platinum | 10.000 IFR | 20% Rabatt | 10000 |

*Tiers sind frei konfigurierbar — kein Oracle, kein USD, rein IFR-denominiert.*

## Schritt 3: Merchant Console testen
1. URL im Browser öffnen: `http://localhost:3000/b/{businessId}`
2. "Verifikation starten" klicken → QR-Code erscheint
3. QR mit Handy scannen → Wallet verbinden → Message signieren
4. Merchant sieht sofort: **APPROVED** oder **REJECTED**
5. Bei APPROVED: "Einlösen" drücken → einmalige Bestätigung

## Schritt 4: Go Live Checkliste

- [ ] Backend deployed (Docker empfohlen, Port 3001)
- [ ] Frontend deployed (Vercel / Netlify / eigener Server, Port 3000)
- [ ] `.env`: `CHAIN_ID=1` (Mainnet)
- [ ] `.env`: `IFRLOCK_ADDRESS` auf Mainnet-Adresse gesetzt
- [ ] `.env`: `RPC_URL` auf Mainnet-RPC (Alchemy/Infura)
- [ ] `ADMIN_SECRET` sicher gespeichert (kein Default-Wert!)
- [ ] Test-Verifikation mit echter Mainnet-Wallet durchgeführt
- [ ] QR-Code-Poster ausdrucken oder Display aufstellen

## Schritt 5: Docker Deployment
```bash
cd apps/benefits-network/backend
docker build -t ifr-benefits-backend .
docker run -p 3001:3001 --env-file .env ifr-benefits-backend
```

## Troubleshooting

| Problem | Ursache | Lösung |
|---------|---------|--------|
| "Business not found" | Falsche businessId in URL | ID aus curl-Response kopieren |
| "Invalid signature" | Wallet falsch verbunden | Neu verbinden, nochmal signieren |
| "Session expired" | >60s gewartet | Neue Session starten (QR neu laden) |
| "Insufficient lock" | Zu wenig IFR gesperrt | requiredLockIFR im Business prüfen |
| RPC Error | Falsche RPC_URL | Alchemy/Infura Key und CHAIN_ID prüfen |
| 401 Unauthorized | Falscher ADMIN_SECRET | .env ADMIN_SECRET prüfen |

## Security-Hinweise
- Nonce + 60s TTL: Screenshots/Videos funktionieren nicht
- One-time Redeem: Selber Code kann nicht 2x verwendet werden
- Wallet-Signatur: Fremde Wallet-Adresse ohne Private Key nicht nutzbar
- On-chain Check: Lock-Status wird direkt gegen IFRLock Contract geprüft

---
*Stand: Februar 2026 | IFR Benefits Network v1.0*
