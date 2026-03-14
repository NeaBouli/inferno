# Contributing to Inferno ($IFR)

## Welcome

Inferno is an open-source project. Contributions are welcome —
from bug reports to feature requests and code contributions.

## How to Contribute

### Bug Reports
1. GitHub Issues: https://github.com/NeaBouli/inferno/issues
2. Use the Bug Report template
3. Provide reproduction steps
4. Environment: Node.js version, OS, Network (Sepolia/Mainnet)

### Feature Requests
1. GitHub Issues: Feature Request Template
2. Describe the problem (not just the solution)
3. Explain the use case

### Code Contributions
1. Fork the repo
2. Branch: `feat/short-description` or `fix/issue-number`
3. Write tests (TDD preferred)
4. All existing tests must pass: `npx hardhat test`
5. Open a Pull Request with a description

## Code Standards

### Solidity
- Pragma: `^0.8.20`
- OpenZeppelin v5 for standard patterns
- NatDoc comments for all public functions
- No magic numbers — use constants
- Slither must show 0 High/Critical findings

### TypeScript/JavaScript
- TypeScript preferred
- Strict Mode
- No `any` types (unless unavoidable)
- Jest for tests

### Git Conventions (STRICT)

Commit prefixes:
- `feat:` new feature
- `fix:` bugfix
- `docs:` documentation only
- `test:` tests only
- `ops:` operations (deploy, governance)
- `refactor:` refactoring

**FORBIDDEN:**
- No force-push to main
- No rebase on pushed commits
- No `--amend` on pushed commits

## Smart Contract Changes

For Solidity changes:
1. Deploy a new contract version (never patch in-place)
2. Governance Proposal for migration (48h Timelock)
3. Tests: `npx hardhat test` (all 556 must pass)
4. Coverage: `npx hardhat coverage` (>80% Branch Coverage)
5. Update documentation

## Review Process

- PRs are reviewed within 48h
- Security-relevant changes: extra review time
- Mainnet-relevant changes: two reviews required

## Code of Conduct

- Respectful communication
- No spam issues
- No unsolicited DMs to maintainers
- Security issues: report privately via GitHub Security Advisory

## Links

- Docs: https://ifrunit.tech/wiki/
- Issues: https://github.com/NeaBouli/inferno/issues
- Security: [docs/SECURITY_POLICY.md](SECURITY_POLICY.md)

---
*Version 1.0 | March 2026*
