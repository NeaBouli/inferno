# Web3 Site Release (web3.ifrunit.tech)

`web3.ifrunit.tech` is a static nginx copy of `docs/` on the production host. A merge to `main`
does **not** update it (GitHub Pages only serves `ifrunit.tech`). Without a release the host
drifts: on 2026-09-30 it still served the 12 September build (vendored ethers/WalletConnect 404,
CSP allowing `esm.sh`, Pages sitemap with foreign-host URLs, service worker `ifr-web3-v15`).

`scripts/deploy-web3-site.sh` releases exactly one reviewed commit. It is operator-run: the Fleet
diagnosis identity has no write access to `/opt/inferno` and no Docker.

## What a release changes

| Target | Change | Not changed |
| --- | --- | --- |
| `/opt/inferno/web3-site/html/` | full `docs/` tree of the release commit (`git archive`, never the working tree), plus `infra/web3/robots.txt` + `infra/web3/sitemap.xml` at the web root, `infra/web3/web3-security-headers.conf` as `.nginx/web3-security-headers.conf`, and `web3-release.json` (`{"sha": …}`) | no deletions unless `DELETE=1` |
| `inferno-web3-site` | `nginx -t`, then `nginx -s reload` | no recreate, no other container, no volume, env or secret |
| `/opt/inferno/web3-site/nginx.conf` | nothing | the host config already includes `/usr/share/nginx/html/.nginx/web3-security-headers.conf` (dot paths are not served); `deploy` stops if that include is missing |

A new backup directory `/opt/inferno/backups/web3-site-<UTC>/` (never reused) receives a tar of
`html/` and a copy of `nginx.conf` before anything changes. A failed sync stops before nginx is
touched. If `nginx -t` fails, the previous headers file is restored from the backup and nginx is
not reloaded.

## Run

```bash
git fetch origin && git checkout --detach <release-sha>   # clean checkout, nothing uncommitted
export EXPECTED_SHA=<release-sha>                          # full 40 characters
scripts/deploy-web3-site.sh plan      # read-only: remote checks, rsync dry run, headers diff
scripts/deploy-web3-site.sh deploy    # backup -> sync -> nginx -t -> reload -> verify
scripts/deploy-web3-site.sh verify    # public HTTP only; safe to repeat from any machine
```

`SSH_HOST` defaults to the operator alias `hetzner`. `deploy` refuses a dirty tree, a different
`HEAD`, a failing `test:web3-headers` or `test:web3-wallet-runtime` gate, a stopped container or
less than 1 GB free.

## Verify

`verify` stages the same commit locally and compares, over public HTTPS with a cache-busting
query, the SHA-256 of `web3/index.html`, `web3-wallet-core.js`, `web3-sw.js`, the manifest, both
vendored artifacts, `robots.txt`, `sitemap.xml`, `llms.txt` and `web3-release.json`, plus the
exact CSP header. Afterwards run the Web3 visual gate (390, 711, 820, 1180, 1440 px) and the
WalletConnect cancel check from T-156.

## Rollback

```bash
scripts/deploy-web3-site.sh rollback /opt/inferno/backups/web3-site-<UTC>
```

Restores `html/` exactly (rsync `--delete` from the archive, including the headers file) and the
backed-up `nginx.conf`, then `nginx -t` and reload. Only timestamped paths under the backup root
are accepted.

## Gate mode

With `DEPLOY_MODE=gate` the same modes run through the scoped deploy gate (inferno-deploy v2):
the staged docroot goes up as a tar with `.nginx/web3-security-headers.conf` at its root, and
`rollback` takes the backup stamp. Mapping and details: [Compose Service Release, gate
mode](COMPOSE_SERVICE_RELEASE.md#gate-mode).

## Tests

`npm run test:release-guards` runs `scripts/test-deploy-release-guards.sh` against a temporary
copy of the host layout (remote commands really run there; only docker, df and curl are fakes):
plan leaves the host byte-identical, a missing include or failed sync stops before any nginx
action, failed `nginx -t` restores the headers, deploy ships docroot + anchors + headers without
touching `nginx.conf`, verify fails on a tampered file or CSP, rollback restores the docroot
exactly and rejects other paths, and `scripts/deploy-benefits-network.sh` refuses deploys without
the exact clean `EXPECTED_SHA`. Each guard is mutation-checked.
