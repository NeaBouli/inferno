# Points Backend — Deployment Guide

## Railway (recommended)

1. https://railway.app → New Project → Deploy from GitHub
2. Repo: `NeaBouli/inferno`
3. Root Directory: `apps/points-backend`
4. Set environment variables:
   ```
   DATABASE_URL=file:./prod.db
   JWT_SECRET=<random 32 chars>
   VOUCHER_SIGNER_PRIVATE_KEY=<deployer key>
   FEE_ROUTER_ADDRESS=0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a
   CHAIN_ID=1
   PORT=3004
   ADMIN_SECRET=<secure secret>
   ```
   > **Note:** The FeeRouter address above is the mainnet address. For Sepolia testnet, use `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` with `CHAIN_ID=11155111`.
5. Deploy → Note the URL (e.g. `https://ifr-points.railway.app`)
6. Set URL in `apps/ai-copilot/.env`: `POINTS_BACKEND_URL=https://ifr-points.railway.app`

## Render (Alternative)

1. https://render.com → New Web Service
2. Connect GitHub → `NeaBouli/inferno`
3. Root Directory: `apps/points-backend`
4. Build Command: `npm install && npx prisma generate && npm run build`
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
