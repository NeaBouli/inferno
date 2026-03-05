# AI Copilot — Corrected Deploy Guide

## Why Two-App Approach?
Vercel is optimized for static sites + serverless functions.
Express server with tsx watch runs better on Railway/Render.

## Option A: Frontend (Vercel) + Backend (Railway)

### Backend on Railway:
1. https://railway.app → New Project → Deploy from GitHub
2. Root Directory: `apps/ai-copilot`
3. Start Command: `npx tsx server/index.ts`
4. Environment Variables:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   POINTS_BACKEND_URL=https://ifr-points.railway.app
   PORT=3003
   ```
5. Note the URL: `https://ifr-copilot-api.railway.app`

### Frontend on Vercel:
1. https://vercel.com → New Project → NeaBouli/inferno
2. Root Directory: `apps/ai-copilot`
3. Framework: Vite
4. Environment Variables:
   ```
   VITE_API_URL=https://ifr-copilot-api.railway.app
   ```
5. URL: `https://ifr-copilot.vercel.app`

### Adjust vite.config.ts:
Replace hardcoded proxy with env variable:
```typescript
server: {
  proxy: {
    "/api": process.env.VITE_API_URL || "http://localhost:3003"
  }
}
```

## Option B: Everything on Railway (simpler)
Railway supports multi-service deployments:
1. Service 1: Frontend (`vite build` → `serve dist/`)
2. Service 2: Backend (`tsx server/index.ts`)
Both in the same Railway project → internal communication

## Recommendation
- Current phase: **Option B** (Railway, everything in one place)
- Production: **Option A** (Vercel CDN for frontend, Railway for API)

## Local Development
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
*As of: February 2026 | Replaces DEPLOY.md (old single-app Vercel config)*
