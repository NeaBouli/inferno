# IFR Benefits Embedded Wallet Prototype

Isolated security prototype for the first embedded-wallet gate. It is not part of
`shop.ifrunit.tech`, is not deployed, and cannot perform blockchain transactions.

## Scope

- Coinbase CDP email/OTP sign-in;
- one automatically created, exportable EVM EOA;
- Ethereum Sepolia only;
- address and network display;
- provider-isolated wallet export with MFA retained;
- sign-out;
- fail-closed configuration screen when no Project ID is present.

There are deliberately no Mainnet chains, IFR addresses, transfers, approvals, locks, swaps,
QR actions, seller APIs or reward actions in this app.

## Local setup

1. Create a dedicated test project in the Coinbase Developer Platform.
2. In Embedded Wallet Configuration, allowlist `http://localhost:3012`.
3. Copy `.env.example` to `.env.local` and set the public `VITE_CDP_PROJECT_ID`.
4. Use only a test email and an empty test wallet.
5. Run `npm ci`, `npm test`, then `npm run dev`.

Never import an existing wallet or fund this prototype with Mainnet assets. The Project ID is a
public frontend identifier, but no API secret belongs in this directory or in Git.

## Production gates

This prototype must not be linked from or merged into the production Benefits wallet flow until
all gates in `docs/ifrp-commerce-app/EMBEDDED_WALLET_DECISION.md` have current evidence. In
particular: second-device recovery, lost-auth behavior, provider outage, account deletion,
mobile browser export, legal/privacy review and independent security review.
