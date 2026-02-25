# Off-Chain Security — IFR Ecosystem

## Übersicht der Off-Chain Komponenten

| App | Kritische Assets | Risiko |
|-----|-----------------|--------|
| Points Backend | VoucherSigner Private Key | Hoch |
| AI Copilot | ANTHROPIC_API_KEY | Mittel |
| Creator Gateway | JWT_SECRET, Google OAuth | Mittel |
| Benefits Network | Admin Secret | Mittel |

## VoucherSigner Key Management (KRITISCH)

Der VoucherSigner Key signiert EIP-712 Voucher für FeeRouter.
Kompromittierter Key → beliebige Voucher möglich.

### Schutzmaßnahmen:
- Key NUR in Railway/Render Environment Variables
- NIEMALS in .env Dateien committed (→ .gitignore!)
- Key Rotation via Governance: setVoucherSigner(newKey)
- Monitoring: Alert bei >100 Vouchers/Tag

### Key Rotation Prozess:
1. Neuen Key generieren
2. Points Backend updaten (neuer Signer)
3. Governance Proposal: setVoucherSigner(newKey)
4. 48h Timelock → Execute
5. Alten Key deaktivieren

## JWT Secrets

Alle JWT Secrets müssen:
- Mindestens 32 Zeichen
- Kryptographisch zufällig (kein Passwort!)
- Unterschiedlich pro App
- Regelmäßig rotiert (alle 90 Tage)

Generieren: `openssl rand -hex 32`

## SIWE (Sign-In With Ethereum)

Points Backend + Benefits Network verwenden SIWE:
- Nonce ist einmalig (Replay-Schutz)
- Nonce Expiry: 10 Minuten
- Chain ID Prüfung: 11155111 (Sepolia) / 1 (Mainnet)
- Domain Binding: verhindert Phishing-Signatur-Reuse

## Rate Limiting

| App | Limit | Schutz gegen |
|-----|-------|-------------|
| Points Backend | 60 req/min/IP | Bot-Farming |
| SIWE Auth | 5 req/hour/IP | Brute-Force |
| Voucher Issuance | 1/wallet/day | Sybil |
| AI Copilot | 60 req/min/IP | API-Missbrauch |
| Creator Gateway | 60 req/min/IP | Scraping |

## Admin Endpoints

Alle Admin-Endpoints müssen:
- ADMIN_SECRET Header-Auth (mindestens 32 Zeichen)
- Nie öffentlich erreichbar (IP-Whitelist oder VPN)
- Logging aller Aktionen mit Timestamp

## Secrets Checkliste (vor Mainnet)

- [ ] VoucherSigner Key: Hardware Wallet oder HSM
- [ ] Alle JWT Secrets: 32+ Zeichen, zufällig
- [ ] ANTHROPIC_API_KEY: nur in Vercel Env
- [ ] Google OAuth Credentials: Scope minimal halten
- [ ] ADMIN_SECRET: 32+ Zeichen, nie im Code
- [ ] Rate Limits: auf Mainnet-Last anpassen
- [ ] Monitoring: Alert bei Anomalien
- [ ] Key Rotation: Prozess dokumentiert

---
*Version 1.0 | Februar 2026*
