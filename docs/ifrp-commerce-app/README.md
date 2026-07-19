# IFRp Commerce App Architecture

This folder tracks the master architecture for the planned IFRp customer/seller commerce app.

Core idea:

- One installable app.
- User chooses `Customer` or `Seller` mode.
- Customer can create/connect a wallet, hold ETH/IFR, swap ETH to IFR, lock IFR, and show a QR proof.
- Seller scans the QR proof, verifies the exact IFRLock threshold for the selected benefit rule, and grants discounts or services only after one-time redemption.
- Seller can configure categories, products, discounts, and IFRLock thresholds in-app or through `shop.ifrunit.tech`.
- Verified sellers/builders can receive IFR partner rewards from the protocol pool once governance and reward automation are ready.

Primary document:

- `MASTER_ARCHITECTURE.md`

Related existing project foundations:

- `apps/benefits-network/`
- `docs/BUSINESS_ONBOARDING.md`
- `docs/PARTNER_INTEGRATION_SPEC.md`
- `docs/wiki/business-onboarding.html`
- `docs/web3/index.html`
