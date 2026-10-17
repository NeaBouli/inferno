# Web Chat Retirement and Data API Cutover

Source change: 17 October 2026. Production cutover is a separate authorized operation;
this document does not claim that the production service has already changed.

Inferno is a community project without a central AI operator. The AI Copilot web
chat is retired so the public website does not depend on a centrally operated
model service for protocol guidance. Maintained documentation and explicit wallet
interfaces remain the sources for instructions and actions.

## Removed

- The inline chat at `/`, its React alternative, embeds, launchers, panels and avatars.
- The Anthropic request, prompts, curated knowledge, Wiki RAG, live Wiki crawler,
  chat budgets, prompt safety, surface context and dynamic-intent modules.
- The Wiki snapshot generator and generated snapshot, Vite client, dedicated
  Railway/Vercel configurations and Railway release workflow.
- Chat-originated guide/onboarding Points event sends. Already-awarded Points
  remain intact; the Points backend accepts the existing event schema, including
  legacy guide types, without a migration. `wallet_connect` remains supported.

The independent Points and fee-discount material stays at `wiki/agent.html`, with
neutral navigation and metadata. Historical logs and audit evidence are preserved.
Telegram `/ask` and `services/skywalker.js` remain unchanged by owner decision.

## Retained service

`apps/data-api/` is the `ifr-data-api` package. Container, Compose service and image
names for the new deployment are `data-api`, `inferno-data-api` and
`inferno-data-api:latest`. The container listens on port **3003**, runs as a non-root
user under `dumb-init`, and healthchecks `GET /api/health`.

All 24 non-chat route registrations retain their paths, response shapes and
behavior, including conditional BuilderRegistry activation, the bootstrap vote
archive, deterministic Builder generation, data caches and loan-health monitor.
RPC fallback, CORS allowlists, request guards and data-route rate limits remain.
The data API does not read `ANTHROPIC_API_KEY` or contact a model provider.

`GET /` returns `{ "service": "ifr-data-api", "endpoints": [...] }`.
`POST /api/chat` returns HTTP **410** and `{ "error": "chat retired" }`, including
obsolete or malformed chat payloads. JSON responses enforce `default-src 'none'`
and `frame-ancestors 'none'`; embedding is denied. Web3 and Benefits retain their
WalletConnect frame permissions and no longer permit a chat frame.

The public hostname **copilot-api.ifrunit.tech stays unchanged for compatibility**
with installed SDK clients, Telegram `/price`, the X daily bot and page data
fetches. Migration to a neutral public hostname is a later, separately coordinated
step. Do not replace these data URLs during the chat cutover.

For existing data-route tuning, `COPILOT_ETHERSCAN_CONCURRENCY` and
`COPILOT_FEED_PER_MINUTE` remain legacy fallback settings.
`DATA_API_ETHERSCAN_CONCURRENCY` and `DATA_API_FEED_PER_MINUTE` take precedence.
The archive still honors `BOOTSTRAP_VOTES` and `RAILWAY_VOLUME_MOUNT_PATH` exactly
as before; legacy infrastructure naming is not a requirement to run Railway.

## Production cutover order

1. Obtain action-specific production authorization. Record exact source/image
   identities, Compose labels, networks, environment-file references, mountpoints,
   archive persistence and external ingress. Back up source, old image, Compose
   configuration and the live bootstrap vote archive; verify restoration. Never
   print secret values or copy them into this repository.
2. Deploy the cleaned landing/Wiki, Web3 and Benefits clients first. Verify mobile
   and desktop layouts, absence of chat requests/frames, wallet and checkout flows,
   retained data fetches, and Benefits service-worker revision **v26**, Web3 revision **v23**, and versioned static CSS. The old
   server can continue supplying data while these clients roll out.
3. Prepare `/opt/inferno/data-api` from the reviewed release, then switch the host
   Compose service from `ai-copilot` to `data-api` on the **same router, hostname,
   network and port 3003**. Preserve the archive volume/data and required non-AI
   configuration. Remove the web service's model credential from the new service's
   configuration; do not rotate or remove credentials used by Telegram `/ask`.
   Avoid two active routers claiming the same hostname. Compose is host-owned and
   is not changed by the repository release helper.
4. Verify exact-head CI, container health, all 24 route contracts with the original
   configuration, `/` JSON, `/api/chat` 410, SDK access checks, `/price`, scheduled
   consumers and archive continuity. Repeat the client visual and cache checks.
   Data availability is required before proceeding.
5. Only after backup and rollback verification, remove the stopped old container
   and later the old image/source under the agreed retention policy. Preserve
   shared volumes and Points history. Disable any old external web-chat deployment
   or hook that could recreate the retired service. Update host deploy-gate
   allowlists and required CI checks from the old workflow to `Data API CI`.

The generic release helper requires an existing source/image baseline. The first
service rename/bootstrap must be prepared by the authorized host operator; the
helper deliberately refuses a missing prior image. After that, use
`EXPECTED_SHA=<full-sha> scripts/deploy-compose-service.sh data-api plan|deploy`.

## Rollback

Keep the pre-cutover Compose definition, source, image, archive snapshot and client
release artifacts. If data verification fails, restore the former service/router
and the same archive mounts; keep the cleaned clients deployed where possible.
Verify `/api/health`, retained API responses and downstream consumers before
resuming traffic. Restore old clients only if their independent flows require it.
Restoring the old image can restore chat availability and model calls, so that
rollback requires explicit owner authorization and its original configuration.

The release helper accepts `ai-copilot` only for rollback and inspection modes
(`verify`, `status`, `health`, `logs`, `backups`). It refuses new `plan`/`deploy`
operations for that retired name. In gate mode the installed host gate must also
accept the relevant service; no host allowlist changes are made by this task.
