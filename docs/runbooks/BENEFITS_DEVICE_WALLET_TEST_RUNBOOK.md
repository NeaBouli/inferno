# Benefits Network Device Wallet Test Runbook

Purpose: prove that `shop.ifrunit.tech` works on real customer and seller devices, not only in automated desktop/iPad browser emulation.

For controlled owner-wallet setup and retirement, use the [Controlled Shop Acceptance guide](BENEFITS_CONTROLLED_SHOP_ACCEPTANCE.md).

This runbook is intentionally operational. Do not record private keys, seed phrases, full personal wallet inventories or screenshots containing sensitive balances.

## Scope

Test the live Benefits Network PWA at:

- `https://shop.ifrunit.tech`
- `https://shop.ifrunit.tech/guide`
- `https://shop.ifrunit.tech/b/{businessId}`
- `https://shop.ifrunit.tech/s/{sellerSlug}`
- `https://shop.ifrunit.tech/p/{passId}`
- `https://shop.ifrunit.tech/r/{sessionId}`
- `https://shop.ifrunit.tech/scan`

Required paths:

1. Customer wallet entry and install guidance.
2. Seller wallet entry and seller profile/rule management.
3. Customer creates a short-lived pass; seller scans it and binds the exact offer.
4. Customer reviews and signs the exact bound offer.
5. The customer's valid proof redeems the checkout once; the seller sees `REDEEMED`; replay remains blocked.
6. The compatible seller-issued `/r/{sessionId}` QR flow still works through `/scan`.
7. Rejected, unavailable or transiently failed checks produce clear recovery guidance.

## Preconditions

- The local release evidence preflight passes before a candidate commit is pushed:

```bash
npm run preflight:benefits
```

- Live health check passes:

```bash
npm run smoke:benefits
```

- Backend HTTP smoke passes:

```bash
cd apps/benefits-network/backend
npm run build
npm run smoke:http
```

- Optional full proof-to-redeemed test requires a real customer wallet that is eligible for the selected seller rule:

```bash
CUSTOMER_PRIVATE_KEY=... MUTATE=true node scripts/seller-wallet-smoke.js
```

Use that command only with a deliberately prepared test wallet. Never paste the key into chat, Bridge, Git, screenshots or logs.

## Current Test Preparation — 28 October 2026

The repository checkpoint for this preparation is Main
`a3ca75d73c8facbcb88d1cd0e84bf8b9ae15be45`. The wallet work from PR #372 was
integrated through [PR #375](https://github.com/NeaBouli/inferno/pull/375).
The [current functionality status](../CURRENT_FUNCTIONALITY_STATUS.md)
records the deployed frontend and accepted automated release gates. These software
records do not close any physical matrix row or replace a fresh tester observation.
The 26 October metadata section below is retained as a historical preparation record.

### Read-only Prerequisites

Print and validate the existing matrix without recording a result:

```bash
npm run qa:benefits-devices
npm run qa:benefits-report
```

At the agreed physical test window, make one bounded public prerequisite pass:

```bash
curl --fail --silent --show-error --max-time 15 https://shop.ifrunit.tech/api/health
curl --fail --silent --show-error --max-time 15 https://shop.ifrunit.tech/api/ready
curl --fail --silent --show-error --max-time 15 'https://shop.ifrunit.tech/api/businesses?page=1&limit=1'
```

HTTP 200 health/readiness and a returned public offer establish only those
prerequisites. An empty `offers` array means that this request supplied no offer to
select; it does not prove a product defect, seller control or customer eligibility.
Do not create a fictitious merchant, lower a rule threshold, enumerate unrelated
catalogs or retry in a loop to manufacture a passing preparation result.

The operator must identify a controlled seller and exact active offer, or prepare
one through the normal seller-wallet UI using agreed test terms. Retain only the
chosen public business/rule reference, `lockSource`, `requiredLockIFR` and optional
`minIFRHeld`; keep numeric strings exact rather than rounding them through
JavaScript `number`. Confirm the authorized customer/seller testers and their
device/browser/wallet versions separately. A public catalog cannot establish any
of those control or eligibility facts.

### Existing-Lock Proof and Gas Boundary

For an already eligible locked customer wallet, the primary `/p` route uses pass
creation, seller message authorization, an exact-offer customer message signature,
fresh eligibility reads and atomic database redemption. That route contains no
on-chain transaction and requires no new customer gas payment. The general wallet
panel's `gas-needed` status is not the exact seller-rule eligibility decision.

The customer must still meet the selected offer's positive lock threshold,
accepted lock source and optional held-IFR threshold. Do not replace those reads
with mocks for physical acceptance. Creating or increasing a lock, Approve, Lock
and Unlock are separate gas-bearing actions; they are outside this zero-gas proof
run and must not be started automatically.

With those prerequisites confirmed, perform the existing customer-pass, seller
binding and exact-offer confirmation cases below on Android/customer and
desktop/seller, including a readable rejection and one-time redemption/replay
refusal. Repeat the customer-proof case on iOS/iPadOS. The five physical outcomes
in the Completion Gate remain mandatory; this sequence does not close the other
matrix rows. Record PASS only after the row's required capabilities were observed
on a physical device, using the existing recorder and redaction rules below.

## Device Matrix

| Device | Browser / Wallet Surface | Expected Result |
|---|---|---|
| iPadOS Safari | `shop.ifrunit.tech` | PWA install guidance is visible; official MetaMask/Trust/OKX/Phantom launch links and Copy/Share are readable. |
| iPadOS MetaMask in-app browser | `shop.ifrunit.tech` | Customer creates a `/p` pass, reviews the seller-bound offer and signs the exact confirmation; disconnect and reload-reconnect behave per Test Case 2. |
| iPadOS Coinbase Wallet browser | `shop.ifrunit.tech` | Customer completes the `/p` pass flow or receives a clear connector fallback. |
| Android Chrome | `shop.ifrunit.tech` | PWA install guidance is visible; official MetaMask/Trust/OKX/Phantom launch links and Copy/Share are readable. |
| Android MetaMask browser | `shop.ifrunit.tech` | Customer creates a `/p` pass, reviews the seller-bound offer and signs the exact confirmation; disconnect and reload-reconnect behave per Test Case 2. |
| Android Trust Wallet browser | `shop.ifrunit.tech` | `/p` pass entry works if an Ethereum provider is exposed; otherwise fallback copy/share is clear. |
| Android OKX Wallet browser | `shop.ifrunit.tech` | `/p` pass entry works if an Ethereum provider is exposed; otherwise fallback copy/share is clear. |
| Phantom | EVM-capable browser/session | `/p` pass entry works through EIP-6963, `window.ethereum` or the targeted `window.phantom.ethereum` fallback; otherwise the app fails gracefully without claiming a connection. |
| Desktop Chrome + MetaMask | `shop.ifrunit.tech` | Seller profile, permanent `/s` URL, pass binding, compatible seller QR and checkout-opening signature work; disconnect and reload-reconnect behave per Test Case 2. |
| Desktop Chrome + Coinbase Wallet extension | `shop.ifrunit.tech` | Wallet entry works or provides a clear fallback. |

WalletConnect modal support remains gated by `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: the value is a build-time configuration gate, so for any build where that production value is not set, success criteria are injected wallet support plus clear mobile wallet-browser fallback. The production modal and wallet catalog were recorded live on 2026-08-06; that configuration state was not re-verified during the 2026-10-26 metadata preparation and must be re-observed against the admitted release before physical acceptance. Do not treat a successful wallet-app launch as a successful wallet connection; the injected provider, Ethereum Mainnet, signature and transaction steps must still be tested inside the opened wallet browser.

## Acceptance Readiness (Metadata Preparation 2026-10-26)

This section is documentation preparation only. It changes no matrix status, appends no
evidence and performs no acceptance action; physical closure remains governed by the
Completion Gate below.

### Source Binding

- Documentation source baseline: `main` at `97bcef89a1a6b90a12d9f6a0af0ae1e37c422757`.
- Qualified candidate: PR [#372](https://github.com/NeaBouli/inferno/pull/372), head
  `ecc45342c37e5b15b9e19fa72698e82fadafbcdd`; all five PR workflows were
  successful at this preparation checkpoint. CI success does not imply deployment.
- Candidate qualification scope: synthetic pinned-SDK composition with a fixture-only
  `navigator.onLine` override and guarded Pulse-zero plus mutation/QR/relay/lifecycle/timer
  controls. This does not establish physical-device or live-release acceptance, approved
  or encrypted sessions, `CONNECT_SUCCESS`, signing, transactions, or real restore/disconnect.
- The retained `android-chrome-pwa` physical PASS (2026-08-08, Galaxy Tab S4 Android 10 /
  Chrome 150) remains historical evidence for that row only; it does not certify the
  currently deployed bytes.

### Row Readiness

| Checklist ID | Status | Available evidence | Known missing inputs | Next actor |
| --- | --- | --- | --- | --- |
| `ios-safari-pwa` | pending | none | tester, iOS/iPadOS + Safari versions, admitted release, test window | WAIT_TESTER |
| `ios-metamask-customer-proof` | pending | none | tester, iOS + MetaMask versions, admitted release, eligible test wallet | WAIT_TESTER |
| `ios-coinbase-customer-proof` | pending | none | tester, iOS + Coinbase Wallet versions, admitted release | WAIT_TESTER |
| `android-chrome-pwa` | pass | physical-device PASS 2026-08-08 (historical; current-release match unknown) | tester, current Android + Chrome versions and admitted release for revalidation | WAIT_TESTER for revalidation; retained PASS unchanged |
| `android-metamask-customer-proof` | pending | none | tester, Android + MetaMask versions, admitted release, eligible test wallet | WAIT_TESTER |
| `android-trust-customer-proof` | pending | none | tester, Android + Trust Wallet versions, admitted release | WAIT_TESTER |
| `android-okx-customer-proof` | pending | none | tester, Android + OKX Wallet versions, admitted release | WAIT_TESTER |
| `phantom-evm-fallback` | pending | none | tester, device + Phantom versions, admitted release | WAIT_TESTER |
| `desktop-metamask-seller` | pending | none | tester, desktop Chrome + MetaMask versions, admitted release | WAIT_TESTER |
| `proof-redeemed-eligible-wallet` | pending | none | tester(s) for customer/seller roles, admitted release, prepared eligible locked customer wallet plus seller wallet | WAIT_TESTER |

Tester names, device/OS/browser/wallet versions and the admitted live release/commit are
currently unknown or unassigned.

### Required Future Tester Packet

Before any physical acceptance run, the assigned tester must receive, outside chat:

1. Tester assignment plus exact device, OS, browser and wallet-app versions per row.
2. The admitted exact release/source (public commit or PR head) and the agreed test window.
3. For cases that use wallets, confirmation of availability and test authority for the
   relevant customer/seller roles. The eligible-proof row requires a prepared eligible
   locked test wallet; PWA install/copy/share-only cases need no wallet.
4. Instruction to record each redacted physical observation through the existing recorder
   (`npm run qa:benefits-record`); a matrix PASS is accepted only with
   `--source physical-device` per the existing gate.

Never record keys, seed phrases, funds, real account data, or QR/URI/topic/payload contents
in evidence notes, screenshots, logs or chat.

### Preparation Acceptance vs Physical Closure

- This preparation is accepted when the checklist validates and this runbook maps every
  matrix row; it requires no merge, deployment or device action.
- Physical closure gates are unchanged: at least one iOS/iPadOS wallet-browser customer
  proof pass, at least one Android wallet-browser customer proof pass, at least one desktop
  injected seller wallet pass, a readable rejected/ineligible customer proof, and the
  primary `/p` pass bound to an exact seller offer, redeemed once (`REDEEMED`) by the proof
  of an eligible locked test wallet and blocked on replay.
- At this 26 October preparation checkpoint, real acceptance of the wallet candidate
  additionally required PR #372 integration and an authorized frontend release.
  The current preparation section above records the later software checkpoint;
  PR #370 was no technical prerequisite, and PR #371 mattered only for its selected
  release-client path. No physical result follows from those integrations.

## Test Cases

### 1. Landing And PWA Entry

1. Open `https://shop.ifrunit.tech`.
2. Confirm the role selector shows Customer and Seller.
3. Confirm Mobile App / install guidance is visible.
4. On iOS, confirm the copy explains Share -> Add to Home Screen.
5. On Android, confirm browser install path is understandable.
6. On iOS/iPadOS and Android, confirm MetaMask, Trust Wallet, OKX and Phantom launch links use HTTPS vendor domains and retain only the canonical Shop path.
7. Tap Copy link and Share if available.

Pass criteria:

- No blank page.
- No console-visible crash behavior.
- Text fits on tablet and smartphone.
- Copy/share feedback is readable.

### 2. Customer Wallet Status

1. Select Customer.
2. Confirm Wallet entry appears.
3. Connect wallet in a wallet browser or extension.
4. Confirm wallet address appears shortened.
5. Confirm `Wallet balances and IFRLock tools` shows the connected wallet and separate balances. Its `IFRLock example overview` is not an exact-offer eligibility decision; the selected offer's lock source and thresholds decide checkout eligibility.
6. Connect once on a non-production EVM chain and confirm the panel shows `Switch to Ethereum Mainnet`, performs no IFR/IFRLock reads, and keeps Approve/Lock/Unlock disabled until the wallet confirms the switch.
7. With a wallet that reports exactly `0 ETH`, confirm the ETH guidance and `Get ETH for gas` action are scoped to optional on-chain tools. The official `https://ethereum.org/get-eth/` guide must open without a wallet request, and Approve/Lock/Unlock stay disabled. An already eligible wallet can sign an off-chain checkout proof without spending ETH; the exact offer's conditions still apply.
8. With ETH available, use `Approve IFR`, `Lock IFR` and `Unlock all` inside the Shop wallet panel; confirm balances and transaction feedback refresh without leaving `shop.ifrunit.tech`.
9. Tap `Buy IFR` and confirm it opens the configured Uniswap path.
10. Reload the page and confirm the connected wallet session is restored without a new signature prompt.
11. Tap Disconnect, reload the page again and confirm the wallet stays disconnected, no IFR/IFRLock reads run and no connect prompt claims success.
12. Connect once more and confirm the wallet panel returns to the connected state.

Pass criteria:

- App does not send tokens.
- Readiness state is understandable.
- Lock actions remain in the Shop app; external buy links open without losing the current app context unexpectedly.
- A reload restores an active session; a disconnected wallet stays disconnected after reload and reconnects only through an explicit connect action.

### 3. Seller Profile And Rule

1. Select Seller.
2. Connect seller wallet.
3. Load seller profiles.
4. If no profile exists, create a test seller profile.
5. Save a benefit rule with test category/product/discount/minimum locked IFR.
6. Load rules.
7. Confirm Seller readiness marks wallet, profile, active rule and scanner link correctly.

Pass criteria:

- Seller actions request short-lived wallet signatures.
- No admin secret is required for normal seller-owned setup.
- Created seller profile appears when reloaded with the same wallet.

### 4. Customer-Presented Pass And Seller Bind

1. On the customer device, select Customer and connect the wallet that will be verified.
2. Create a checkout pass and confirm the QR points to canonical `/p/{passId}` without a control token.
3. On the seller device, open `/b/{businessId}` or `/b/{sellerSlug}` and select the intended active rule.
4. Scan the customer pass, choose its QR image or paste the canonical pass link.
5. Sign the seller `passes:bind` challenge.
6. Confirm the originating customer tab shows seller, product/service, reference price when present, discount, lock source and exact thresholds.

Pass criteria:

- A copied pass can be bound only once and is not proof of wallet ownership.
- No customer control token appears in URL, QR payload, persistent `localStorage` or seller UI;
  the originating tab may retain it in `sessionStorage` for same-tab recovery.
- Missing, expired, cancelled or already-bound passes show readable recovery guidance.
- A transient pass or seller-profile load failure exposes an enabled in-place retry.

### 5. Exact-Offer Customer Confirmation

1. On the originating customer tab, compare the bound seller and rule with the intended checkout.
2. Connect the eligible customer wallet (pass creation involves no wallet; the proof binds it).
3. Tap the exact-offer confirmation action.
4. Sign the exact checkout proof text.
5. Confirm the result is REDEEMED or a readable ineligible/retry state (the checkout stays open).

Pass criteria:

- Wallet signature prompt clearly refers to IFR Benefits Network.
- No token transfer or approval prompt appears.
- A signature whose signer differs from the claimed wallet is refused and the checkout stays open.
- A changed or mismatched seller/rule is not silently accepted.
- Rejected wallets explain the relevant lock or wallet condition without exposing private data.

### 6. Seller Sees Redeemed

1. Return to seller scanner.
2. Confirm the checkout shows `REDEEMED` after the customer's proof; there is no seller Redeem
   action or seller redeem signature.
3. Submitting the same or another proof for this checkout again must fail and stay blocked.

Pass criteria:

- Only the seller wallet that opened the checkout (owner or active operator) can start it, and its
  authority is re-checked when the proof redeems it.
- A valid, eligible proof redeems the checkout exactly once.
- Reuse is blocked.

### 7. Compatible Seller-Issued QR

1. From Seller readiness or `/b/{businessId}`, select an active rule and create a seller QR session.
2. Open the canonical `/r/{sessionId}` link directly or scan it through `/scan`.
3. Connect the customer wallet and confirm `Proof readiness`.
4. Sign the exact checkout proof and observe the readable result.
5. For an eligible wallet, confirm the checkout is `REDEEMED` once on customer and seller screens.

Pass criteria:

- `/scan` rejects foreign origins, insecure URLs, credentials, ports, queries and fragments.
- Camera denial still leaves image and paste/session-ID fallbacks.
- The compatibility flow cannot bypass the exact rule snapshot or one-time redeem boundary.

### 8. Public Seller URL And Guide

1. Open the seller's canonical `/s/{sellerSlug}` catalog.
2. Confirm legacy `/s/{businessId}` resolves to the permanent seller URL.
3. Open an active offer and confirm the customer handoff preserves seller and rule identifiers.
4. Open `/guide` and verify install, customer-pass, seller and recovery instructions are readable.

Pass criteria:

- Public catalog content matches the selected seller and active offers.
- Stable seller URLs do not expose internal-only data.
- Guide and recovery links stay on the canonical Shop origin.

## Evidence To Record

For each device/wallet combination, record:

- Date/time.
- Device and OS version.
- Browser or wallet app version.
- Wallet type.
- Test path covered.
- Checklist capabilities covered by that matrix row.
- Result: PASS / FAIL / BLOCKED.
- Short note.
- Screenshot path if saved locally.
- Session ID and business ID only if they are test IDs.

Do not record private keys, seed phrases, full wallet balances unrelated to IFR, or personal account data.

Before and after editing the checklist, validate it:

```bash
npm run qa:benefits-devices
```

Print the current open/pass/blocked status:

```bash
npm run qa:benefits-report
```

Preferred recording command:

```bash
npm run qa:benefits-record -- \
  --id ios-safari-pwa \
  --status pass \
  --source physical-device \
  --note "iPadOS Safari install guidance visible; copy/share wallet entry readable." \
  --screenshot-path /Users/gio/Desktop/example.png
```

Preferred evidence object:

```json
{
  "dateTime": "2026-07-16T18:00:00Z",
  "result": "PASS",
  "evidenceSource": "physical-device",
  "note": "iPadOS Safari install guidance visible; copy/share wallet entry readable.",
  "screenshotPath": "/Users/gio/Desktop/example.png",
  "businessId": "test-business-id",
  "sessionId": "test-session-id"
}
```

Use only test business/session ids. Leave fields out when they do not apply.
`PASS` is accepted only with `--source physical-device`. Emulator and automated
evidence may document failures or blockers, but cannot close a physical row.

## Known Blockers

- The production WalletConnect modal and wallet catalog are live as of 2026-08-06;
  physical QR pairing, connection and signature evidence is still required. That
  configuration state was not re-verified during the 2026-10-26 metadata preparation.
- Physical customer-proof -> REDEEMED evidence requires an eligible locked customer wallet;
  the local state machine is automated, while its on-chain eligibility read remains mocked.
- Production capacity must still be checked read-only immediately before every deploy; keep the 4-GB hard deploy floor and never rely on an earlier free-space snapshot.

## Completion Gate

The real-device wallet test gap can be closed only when:

- At least one iOS/iPadOS wallet-browser customer proof path passes.
- At least one Android wallet-browser customer proof path passes.
- At least one desktop injected seller wallet path passes.
- A rejected/ineligible customer proof path is observed and readable.
- The primary customer `/p` pass is seller-bound to an exact offer, redeemed once (`REDEEMED`) by the proof of an eligible locked test wallet and blocked on replay.
- All results are recorded in `docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json` or a dated derivative file.
