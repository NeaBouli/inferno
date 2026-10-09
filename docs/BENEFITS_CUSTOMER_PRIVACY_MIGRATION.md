# Benefits Customer Privacy Migration Runbook

Status: **plan only. Nothing in this runbook has been run against production or any backup.**
The production migration and the backup clean-up need their own approved release.

Migration: `apps/benefits-network/backend/prisma/migrations/20261006120000_owner_b_customer_session_privacy`
(owner decision B, T-231b, "storage-free customer sessions").

## What changes

After the migration the backend stores no customer wallet address, no hash or fingerprint of it,
no signature or signed text, no lock or balance amounts, no block numbers, no payment transaction
hashes and no customer history. It still keeps merchant checkout records (random checkout ID,
shop, offer terms, status, timestamps, lock source, self-redemption flag, the seller wallet that
opened the checkout) and seller-side audit events. This is not anonymity.

### Removed customer data

| Store | Removed |
| --- | --- |
| `Session` | `recoveredAddress` (+ customer-history index), `lockAmountRaw`, `walletBalanceRaw`, `verificationBlock` |
| `CustomerPass` | `walletAddress` (+ index) |
| `RewardEvent` | `customerWallet`, `lockAmountRaw`, unique `(customerWallet, partnerId)` |
| `CustomerPassChallenge` | table dropped |
| `CustomerHistoryChallenge` | table dropped |
| `CustomerHistoryAccess` | table dropped (all customer history read tokens become invalid) |
| `AuditLog.payload` | `wallet`, `locked`, `held`, `verificationBlock` removed from `ATTEST_OK` and `REDEEM_DENIED_LIMIT` |

Added `Session` columns: `selfRedemption`, `proofVersion`, `confirmedByWallet`, `confirmedByRole`,
`confirmedByOperatorId` (seller identity only).

Out of scope of the migration: RPC provider request logs, reverse-proxy or platform access logs,
and existing backups (see below).

## Migration steps (in SQL order)

1. **Refusal guard (fail closed, explicit allowlist).** The only reward status treated as finished
   is `CONFIRMED` (recorded on-chain). If any `RewardEvent` has another status, including the open
   statuses `PENDING`, `READY`, `BLOCKED_CALLER`, `BLOCKED_GOVERNANCE`, `SETTLEMENT_PENDING` and any
   unknown, unexpected or NULL value, the migration fails before it changes anything. These
   obligations must be settled or explicitly resolved under the **old release** first. Never
   delete a pending obligation to pass the guard, and never treat elapsed time (for example
   `periodEnd + 72h`) as settlement. How each event is resolved is an owner/governance decision
   recorded before the release. A non-payable residue (for example permanently blocked governance
   events) needs an explicitly accepted terminal disposition; the guard does not assume one.
   Steps 1b–4 run in **one transaction**, so a failure at any later statement rolls everything back.
1b. **Invalid-JSON guard (first statement of the transaction).** If any `AuditLog` payload is NULL
   or not valid JSON, the migration aborts before any write; repair such rows under the old release.
2. **Closed-session reasons and in-flight invalidation.** The reason of every non-open session is
   replaced by one fixed neutral text (legacy balance and per-wallet limit texts). `PENDING` and `APPROVED` sessions become `EXPIRED` with a "start a
   new checkout" reason; `OPEN` and `BOUND` customer passes become `EXPIRED`. Customers and
   sellers start a new checkout after the cutover. Dropping `CustomerHistoryAccess` invalidates
   every history token.
3. **Audit scrub.** Type-independent `json_remove` of `$.wallet`, `$.held`, `$.locked`,
   `$.verificationBlock` and `$.used` from every payload, plus `$.reason`/`$.error` from `ATTEST_FAIL`;
   seller identities at the allowlisted leaves stay. `SellerAuthorizationChallenge` is rebuilt
   without a wallet column and emptied (nonce-only challenges).
4. **Table redefinition.** Customer tables are dropped and `CustomerPass`, `RewardEvent` and
   `Session` are rebuilt without the customer columns. Sessions, closed reward events and audit
   rows are kept.

## Cutover plan

`scripts/deploy-benefits-network.sh` refuses any release whose Prisma migrations differ from the
live ones (`require_no_schema_migration`). This migration therefore cannot ship through the normal
deploy path; it needs a separate, reviewed migration release with these steps:

0. Release prerequisites: the wallet-free `ifr-sdk` is published and rolled out first (older SDKs
   break against the wallet-free challenge), the edge route is verified not to log legacy
   `walletAddress` query strings, and the receipt context check passes from a clean shell:
   `npm run check:benefits-proof-context -- --env <compose env file> --public-host shop.ifrunit.tech`
   (fails closed on a missing value, a mismatch between `SELLER_AUTH_DOMAIN`/`CHAIN_ID` and the
   frontend host/`NEXT_PUBLIC_CHAIN_ID`, or a shell override; never prints values).
1. Rehearse on a copy of a recent production backup on a non-production host and record counts
   (sessions, reward events by status, audit rows) before and after.
2. Under the old release, confirm zero open reward events (guard query above). If any exist,
   stop and resolve them first.
3. Announce a short checkout pause, then stop the backend.
4. Take a backup of the SQLite database (including `-wal`/`-shm` if present) and verify it
   (`PRAGMA integrity_check`, row counts, restore test).
5. Run `prisma migrate deploy` with the new image without starting the server. The image's start
   command also runs `prisma migrate deploy`, so starting the new image would migrate implicitly;
   running it separately keeps the `VACUUM` step before traffic. If the guard refuses, nothing is
   changed; check `_prisma_migrations` and, if the migration is recorded as failed, mark it rolled
   back (`prisma migrate resolve --rolled-back ...`) only after the cause is fixed.
6. Run `PRAGMA wal_checkpoint(TRUNCATE);` and `VACUUM;`. SQLite free pages and the WAL can keep
   the old bytes of dropped columns and tables until the file is rewritten.
7. Check that no customer address remains: run the read-only generic scan on the migrated file
   (`node scripts/verify-owner-b-migration.cjs --scan <database file>` in
   `apps/benefits-network/backend`, Node >= 22.12; the scan refuses older runtimes before opening
   anything). It opens the file strictly read-only, fails on any address
   outside the allowlisted seller locations, on invalid JSON and on any unknown table or column, and
   prints counts per location only. Do not start traffic unless it prints PASS.
8. Start the new image. Smoke: `/api/health`, `/api/ready`, one seller checkout with a customer
   proof (`REDEEMED`), `POST /api/sessions/:id/redeem` returns 410, `/api/customer/history`
   returns 410.

## Rollback

The data drop is irreversible. The only rollback that restores data is the pre-migration backup
plus the old image, and that brings the customer data back. Such a backup must be
access-restricted and deleted after an acceptance window set by the owner. The old image cannot
run on the new schema, and the new image migrates on start, so do not mix them. Prefer a
forward fix on the new schema over a rollback.

## Existing backups

Backups made before the cutover still contain customer wallet addresses, amounts and history
tokens. Before the release, list every backup (location, date, who can access it). The access
rules and the expiry schedule for these backups are an owner/ops decision, recorded with the
release. Until they are deleted, the privacy page statement about older records and backups
applies.

## Verification

`apps/benefits-network/backend/scripts/verify-owner-b-migration.cjs` (part of
`npm run test:migration-upgrade`) builds a pre-migration database with dummy data using the real
`prisma migrate deploy` runner in a temporary directory and checks that:

- every non-`CONFIRMED` reward status (all open statuses and an unknown status), even older than
  `periodEnd + 72h`, makes the migration fail without changing data;
- a failure forced late in the migration (table redefinition) rolls back the earlier
  invalidation and audit scrub, leaving the data unchanged;
- without open obligations, sessions, closed reward events and audit rows are kept, in-flight
  checkouts and passes expire, customer tables and columns are dropped, audit payloads are
  scrubbed, and after `VACUUM` no customer address remains in the dump or the file.

It never touches a real database.
