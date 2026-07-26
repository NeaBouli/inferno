# Benefits Network Device Wallet Test Runbook

Purpose: prove that `shop.ifrunit.tech` works on real customer and seller devices, not only in automated desktop/iPad browser emulation.

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
5. Seller sees the result and redeems an approved checkout once; replay remains blocked.
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

- Optional full approve/redeem test requires a real customer wallet that is eligible for the selected seller rule:

```bash
CUSTOMER_PRIVATE_KEY=... MUTATE=true node scripts/seller-wallet-smoke.js
```

Use that command only with a deliberately prepared test wallet. Never paste the key into chat, Bridge, Git, screenshots or logs.

## Device Matrix

| Device | Browser / Wallet Surface | Expected Result |
|---|---|---|
| iPadOS Safari | `shop.ifrunit.tech` | PWA install guidance is visible; official MetaMask/Trust/OKX/Phantom launch links and Copy/Share are readable. |
| iPadOS MetaMask in-app browser | `shop.ifrunit.tech` | Customer creates a `/p` pass, reviews the seller-bound offer and signs the exact confirmation. |
| iPadOS Coinbase Wallet browser | `shop.ifrunit.tech` | Customer completes the `/p` pass flow or receives a clear connector fallback. |
| Android Chrome | `shop.ifrunit.tech` | PWA install guidance is visible; official MetaMask/Trust/OKX/Phantom launch links and Copy/Share are readable. |
| Android MetaMask browser | `shop.ifrunit.tech` | Customer creates a `/p` pass, reviews the seller-bound offer and signs the exact confirmation. |
| Android Trust Wallet browser | `shop.ifrunit.tech` | `/p` pass entry works if an Ethereum provider is exposed; otherwise fallback copy/share is clear. |
| Android OKX Wallet browser | `shop.ifrunit.tech` | `/p` pass entry works if an Ethereum provider is exposed; otherwise fallback copy/share is clear. |
| Phantom | EVM-capable browser/session | `/p` pass entry works with an EVM provider, or the app fails gracefully without claiming a connection. |
| Desktop Chrome + MetaMask | `shop.ifrunit.tech` | Seller profile, permanent `/s` URL, pass binding, compatible seller QR and redeem signature work. |
| Desktop Chrome + Coinbase Wallet extension | `shop.ifrunit.tech` | Wallet entry works or provides a clear fallback. |

WalletConnect modal support remains gated by `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Until that production value is set, success criteria are injected wallet support plus clear mobile wallet-browser fallback. Do not treat a successful wallet-app launch as a successful wallet connection; the injected provider, Ethereum Mainnet, signature and transaction steps must still be tested inside the opened wallet browser.

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
5. Confirm Checkout readiness reflects connected wallet, IFR balance, ETH gas and lock status.
6. Use `Approve IFR`, `Lock IFR` and `Unlock all` inside the Shop wallet panel; confirm balances and transaction feedback refresh without leaving `shop.ifrunit.tech`.
7. Tap `Buy IFR` and confirm it opens the configured Uniswap path.

Pass criteria:

- App does not send tokens.
- Readiness state is understandable.
- Lock actions remain in the Shop app; external buy links open without losing the current app context unexpectedly.

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
2. Confirm the connected wallet matches the wallet that created the pass.
3. Tap the exact-offer confirmation action.
4. Sign the one-time challenge.
5. Confirm the result is APPROVED or a readable ineligible/retry state.

Pass criteria:

- Wallet signature prompt clearly refers to IFR Benefits Network.
- No token transfer or approval prompt appears.
- A different wallet cannot confirm the pass.
- A changed or mismatched seller/rule is not silently accepted.
- Rejected wallets explain the relevant lock or wallet condition without exposing private data.

### 6. Seller Redeem

1. Return to seller scanner.
2. If customer is approved, confirm scanner status is `Ready to redeem` after seller wallet is connected.
3. Tap Redeem.
4. Sign seller redeem message.
5. Confirm session changes to REDEEMED.
6. Attempting to redeem again must fail or remain blocked.

Pass criteria:

- Redeem requires seller wallet signature.
- Approved benefit can be redeemed once.
- Reuse is blocked.

### 7. Compatible Seller-Issued QR

1. From Seller readiness or `/b/{businessId}`, select an active rule and create a seller QR session.
2. Open the canonical `/r/{sessionId}` link directly or scan it through `/scan`.
3. Connect the customer wallet and confirm `Proof readiness`.
4. Sign the one-time customer challenge and observe the readable result.
5. For an approved session, complete the seller-signed redeem once.

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
  --note "iPadOS Safari install guidance visible; copy/share wallet entry readable." \
  --screenshot-path /Users/gio/Desktop/example.png
```

Preferred evidence object:

```json
{
  "dateTime": "2026-07-16T18:00:00Z",
  "result": "PASS",
  "note": "iPadOS Safari install guidance visible; copy/share wallet entry readable.",
  "screenshotPath": "/Users/gio/Desktop/example.png",
  "businessId": "test-business-id",
  "sessionId": "test-session-id"
}
```

Use only test business/session ids. Leave fields out when they do not apply.

## Known Blockers

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is not currently set for the production WalletConnect QR modal.
- Full live APPROVED -> REDEEMED proof requires an eligible locked customer wallet.
- Production capacity must still be checked read-only immediately before every deploy; keep the 4-GB hard deploy floor and never rely on an earlier free-space snapshot.

## Completion Gate

The real-device wallet test gap can be closed only when:

- At least one iOS/iPadOS wallet-browser customer proof path passes.
- At least one Android wallet-browser customer proof path passes.
- At least one desktop injected seller wallet path passes.
- A rejected/ineligible customer proof path is observed and readable.
- The primary customer `/p` pass is seller-bound to an exact offer, confirmed by an eligible locked test wallet, seller-signed REDEEMED once and blocked on replay.
- All results are recorded in `docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json` or a dated derivative file.
