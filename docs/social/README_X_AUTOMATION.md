# X Posting Automation

This folder contains post drafts for the official `@IFRtoken` X account.

Automation script:

```bash
X_DRY_RUN=true node scripts/post-x.js docs/social/x-geckoterminal-thread.md
X_DRY_RUN=false X_ALLOW_LIVE=true node scripts/post-x.js docs/social/x-geckoterminal-thread.md
npm run post:x:dry
```

Scheduled daily automation:

```bash
npm run post:x:daily:promo
npm run post:x:daily:status
```

Production schedule:

- `03:00 Europe/Athens` — rotating project promotion from the IFR content palette.
- `10:00 Europe/Athens` — live protocol status from supply, CommitmentVault and LendingVault API data.
- Automatic scheduled posts intentionally contain no links.
- Live cron must set `X_DRY_RUN=false` and `X_ALLOW_LIVE=true`; the repository defaults stay dry-run safe.

Live posting requires an X Developer App with write access and user-context credentials for `@IFRtoken`.

Recommended credential path:

- In X Developer Portal, set App permissions to `Read and write`.
- Open `Keys & Tokens`.
- Regenerate `Access Token` for `@IFRtoken` after permissions are changed.
- Store these four OAuth 1.0a values in local `x.env` or `.env`:
  - `X_CONSUMER_KEY`
  - `X_CONSUMER_SECRET`
  - `X_ACCESS_TOKEN`
  - `X_ACCESS_TOKEN_SECRET`

Required setup:

- X Developer Account
- X App with Read and Write permission
- OAuth 1.0a user-context token for `@IFRtoken`, or OAuth 2.0 user-context access/refresh token
- Optional refresh token setup via `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN`

Safety rules:

- Real credentials stay in `.env`, server env, or a secret manager.
- Use `docs/social/x.env.example` as the safe template.
- The script automatically loads local `x.env` first, then `.env`.
- For a custom local file, run with `X_ENV_FILE=/path/to/private-x.env`.
- Do not commit real X credentials. Local files such as `x.env`, `x.production.env`, `twitter.env`, `*.secrets.env`, and `*token*.env` are gitignored.
- Keep `X_DRY_RUN=true` by default.
- Live posting requires both `X_DRY_RUN=false` and `X_ALLOW_LIVE=true`.

Local setup:

```bash
cp docs/social/x.env.example x.env
nano x.env
X_DRY_RUN=true node scripts/post-x.js docs/social/x-clarification-post.md
X_DRY_RUN=false X_ALLOW_LIVE=true node scripts/post-x.js docs/social/x-clarification-post.md
```

Thread format:

- One post per block.
- Separate blocks with a line containing exactly `---tweet---`.
- Each post must be 280 characters or less.

IFR wording guidance:

- Do not use `$IFR` alone as the first line while X maps the cashtag incorrectly.
- Prefer `Inferno IFR on Ethereum`.
- Include the official contract and GeckoTerminal pool for important posts.

Canonical identifiers:

- Website: `https://ifrunit.tech`
- X: `https://x.com/IFRtoken`
- Ethereum contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- GeckoTerminal pool: `https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`

Included drafts:

- `x-geckoterminal-thread.md` — listing/verified pool thread
- `x-clarification-post.md` — pinned clarification candidate
- `x-cashtag-support-ticket.md` — support text for wrong `$IFR` cashtag mapping
