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

## Collateral Web3 Open Audits — 14 September 2026

- Original report:
  [CWA_IFR_Protocol_Audit_2026-09-14.md](CWA_IFR_Protocol_Audit_2026-09-14.md)
- Original SHA-256 (as delivered):
  `86d9ef68f270df799436f0207146d1430817737f7f64f51a26d1a6a335dfce0b`
- Current SHA-256 (after the corrections noted below):
  `a0d5b454e91a790af174bbfc29c823c08c3766591ffc8265cf7c5c1cd74e2e96`
- Publication status: corrected 2026-09-14 after independent PR review — three
  factual fixes, no change to any finding classification or severity:
  (1) CWA-01 collateral example figure (≈104,310,881 wei at X = 1 wei);
  (2) totals summary states 6 Medium, matching the classified CWA-02…CWA-07;
  (3) conclusion now qualifies the no-funds-at-risk statement for new
  price-conditioned CommitmentVault locks (CWA-03).
- Review type: independent AI-assisted full-scope security review (Kimi K2,
  executed with the project's `collateral-web3-audit` skill); read-only
  evidence at repo commit `eb538a355001b042b343bfb19221af2407a96e63` and
  Ethereum mainnet block 25971217
- Certification status: first external review of the project; not a formal
  certification. Publication does not mean that IFR Protocol accepts every
  factual or technical conclusion.

Result summary: 0 Critical, 1 High (dormant LendingVault single-price
activation risk; currently fail-closed and verified on-chain), 6 Medium,
12 Low, plus a documentation-drift cluster. Known-issues register (W1–W21,
OPS) verified item by item; several documentation values diverge from chain
state in both directions and are listed in the report's §6.

Remediation of report findings follows the normal governance path: timelock
proposals, tests, and independent review per finding. No finding is
implemented directly from this report.
