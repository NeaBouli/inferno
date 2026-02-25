# AI Copilot — Korrigierter Deploy Guide

## Warum Two-App Approach?
Vercel ist optimiert für statische Sites + Serverless Functions.
Express-Server mit tsx watch läuft besser auf Railway/Render.

## Option A: Frontend (Vercel) + Backend (Railway)

### Backend auf Railway:
1. https://railway.app → New Project → Deploy from GitHub
2. Root Directory: `apps/ai-copilot`
3. Start Command: `npx tsx server/index.ts`
4. Environment Variables:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   POINTS_BACKEND_URL=https://ifr-points.railway.app
   PORT=3003
   ```
5. URL notieren: `https://ifr-copilot-api.railway.app`

### Frontend auf Vercel:
1. https://vercel.com → New Project → NeaBouli/inferno
2. Root Directory: `apps/ai-copilot`
3. Framework: Vite
4. Environment Variables:
   ```
   VITE_API_URL=https://ifr-copilot-api.railway.app
   ```
5. URL: `https://ifr-copilot.vercel.app`

### vite.config.ts anpassen:
Ersetze hardcoded proxy durch env variable:
```typescript
server: {
  proxy: {
    "/api": process.env.VITE_API_URL || "http://localhost:3003"
  }
}
```

## Option B: Alles auf Railway (einfacher)
Railway unterstützt Multi-Service Deployments:
1. Service 1: Frontend (`vite build` → `serve dist/`)
2. Service 2: Backend (`tsx server/index.ts`)
Beide im selben Railway-Projekt → interne Kommunikation

## Empfehlung
- Testnet Phase: **Option B** (Railway, alles an einem Ort)
- Mainnet: **Option A** (Vercel CDN für Frontend, Railway für API)

## Lokale Entwicklung
```bash
cd apps/ai-copilot
cp .env.example .env
# .env: ANTHROPIC_API_KEY=sk-ant-...
npm install
npm run dev
# Frontend: http://localhost:5175
# Backend:  http://localhost:3003
```

## Health Check
```bash
curl https://ifr-copilot-api.railway.app/api/health
# → { "status": "ok", "apiKeySet": true }
```

---
*Stand: Februar 2026 | Ersetzt DEPLOY.md (alte Single-App Vercel Config)*
