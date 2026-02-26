# Benefits Network — E2E Test Results

## Test-Datum: 26.02.2026 (v2)

## Lokaler Test

### Backend Health
- [x] `npm install` — OK
- [x] `npx prisma generate` — OK
- [x] `npx prisma migrate dev --name init` — OK
- [x] `npm run build` (tsc) — 0 Errors
- [x] `node dist/index.js` — Port 3001 gestartet
- [x] `GET /health` → `{"status":"ok","chainId":11155111}`

### API Endpoints
- [x] `POST /api/admin/businesses` → Business erstellt (id: `cmm3ay458...`)
  - Auth: `Authorization: Bearer <ADMIN_SECRET>`
  - Body: `{name, discountPercent, requiredLockIFR, tierLabel}`
  - Response: `{id, verifyUrl, qrUrl}`
- [x] `POST /api/sessions` → Session erstellt (id: `cmm3ayfd6...`)
  - Body: `{businessId}`
  - Response: `{sessionId, expiresAt, qrUrl, discountPercent, requiredLockIFR, tierLabel}`
- [x] `GET /api/sessions/:id` → Session Status
  - Response: `{status: "PENDING", recoveredAddress: null, expiresAt: "..."}`

### Korrektur gegenueber v1
- Route ist `/api/sessions` (nicht `/api/verification/start`)
- Auth-Header ist `Authorization: Bearer <secret>` (nicht `X-Admin-Secret`)
- Schema: `discountPercent` + `requiredLockIFR` sind Pflichtfelder (nicht `address` + `minLockAmount`)

### Sepolia Integration
- [x] isLocked() Abfrage konfiguriert (IFRLOCK_ADDRESS in .env)
- [ ] Wallet mit Lock → APPROVED (benoetigt Frontend + Wallet-Signatur)
- [ ] Wallet ohne Lock → DENIED (benoetigt Frontend + Wallet-Signatur)

**Note:** Attest-Flow (`POST /api/attest`) benoetigt eine EIP-712 Signatur vom Wallet. Lokaler API-Test deckt Health + Business + Session ab. Full QR-Flow benoetigt Frontend.

## Bekannte Issues
- Sepolia RPC Rate Limits bei Alchemy Free Tier
- Test-Wallet muss IFR gesperrt haben fuer Full Attest
- Prisma Update verfuegbar (5.22.0 → 7.4.1) — nicht blockierend

---
*Stand: 26.02.2026*
