# AI Copilot — Railway Deployment

Stand: 05. Maerz 2026

## Architektur: Single-App Deployment (Railway)

| Komponente | Plattform | URL |
|-----------|-----------|-----|
| Full App (Frontend + Backend) | Railway | https://ifr-ai-copilot-production.up.railway.app |

## Railway Environment Variables

| Variable | Beispiel | Beschreibung |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Claude API Key |
| `NODE_ENV` | `production` | Environment |
| `PORT` | `3000` | Server Port |
| `ALLOWED_ORIGINS` | `https://ifrunit.tech,...` | CORS Origins (comma-separated) |

## Deploy Steps

```bash
cd apps/ai-copilot

# 1. Railway CLI
railway login

# 2. Projekt initialisieren
railway init
# Name: ifr-ai-copilot

# 3. Env Vars setzen
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set NODE_ENV=production
railway variables set PORT=3000

# 4. Deploy
railway up

# 5. Domain zuweisen
railway domain
```

## CORS

Backend erlaubt folgende Origins (Fallback wenn `ALLOWED_ORIGINS` nicht gesetzt):
- `https://ifrunit.tech`
- `https://www.ifrunit.tech`
- `https://neabouli.github.io`
- `http://localhost:5175` (local dev)
- `http://localhost:3003` (local dev)

## Health Check

```bash
curl https://ifr-ai-copilot-production.up.railway.app/api/health
# → { "status": "ok", "apiKeySet": true }
```

## Sicherheit

- `ANTHROPIC_API_KEY` nur auf Railway (Backend) — niemals im Frontend
- CORS auf Production Origins beschraenkt
- Widget wird als iframe in Landing Page + Wiki eingebettet

## Widget-Integration

Der Copilot ist als iframe-Widget in allen Seiten eingebettet:
- `docs/index.html` (Landing Page)
- `docs/wiki/*.html` (alle 16 Wiki-Seiten)

```javascript
iframe.src = 'https://ifr-ai-copilot-production.up.railway.app';
```

---
*Alte Two-App-Architektur (Vercel Frontend + Railway Backend) wurde durch Single-App Railway Deploy ersetzt.*
