# Embedded Wallet Decision

Status: PROTOTYPE PROVIDER SELECTED - isolated CDP EOA lab implemented; production integration deferred

Date: 2026-07-19

## Decision

The IFR Benefits Network keeps external user-controlled wallets as its production baseline.
No embedded-wallet SDK, generated private key, server signer or custodial recovery path will be
added to `shop.ifrunit.tech` until the separate prototype passes the gates in this document.

Coinbase CDP is selected for the first isolated browser prototype, using an EVM EOA rather than a
smart account. This selection is based on the current direct Wagmi connector, explicit Sepolia
transport support and provider-isolated EOA export component. It is not a provider contract or a
production selection. Privy remains the comparison candidate. Dynamic and MetaMask Embedded
Wallets must provide equally explicit, currently reachable export and recovery evidence before
entering a future production comparison.

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
| Privy | Client-created embedded wallets support user key export under strict web-browser guarantees; native clients require a separate secure web export flow. New-device provisioning and multiple recovery models are documented. | Production comparison candidate only after one recovery trust model is selected and secure mobile export is proven. |
| Coinbase CDP | EVM EOA key export uses an isolated iframe; application code does not receive raw key material. Smart accounts require separate ownership/export explanations. | Selected for the isolated EOA prototype only. Production remains blocked by the acceptance matrix below. |
| Dynamic | No current capability claim is accepted because the previously reviewed official export URL is no longer reachable. | Hold until working official export, recovery and portability documentation is reviewed. |
| MetaMask Embedded Wallets | Social/custom-auth embedded onboarding is documented. | Hold until export, recovery and portability evidence is reviewed to the same depth. |

Primary references:

- [Privy wallet export](https://docs.privy.io/wallets/wallets/export)
- [Privy new-device provisioning](https://docs.privy.io/wallets/advanced-topics/new-devices/provision-new-devices)
- [Privy on-device security and recovery](https://docs.privy.io/security/wallet-infrastructure/advanced/user-device)
- [Coinbase CDP wallet import and export](https://docs.cdp.coinbase.com/wallets/using-wallets/import-and-export)
- [Coinbase CDP export component](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-react/Components/ExportWallet.README)
- [MetaMask developer documentation](https://docs.metamask.io/)

## Implemented Prototype Boundary

The separate app at `apps/benefits-wallet-prototype` implements only the first technical lab:

- fail-closed preflight if `VITE_CDP_PROJECT_ID` is absent;
- dedicated CDP Project ID and origin allowlist required;
- email and one-time-code sign-in;
- automatic EVM EOA creation with `createOnLogin: "eoa"`;
- Ethereum Sepolia as the only configured chain;
- provider analytics disabled;
- address, network and account-type display;
- provider-owned export modal with MFA bypass explicitly disabled;
- sign-out.

The prototype has no Mainnet import, IFR contract address, send, approve, lock, swap, QR, seller,
redeem or reward capability. A static invariant test enforces this boundary. It is not deployed or
linked from the production Shop. The production Shop remains on its existing external-wallet
stack.

Current local evidence:

- clean `npm ci` from the committed lockfile;
- `npm audit --audit-level=moderate`: zero vulnerabilities after compatible `ws` and `uuid`
  overrides;
- security-boundary test: pass;
- strict TypeScript and Vite production build: pass.

This evidence proves only source integration and the unconfigured/fail-closed lab. It does not
prove provider login, wallet creation, export, recovery or behavior on a real device because no
dedicated CDP test project has been configured.

## Threat Model For This Lab

Protected assets are the user's authentication identity, wallet ownership and exported key.
Primary threats are account takeover through email or linked authentication, key exposure to host
JavaScript or an in-app WebView, provider outage or lock-in, accidental Mainnet funding, and users
mistaking a smart-account owner key for the account itself.

Controls in the lab are a dedicated test identity, Sepolia-only chain list, EOA-only creation,
provider-isolated export, retained MFA gate, analytics opt-out, no transaction APIs and no browser
persistence written by IFR source code. Residual risks remain provider-controlled authentication
and storage, dependency supply chain, unavailable recovery evidence, email compromise, user key
handling after export and provider availability. These risks block production.

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

The prototype may advance toward production only when all rows have evidence. None of these rows
is satisfied by a source build alone:

- wallet creation and repeat login;
- key export or equivalent owner-controlled escape hatch;
- recovery on a second device;
- loss of the primary authentication method;
- linked-auth takeover resistance;
- provider outage and SDK failure behavior;
- secure mobile export without an in-app WebView or host-app access to key material;
- the selected recovery trust model, including takeover and lockout tests;
- account deletion and data export;
- accessible, readable recovery warnings on mobile.

Future production-candidate tests, in a separate application and review phase, must include
Ethereum Mainnet chain selection without a transaction and IFR token discovery without an
approval or transfer. These tests must not add Mainnet or IFR configuration to the isolated
Sepolia lab.

## Production Rollout Boundary

If a provider is selected later, ship it behind an explicit feature flag alongside external-wallet
connection. Never auto-migrate an existing wallet, never make embedded login the only access path,
and never enable server-side autonomous signing for customer or seller funds.

The first production-capable increment is authentication plus an empty wallet and export/recovery
UI. IFR purchase, approve, lock, QR proof and seller actions remain disabled until each transaction
path has separate simulation, confirmation, failure and real-device evidence.
