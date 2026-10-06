# Benefits Retention Runbook

## Scope

The backend stores no raw customer wallet address (T-231a). Where an identity is
needed it stores a keyed fingerprint, `wfp1:` + HMAC-SHA256 of the lowercase
address under `CUSTOMER_WALLET_HMAC_KEY`. Seller wallets (owner, checkout
operators, reward and builder wallet) are business identities and stay in clear
text.

The retention tool (policy `phase-two-bounded-customer-data`) does not run
during backend startup and does not schedule itself.

Eligible data:

- `AdminAuditLog` rows created before the selected cutoff
- expired `CustomerPassChallenge` rows
- expired `SellerAuthorizationChallenge` rows
- expired `CustomerHistoryChallenge` rows
- expired `CustomerHistoryAccess` rows
- expired `OPEN`, `CANCELLED`, or `EXPIRED` customer passes with no linked
  session
- `RewardEvent` rows (any status) created before the customer-data cutoff
- `Session` rows created and expired before the customer-data cutoff that have
  no remaining reward event, together with their session `AuditLog` rows and
  the customer pass they were bound to

Customer-data cutoff: the selected cutoff, but never younger than **35 days**
(`CUSTOMER_DATA_MIN_RETENTION_DAYS`). The floor covers the longest monthly
redemption-limit look-back (31 days) and the Model B rule that a period must be
settled within 72 hours after it ends. No live check reads an older customer row.

Consequence: "one reward per wallet and partner" and the redemption limits hold
inside the retained window; after a row is pruned, the same wallet is treated
as new. This is the intended trade-off of the owner decision of 2026-10-06.

This tool is not a data-subject deletion workflow and does not establish a legal
retention period.

## Preview

Set the intended database through the normal `DATABASE_URL` environment
configuration. Do not put credentials or private paths in screenshots, tickets,
or Bridge entries.

```bash
cd apps/benefits-network/backend
npm run retention:report -- --older-than-days=35
```

The report contains counts and both cutoffs only. It does not return wallet
addresses, fingerprints, tokens, signatures, request bodies, or database
connection details.

The same read-only report is available to authenticated operators:

```text
GET /api/admin/retention/report?olderThanDays=35
Authorization: Bearer <admin credential>
```

The endpoint uses `private, no-store` and does not mutate the audit table.

## Apply

Production execution is a separate operational write. Before an approved run:

1. confirm the intended environment and database;
2. create and verify a rollback backup;
3. save the preview counts;
4. choose an approved cutoff;
5. run one bounded batch;
6. rerun the preview and reconcile the deleted counts.

```bash
npm run retention:prune -- \
  --older-than-days=35 \
  --batch-limit=1000 \
  --confirm=PRUNE_BENEFITS_DATA_WINDOW
```

The confirmation string changed with T-231a (it was
`PRUNE_EXPIRED_BENEFITS_DATA`), so an old command line cannot silently prune
customer records. The batch limit defaults to `1000` and may not exceed `10000`
per table in one run. Apply writes a new digest-only `retention:prune` admin
audit row. Running the same cutoff again is safe and deletes only remaining
eligible rows. Do not run `VACUUM` or delete the SQLite file as part of this
procedure.

## T-231a customer wallet data migration (one-off)

Rows written before T-231a hold raw customer addresses. They are converted in
place by a keyed data migration. There is no schema change: the Prisma fields
are mapped onto the existing columns, so `prisma migrate diff` is empty.

1. The owner provisions `CUSTOMER_WALLET_HMAC_KEY` (at least 32 random
   characters, different from `ADMIN_SECRET`) in the backend environment. The
   current deploy tool only whitelists `env-set` for `COMMITMENT_VAULT_V2_ADDRESS`;
   it needs an extension for this key, or the owner sets it on the host. Never
   paste the key into tickets, chat or logs. Keep an offline copy: losing or
   changing it orphans every stored fingerprint.
2. Stop the backend (no writes during the migration) and take a verified
   backup of the SQLite database.
3. Preview, then apply with the new release's build:

   ```bash
   npm run fingerprint:migrate -- report
   npm run fingerprint:migrate -- apply --confirm=HASH_CUSTOMER_WALLETS
   ```

   The tool refuses without the key, refuses without the exact confirmation,
   refuses if two reward events would collide on (fingerprint, partner), runs
   in one transaction, prints counts only, and is idempotent.
   `remainingRawRows` must be all zero.
4. Start the new backend image and confirm `GET /api/ready` reports
   `customerWalletProtection: "configured"`.

Rollback: the hash is one-way by design. Restore the backup from step 2 and the
previous image together. The new code must not run against unmigrated rows (it
ignores them for limits, history and rewards), and the old code must not run
against migrated rows.

## Remaining Policy Decisions

- approved cutoff and schedule for production runs;
- verified deletion-request and support workflow;
- legal/privacy review and dedicated contact channel;
- production monitoring, backup, and `VACUUM` policy;
- key custody and rotation procedure for `CUSTOMER_WALLET_HMAC_KEY`.
