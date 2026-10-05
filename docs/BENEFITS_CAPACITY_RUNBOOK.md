# Benefits Network Capacity Runbook

Last evidence snapshot: 2026-07-16, from `LIMIT=20 scripts/audit-docker-capacity.sh`.

This runbook is for `shop.ifrunit.tech` deploy safety. It does not authorize deleting
production volumes, active images, databases or service data.

## Why This Exists

`shop.ifrunit.tech` frontend deploys have repeatedly completed successfully, but the
server volume has stayed around `3.5 GB` free / `96%` used. During Docker builds the
free space can briefly fall below `0.5 GB`. Deploys therefore require `4 GB` free and never
prune shared Docker caches (T-265).

The Benefits Network containers are not the main disk consumers:

- `inferno-benefits-backend` image: about `91 MB`
- `inferno_benefits_data` volume: about `78 KB`
- Build cache (2026-07-16 snapshot): about `757 MB`

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

`scripts/deploy-benefits-network.sh` (T-265) is bounded, fail-closed and **never prunes** the
shared Docker daemon: no builder, container, image, system or volume prune in any mode. The
earlier "safe prune" path is gone.

Deploy modes (`frontend`, `backend`, `all`) run these steps in order and stop at the first
refusal; nothing on the host changes before step 7:

1. Exact release: `EXPECTED_SHA=<full sha>` equals `HEAD`, the tree is clean, and nothing
   ignored or index-hidden would be uploaded (exit 64/65).
2. Production env names in `/opt/inferno/.env.benefits` (see below; exit 78).
3. **No schema migration:** the release's `backend/prisma/migrations` must equal the host's
   file for file and byte for byte (exit 78). The backend runs `prisma migrate deploy` on
   start and an image retag cannot undo a schema change, so a migration needs its own
   reviewed, backed-up release.
4. Capacity: at least `4096M` free on the volume (exit 75). The floor is fixed; the old
   `MIN_FREE_GB`, `ABORT_FREE_GB` and `DEPLOY_ABORT_FREE_GB` knobs are ignored.
5. Exactly one backend replica (exit 78).
6. The container `inferno-<service>` runs for every service of the mode (nothing to roll
   back to otherwise; exit 78).
7. Backup in `/opt/inferno/backups/benefits-network-<UTC>/` (a new directory, never reused):
   `source.tgz` (the live tree without excludes), `env.benefits` (byte copy, mode `600`),
   `image-id-<service>`, `services`, and the tags `inferno-<service>:rollback-<UTC>`. The tag
   is set on the image ID the running container uses (`docker inspect -f '{{.Image}}'`), never
   on whatever `:latest` points to, since a build without `up` or a retag can move `:latest`.
8. Content-only sync (`rsync -rl --checksum --delete`, no `-a/-t/-p/-o/-g`, as in #199) and
   `RELEASE_SHA`.
9. `docker compose --env-file .env.benefits up -d --build --no-deps` for only the Benefits
   services of the mode (`frontend`: frontend; `backend`/`all`: backend, then frontend), each
   followed by a bounded health wait (`healthy` only).
10. Exactly one backend, then public checks: `https://shop.ifrunit.tech/`, `/api/health` and
    `/api/ready` must return `200`.

Any failure in steps 8-10 restores automatically: source (content-only), `.env.benefits`
(`cat` into the root-owned file, so inode, owner and mode stay), the rollback image tags and
the containers (`up -d --no-build --no-deps`), then verifies (a) content, (b) symlinks,
(c) world read/traverse access, (e) env byte-identity, (g) each container runs the backed-up
image ID, (d) container health and (f) public `200`. Every check fails on its own exit status
(listings go to files, no process substitution or unchecked pipeline), so a check command
that errors fails the restore like a mismatch. A verified restore exits `1` ("rolled back to
..."); an unverifiable one exits `70` with the manual command:

```bash
scripts/deploy-benefits-network.sh rollback /opt/inferno/backups/benefits-network-<UTC>
```

`verify` runs only the public checks. `capacity` and `status` stay read-only.

Before any upload or build, deploy modes also check the production settings in
`/opt/inferno/.env.benefits`. The backend refuses to start without these settings:

- `SELLER_AUTH_DOMAIN`, `CHAIN_ID`, `RPC_URL`;
- `IFR_TOKEN_ADDRESS`, `IFRLOCK_ADDRESS`, `COMMITMENT_VAULT_ADDRESS`;
- an `ADMIN_SECRET` of at least 32 characters.

If any are missing, the helper exits with code 78 and lists their names only; values are never
printed. Background: the 2026-10-02 release added the #124 requirement for `SELLER_AUTH_DOMAIN`
while the host file dated from August, which broke the shop API until the setting was added.

### CommitmentVault V2 address (`env-vault-v2`)

```bash
scripts/deploy-benefits-network.sh env-vault-v2 0x<40 hex>
```

Edits only `COMMITMENT_VAULT_V2_ADDRESS` in `/opt/inferno/.env.benefits`: the address must match
`^0x[0-9a-fA-F]{40}$` and not be zero; more than one key line refuses (exit 78). The file is
backed up first to `/opt/inferno/backups/benefits-env-<UTC>/env.benefits` (mode `600`); the
candidate must equal the backup except for that one line (replaced, or appended when absent);
the write is content-only and the written bytes, inode, mode and owner are verified, with an
automatic verified restore on mismatch (exit 1; 70 if the restore fails). No env value is
extracted or printed, no other key is touched and no container is recreated: apply it with a
reviewed `backend` deploy. The backend refuses a V2 address equal to `COMMITMENT_VAULT_ADDRESS`,
which that deploy's health check catches and rolls back. Undo:

```bash
scripts/deploy-benefits-network.sh env-restore /opt/inferno/backups/benefits-env-<UTC>
```

Tests: `npm run test:release-guards` (`scripts/test-deploy-benefits-network.sh` models the host
and covers each failure path, the never-prune rule and the single-key env edit).

With `DEPLOY_MODE=gate` the deploy modes run through the scoped deploy gate (inferno-deploy
v2), which applies the same floor and single-backend asserts on the host. Gate mode never
prunes (the Docker daemon is shared with other projects) and refuses a set `ALLOW_PRUNE`. See [gate mode](COMPOSE_SERVICE_RELEASE.md#gate-mode).

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
2. Use `scripts/deploy-benefits-network.sh frontend` only when the deploy floor is met, from a
   clean checkout of the reviewed release commit with `EXPECTED_SHA=<full sha>` set; the script
   refuses other trees, including ignored or assume-unchanged files it would upload (e.g.
   `.env.development.local`, `coverage/`). Below the floor it refuses (exit 75) and never prunes.
3. Before backend/all deploys, run `scripts/deploy-benefits-network.sh capacity`.
4. If free space remains below the `4096M` deploy floor, inspect owners of large images/volumes.
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
- Do not add a prune step to the release path; capacity below the floor is a refusal.

## Open Ops Work

- Decide whether the server volume should be expanded.
- Decide ownership and retention policy for `plausible_plausible-events`.
- Decide whether `volumes_ekklesia_ollama` and `ollama/ollama:latest` belong on this
  production host.
- Investigate `parlay-celery-beat` unhealthy status in the Parlay project context.
- Identify the anonymous `1.245 GB` active volume before any cleanup action.
