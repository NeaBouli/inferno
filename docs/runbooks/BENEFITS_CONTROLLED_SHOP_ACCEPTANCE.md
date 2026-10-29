# Controlled Shop Acceptance

Use this guide to prepare one controlled seller and exact offer in the existing
[IFR Shop](https://shop.ifrunit.tech/), observe the agreed customer flow, and retire
only the test data you created. It complements the
[Device Wallet Test Runbook](BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md); preparation
alone does not complete a physical device or wallet checklist row.

## Agree the actors and terms

Before creating data, confirm:

- An authorized seller **owner** controls the connected wallet and may manage the
  selected profile. Checkout staff access alone does not grant profile/rule ownership.
- The seller has approved the public test name, offer wording, discount, category,
  test window and any product/service details. Use controlled test data, not a
  fictitious retailer or an unrelated merchant's profile.
- The exact offer's accepted lock source, positive required lock and optional held-IFR
  threshold are agreed. A general wallet status is not an exact-offer eligibility decision.
- Authorized eligible and ineligible customers, the required physical testers and an
  admitted release/test window are available. If any prerequisite is unknown, record
  it as pending rather than manufacturing a passing result.
- The operator knows which existing data must remain and which newly created profile,
  rule or product will be retired afterwards. Agree a manual retirement deadline and
  confirm that its authorized owner will be available. If timely manual retirement
  cannot be assured, leave preparation pending and do not publish an active test offer.

Keep the selected profile/rule IDs, exact terms and observations in a private test
record. Never include private keys, seed phrases, admin secrets, signatures, control
tokens, QR/session payloads, personal wallet addresses or sensitive balances in a
public issue, screenshot or shared acceptance template. Public profile fields must
contain only information the seller intends to publish.

## Understand the gas boundary

Normal seller setup uses short-lived wallet **message signatures** and application
database writes. It does not require an admin secret, a funded seller wallet or an
on-chain transaction. Use the existing wallet interface; do not export a key into a
script. Review the expected site, action, profile, scope and authorization-challenge
expiry before signing.

An already eligible customer's exact-offer proof also uses a message signature,
fresh eligibility reads and a one-time application redemption; it requires no new
customer gas payment. The selected offer's actual criteria still apply.

Funding, token approval, creating/increasing a lock, Lock and Unlock are separate
on-chain actions that can spend value or gas. They are outside this procedure.
If a qualifying lock does not already exist, leave the eligible-proof case pending
and arrange a separately authorized plan; do not lower the offer's threshold.

## Prepare the owned profile

1. Open the Shop, select **Seller**, and choose **Open seller tools**.
2. Connect the authorized owner wallet and select **Load my seller profiles**.
   Confirm the chosen profile is the intended controlled one. An empty list for one
   wallet does not prove that the whole Shop has no merchants.
3. Reuse that profile when appropriate. For a separate agreed test profile, choose
   **New seller profile** if a profile is already selected, enter the approved public
   details and slug, then submit **Create wallet-owned seller profile**. The normal
   flow binds ownership to the signing wallet. Existing profile limits still apply;
   do not create repeated profiles to work around a failed preparation.
4. Reload the profiles with the same owner wallet and confirm that the chosen
   profile is returned. Record its exact ID/slug privately.

The admin fallback is not required. An operator-created profile without an owner
wallet cannot authorize checkout; use the normal owner-wallet setup for this run.
Follow [Seller Profile And Rule](BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md#3-seller-profile-and-rule)
for the corresponding physical observations.

## Prepare and verify the exact offer

1. Select the intended profile. Either create an agreed product/service in its
   catalog or choose **Custom rule without catalog item** under **Catalog binding**.
   A separate product row is not required for a general rule.
2. Save the agreed rule, including its discount, accepted lock source, positive lock
   threshold, optional held-IFR threshold and **QR session TTL** in seconds. This TTL
   controls the lifetime of a newly created checkout session; it is not an offer-expiry
   field and does not retire the rule. Use the agreed manual retirement plan for the
   test offer. Copy exact quantity strings into the private record; do not round
   eligibility values through JavaScript `number`.
3. Load the rules again and check the exact rule, its active state and any catalog
   binding. Saving or loading rules can automatically verify public discovery; read
   the displayed result. If **Verify public offer** is shown, use it to retry the
   check. Once verification succeeds, that action changes to **Open public catalog**.
   A successful save or a general verified seller status alone is not evidence that
   the chosen exact offer is publicly available.
4. Confirm the public seller/catalog view presents that same controlled offer and
   terms. Record the chosen rule ID and profile reference privately. If the offer is
   absent or verification fails, keep preparation pending and investigate that result;
   do not substitute another merchant or silently change terms.

## Observe the agreed flow

Use the existing runbook's
[customer-presented pass and seller binding](BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md#4-customer-presented-pass-and-seller-bind),
[exact-offer confirmation](BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md#5-exact-offer-customer-confirmation)
and [seller result](BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md#6-seller-sees-redeemed).
The owner can perform the initial seller flow; adding checkout staff is optional.

Record outcomes separately and only after observing them:

- The customer sees the intended seller, exact offer and terms before signing.
- An eligible proof reaches `REDEEMED` once and the seller sees the same result.
  There is no second seller redemption action.
- Replaying the same controlled confirmation is refused without a second redemption;
  do not create a different checkout and call that replay evidence.
- The controlled ineligible customer receives readable rejection without a success claim.
- History, reload/reconnect and any history export behave as actually observed.
  An untested history/export action stays pending; a visible button or an existing
  file is not evidence that this run exported the intended data correctly.

Use the runbook's redaction and evidence rules. An automated fixture, public catalog
response or wallet connection alone cannot close a physical row in the
[device checklist](../qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json).

## Retire only the chosen test data

1. Before retirement, record the IDs of the rule/product/profile created for this
   run and distinguish them from reused seller data. Preserve the permitted evidence
   privately; do not export customer proofs or sensitive payloads.
2. To retire an individual test offer, use **Archive** on that exact rule. To retire
   a test product/service, archive that exact catalog item; linked rules are paused.
   Verify the selected offer is no longer active/public.
3. If the entire profile was created solely for this run, its original owner may
   choose **Deactivate** on that profile and confirm **Deactivate profile** in the
   dialog. This pauses its products, rules and checkout staff. Do not deactivate a
   reused operational merchant merely because one test rule needs retirement.
4. Reload owned profiles and verify the chosen profile's inactive state when it was
   deactivated. Check its public catalog/scanner no longer presents active authority.
   Keep a failed or unobserved retirement check pending and hand the exact selected
   IDs to the authorized operator; do not claim cleanup succeeded.

Archive/deactivation is reversible soft retirement, not erasure. Existing checkout
history remains and the permanent seller URL stays reserved. Reactivating a profile
does not reactivate its products, rules or checkout staff automatically. This procedure
does not prove database deletion, retention compliance or removal from backups.

## Private observation template

Use only nonsecret fields, without real values in a public copy of this template:

```text
run_label: <operator-chosen label>
release_reference: <admitted public commit or release>
test_window: <UTC window>
owner_control_confirmed: <yes / pending>
profile_reference: <chosen ID or slug; keep the completed record private>
profile_created_for_this_run: <yes / no>
rule_reference: <chosen exact rule ID; keep the completed record private>
catalog_binding: <general rule / chosen product reference>
offer_terms: <approved wording, discount, lock source, exact quantity strings>
qr_session_ttl_seconds: <agreed checkout-session lifetime, not an offer deadline>
manual_retirement_deadline: <agreed UTC time>
manual_retirement_owner_available: <yes / pending>
exact_offer_visible: <PASS / FAIL / pending; observed note>
eligible_result: <PASS / FAIL / pending; observed note>
ineligible_result: <PASS / FAIL / pending; observed note>
single_redemption_and_replay: <PASS / FAIL / pending; observed note>
history_reload_export: <separate actual outcomes or pending>
selected_data_retirement: <separate actual outcomes or pending>
physical_checklist_rows: <only rows whose required observations were completed>
```

Do not infer unrelated devices, all-wallet compatibility, chain transactions,
production health or backup/recovery acceptance from a successful controlled run.
