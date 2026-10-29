# Creator Gateway production preparation

Status: **prepared, not deployed** (owner decision, 17 October 2026). Source:
`apps/creator-gateway`; the CWA-28/29/30/41/42 fixes were merged in PR #124.
This document prepares a reviewed first release. It authorizes no deployment,
secret provisioning, Google Console changes, DNS changes or on-chain writes.
There is no live verification evidence for this service yet.

## Scope and owner decisions

| System | Environment | Access in this task | Owner | Permitted action |
| --- | --- | --- | --- | --- |
| Gateway source, image recipe, release client | Local worktree | Local reads and edits | Gio; Claude coordinates | Prepare and test |
| Shared Compose project and deploy gate | Production | Repository examples only; host state unknown | Gio / authorized operator | Document prerequisites |
| DNS, TLS, Google OAuth and RPC credentials | Production | No account or secret access | Gio / account owner | Propose configuration |

Proposed hostname: **`creator-api.ifrunit.tech` — owner decision required**.
`CREATOR_GATEWAY_HOST` selects the hostname in both the example labels and the
release client's public checks. The client defaults to the proposal; the Compose
template requires an explicit selection. Neither changes DNS.

Before authorizing a rollout, Gio must approve the final hostname, browser/SIWE
origin and CORS allowlist, Google project and channel ownership, membership
product behavior, RPC provider and independently verified Mainnet IFRLock,
single-replica operation and restart behavior, host gate onboarding, bootstrap
and withdrawal plan, capacity, release SHA and deployment window. The membership
blocker below must be resolved or explicitly scoped out in a separate reviewed
product change before a production release can be approved.

## Image and Compose insertion

The multi-stage Dockerfile uses the same digest-pinned Node 22 Alpine base as
the hardened Benefits images, omits development dependencies from the runner,
copies only application artifacts and runs as UID 1000 (`node`). No environment
file is copied into the image. Review the pinned base and scan the built image
at the release SHA before approving it; a digest is not a vulnerability scan.

Use
[`docker-compose.production.example.yml`](../apps/creator-gateway/docker-compose.production.example.yml)
as an **insertion template** in the existing `/opt/inferno/docker-compose.yml`.
Do not replace the shared Compose file or create a different Compose project.
The build context is `/opt/inferno/creator-gateway`, image
`inferno-creator-gateway:latest`, container `inferno-creator-gateway`, internal
port 3005. Only this service receives `/opt/inferno/.env.creator-gateway` via
its service-level `env_file`; never add it to another service, shared anchors,
image build args or a project-wide `--env-file`. Provision it outside this task
with owner-restricted permissions. Avoid printing rendered Compose environments
or `docker inspect` environment arrays.

The template has no published host port or data volume. It uses a read-only root
filesystem, a bounded temporary filesystem, dropped capabilities, init handling,
restart policy and initial CPU/memory/PID limits. Confirm those limits with a
built-image load test and read-only host capacity evidence before release.

The proposed Traefik labels follow the repository's Points routing pattern:

```yaml
labels:
  - traefik.enable=true
  - traefik.docker.network=traefik-public
  - traefik.http.routers.ifr-creator.rule=Host(`${CREATOR_GATEWAY_HOST:?owner must approve CREATOR_GATEWAY_HOST}`)
  - traefik.http.routers.ifr-creator.entrypoints=websecure
  - traefik.http.routers.ifr-creator.tls=true
  - traefik.http.routers.ifr-creator.tls.certresolver=letsencrypt
  - traefik.http.routers.ifr-creator.service=ifr-creator
  - traefik.http.services.ifr-creator.loadbalancer.server.port=3005
```

Confirm the existing external network, entrypoint, certificate resolver and
unique router/service names before insertion. Use the existing TLS/HTTP redirect
policy. Traefik must be the only ingress, with exactly one trusted proxy hop;
the production app trusts one hop for per-client rate limits. Do not publish
port 3005 or add another proxy without reviewing this trust boundary. Prevent
untrusted peers on the proxy network from bypassing ingress controls. See the
[Traefik Docker routing reference](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/).

The Docker healthcheck requests `/health` and requires HTTP success plus
`status: ok`. Liveness is outside the request limiter and carries `no-store`.
It does not prove Google availability, entitlement correctness or ongoing RPC
health. Before opening its production listener, the app validates configuration
and makes a bounded `eth_chainId` request; wrong-chain/unavailable RPC fails
startup without printing the endpoint or upstream errors.

## Runtime environment inventory

Names and descriptions only; provision actual settings through the authorized
operator. Production requires every application field marked required and has
no Sepolia or OAuth credential fallback.

| Name | Requirement | Description |
| --- | --- | --- |
| `NODE_ENV` | Fixed by production Compose | Enables strict production validation and Secure OAuth cookies. |
| `PORT` | Fixed by production Compose | Listener port; must agree with Traefik and healthcheck. |
| `JWT_SECRET` | Required | Independently generated high-entropy signing secret, at least 32 bytes; never reuse another service's secret. Length validation cannot establish entropy. |
| `SIWE_DOMAIN` | Required | Exact signing authority, including any port; must equal the host of the signing URI. |
| `SIWE_URI` | Required | Exact HTTPS URI signed by clients; approve together with the client integration. |
| `ALLOWED_ORIGINS` | Required | Comma-separated exact HTTPS browser origins; no wildcard, path, query, fragment, credentials or empty entry. |
| `CHAIN_ID` | Required | Explicit Ethereum Mainnet selection; other production chains fail startup. |
| `IFRLOCK_ADDRESS` | Required | Explicit nonzero checksummed or lowercase EVM address; operator must independently verify Mainnet code and identity. Syntax checks do not prove contract identity. |
| `RPC_URL` | Required | HTTPS JSON-RPC endpoint for the selected chain; no URL userinfo or fragment. Treat provider URL paths/query strings as secrets. |
| `GOOGLE_CLIENT_ID` | Required | Server-side Web application OAuth client identifier. |
| `GOOGLE_CLIENT_SECRET` | Required | Corresponding server-side OAuth secret. |
| `GOOGLE_REDIRECT_URI` | Required | Exact HTTPS callback URI ending in `/auth/google/callback`, without query or fragment. |
| `YOUTUBE_CHANNEL_ID` | Required | Intended creator channel identifier; currently metadata, not an enforced membership filter. |
| `MIN_LOCK_IFR` | Optional | Positive decimal token threshold with at most nine fractional digits, parsed with integer arithmetic. Defaults to `1000` in the default entitlement policy below. |
| `CREATOR_GATEWAY_HOST` | Operator/release setting | Approved public DNS hostname for Compose interpolation and release verification; not an application credential. |

Production requires `CHAIN_ID=1` and an explicit address pair; development
retains the consistent Sepolia pair when both are absent. HTTPS origins must be
canonical origins without trailing slashes. `/access/check` uses the source-defined
OR policy in `src/services/entitlement.ts`: YouTube membership or an IFR lock meeting
`MIN_LOCK_IFR` (default `1000`). The validated setting is captured at startup;
changing it requires restarting the gateway. Explicit policies passed to
`checkEntitlement` retain their own logic and thresholds. IFR accounting retains
nine decimals without JavaScript number rounding.

Only one process/replica is supported: SIWE nonces, OAuth states, YouTube sessions
and rate limits are in memory. Restart or rollback discards them. Users must
restart in-progress OAuth and reauthenticate for YouTube; an older JWT's `sid`
will no longer resolve. Wallet JWTs can remain valid until expiry if the signing
secret stays unchanged. There is no persistent database to migrate or restore.

## Google OAuth requirements and membership release blocker

Use a separate production Google Cloud project, enable YouTube Data API v3 and
create an OAuth client of type **Web application**. For the proposed hostname,
register exactly **`https://creator-api.ifrunit.tech/auth/google/callback`** as
the authorized redirect URI; substitute the approved hostname if different.
The environment and Console URI must match exactly, including path and slash.
Keep localhost/test callbacks in the development project. The current flow
uses server redirects and does not require a Google browser JavaScript client.

Configure the consent audience, support/developer contacts, verified owned
domains, public app homepage and privacy policy. Complete the verification
required for the chosen scopes and production audience before public launch;
Google Testing mode/test-user access is not general production approval. These
requirements follow Google's
[production OAuth guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
and [web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

**Unresolved release blocker:** the reviewed code currently requests only
`https://www.googleapis.com/auth/youtube.readonly`, whereas
[`members.list`](https://developers.google.com/youtube/v3/docs/members/list)
requires `https://www.googleapis.com/auth/youtube.channel-memberships.creator`,
channel-owner authorization and access for a memberships-enabled creator.
Google also documents `all_current`/`updates` modes; the checker sends
`listMembers`. It treats any returned member as success, without binding the
member to the signed-in user or configured `YOUTUBE_CHANNEL_ID`.

Consequently, setting up the OAuth client or adding a scope in the Console
cannot establish the promised visitor membership check. Do not broaden the
runtime scope as a deployment workaround. A separately reviewed design must
establish channel-owner credentials, member identity/channel binding and the
required API access, or explicitly remove that branch from the product. Until
then, Google API errors return false and the IFR-lock branch can independently
grant access through the OR policy. Do not advertise working YouTube membership
or approve a full membership launch from a green liveness response.

## First release prerequisites and procedure

1. Resolve the membership blocker and owner decisions above. Choose one full
   reviewed 40-character release SHA, require green Creator Gateway CI and
   release-guard CI for that exact SHA, and review the final image/Compose diff.
2. An authorized operator must obtain read-only capacity and routing evidence,
   confirm no conflicting service/hostname, validate the new image on an
   isolated deployment rehearsal, and test startup failure, liveness, actual
   client flow, per-client rate limits and secret-free error handling. Review
   access-log policy: callback URLs/codes/state, cookies, bearer JWTs and
   provider errors must not enter shared logs or retained evidence.
3. Separately authorize provisioning the dedicated environment file, Google
   application, DNS/TLS, shared Compose insertion and any deploy-gate change.
   Only an authorized operator may perform them. This task performs none.
4. **Gate onboarding is required:** local `DEPLOY_MODE=gate` routes the new
   service, but the installed host tool and forced-command allowlists are
   outside this repository and their support is unknown. Have the owner review
   and install a service-specific allowlist change, including health, backups
   and restore. Never fall back to unrestricted/root SSH to bypass a denial.
5. **Bootstrap is distinct from update deployment.** The existing direct
   release path requires the source directory, shared Compose file and previous
   `inferno-creator-gateway:latest` image even for `plan`; a first deployment
   intentionally refuses when no previous image exists. Gate bootstrap
   semantics must also be accepted before use. Do not invent a previous image
   or tag the new image as a fictitious rollback target. Prepare and approve an
   operator bootstrap change with an exact-SHA source archive, built image ID,
   source release marker, pre-insertion Compose backup and service-only
   withdrawal. Its rehearsal and one-time execution need separate approval.
6. Once a real baseline exists, use the regular client below for subsequent
   reviewed releases. These are future operator commands, not authorization:

```bash
export DEPLOY_MODE=gate
export EXPECTED_SHA=<full-reviewed-release-sha>
export CREATOR_GATEWAY_HOST=<owner-approved-hostname>
scripts/deploy-compose-service.sh creator-gateway plan
scripts/deploy-compose-service.sh creator-gateway deploy
scripts/deploy-compose-service.sh creator-gateway verify
```

The generic [Compose release runbook](COMPOSE_SERVICE_RELEASE.md) describes
source backups, excluded remote-only environment/runtime files, capacity floor
and direct-mode automatic rollback. In gate mode, public-check failure after a
successful host deploy requires explicit rollback using the printed stamp;
host recovery guarantees must be accepted for this service.

## Pre-release and post-release verification

Record release SHA, image ID, time, expected/actual result and redacted evidence
for every check. The table specifies future live checks; none ran in this task.
Use dedicated controlled accounts and existing wallets/locks; no transaction or
private-key access is required. Keep raw OAuth codes, cookies, tokens and wallet
identifiers out of the report. Destructive replay tests consume only their own
test nonce/state.

| Item | Live verification required before sign-off |
| --- | --- |
| Routing/liveness | Correct TLS hostname and certificate; `/health` returns 200 with only `status: ok`, `no-store`; no host port. Exhaust a controlled client's limit in a rehearsal and confirm health remains 200 and other clients retain their own budget. |
| CWA-28 | `POST /auth/wallet` returns 404 and no token, including with a valid wallet address. A valid canonical SIWE flow still issues a JWT. |
| CWA-29 | Browser OAuth start sets HttpOnly/SameSite=Lax/Secure cookie scoped to `/auth`; query/body wallet input returns 400. Missing, foreign, expired and replayed state/cookie callbacks fail. A bare Google login has no wallet claim; only a verified SIWE bearer may link it. |
| CWA-30 | Correct domain, exact URI, Mainnet chain, server-issued nonce and valid time window succeed. Wrong domain/URI/chain, expired message, foreign/reused nonce and invalid signature never issue a JWT. |
| CWA-41 | After a controlled real Google callback, response and decoded JWT contain only minimal application claims (`sid`, optional proven wallet, timestamps), no provider tokens. Reuse an old session after restart/expiry: the YouTube branch fails closed. Check redacted app and proxy logs. |
| CWA-42 | Missing/short signing secret, incomplete network pair, non-Mainnet production chain and wrong-chain/unavailable RPC prevent startup in an isolated rehearsal. Unsigned, wrong-key and HS512 JWTs return 401 on `/access/check`; a legitimate HS256 JWT works. |
| CORS | Approved browser origins receive the matching CORS header; foreign origins receive none. CORS is a browser control and does not replace bearer authorization. |
| Entitlements | Controlled locked/unlocked wallets yield the expected IFR decisions at nine-decimal boundaries. After the separate membership repair, member/nonmember/foreign-channel/API-error cases must prove identity binding and fail-closed behavior. |
| Service isolation | Other public services remain healthy; their environment, image IDs and start times stay unchanged. Restart only the new service in the rehearsal and prove the documented session loss and recovery. |

The release client's public checks cover health 200, SIWE nonce 200,
`POST /auth/wallet` 404, unauthenticated `/access/check` 401 and incomplete
Google callback 400. These do not substitute for the authenticated live matrix.

## Rollback and first-release withdrawal

For an update with a genuine previous baseline:

```bash
DEPLOY_MODE=gate scripts/deploy-compose-service.sh creator-gateway backups
DEPLOY_MODE=gate scripts/deploy-compose-service.sh creator-gateway rollback <backup-stamp>
scripts/deploy-compose-service.sh creator-gateway verify
```

Set `CREATOR_GATEWAY_HOST` to the approved host for verification. In direct
operator mode, rollback takes
`/opt/inferno/backups/creator-gateway-<UTC-stamp>` instead of a bare stamp. It
restores source and the previous image, recreates only the gateway without
building, checks content/symlinks/access/health, and preserves excluded env and
runtime files. Gate restore must have equivalent accepted service-specific
evidence. Run the live matrix and peer health checks after rollback. Rollback
does not restore Compose, DNS, Google Console settings or the dedicated env;
keep those unchanged during routine releases or prepare their own reviewed
recovery steps.

For the **first bootstrap**, there is no previous application to restore.
The approved withdrawal must stop/remove only `creator-gateway`, restore the
pre-insertion Compose definition without recreating peers, and prove the new
hostname no longer routes to the gateway while other services stay healthy.
Never run project-wide `down`, prune volumes/images or delete secrets as part
of withdrawal. Retain the reviewed image, release evidence and protected
configuration for diagnosis. DNS or Google rollback is a separate owner action.
Do not start bootstrap until that service-only withdrawal has been rehearsed.
