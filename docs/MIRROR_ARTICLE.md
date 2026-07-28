# The IFR Fair Launch Story — From Code to Community

*Published on Mirror.xyz by Inferno Protocol*

## Why We Built IFR

Most DeFi tokens follow the same pattern: raise money from VCs, give insiders a discount, dump on retail. We refused.

Inferno ($IFR) was built on a single principle: **your wallet is your identity**.

Lock IFR once. Keep product access active while the required IFR remains locked and the integration remains available. No recurring subscription.

## The Technical Foundation

We spent months building before launching. The result:

- 14 smart contracts on Ethereum Mainnet
- 544 automated tests (91% branch coverage)
- Slither static analysis: 0 critical findings
- 48-hour governance timelock on all parameter changes
- No mint function — supply only decreases

Every line of code is open source. Every deployment transaction is on Etherscan. Every governance action is public for 48 hours before execution.

## The Bootstrap: Community Price Discovery

No team ETH in the pool. Ever.

Instead, we funded the Bootstrap Vault from the protocol treasury and community safe: 200,000,000 IFR pre-funded, waiting for community ETH to pair with on Uniswap V2.

The formula is simple:

**IFR price = total ETH raised / 200,000,000 IFR**

The community set the initial price. The finalised pool paired 100M IFR with 0.030 ETH and reserved 100M IFR for contributor claims. Team.Finance was disabled on Mainnet; LP remains in BootstrapVaultV3, which exposes no LP withdrawal function.

Bootstrap ends June 5, 2026. Anyone can trigger `finalise()` — permissionlessly.

## The Lock Mechanism: Your Wallet, Your Access

IFR is not a trading token. It's an access key.

Lock IFR in the IFRLock contract. Any builder product can verify your status on-chain. Access remains active while that product's required amount stays locked and the integration remains available.

One lock. Every participating product, while the required IFR remains locked and the integration remains available.

## What's Next

- **Phase 2:** LP live on Uniswap V2 after Bootstrap ends
- **Phase 3:** Builder ecosystem, Creator Rewards, BuybackController
- **Phase 4:** Full DAO governance — Der Rat + Das Forum

We're building the infrastructure for a new kind of digital access. One that's permissionless, transparent, and owned by the community.

---

**Links:**
- Website: https://ifrunit.tech
- Bootstrap: https://ifrunit.tech/wiki/bootstrap.html
- GitHub: https://github.com/NeaBouli/inferno
- Telegram: https://t.me/IFR_token
- X: https://x.com/IFRtoken
- Contact: GitHub Issues or Telegram @IFR_token

*$IFR — Lock. Use. Benefit.*
