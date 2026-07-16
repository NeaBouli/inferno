# Benefits Network — E2E Test Results

## Test Date: 2026-02-26 (v2)

## Local Test

### Backend Health
- [x] `npm install` — OK
- [x] `npx prisma generate` — OK
- [x] `npx prisma migrate dev --name init` — OK
- [x] `npm run build` (tsc) — 0 Errors
- [x] `node dist/index.js` — Port 3001 started
- [x] `GET /health` → `{"status":"ok","chainId":11155111}`

### API Endpoints
- [x] `POST /api/admin/businesses` → Business created (id: `cmm3ay458...`)
  - Auth: `Authorization: Bearer <ADMIN_SECRET>`
  - Body: `{name, discountPercent, requiredLockIFR, tierLabel}`
  - Response: `{id, verifyUrl, qrUrl}`
- [x] `POST /api/sessions` → Session created (id: `cmm3ayfd6...`)
  - Body: `{businessId}`
  - Response: `{sessionId, expiresAt, qrUrl, discountPercent, requiredLockIFR, tierLabel}`
- [x] `POST /api/sessions` with `benefitRuleId` → Rule-bound session created
  - Body: `{businessId, benefitRuleId}`
  - Response includes rule `label`, `category`, `productName`, `discountPercent`, `requiredLockIFR`
- [x] `GET /api/sessions/:id` → Session Status
  - Response: `{status: "PENDING", recoveredAddress: null, expiresAt: "...", businessId, benefitRuleId, benefit}`

### Corrections from v1
- Route is `/api/sessions` (not `/api/verification/start`)
- Auth header is `Authorization: Bearer <secret>` (not `X-Admin-Secret`)
- Schema: `discountPercent` + `requiredLockIFR` are required fields (not `address` + `minLockAmount`)
- Benefit rules are first-class and can be bound to QR sessions via `benefitRuleId`

### Sepolia Integration
- [x] isLocked() query configured (IFRLOCK_ADDRESS in .env)
- [ ] Wallet with Lock → APPROVED (requires frontend + wallet signature)
- [ ] Wallet without Lock → DENIED (requires frontend + wallet signature)

**Note:** Attest flow (`POST /api/attest`) requires an EIP-712 signature from the wallet. Local API test covers Health + Business + Session. Full QR flow requires frontend.

## Known Issues
- Sepolia RPC rate limits on Alchemy Free Tier
- Test wallet must have IFR locked for full attest
- Prisma update available (5.22.0 → 7.4.1) — not blocking

---
*As of: 2026-07-16*
