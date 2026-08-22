# Inferno ($IFR) -- Investor One-Pager

## What is Inferno?
Inferno is a deflationary ERC-20 utility token on Ethereum with
a lock-to-access model. Users lock IFR tokens to gain access to
builder benefits, creator content, and protocol discounts.

## Key Numbers (Ethereum Mainnet, verified 22 August 2026)

| Metric | Value |
|--------|-------|
| Genesis / Current Supply | 1,000,000,000 / 997,673,879.091903855 IFR (no mint) |
| Burn Rate | 2.5% per transfer |
| Team Vesting | 150M IFR, 4 years, 1 year cliff |
| LP Reserve | 400M IFR genesis allocation; live pool balance is dynamic |
| Token Pool Fee | 1% on non-exempt transfers |
| Current test evidence | 642 contract + 30 Generator Engine + 36 SDK legacy tests, plus browser/application gates |
| On-Chain Components | 17 documented and verified on Mainnet |

## Tokenomics

Deflationary + Utility:
- Every transfer permanently burns 2.5%
- 1% goes to the configured protocol pool-fee receiver
- Lock -> tier access without a yield promise; token, contract, market and product-availability risks still apply
- PartnerVault rewards are currently inactive and require governance registration, allocation and authorized processing; no fixed active reward rate is promised

## Products

1. **Benefits Network** -- live customer/seller PWA for QR-based benefits; physical wallet/device acceptance remains incomplete
2. **Creator Gateway** -- YouTube x IFR Lock hybrid access
3. **AI Copilot** -- Guided onboarding (3 modes: User/Builder/Developer)
4. **Points System** -- implemented repository service; deployment availability is separate
5. **Governance Dashboard** -- On-chain proposal management

## Technology

- Blockchain: Ethereum Mainnet (deployed 2026-03-05)
- Contracts: Solidity 0.8.20, OpenZeppelin v5
- Security: full internal audits, static analysis and public automated test evidence; independent professional third-party audit pending
- Governance: 48h Timelock, Guardian Cancel, Gnosis Safe Multisig

## Post-Launch Roadmap

- [x] Mainnet deployment (17 on-chain components, all verified)
- [x] Gnosis Safe Multisig deployed
- [x] Governance Proposal #0 executed
- [x] Uniswap V2 LP created through BootstrapVaultV3 finalization; LP remains in the withdrawal-less vault
- [x] Applicable ownership transfers to Governance completed
- [ ] LendingVault borrowing remains disabled pending a separately audited V2/oracle design
- [ ] CommitmentVault price-conditioned locks remain disabled pending a real oracle path
- [ ] First Mainnet BuilderRegistry activation and PartnerVault reward allocation
- [ ] Third-party security audit (Code4rena / Sherlock)

For the complete live matrix, see
[`CURRENT_FUNCTIONALITY_STATUS.md`](CURRENT_FUNCTIONALITY_STATUS.md).

## Links

- Website: https://ifrunit.tech/
- GitHub: https://github.com/NeaBouli/inferno
- Transparency: docs/TRANSPARENCY.md
- Wiki: https://ifrunit.tech/wiki/

---
*Mainnet Live | March 2026 | Not financial advice*
