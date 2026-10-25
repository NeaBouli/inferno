# Server Capacity Runbook

Generic operational runbook for a shared Docker host that serves
`shop.ifrunit.tech` alongside other, independently owned projects. The concrete
host connection, volume mount and third-party inventory are operator-specific and
live in the private operations record, not in this public runbook.

## Finding Pattern

The Benefits Network images are not the main source of disk pressure. After the
backend image hygiene work, the active Benefits images are small relative to a
shared-host footprint:

- `inferno-benefits-backend`: about 95 MB image payload measured by Docker inspect
- `inferno-benefits-frontend`: about 56 MB image payload measured by Docker inspect

On a shared host, large third-party image families and volumes (AI models, forums,
analytics databases, other applications) usually dominate the footprint. Treat
every non-Benefits image, container and volume as owned by another project:
identify the owner before any cleanup, and never infer ownership from names alone.
Anonymous volumes must be inspected before any action.

## Read-Only Audit

The audit needs the operator-supplied connection (no defaults are shipped):

```bash
SSH_HOST=<operator-ssh-alias> REMOTE_VOLUME=<mounted-volume-path> scripts/audit-docker-capacity.sh
```

Optional:

```bash
LIMIT=20 SSH_HOST=<operator-ssh-alias> REMOTE_VOLUME=<mounted-volume-path> scripts/audit-docker-capacity.sh
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

Operator-only cache cleanup on the shared Docker daemon (explicit approval; never part of a release):

```bash
docker builder prune -af
```

The Benefits deploy helper never runs these (T-265): below 4 GB free it refuses
the deploy, and any cache cleanup is a separate, explicitly approved operator step
on the shared daemon:

```bash
SSH_HOST=<operator-ssh-alias> REMOTE_ROOT=<deploy-root> REMOTE_VOLUME=<mounted-volume-path> \
  scripts/deploy-benefits-network.sh capacity   # read-only
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

## Standing Recommendations

1. Keep using `scripts/deploy-benefits-network.sh` for Shop deploys.
2. Treat Benefits as optimized enough; further savings there are small.
3. Keep a server-wide image retention policy for non-Inferno projects before deleting anything.
4. Investigate large third-party images and anonymous volumes with their owning projects before any cleanup.
5. Add more disk or move heavyweight services if the host remains shared.
