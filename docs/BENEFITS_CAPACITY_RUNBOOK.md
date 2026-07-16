# Benefits Network Capacity Runbook

Last evidence snapshot: 2026-07-16, from `LIMIT=20 scripts/audit-docker-capacity.sh`.

This runbook is for `shop.ifrunit.tech` deploy safety. It does not authorize deleting
production volumes, active images, databases or service data.

## Why This Exists

`shop.ifrunit.tech` frontend deploys have repeatedly completed successfully, but the
server volume has stayed around `3.5 GB` free / `96%` used. During Docker builds the
free space can briefly fall below `0.5 GB` before cache pruning runs.

The Benefits Network containers are not the main disk consumers:

- `inferno-benefits-backend` image: about `91 MB`
- `inferno_benefits_data` volume: about `78 KB`
- Build cache after safe prune: about `757 MB`

## Safe Read-Only Checks

Capacity-only guardrail check:

```bash
scripts/deploy-benefits-network.sh capacity
```

This mode is strictly read-only: it reports the guardrail result, compose status and Docker
disk usage but never invokes a prune command, even when capacity is below a threshold.

Detailed Docker inventory:

```bash
LIMIT=20 scripts/audit-docker-capacity.sh
```

The detailed inventory is read-only. It reports active image owners by container name and
lists the containers and mount destinations attached to the largest Docker volumes. Use
that ownership view before deciding whether a volume belongs to Benefits, Parlay,
Plausible, Ekklesia/Ollama or another service.

Benefits live smoke after any operational work:

```bash
npm run smoke:benefits
```

## Deploy Guardrails

`scripts/deploy-benefits-network.sh` uses:

- `MIN_FREE_GB=4` as the warning floor.
- `ABORT_FREE_GB=2` as the emergency hard floor for all checks.
- `DEPLOY_ABORT_FREE_GB=4` as the default hard floor before any container rebuild.
- Explicit deploy modes may run safe pruning only:
  - Docker builder cache
  - stopped containers
  - dangling images

The helper does not prune Docker volumes.

Reason for the stricter deploy floor: frontend-only deploys have started with
about `3.4-3.5 GB` free and then dropped below `0.5 GB` during Docker build
before safe pruning recovered space. Treat deploys below `4 GB` free as blocked
unless an operator explicitly accepts the risk for a one-off run.

## Current Largest Consumers

Largest active images from the latest audit:

| Size | Active containers | Image | Container names |
|---:|---:|---|---|
| 3.51 GB | 1 | `ollama/ollama:latest` | `ekklesia-ollama` |
| 1.43 GB | 1 | `parlay-backend:latest` | `parlay-backend` |
| 1.24 GB | 1 | `local_discourse/app` | `app` |
| 339 MB | 1 | `neo4j:5-community` | `parlay-neo4j` |
| 253 MB | 1 | `clickhouse/clickhouse-server:23.3.7.5-alpine` | `plausible-events` |

Largest local volumes from the latest audit:

| Size | Active refs | Volume | Attached containers / mountpoints |
|---:|---:|---|---|
| 3.129 GB | 1 | `plausible_plausible-events` | `plausible-events` -> `/var/lib/clickhouse` |
| 2.019 GB | 1 | `volumes_ekklesia_ollama` | `ekklesia-ollama` -> `/root/.ollama` |
| 1.245 GB | 1 | anonymous volume `ad8d889d...` | `plausible-events` -> `/var/log/clickhouse-server` |
| 561 MB | 1 | `parlay_parlay_neo4j_data` | `parlay-neo4j` -> `/data` |
| 212 MB | 1 | `parlay_parlay_chroma_data` | `parlay-chroma` -> `/chroma/chroma` |

The latest audit also reported one unhealthy container:

- `parlay-celery-beat`

## Safe Decision Path

1. Keep using `scripts/deploy-benefits-network.sh capacity` for read-only capacity checks.
2. Use `scripts/deploy-benefits-network.sh frontend` only when the deploy floor is met.
3. Before backend/all deploys, run `scripts/deploy-benefits-network.sh capacity`.
4. If free space remains below `MIN_FREE_GB`, inspect owners of large images/volumes.
5. Confirm whether non-Benefits services can be stopped, migrated, archived or resized.
6. Only after explicit approval, perform any destructive action such as volume removal,
   image removal for active services, database compaction or service migration.
7. After any approved capacity change, run:

```bash
scripts/deploy-benefits-network.sh capacity
npm run smoke:benefits
```

## Do Not Do Without Explicit Approval

- Do not run `docker system prune --volumes`.
- Do not delete `plausible_*`, `parlay_*`, `volumes_ekklesia_*`, database, analytics,
  AI model or anonymous volumes without owner confirmation.
- Do not stop unrelated production services just to free disk for a Benefits deploy.
- Do not lower `ABORT_FREE_GB` as a permanent workaround.

## Open Ops Work

- Decide whether the server volume should be expanded.
- Decide ownership and retention policy for `plausible_plausible-events`.
- Decide whether `volumes_ekklesia_ollama` and `ollama/ollama:latest` belong on this
  production host.
- Investigate `parlay-celery-beat` unhealthy status in the Parlay project context.
- Identify the anonymous `1.245 GB` active volume before any cleanup action.
