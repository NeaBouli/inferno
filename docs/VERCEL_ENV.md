# AI Copilot — Vercel Environment Variables

Stand: 26. Februar 2026

## Architektur: Two-App Deployment

| Komponente | Plattform | Zweck |
|-----------|-----------|-------|
| Frontend (React) | Vercel | Statische SPA, CDN |
| Backend (Express) | Railway | API, Anthropic Proxy |

## Vercel (Frontend) Variablen

| Variable | Beispiel | Beschreibung |
|----------|---------|-------------|
| `VITE_API_URL` | `https://ifr-copilot-api.railway.app` | Backend API URL (nur fuer Produktion) |

## Railway (Backend) Variablen

| Variable | Beispiel | Beschreibung |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Claude API Key |
| `POINTS_BACKEND_URL` | `https://ifr-points.railway.app` | Points Backend URL |
| `PORT` | `3003` | Server Port |

## Vercel Setup

```bash
# 1. Vercel CLI
npm i -g vercel && vercel login

# 2. Projekt initialisieren
cd apps/ai-copilot
vercel

# 3. Settings:
#    Root Directory: apps/ai-copilot
#    Framework: Vite
#    Build Command: npm run build
#    Output Directory: dist

# 4. Env setzen
vercel env add VITE_API_URL
# → Wert: https://ifr-copilot-api.railway.app

# 5. Deploy
vercel --prod
```

## Proxy-Konfiguration

**Lokal (vite.config.ts):**
```typescript
proxy: {
  "/api": "http://localhost:3003"
}
```

**Produktion (vercel.json):**
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://ifr-copilot-api.railway.app/api/$1" }
  ]
}
```

## Health Check

```bash
# Backend:
curl https://ifr-copilot-api.railway.app/api/health
# → { "status": "ok", "apiKeySet": true }

# Frontend:
curl https://ifr-copilot.vercel.app
# → HTML (React SPA)
```

## Sicherheit

- `ANTHROPIC_API_KEY` **NIEMALS** im Frontend exponieren (nur Backend!)
- Vercel Rewrites leiten `/api/*` an Railway weiter
- CORS auf Backend korrekt konfiguriert fuer Vercel Domain

## Deploy Steps

### Frontend (Vercel)
```bash
vercel login
cd apps/ai-copilot
vercel --prod
# Env Var setzen: VITE_API_URL=https://ifr-copilot-api.railway.app
```

### Backend (Railway)
```bash
railway login
cd apps/ai-copilot/server
railway up
# Env Vars: ANTHROPIC_API_KEY, PORT=3003
```

### Server Dockerfile
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist/
EXPOSE 3003
CMD ["node", "dist/server.js"]
```

---
*Siehe auch: apps/ai-copilot/DEPLOY_CORRECTED.md*
