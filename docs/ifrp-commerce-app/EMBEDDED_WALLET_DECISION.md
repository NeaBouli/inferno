# Embedded Wallet Decision

Status: DECISION RECORDED - production integration deferred

Date: 2026-07-19

## Decision

The IFR Benefits Network keeps external user-controlled wallets as its production baseline.
No embedded-wallet SDK, generated private key, server signer or custodial recovery path will be
added to `shop.ifrunit.tech` until a separate prototype passes the gates in this document.

Privy and Coinbase CDP are the current prototype shortlist. This is not a provider contract or a
production selection. Dynamic and MetaMask Embedded Wallets must provide equally explicit,
currently reachable export and recovery evidence before entering the final comparison.

## Why

The Shop already supports customer and seller flows with external EVM wallets. Adding an embedded
wallet changes the security model: authentication becomes part of wallet recovery, provider
availability affects access to funds, key export becomes a critical user journey, and smart-account
ownership can differ from an exportable EOA key.

The project must not improve onboarding by silently weakening self-custody or making IFR balances
dependent on one app login.

## Provider Evidence Reviewed

| Provider | Relevant current capability | Decision impact |
| --- | --- | --- |
| Privy | Client-created embedded wallets support user key export under strict web-browser guarantees; native clients require a separate secure web export flow. New-device provisioning and multiple recovery models are documented. | Prototype candidate only after one recovery trust model is selected and secure mobile export is proven. |
| Coinbase CDP | EVM EOA key export uses an isolated iframe; application code does not receive raw key material. Smart accounts require separate ownership/export explanations. | Prototype candidate, provided EOA versus smart-account ownership is explicit. |
| Dynamic | No current capability claim is accepted because the previously reviewed official export URL is no longer reachable. | Hold until working official export, recovery and portability documentation is reviewed. |
| MetaMask Embedded Wallets | Social/custom-auth embedded onboarding is documented. | Hold until export, recovery and portability evidence is reviewed to the same depth. |

Primary references:

- [Privy wallet export](https://docs.privy.io/wallets/wallets/export)
- [Privy new-device provisioning](https://docs.privy.io/wallets/advanced-topics/new-devices/provision-new-devices)
- [Privy on-device security and recovery](https://docs.privy.io/security/wallet-infrastructure/advanced/user-device)
- [Coinbase CDP wallet import and export](https://docs.cdp.coinbase.com/wallets/using-wallets/import-and-export)
- [Coinbase CDP export component](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-react/Components/ExportWallet.README)
- [MetaMask developer documentation](https://docs.metamask.io/)

## Mandatory Prototype Gates

1. Use a separate test application and test accounts. Do not import existing customer wallets.
2. No Mainnet funds, IFR approvals, locks, swaps, seller rewards or production API credentials.
3. The user must be able to export or recover the controlling key without IFR Protocol support.
4. The app must never receive, log, persist or proxy plaintext private keys or recovery phrases.
5. New-device recovery, lost-auth recovery, account-linking and provider-outage behavior must be
   tested on iPadOS, iOS, Android and desktop.
6. EOA and smart-account ownership must be explained and tested separately.
7. Require MFA or an equivalent step-up check for key export and high-risk account changes.
8. Define account deletion, provider migration, incident response and support boundaries.
9. Complete legal/privacy review for email, phone, social-login and recovery metadata.
10. Obtain an independent security review before any production feature flag is enabled.
11. Select and threat-model exactly one recovery trust model. Automatic auth-token recovery,
    user-managed passcode recovery and cloud-backed recovery are not interchangeable.
12. Prohibit private-key or recovery-phrase export inside a native app WebView. Use only the
    provider's documented isolated browser/export surface, and prove that host-app JavaScript
    cannot access key material.

## Acceptance Matrix

The prototype may advance only when all rows have evidence:

- wallet creation and repeat login;
- key export or equivalent owner-controlled escape hatch;
- recovery on a second device;
- loss of the primary authentication method;
- linked-auth takeover resistance;
- provider outage and SDK failure behavior;
- secure mobile export without an in-app WebView or host-app access to key material;
- the selected recovery trust model, including takeover and lockout tests;
- Ethereum Mainnet chain selection without a transaction;
- IFR token discovery without an approval or transfer;
- account deletion and data export;
- accessible, readable recovery warnings on mobile.

## Production Rollout Boundary

If a provider is selected later, ship it behind an explicit feature flag alongside external-wallet
connection. Never auto-migrate an existing wallet, never make embedded login the only access path,
and never enable server-side autonomous signing for customer or seller funds.

The first production-capable increment is authentication plus an empty wallet and export/recovery
UI. IFR purchase, approve, lock, QR proof and seller actions remain disabled until each transaction
path has separate simulation, confirmation, failure and real-device evidence.
