# Benefits Network Device Wallet Test Runbook

Purpose: prove that `shop.ifrunit.tech` works on real customer and seller devices, not only in automated desktop/iPad browser emulation.

This runbook is intentionally operational. Do not record private keys, seed phrases, full personal wallet inventories or screenshots containing sensitive balances.

## Scope

Test the live Benefits Network PWA at:

- `https://shop.ifrunit.tech`
- `https://shop.ifrunit.tech/b/{businessId}`
- `https://shop.ifrunit.tech/r/{sessionId}`

Required paths:

1. Customer wallet entry and install guidance.
2. Seller wallet entry and seller profile/rule management.
3. Seller scanner creates a QR session.
4. Customer scans/opens QR, connects wallet and signs proof.
5. Seller sees result and redeems approved sessions.
6. Rejected or ineligible wallets produce clear, non-technical messages.

## Preconditions

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
| iPadOS Safari | `shop.ifrunit.tech` | PWA install guidance is visible; Copy/Share wallet entry works. |
| iPadOS MetaMask in-app browser | `shop.ifrunit.tech` | Customer wallet connects; proof page can sign a QR challenge. |
| iPadOS Coinbase Wallet browser | `shop.ifrunit.tech` | Customer wallet connects or displays a clear fallback path. |
| Android Chrome | `shop.ifrunit.tech` | PWA install guidance is visible; Copy/Share wallet entry works. |
| Android MetaMask browser | `shop.ifrunit.tech` | Customer wallet connects; proof page can sign a QR challenge. |
| Android Trust Wallet browser | `shop.ifrunit.tech` | Wallet entry works if Ethereum provider is exposed; otherwise fallback copy/share is clear. |
| Android OKX Wallet browser | `shop.ifrunit.tech` | Wallet entry works if Ethereum provider is exposed; otherwise fallback copy/share is clear. |
| Phantom | EVM-capable browser/session | If Ethereum provider is unavailable, app must fail gracefully and not block non-Phantom wallets. |
| Desktop Chrome + MetaMask | `shop.ifrunit.tech` | Seller and customer wallet actions work with injected provider. |
| Desktop Chrome + Coinbase Wallet extension | `shop.ifrunit.tech` | Wallet entry works or provides a clear fallback. |

WalletConnect modal support remains gated by `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Until that production value is set, success criteria are injected wallet support plus clear mobile wallet-browser fallback.

## Test Cases

### 1. Landing And PWA Entry

1. Open `https://shop.ifrunit.tech`.
2. Confirm the role selector shows Customer and Seller.
3. Confirm Mobile App / install guidance is visible.
4. On iOS, confirm the copy explains Share -> Add to Home Screen.
5. On Android, confirm browser install path is understandable.
6. Tap Copy link and Share if available.

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
6. Tap `Lock IFR` and confirm it routes to `https://web3.ifrunit.tech`.
7. Tap `Buy IFR` and confirm it opens the configured Uniswap path.

Pass criteria:

- App does not send tokens.
- Readiness state is understandable.
- Links open without losing the current app context unexpectedly.

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

### 4. Scanner And Customer QR

1. Open scanner from Seller readiness or `/b/{businessId}`.
2. Confirm Checkout readiness appears.
3. Select the intended rule.
4. Create QR session.
5. Confirm QR code and customer link appear.
6. Copy/share customer link.
7. Open the customer link on the customer device or wallet browser.

Pass criteria:

- Seller scanner shows `Waiting for customer`.
- Customer proof page shows `Proof readiness`.
- Missing/invalid business or session IDs produce readable messages such as `Business not found` or `Session not found`.

### 5. Customer Proof

1. On `/r/{sessionId}`, connect customer wallet.
2. Confirm Proof readiness marks wallet connected.
3. Tap `Sign and verify`.
4. Sign the one-time challenge.
5. Confirm result is either approved or rejected with readable reason.

Pass criteria:

- Wallet signature prompt clearly refers to IFR Benefits Network.
- No token transfer or approval prompt appears.
- Rejected wallets explain insufficient lock or invalid signature clearly.

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

## Evidence To Record

For each device/wallet combination, record:

- Date/time.
- Device and OS version.
- Browser or wallet app version.
- Wallet type.
- Test path covered.
- Result: PASS / FAIL / BLOCKED.
- Short note.
- Screenshot path if saved locally.
- Session ID and business ID only if they are test IDs.

Do not record private keys, seed phrases, full wallet balances unrelated to IFR, or personal account data.

## Known Blockers

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is not currently set for production WalletConnect/RainbowKit modal support.
- Full live APPROVED -> REDEEMED proof requires an eligible locked customer wallet.
- Server disk remains tight during deploys; do not run unnecessary rebuilds while conducting device tests.

## Completion Gate

The real-device wallet test gap can be closed only when:

- At least one iOS/iPadOS wallet-browser customer proof path passes.
- At least one Android wallet-browser customer proof path passes.
- At least one desktop injected seller wallet path passes.
- A rejected/ineligible customer proof path is observed and readable.
- An approved customer proof and seller redeem path is observed with an eligible locked test wallet.
- All results are recorded in `docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json` or a dated derivative file.
