# Content Coherence Audit — 16.06.2026

## Scope
Checked the public landing page and all 33 wiki HTML pages for stale project-status claims.

Audited public pages:
- `docs/index.html`
- `docs/wiki/agent.html`
- `docs/wiki/bootstrap.html`
- `docs/wiki/business-onboarding.html`
- `docs/wiki/commitment-vault.html`
- `docs/wiki/contracts.html`
- `docs/wiki/contributing.html`
- `docs/wiki/dao-governance.html`
- `docs/wiki/deployment.html`
- `docs/wiki/ecosystem.html`
- `docs/wiki/fair-launch.html`
- `docs/wiki/faq.html`
- `docs/wiki/fee-design.html`
- `docs/wiki/governance.html`
- `docs/wiki/index.html`
- `docs/wiki/integration.html`
- `docs/wiki/lending-market.html`
- `docs/wiki/lending-vault.html`
- `docs/wiki/lock-mechanism.html`
- `docs/wiki/lp-strategy.html`
- `docs/wiki/mainnet-checklist.html`
- `docs/wiki/multisig.html`
- `docs/wiki/one-pager.html`
- `docs/wiki/open-audit.html`
- `docs/wiki/press-kit.html`
- `docs/wiki/protocol-plan.html`
- `docs/wiki/roadmap.html`
- `docs/wiki/security.html`
- `docs/wiki/testnet.html`
- `docs/wiki/tokenomics.html`
- `docs/wiki/transparency.html`
- `docs/wiki/verify.html`
- `docs/wiki/vesting.html`
- `docs/wiki/wallet-guide.html`

## Source of Truth
- `node scripts/check-bootstrap-status.js`
- `node scripts/check-contributors-execution.js`
- `contracts/bootstrap/BootstrapVaultV3.sol`
- `docs/CONTRIBUTOR_EXECUTION_STATUS_20260616.md`

## Current Canonical Facts
- Bootstrap finalized on 05.06.2026 23:51 UTC.
- Bootstrap raised 0.030 ETH.
- BootstrapVaultV3 finalise() used 100M IFR + 0.030 ETH for the Uniswap V2 LP and reserved 100M IFR for contributor claims.
- LP Token: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`.
- Proposal #15 executed on 08.06.2026: LP Token feeExempt = true.
- Proposal #16 executed on 09.06.2026: CommitmentVault P0 = 300,000,000 wei.
- C1/C2/C3 have claimed 33,333,333.333333333 IFR each.
- As of 16.06.2026, C1/C2/C3 have not yet executed locks or LendingVault offers.
- Contributor execution plan: buy IFR first, then `LOCK_BPS=5000`, then default `LENDING_BPS=5000`.
- Public API is served through `copilot-api.ifrunit.tech`; old visible “Railway Proxy” labels are stale.
- Wiki page count is 33.

## Fixed Stale Claims
- Removed or corrected “LP pending”, “Proposal #15 pending”, “Proposal #16 pending”, and “setP0 pending” claims.
- Replaced incorrect “200M IFR + ETH” LP descriptions with the contract-accurate split: 100M IFR for LP and 100M IFR for claims.
- Updated “Contributor 1 committed” / price-milestone lock copy to the current `LOCK_BPS=5000` TIME_ONLY execution plan.
- Updated Landing, Bootstrap, FAQ, Tokenomics, Roadmap, LP Strategy, Wallet Guide, Mainnet Checklist, Transparency, Security/Open Audit live-data labels.
- Updated wiki page count from 32/25 to 33 where found.

## Remaining Legitimate Pending Items
- Contributor ETH top-ups and IFR buys.
- Contributor 50% CommitmentVault locks.
- Contributor 50% LendingVault offers.
- CoinGecko / CoinMarketCap listings.
- Third-party professional audit.
- Future DAO and governance-extension contracts.
