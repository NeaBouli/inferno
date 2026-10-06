# Points Backend — Deployment Guide

## Railway (recommended)

1. https://railway.app → New Project → Deploy from GitHub
2. Repo: `NeaBouli/inferno`
3. Root Directory: `apps/points-backend`
4. Set environment variables:
   ```
   DATABASE_URL=file:./prod.db
   NODE_ENV=production
   JWT_SECRET=<random 32 chars>
   VOUCHER_SIGNER_PRIVATE_KEY=<dedicated voucher signer key>
   FEE_ROUTER_ADDRESS=0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a
   CHAIN_ID=1
   RPC_URL=<ethereum-mainnet-rpc>
   IFR_LOCK_ADDRESS=0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb
   SIWE_ALLOWED_ORIGINS=https://ifrunit.tech,https://www.ifrunit.tech
   ALLOWED_ORIGINS=https://ifrunit.tech,https://www.ifrunit.tech
   PORT=3004
   ADMIN_SECRET=<secure secret>
   ```
   Production startup fails closed unless the RPC reports Ethereum mainnet and
   the configured IFRLock has deployed bytecode at the canonical address.
   `FEE_ROUTER_ADDRESS` must be the mainnet FeeRouterV1: it is the EIP-712
   `verifyingContract`, and voucher issuance reads its `protocolFeeBps` fresh for
   every request. With `CHAIN_ID=1` startup refuses any other address
   (case-insensitive compare), and production startup also requires router
   bytecode and an `eip712Domain()` of `InfernoFeeRouter`/`1`/chain 1/that
   address. An unreadable fee at issue time makes `/voucher/issue` fail closed (503).
5. Deploy → Note the URL (e.g. `https://ifr-points.railway.app`)
6. Set URL in `apps/ai-copilot/.env`: `POINTS_BACKEND_URL=https://ifr-points.railway.app`

## Render (Alternative)

1. https://render.com → New Web Service
2. Connect GitHub → `NeaBouli/inferno`
3. Root Directory: `apps/points-backend`
4. Build Command: `npm ci && npx prisma generate && npm run build`
5. Start Command: `npx prisma migrate deploy && npm run start`
6. Environment variables as above

## Health Check

```bash
curl https://<your-url>/health
# → { "status": "ok" }
```

## After Deployment

1. Update AI Copilot `.env`:
   ```
   POINTS_BACKEND_URL=https://ifr-points.railway.app
   ```
2. Test:
   ```bash
   curl https://ifr-points.railway.app/auth/siwe/nonce
   ```
