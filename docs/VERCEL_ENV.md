# AI Copilot — Railway Deployment

As of: March 2026

## Architecture: Single-App Deployment (Railway)

| Component | Platform | URL |
|-----------|----------|-----|
| Full App (Frontend + Backend) | Railway | https://ifr-ai-copilot-production.up.railway.app |

## Railway Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Claude API Key |
| `NODE_ENV` | `production` | Environment |
| `PORT` | `3000` | Server port |
| `ALLOWED_ORIGINS` | `https://ifrunit.tech,...` | CORS origins (comma-separated) |

## Deploy Steps

```bash
cd apps/ai-copilot

# 1. Railway CLI
railway login

# 2. Initialize project
railway init
# Name: ifr-ai-copilot

# 3. Set env vars
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set NODE_ENV=production
railway variables set PORT=3000

# 4. Deploy
railway up

# 5. Assign domain
railway domain
```

## CORS

Backend allows the following origins (fallback when `ALLOWED_ORIGINS` is not set):
- `https://ifrunit.tech`
- `https://www.ifrunit.tech`
- `https://neabouli.github.io`
- `http://localhost:5175` (local dev)
- `http://localhost:3003` (local dev)

## Health Check

```bash
curl https://ifr-ai-copilot-production.up.railway.app/api/health
# -> { "status": "ok", "apiKeySet": true }
```

## Security

- `ANTHROPIC_API_KEY` only on Railway (backend) — never in the frontend
- CORS restricted to production origins
- Widget is embedded as iframe in landing page + wiki

## Widget Integration

The Copilot is embedded as an iframe widget in all pages:
- `docs/index.html` (Landing Page)
- `docs/wiki/*.html` (all 16 wiki pages)

```javascript
iframe.src = 'https://ifr-ai-copilot-production.up.railway.app';
```

---
*The old two-app architecture (Vercel Frontend + Railway Backend) was replaced by a single-app Railway deployment.*
