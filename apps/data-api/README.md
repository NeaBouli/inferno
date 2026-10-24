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

The existing RPC, CORS, process caches, archive, deterministic Builder helpers, rate limits
and loan-health monitor retain their behavior. BuilderRegistry routes remain
conditional on `BUILDER_REGISTRY_ADDR`. Public consumers keep their existing data
hostname until a coordinated hostname migration.

Wallet lookups and lock-event searches send `Cache-Control: private, no-store`
(some existing wallet routes use `no-store`). Wallet lookup error logs retain only fixed operation
labels and allowlisted error codes, omitting addresses and raw provider errors.
GET paths and response bodies remain compatible. Wallets still appear in request
URLs, and normalized lock-event searches remain in the bounded process cache.
Remaining recommendation: coordinate a POST/body lookup API with clients and
redact wallet/query targets in proxy access logs; HTTP cache headers do not remove
URL exposure or erase existing logs/caches. RPC providers still receive lookup calldata.

See [retirement and production cutover](../../docs/COPILOT_CHAT_RETIREMENT.md) and
[Compose service releases](../../docs/COMPOSE_SERVICE_RELEASE.md). Deployment and
archive handling require separate production authorization.
