# AI Copilot — Deployment Guide

## Vercel (empfohlen)

1. https://vercel.com → New Project → Import from GitHub
2. Repo: `NeaBouli/inferno`
3. Root Directory: `apps/ai-copilot`
4. Framework: Vite
5. Environment Variables:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   POINTS_BACKEND_URL=https://ifr-points.railway.app
   ```
6. Deploy → URL notieren (z.B. `https://ifr-copilot.vercel.app`)

## Nach dem Deploy

Die Copilot Widget URL ist bereits in allen Seiten als Platzhalter gesetzt:
```
iframe.src = 'https://ifr-copilot.vercel.app';
```

Falls die URL anders ist, suche und ersetze in:
- `docs/index.html`
- `docs/wiki/*.html` (9 Seiten)

```bash
grep -rn "ifr-copilot.vercel.app" docs/
# Alle Treffer aktualisieren
```

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
curl https://ifr-copilot.vercel.app/api/health
# → { "status": "ok", "apiKeySet": true }
```
