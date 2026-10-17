# IFR Data API

JSON-only protocol data service, package `ifr-data-api`, port **3003**.

```bash
npm ci
npm run typecheck
npm test
npm start
```

`GET /` lists the 24 retained data route registrations. `GET /api/health` returns
`{"status":"ok"}`. `POST /api/chat` returns HTTP 410 with `{"error":"chat retired"}`.
No model provider or chat UI is part of this service.

The existing RPC, CORS, cache, archive, deterministic Builder helpers, rate limits
and loan-health monitor retain their behavior. BuilderRegistry routes remain
conditional on `BUILDER_REGISTRY_ADDR`. Public consumers keep their existing data
hostname until a coordinated hostname migration.

See [retirement and production cutover](../../docs/COPILOT_CHAT_RETIREMENT.md) and
[Compose service releases](../../docs/COMPOSE_SERVICE_RELEASE.md). Deployment and
archive handling require separate production authorization.
