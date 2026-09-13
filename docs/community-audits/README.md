# IFR Protocol Community Audits

This directory preserves security and project reviews submitted by community
members. Community audits are published for transparency. They are not
professional third-party certifications, and publication does not mean that
IFR Protocol accepts every factual, legal, economic or technical conclusion.

## OKComputer Community Audit — 27 July 2026

- Original report:
  [IFR_Protocol_Audit_2026-07-27.md](IFR_Protocol_Audit_2026-07-27.md)
- Original SHA-256:
  `ec7f99b0b74c51e04091727a0b69f49f67c36409a52c9ea7b55ba545b6b3e375`
- Publication status: preserved unchanged as submitted
- Review type: community-submitted project and security review
- Certification status: not an independent professional third-party audit

### Editorial status note — 28 July 2026

The report is a dated snapshot. Several findings were useful and have already
driven repository corrections:

- Mainnet LP custody is now described consistently: Team.Finance was disabled,
  the LP tokens remain in BootstrapVaultV3, and that vault exposes no LP
  withdrawal or recovery function.
- Public operational TODO files were removed from the website deployment.
- Audit claims now identify full internal audits and state that a professional
  third-party audit remains pending.
- Access language now states that access continues while the required IFR
  remains locked and the relevant integration remains available.
- Burn, vesting, Bootstrap allocation and Telegram descriptions were aligned
  across active public surfaces.

Some snapshot claims were already outdated when the report was reviewed:

- LendingVault had three offers rather than zero.
- CommitmentVault and IFRLock already held live user locks.
- The LP was not waiting for a Team.Finance transaction; its actual custody
  follows from the deployed BootstrapVaultV3 configuration and bytecode.

Legal statements in the submitted report are the contributor's assessment,
not legal advice or a confirmed regulatory determination. Legal texts,
operator disclosures, lending design and regulatory classification require
qualified German/EU legal review.

Open high-risk recommendations involving immutable contracts, lending,
governance or Mainnet roles are not implemented directly from this report.
They require separate architecture, tests, independent review and an
authorized governance process.

## Collateral Web3 Open Audits — Contract Deep Audit — 14 September 2026

- Original report:
  [CWA_IFR_Contracts_Deep_Audit_2026-09-14.md](CWA_IFR_Contracts_Deep_Audit_2026-09-14.md)
- Original SHA-256:
  `ef301821fa2e1bb4afe361c956c541f29e8be5cee574130a7b54399870d7802d`
- Fuzz harness (evidence artifact):
  [CWA_IFR_DeepAudit_FuzzHarness_2026-09-14.t.sol](CWA_IFR_DeepAudit_FuzzHarness_2026-09-14.t.sol)
  · SHA-256 `5f155ef0c5a8898ce32efda99c6d62a7489f6c28a5a70b5779f10840a472f933`
- Publication status: preserved unchanged as delivered
- Review type: independent AI-assisted deep audit (Kimi K2,
  `web3-contract-deep-audit` skill): reproduced Slither/Mythril gates locally,
  Foundry invariant fuzzing (14/14), bytecode-vs-source comparison, dual-explorer
  verification sweep, block-pinned chain reads (block 25971217)
- Certification status: not a formal certification

Result summary: 0 Critical / 0 High / 1 Medium / 1 Low / 2 Informational.
Key correction: W1 (Governance `setOwner`) and W3 (BuybackVault `setParams`
bounds) are fixed in repository source only — the deployed mainnet bytecode
predates both fixes (proven by live probe, bytecode diff, commit diff, and
era-source diff). No new vulnerability in deployed contract logic.

## Collateral Web3 Open Audits — Surfaces Supplement — 14 September 2026

- Original report:
  [CWA_IFR_Surfaces_Supplement_2026-09-14.md](CWA_IFR_Surfaces_Supplement_2026-09-14.md)
- Original SHA-256:
  `91092379f4677c48dc1e6ce0387753dd7a0ca425a7dce4989808f9fc5aa97408`
- Publication status: preserved unchanged as delivered
- Review type: independent AI-assisted static source review (Kimi K2 with an
  independent review pass) of creator-gateway, Telegram bot, Benefits backend,
  SDK and dashboards at commit `eb538a355001b042b343bfb19221af2407a96e63`;
  no dynamic testing, no live-deployment probing
- Certification status: not a formal certification

Result summary: 2 High / 6 Medium / 8 Low / 2 Informational (CWA-28…CWA-45).
The two High findings are both in creator-gateway (attacker-chosen JWT wallet
claim via legacy `/auth/wallet` and via the Google OAuth flow); exploitability
depends on the service's deployment status, which was not publicly observable.
