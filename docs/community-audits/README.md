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

## Collateral Web3 Open Audits — README Audit — 14 September 2026

- Original report:
  [CWA_IFR_README_Audit_2026-09-14.md](CWA_IFR_README_Audit_2026-09-14.md)
- Original SHA-256:
  `fe1a233884665f4a03ef9bd3e28d7a1d3e8daa4652a3c799f62cc3ef014fe590`
- Publication status: preserved unchanged as delivered
- Review type: independent AI-assisted claim-by-claim consistency review of the
  repository README against pinned chain state (block 25971217), reproduced tool
  runs, and source review at commit `eb538a355001b042b343bfb19221af2407a96e63`
- Certification status: not a formal certification

Result summary: 0 Critical / 0 High / 2 Medium / 1 Low / 3 Informational
(CWA-51…CWA-56). Key findings: allocation-table custody rows diverge from chain
state (Treasury Safe holds 0 IFR; aggregation into LP Reserve Safe undocumented
in the README), and the "BuybackVault/BurnReserve accumulate from the 1% pool
fee" sentence contradicts chain reality (see CWA-02). The README's dated-snapshot
and disclaimer patterns are exemplary and were verified as honest.
