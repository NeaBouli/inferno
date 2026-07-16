# Server Capacity Runbook

Operational runbook for the Hetzner host that serves `shop.ifrunit.tech` and other projects.

## Current Finding

The Benefits Network images are not the main source of disk pressure anymore.
After the backend image hygiene work, the active Benefits images are small
relative to the host footprint:

- `inferno-benefits-backend`: about 95 MB image payload measured by Docker inspect
- `inferno-benefits-frontend`: about 56 MB image payload measured by Docker inspect
- Docker still reports about 35 GB of active images across all services

The largest active image families observed on 2026-07-16 were:

| Image | Approx. size | Status |
|---|---:|---|
| `ollama/ollama:latest` | 10.1 GB | active |
| `parlay-backend:latest` | 5.5 GB | active |
| `local_discourse/app:latest` | 5.5 GB | active |
| `inferno-points-backend:latest` | 1.1 GB | active |
| `clickhouse/clickhouse-server:23.3.7.5-alpine` | 1.0 GB | active |
| `neo4j:5-community` | 968 MB | active |

Large volumes observed on 2026-07-16 included:

| Volume | Approx. size | Notes |
|---|---:|---|
| `plausible_plausible-events` | 3.3 GB | active ClickHouse events data |
| `volumes_ekklesia_ollama` | 2.0 GB | active Ollama data |
| `ad8d889d72c25662c6be29c94fc8914f96daa77cc54520cdd1b935517c22cd90` | 1.2 GB | anonymous active volume; inspect before action |
| `parlay_parlay_neo4j_data` | 561 MB | active Neo4j data |

## Read-Only Audit

Run:

```bash
scripts/audit-docker-capacity.sh
```

Optional:

```bash
LIMIT=20 scripts/audit-docker-capacity.sh
SSH_HOST=hetzner REMOTE_VOLUME=/mnt/HC_Volume_106164848 scripts/audit-docker-capacity.sh
```

The audit is read-only. It prints:

- host disk usage
- Docker summary
- largest active images by Docker inspect size
- largest volumes
- unhealthy/restarting containers
- reclaimable build cache

Note: `docker images`, `docker system df -v` and `docker image inspect` can show
different size numbers because of shared layers, manifest/layer accounting and
virtual size reporting. Use the audit for ranking and follow-up investigation,
not as byte-perfect billing data.

## Safe Actions

These are generally safe during normal Benefits deployments:

```bash
docker builder prune -af
```

The Benefits deploy helper does this automatically when free space drops below
the configured floor:

```bash
scripts/deploy-benefits-network.sh frontend
scripts/deploy-benefits-network.sh backend
```

## Needs Explicit Review

Do not run these blindly:

```bash
docker image prune -af
docker system prune -af
docker volume prune
docker compose down -v
```

Before removing images, verify:

- the image has `CONTAINERS=0` in `docker system df -v`
- no stopped container still references it
- the owning project confirms rollback is not needed

Before touching volumes, verify:

- the owning project
- whether the volume is linked to an active container
- whether it contains production data
- whether a backup exists and was tested

## Current Recommendations

1. Keep using `scripts/deploy-benefits-network.sh` for Shop deploys.
2. Treat Benefits as optimized enough for now; further savings there are small.
3. Create a server-wide image retention policy for non-Inferno projects before deleting anything.
4. Investigate large active images separately: `ollama`, `parlay-backend`, `local_discourse/app`.
5. Investigate anonymous active volumes separately before any cleanup.
6. Add more disk or move heavyweight services if this host remains shared.
