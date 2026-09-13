# IFR Protocol — Web & API Surface Inventory

Read-only recon baseline, 2026-09-13/14. All observations are time-stamped; re-verify at audit
time — surfaces change. Only GET/HEAD was used; robots.txt disallow paths were not probed.

## URL inventory

**Apex `ifrunit.tech`** (GitHub Pages, static; cert Let's Encrypt, newest apex cert 2026-09-01;
`www.` 301 → apex). Sitemap lists 40 URLs:

- `/` (homepage, ~256 KB), `/web3/`, `/builder.html`
- Wiki — 36 pages under `/wiki/`: index, contracts, tokenomics, protocol-plan, lock-mechanism,
  governance, security, reputation, deployment, integration, transparency, fair-launch,
  fee-design, faq, vesting, roadmap, agent, bootstrap, commitment-vault, community-signer-expansion,
  lending-market, lending-vault, liquidity, lp-strategy, testnet, multisig, dao-governance,
  mainnet-checklist, business-onboarding, contributing, press-kit, one-pager, verify,
  wallet-guide, ecosystem, open-audit
- robots.txt: allows all (incl. GPTBot/ClaudeBot), disallows `/.env`, `/node_modules/`; declares
  `/web3/` the "lightweight user execution surface". No security.txt at `/.well-known/security.txt`
  or `/security.txt` (both 404) — anywhere.

**Subdomains (crt.sh):** `ifrunit.tech`, `www`, `web3`, `shop`, `copilot-api`, `verify-api`,
`points-api`. (The two *-api hosts were only visible via certificate transparency — keep
enumeration in every audit run.)

**`web3.ifrunit.tech`** — byte-identical copy of apex `/web3/` (154,881 B; nginx vs GitHub Pages
on apex). Wallet-connect dApp: MetaMask/Trust/Coinbase deeplinks, Uniswap buy link, IFRLock
lock/unlock, CommitmentVault tranches, LendingVault offers; embeds copilot iframe
(`copilot-api.ifrunit.tech?embedded=1`); RPC `eth.llamarpc.com`.

**`shop.ifrunit.tech`** — Next.js 15 PWA "IFR Benefits Network" (customer + seller modes).
Own robots (`Allow: /guide /scan /s/ /privacy /support`; `Disallow: /api/ /b/ /p/ /r/`) and
sitemap (5 URLs: `/ /guide /scan /privacy /support`). Injected-wallet connect; WalletConnect
"not configured yet"; IFRLock lock UI (approve exact amount → lock); short-lived customer-pass
QR + seller QR; single-redemption checkout; signed read-only history (10-minute memory).
Public `GET /api/health` → `{"status":"ok","chainId":1}`.

**`copilot-api.ifrunit.tech`** — Express (`x-powered-by: Express`). Observed:

| Endpoint | Status | Response |
|---|---|---|
| `GET /` | 200 HTML | IFR Copilot chat widget UI; JS references `POST /api/chat` + donation address |
| `GET /api/health` | 200 | `{"status":"ok","apiKeySet":true,"etherscanKeySet":true,"version":"2026-03-07-proxy"}` — **information disclosure** |
| `GET /api/ifr/supply` | 200 | totalMinted 1e9; totalSupply 997,571,140.02; burned 2,428,859.98; source "live" |
| `GET /api/ifr/balances` | 200 | per-contract raw/formatted balances (IFRLock locked 2,000; CommitmentVault 47,952,476.87; LendingVault 52,155,440.95; FeeRouterV1 371,543.99; LPReserveSafe 400.6M; Vesting 150M; BootstrapVaultV3 ~1 wei) |
| `GET /api/ifr/check?wallet=0x…` | 200 | `{hasAccess, balance, locked, total, required:1000, tier, tierName}`; 400 on invalid address |
| `GET /api/ifr/price` | **502** | `{"error":"Failed to fetch price data"}` — upstream failure at recon time |
| `/health /status /docs /openapi.json /api /version` | 404 | Express default |

**`points-api.ifrunit.tech`** — Express. `GET /health` → 200 `{"status":"ok"}`; `/` and
`/api/health` → 404. Documented-but-unprobed (auth-gated): `/auth/siwe/nonce`,
`/auth/siwe/verify` → JWT 24h, `/points/balance`, `/points/event`, `/voucher/issue`.
**Docs say the Points system is "designed, not yet live" while the live service answers healthy
— verify status.** Claimed limits: 1 voucher/wallet/day, 100 pts → 15 bps voucher (7 days,
single use), 60 req/min/IP.

**`verify-api.ifrunit.tech`** — Express. `/`, `/health`, `/api/health` all 404. CORS preflight:
`access-control-allow-origin: *`, methods POST/GET/OPTIONS. Used by `wiki/verify.html` for
Telegram wallet binding (3-tier verification Signer/Voter/Builder via `/verify` code + EIP-191
signature; Telegram topic IDs: Core Dev 58, Council 21, Vote 23, Dev & Builder 11).

## Security-header baseline (re-verify every run)

| Header | apex (Pages) | web3 (nginx) | shop (Next.js) | copilot-api | verify-api / points-api |
|---|---|---|---|---|---|
| CSP | ✗ | ✗ | ✓ enforced + Report-Only | ✗ | `default-src 'none'` |
| X-Frame-Options | ✗ | ✗ | ✓ DENY | ✗ | ✗ (CSP covers) |
| HSTS | ✗ | ✗ | ✓ 63072000 incl. subDomains | ✗ | ✗ |
| X-Content-Type-Options | ✗ | ✗ | ✓ nosniff | ✗ | ✓ nosniff |
| Referrer-Policy | ✗ | ✗ | ✓ no-referrer | ✗ | ✗ |
| Permissions-Policy | ✗ | ✗ | ✓ restrictive | ✗ | ✗ |
| CORS | `ACAO: *` (Pages default) | — | same-origin | `vary: Origin` | `ACAO: *` (verify-api) |

**Weakest surface: `web3.ifrunit.tech`** — wallet-connect dApp with zero hardening headers
(clickjacking a signing UI is the scenario to assess). Shop is the best-hardened surface.

## Addresses embedded in web/JS (integrity-check these against contract-map.md)

Homepage + `/web3/` embed: token, pair, IFRLock, CommitmentVault, LendingVault, Governance;
`c2Addr = 0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958` hard-coded; RPC endpoints
`eth.llamarpc.com`, `ethereum-rpc.publicnode.com`. builder.html references
`copilot-api.ifrunit.tech/api/ifr/check?wallet=`. Wiki `contracts.html` code examples use
**Sepolia** addresses on the mainnet reference page (integrator-confusion risk).

## External links (inventory for reputation/phishing review)

Uniswap (swap link with outputCurrency), GeckoTerminal pool page, Etherscan (253 links),
app.safe.global, t.me/IFR_token (community) + t.me/IFRtoken (announcements — phishing-similar
handles, documented in FAQ), x.com/IFRtoken, paragraph.com fair-launch article (author =
Deployer EOA), wallet deeplinks (MetaMask/Trust/Coinbase/Rainbow), faucets, fonts.googleapis /
cdnjs (no SRI noted), schema.org.

## Web oddities / audit hooks (from recon)

1. Test-count drift across pages: homepage "642", wiki index "644", FAQ "644 + 30 + 36",
   security/one-pager/press-kit "historical 544".
2. Signer identity conflict: same Deployer address labeled "A.K." (multisig/protocol-plan) vs
   "G.M. (Kaspartizan)" (transparency).
3. contracts.html mainnet reference page uses Sepolia addresses in code examples.
4. LP phase figures diverge: protocol-plan 150M/100M/150M vs tokenomics 100M/100M/100M.
5. Stale supply table on security page (BootstrapVaultV3 200M) vs live API (~1 wei post-finalise);
   burned 2,326,121 @ 22.08.2026 snapshot vs 2,428,860 live.
6. Tier-table divergence: press-kit Gold 25,000 / Platinum 100,000 vs lock-mechanism Gold 5,000 /
   Platinum 10,000 (integration page adds a third variant: 1,000/5,000/25,000).
7. LendingVault wiki claims "audited smart contract" while the same wiki states a professional
   audit is pending — overstatement to flag.
8. copilot-api `/api/health` leaks `apiKeySet`/`etherscanKeySet`/version; `/api/ifr/price` 502
   matched the homepage's "Pool data could not be verified" state.
9. points-api live despite docs "not yet live" — deployment ahead of documentation.
10. ~21,000 IFR pool fees documented on Deployer EOA pre-Proposal-#6; live API showed Deployer
    balance 0 at recon — verify on-chain where it went.
11. Donation address = signer Y.K.'s personal EOA (ops donations commingled with keyholder
    identity; disclosed, still governance-relevant).
12. `/web3/` and `web3.ifrunit.tech` are byte-identical copies on different infrastructure —
    drift between them (or compromise of one) would be silent; check both every run.
13. No security.txt anywhere; security contact = GitHub Private Vulnerability Reporting only;
    no bug bounty.
14. Homepage wiki links both Telegram handles; reputation page lists pending CoinGecko
    (CL0309260050) and CMC (1390230) tickets — relevant for the "wallet may flag IFRLock as
    untrusted" caveat on the lock-mechanism page.
