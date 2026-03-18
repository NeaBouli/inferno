# PROJEKT INFERNO — VOLLSTÄNDIGE TODO-LISTE
Stand: 17.03.2026 | Konsolidiert (Claude + Core Dev)

---

## KRITISCH — Governance Proposals Execute

1. ✅ Execute Proposal #1: `setFeeExempt(Vesting, true)` — 10.03.2026
2. ✅ Execute Proposal #2: `setFeeExempt(BurnReserve, true)` — 10.03.2026
3. ✅ Execute Proposal #3: `setFeeExempt(BootstrapVaultV3, true)` — 10.03.2026
4. ✅ Treasury Safe → BootstrapVaultV3: 150M IFR gesendet — 10.03.2026
5. ✅ Community Safe → BootstrapVaultV3: 50M IFR gesendet — 10.03.2026
6. ✅ Verified on-chain: vault.balanceOf() >= 200M IFR

## KRITISCH — Proposals #7/8/9 — EXECUTED ✅

7. ✅ Proposals #7/8/9 executed on-chain (18.03.2026)
   TX #7: `0xfbb98818e1124e5c238b209cef370370e01474538fead9d1e279a4bf4baae644`
   TX #8: `0x4caadb53fc0a7a8f8635bd478155419c2b96fb16d70a00c87a71e828b6fd7f59`
   TX #9: `0x1d43de02fe76da2f94ead84c2037f4f96b3ecb13a9fb8a5afb5bd838ecf08259`
8. ✅ isFeeExempt(Deployer+TreasurySafe+CommunitySafe) = true
9. ✅ transparency.html + wallet-guide.html feeExempt → ✅ (18.03.2026)

## KRITISCH — Proposal #10: transferOwnership

10. ✅ Proposal #10 submitted — setOwner(TreasurySafe)
    TX: `0xc5d6ae0b63c37fea4283da5c62e485744c764064445d578bcd073ea2223d9583`
    ID: 10, ETA: 2026-03-20T07:18:23 UTC (20.03 09:18 Athen)
11. 🔴 Execute Proposal #10 — 20.03.2026 07:18 UTC
    ERST nach Bestaetigung aller 5 Signers!
12. 🔴 400M Transfer: Deployer → TreasurySafe
    WARTET auf Team-Abstimmung

---

## Governance Proposals Status

| ID | Call | Status |
|----|------|--------|
| 0–6 | Diverse (Vesting, BurnReserve, Bootstrap, etc.) | ✅ Executed |
| 7 | setFeeExempt(Deployer) | ✅ Executed 18.03.2026 |
| 8 | setFeeExempt(TreasurySafe) | ✅ Executed 18.03.2026 |
| 9 | setFeeExempt(CommunitySafe) | ✅ Executed 18.03.2026 |
| 10 | setOwner(TreasurySafe) | 🟡 Queued — ETA 20.03.2026 07:18 UTC |

---

## HOCH — Multisig + Governance

1. ✅ Multisig Upgrade: 1-of-2 → 3-of-5 (15.03.2026, beide Safes)
2. ✅ Sepolia Proposal #10: setFeeExempt(BootstrapVaultV3 Sepolia) executed
3. 🔴 Transfer Governance → TreasurySafe (via Proposal #10, nach Execute #7)

## HOCH — Telegram Bot

4. ✅ /announce command: auto-append community link
5. ✅ Channel → Community auto-sync + pin
6. ✅ Full language switch to English (7 files)
7. ✅ Final test protected topics DONE (17.03.2026)
8. ✅ Persistent verification across restarts (17.03.2026, Commit: f30dc3ce)
9. ✅ SIGNER_WALLETS + VERIFY_PORT=3001 in Railway (16.03.2026)
10. Ali Phase 2: WalletConnect → wallet-specific answers (after LP live)

---

## MITTEL — Bootstrap Announcements

1. ✅ Announcement texts fertig (docs/BOOTSTRAP_ANNOUNCEMENT.md, 16.03.2026)
2. ✅ X/Twitter Thread gepostet (16.03.2026) + PNG Banner
3. ✅ Telegram Announcement gepostet (16.03.2026)
4. ✅ Juicebox listing live — juicebox.money/v5/eth:79 (16.03.2026)
5. ✅ Bootstrap page final review done (16.03.2026)
6. ✅ Reddit r/defi + r/ethfinance + r/CryptoMoonShots gepostet (17.03.2026)
7. 📢 Farcaster — Account erstellen + erster Post

## MITTEL — Publication Platforms

**✅ Erledigt:**
- [x] ✅ Juicebox — juicebox.money/v5/eth:79 (16.03.2026)
- [x] ✅ Etherscan Token Profile submitted (17.03.2026)
- [x] ✅ Paragraph.xyz Artikel published (17.03.2026)
      URL: paragraph.com/@0x6b36.../the-ifr-fair-launch-story
- [x] ✅ MIRROR_ARTICLE.md vorbereitet (17.03.2026)
- [x] ✅ FARCASTER_POSTS.md vorbereitet (17.03.2026)
- [x] ✅ GUILD_SETUP.md vorbereitet (17.03.2026)
- [x] ✅ Contact Email kaspartisan@proton.me → Footer + press-kit.html (16.03.2026)

**🔴 Noch offen:**
- [ ] 🔴 Farcaster Account erstellen + ersten Post
- [ ] 🟡 Collab.Land Bot zu Telegram Group hinzufuegen
- [ ] 🟡 Medium — Account anlegen + Artikel
- [ ] 🔵 Reddit Karma pruefen (r/CryptoMoonShots Minimum)

**⏳ Nach LP live (nach 05.06.2026):**
- [ ] ⏳ CoinGecko Listing — Token Logo 256x256 PNG bereit
- [ ] ⏳ CoinMarketCap Listing
- [ ] ⏳ DEXTools Profil optimieren (automatisch nach LP)
- [ ] ⏳ DEXScreener Profil optimieren
- [ ] ⏳ GeckoTerminal Profil optimieren
- [ ] ⏳ DexGuru Profil optimieren
- [ ] ⏳ DeFiLlama TVL Listing beantragen
- [ ] ⏳ TokenSniffer Audit-Status optimieren
- [ ] ⏳ GoPlus Security Token Security Check
- [ ] ⏳ De.fi Token Info vervollstaendigen
- [ ] ⏳ Lens Protocol Account anlegen

## MITTEL — Frontend (Session 16-17.03.2026)

- [x] ✅ Bootstrap Stats Race Condition gefixt (16.03.2026)
- [x] ✅ Recent Votes Bug gefixt (16.03.2026)
- [x] ✅ Bootstrap Voting UX — public stats + 3-state buttons (16.03.2026)
- [x] ✅ Bootstrap Voting: Public stats via Railway API (17.03.2026)
      POST /api/bootstrap/vote + GET /api/bootstrap/votes
      On-chain contribution verification via Etherscan eth_call
- [x] ✅ Bootstrap votes persistent via Railway GraphQL API (17.03.2026)
      BOOTSTRAP_VOTES env var (base64) — survives deploys + restarts
      Fallback: /tmp/ifr_bootstrap_votes.json
- [x] ✅ Railway GraphQL fix — projectId added (17.03.2026)
- [x] ✅ Debug panel removed (17.03.2026)
- [x] ✅ Bootstrap votes: localStorage re-submit to Railway on page load (17.03.2026)
- [x] ✅ Railway vote endpoints verified live (17.03.2026)
      GET /api/bootstrap/votes → 200 OK
      POST /api/bootstrap/vote → 403 correct (deployer has 0 contribution)
      On-chain verification working — only actual contributors can vote
      Note: 0.01 ETH contributor is external address, not deployer
- [x] ✅ Auto-resubmit chains into fetchPublicVotes (17.03.2026)
      resubmit → Promise.all → fetchPublicVotes → render
- [x] ✅ Bootstrap Contribution Listener Bot (16.03.2026)
- [x] ✅ wallet-guide.html — 27. Wiki-Seite (16.03.2026)
- [x] ✅ Wiki Sidebar Navigation neu geordnet — 6 Sektionen (17.03.2026, Commit: 1ca41f5f)
- [x] ✅ Token Flow SVG korrigiert (16.03.2026)
- [x] ✅ Paragraph.xyz Blog-Link im Footer (17.03.2026, Commit: 2eb00870)
- [ ] Create animated token GIF (fuer CoinGecko/CMC)
- [ ] WalletConnect Phase 2: `isLocked(wallet, 1000e9)` Check → Copilot Gate
- [ ] Uniswap Link aktivieren — NUR wenn LP live

## MITTEL — Documentation (Session 16-17.03.2026)

- [x] ✅ MIRROR_ARTICLE.md erstellt (17.03.2026)
- [x] ✅ FARCASTER_POSTS.md erstellt (17.03.2026)
- [x] ✅ GUILD_SETUP.md erstellt (17.03.2026)
- [x] ✅ BOOTSTRAP_ANNOUNCEMENT.md fertig (16.03.2026)
- [x] ✅ PROPOSAL_7_CALLDATA.md erstellt (16.03.2026)
- [x] ✅ PROPOSAL_7_EXECUTION.md erstellt (16.03.2026)
- [x] ✅ PROPOSAL_8_EXECUTION.md erstellt (17.03.2026)
- [x] ✅ propose_8.js — transferOwnership Script (17.03.2026)

## MITTEL — Security/Audit

- [x] ✅ Deep Audit 16.03.2026 — 7 Fixes, 0 Critical (Commit: 44458cb6)
- [x] ✅ AUDIT_REPORT_20260316.md erstellt
- [x] ✅ ifr_icon_32.svg erstellt + auf GitHub (17.03.2026)
- [x] ✅ robots.txt AI Bots erlaubt
- [ ] 🔒 npm audit: 34 Vulnerabilities — fix nach LP-Launch (Breaking Changes)

## MITTEL — 400M LP Reserve Security (on-chain verifiziert 17.03.2026)

**Architektur (bestaetigt):**
- Bootstrap `finalise()` nutzt NUR Vault IFR (100M LP + 100M Claims)
- Deployer 400.6M IFR wird von `finalise()` NICHT beruehrt
- Transfer kann jederzeit nach Proposal #7 erfolgen (feeExempt!)

- [x] ✅ 400.6M IFR Transfer: Deployer → LP Reserve Safe (18.03.2026)
      LP Reserve Safe: `0x5D93E7919a71d725054e31017eCA86B026F86C04` (Gnosis 3-of-5)
      TX: `0xd33c771dc3e09689f124d3ac8f4eab138c827494e3cca5dd329bc29192d23197`

- [x] ✅ Site-wide update: LP Reserve Safe alle Seiten (18.03.2026)
      Landing, Tokenomics, Transparency, Wallet-Guide, Roadmap,
      Governance, Security, Fair-Launch, Protocol-Plan, One-Pager,
      Multisig, Mainnet-Checklist — 13 Dateien aktualisiert

- [ ] 🟡 Phase 2 LP via Governance Proposal
      LP Reserve Safe → Uniswap (100M Phase 2)
      Timing: nach 01.09.2026 LiqRes unlock

- [ ] 🟡 Phase 3 LP via Governance Proposal
      LP Reserve Safe → Uniswap (150M Phase 3)
      Timing: Team-Entscheidung

- [ ] 🔵 Nach Bootstrap finalise(): LP Tokens bei Team.Finance verifizieren (12-Monate Lock)

## MITTEL — Builder Registry

- [x] ✅ StealthX, Vendetta, K-9 Academy — GitHub Issues #9/#10/#11 (17.03.2026)
      BUILDERS.md entfernt — GitHub Issues ist das richtige Format

## MITTEL — Infrastruktur

1. Repo-Maintainer rekrutieren (2-3 Personen)
2. Eigene Domain (weg von GitHub Pages)
3. Project Continuity Sektion in Landing + README + Wiki

---

## NIEDRIG — Frontend Fixes & Styling

1. Bug: INFERNO "I" auf Mobile/Tablet verschoben (CSS-Reflow)
2. Bug: Silber/Gas-Aufflackern INFERNO startet zu spaet
3. Subtitle anpassen: `$IFR` (rot) + `The Deflationary Utility Token`
4. "Read the Docs" Button: Transparent Rot, soft pulsierend
5. FAQ / Name-Erklaerung einbauen (Dantes Inferno Referenz)

## NIEDRIG — Dokumentation + Community

6. CHANGELOG.md: Plan B dokumentieren
7. Wiki-Inkonsistenzen fixen (Test-Counts, Roadmap Phasen, Adressen)
8. Vesting-Zeitplan Dokument erstellen (intern)
9. Transparency Page: Railway `burned` vs `burnBalance` Fix

## NIEDRIG — Audits & Tests

10. Weitere Security Audits durchfuehren
11. Testabdeckung erweitern / neue Tests schreiben

---

## PHASE 2/3 — Spaeter

1. LiqRes Withdrawal: ab 01.09.2026 — `setMaxWithdrawPerPeriod(200M)` Proposal
2. LP-Erweiterung aus LiqRes (Phase 2/3)
3. Creator Rewards / SDK (Phase 3)
4. DAO Upgrade (Phase 4)
5. Bug Bounty Programm (Phase 5)
6. ⏳ Animated Token GIF (256x256px, transparent BG, <500KB)

---

## Wichtige Adressen

| Contract | Adresse |
|----------|---------|
| BootstrapVaultV3 Mainnet | `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` |
| BootstrapVaultV3 Sepolia | `0x16086d4f7F191047d8A4fFf2090126E12e865A7E` |
| BootstrapVault V1 (DEPRECATED) | `0xA820540936d18e1377C39dd9445E5b36F3F1261a` |
| Treasury Safe | `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` |
| Community Safe | `0xaC5687547B2B21d80F8fd345B51e608d476667C7` |
| LiquidityReserve (locked bis 01.09.2026) | `0xdc0309804803b3A105154f6073061E3185018f64` |

## Wichtige Termine

| Datum | Aktion |
|-------|--------|
| ✅ 10.03.2026 | Proposals #1-#3 executed + Bootstrap funded (200M IFR) |
| ✅ 18.03.2026 | Proposals #7/#8/#9 executed — feeExempt Deployer+Safes |
| 🟡 20.03.2026 07:18 UTC | Proposal #10 execute: setOwner(TreasurySafe) |
| 05.06.2026 | Bootstrap Ende — finalise() → Uniswap V2 LP |
| 01.09.2026 | LiqRes Lock-Ende — LP-Erweiterung moeglich |

---

**Gesamtuebersicht (Stand 17.03.2026):**
KRITISCH: 10 (6 ✅) | HOCH: 10 (9 ✅) | MITTEL: ~50 (30+ ✅) | NIEDRIG: 11 | Phase 2+: 6
