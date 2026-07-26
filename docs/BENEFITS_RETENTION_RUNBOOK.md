# Benefits Retention Runbook

## Scope

The phase-one retention tool removes only expired, operational authentication
artifacts and old admin audit rows. It does not run during backend startup and
does not schedule itself.

Eligible data:

- `AdminAuditLog` rows created before the selected cutoff
- expired `CustomerPassChallenge` rows
- expired `SellerAuthorizationChallenge` rows
- expired `CustomerHistoryChallenge` rows
- expired `CustomerHistoryAccess` rows
- expired `OPEN`, `CANCELLED`, or `EXPIRED` customer passes with no linked
  session

Protected data:

- all `Session` rows
- all session `AuditLog` rows
- all `RewardEvent` rows
- every customer pass linked to a session

The protected records support redemption limits, customer history, replay
defence, reward reconciliation, and auditability. This tool is not a
data-subject deletion workflow and does not establish a legal retention period.

## Preview

Set the intended database through the normal `DATABASE_URL` environment
configuration. Do not put credentials or private paths in screenshots, tickets,
or Bridge entries.

```bash
cd apps/benefits-network/backend
npm run retention:report -- --older-than-days=30
```

The report contains counts only. It does not return wallet addresses, tokens,
signatures, request bodies, or database connection details.

The same read-only report is available to authenticated operators:

```text
GET /api/admin/retention/report?olderThanDays=30
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
  --older-than-days=30 \
  --batch-limit=1000 \
  --confirm=PRUNE_EXPIRED_BENEFITS_DATA
```

The batch limit defaults to `1000` and may not exceed `10000` per table in one
run. Apply writes a new digest-only `retention:prune` admin audit row after
deleting the selected old rows. Running the same cutoff again is safe and
deletes only remaining eligible rows.

Never automate this command until a production retention schedule, operator,
backup requirement, and incident rollback procedure have been approved. Do not
run `VACUUM`, delete the SQLite file, or prune Session/AuditLog/RewardEvent data
as part of this procedure.

## Remaining Policy Decisions

- approved retention days per data class;
- Session and session-audit retention beyond the monthly redemption-limit
  floor;
- reward and financial-record retention;
- verified deletion-request and support workflow;
- legal/privacy review and dedicated contact channel;
- production schedule, monitoring, backup, and `VACUUM` policy.
