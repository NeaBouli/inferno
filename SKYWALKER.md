# 🔥 Inferno ($IFR) — Vollständige Projekt-Übergabe

> **Erstellt:** 22.02.2026 | **Aktualisiert:** 05.03.2026
> **Zweck:** Nahtlose Weiterarbeit in einem neuen Chat ohne Vorwissen
> **Sprache des Entwicklers:** Deutsch (Code & Docs auf Englisch)
> **Lokaler Projektpfath:** `/Users/gio/Desktop/Inferno`
> **GitHub:** https://github.com/NeaBouli/inferno
> **Live-Seite:** https://neabouli.github.io/inferno/
> **Wiki:** https://neabouli.github.io/inferno/wiki/

---

## 1. Projektstatus

Inferno ($IFR) ist ein **deflationärer ERC-20 Utility-Token** auf Ethereum. Jeder Transfer verbrennt 2.5% permanent (2% Sender + 0.5% Recipient), plus 1% Pool Fee. Der Token dient als **universeller Utility-Lock**: Nutzer locken IFR on-chain, und Builder-Produkte verifizieren den Lock-Status, um Lifetime/Premium-Zugang zu gewähren.

**Phase:** MAINNET DEPLOYED (05.03.2026) — 10 Contracts deployed + verified, Ownership transferred to Governance.

## Aktueller Stand (05.03.2026)

### Deployed Mainnet Contracts (10 total, alle verifiziert)

| Contract | Adresse | Ownership |
|----------|---------|-----------|
| InfernoToken | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | owner→Governance |
| Governance | `0xc43d48E7FDA576C5022d0670B652A622E8caD041` | owner→Deployer (→Gnosis Safe pending) |
| IFRLock | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | guardian→Deployer (emergency only) |
| BurnReserve | `0xaA1496133B6c274190A2113410B501C5802b6fCF` | owner→Governance |
| BuybackVault | `0x670D293e3D65f96171c10DdC8d88B96b0570F812` | owner→Governance |
| PartnerVault | `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` | admin→Governance |
| FeeRouterV1 | `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` | governance (immutable) |
| Vesting | `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271` | guardian→Deployer (emergency only) |
| LiquidityReserve | `0xdc0309804803b3A105154f6073061E3185018f64` | owner→Governance |
| BootstrapVaultV3 | `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` | keine Ownership (immutable params) |

**Weitere Adressen:**
- Deployer: `0x6b36687b0cd4386fb14cf565B67D7862110Fed67`
- Treasury: `0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c`
- Community: `0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E`
- Gnosis Safe: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` (1-of-1, →2-of-4 pending)
- Uniswap V2 Router: `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`

### Governance Proposals (Mainnet)

| # | Action | ETA | Status |
|---|--------|-----|--------|
| 0 | `setFeeExempt(BootstrapVault, true)` | 07.03.2026 20:12 CET | Pending (48h Timelock) |

### Offene TODOs (geordnet nach Priorität)

**ZEITKRITISCH:**
- 17) Proposal #0 ausführen: **07.03.2026 20:12 CET**
- 18) Treasury Safe (150M) + Community Safe (50M) → BootstrapVaultV3
- 19) Governance owner → Gnosis Safe (nach 2-of-4)

**VOR BOOTSTRAP ANKÜNDIGUNG:**
- 6) 2-of-4 Multisig (warte auf 2 Wallet-Adressen)
- 10) Roadmap Wiki + Landing neu schreiben
- 15) Multisig-Policy Wiki-Seite
- 16) Project Continuity + Schutzschild-Satz
- 22) Coin-Animation Landing Page

**NACH BOOTSTRAP START:**
- 20) Bootstrap Ankündigung (X/GitHub/Landing/Wiki/Juicebox)
- 7) Juicebox (nach finalem Audit)
- 9) Wiki RAG Fix
- 13) Live Token Stats Etherscan API

**NACH BOOTSTRAP FINALISE / LP LIVE:**
- 12) WalletConnect Landing Page
- 14) Token Logo CMC/CG/Trust Wallet einreichen
- 21) CoinGecko + CMC Listing bewerben
- 23) Repo-Maintainer rekrutieren

### Philosophie

- Inferno ist eine **PLATTFORM** — Community integriert sich selbst
- Kein "Builder Onboarding", kein "Apply to join"
- No team ETH in LP — Bootstrap sammelt Community ETH
- On-chain truth layer: IFRLock ist kanonische Quelle

### Tests & Coverage

- **556 total tests** (521 protocol + 35 ecosystem) — all passing
- **Solidity Coverage**: 99.45% Stmts, 91% Branch, 98.26% Funcs, 99% Lines
- **Wiki**: 25 HTML pages
- **CI**: 5 Workflows (creator-gateway, points-backend, ai-copilot, benefits-network, docs-validator)

---

## 2. Architekturentscheidungen

**Überlegung:** Ein neuer Assistent muss verstehen WARUM bestimmte Design-Entscheidungen getroffen wurden, nicht nur WAS gebaut wurde. Besonders die ungewöhnlichen Entscheidungen (9 Decimals, kein DAO, kein Auto-Buyback) müssen begründet sein, da sonst falsche "Verbesserungen" vorgeschlagen werden.

### Zusammenfassung

#### Fee-on-Transfer direkt im Token (nicht Wrapper/Proxy)
- Die Fee-Logik sitzt in `_update()` im InfernoToken — nicht umgehbar
- Fees: 2% SenderBurn + 0.5% RecipientBurn + 1% PoolFee = 3.5% total
- Hard Cap: 5% Maximum (on-chain erzwungen)
- **FeeExempt-Mechanismus**: Kritisch — interne Protokoll-Transfers (Vesting, Lock, Reserve) MÜSSEN exempt sein, sonst entstehen Balance-Mismatches

#### 9 Decimals statt 18
- Bewusste Entscheidung für präzisere Mengenabbildung
- **KRITISCH für alle Integrationen**: `parseUnits(x, 9)` statt `parseUnits(x, 18)`
- Betrifft Tests, UI, Lock-Amounts, Fee-Berechnungen — überall konsistent

#### Community Fair Launch Model (CFLM) — kein Presale
- Ursprünglich war ein Presale-Contract geplant (Presale.sol existierte)
- **Migration zu CFLM**: Presale wurde entfernt, kein VC, kein Private Sale
- Allocation: 40% DEX / 20% Reserve / 15% Team (Vested) / 15% Treasury / 6% Community / 4% Builder

#### Timelocked Governance statt DAO
- **Bewusst KEIN Token-Voting** — verhindert Whale-Manipulation, Flash-Loan-Attacks
- 48h Timelock auf alle Parameter-Änderungen
- Guardian kann Proposals canceln (nur cancel, nicht execute)
- DAO als Phase-4-Upgrade geplant: Admin → Multisig → DAO

#### Kein automatischer Buyback
- **Bewusst kontrolliert, nicht automatisch** — vermeidet MEV/Sandwich-Attacks und prozyklischen Sell-Pressure
- BuybackVault kauft IFR via Uniswap V2 mit ETH, splittet 50/50 Burn/Treasury
- "Guarded Automation" als zukünftiges Upgrade geplant

#### 3-Layer Lock-Architektur
1. **Truth Layer** (IFRLock Smart Contract): `isLocked(wallet, minAmount) → bool`
2. **Bridge Layer** (License Resolver): Stateless Mapping Wallet → Lock → Plan
3. **Service Layer** (Builder Apps): Plan-basierte Features (MONTHLY oder LIFETIME)
- **Keine Wallet-Speicherung in Apps**, keine On-Chain-Calls vom Client, kein Token-Narrativ im User-Flow

#### Builder Allocation mit Lock-triggered Creator Rewards
- 4% (40M IFR) reserviert für Builder Ecosystem Pool, verwaltet durch PartnerVault.sol
- Verteilung über Lock-triggered Creator Rewards: User lockt IFR → Creator bekommt RewardBps% aus Pool, gevestet 6-12 Monate
- Per-Builder Cap + Annual Emission Cap verhindern Pool-Erschöpfung
- Builder-Tokens geben zukünftige DAO-Stimmrechte (Phase 4+)
- **Sepolia-Parameter (Test):** rewardBps=1500 (15%), annualCap=4M, partnerCap=nicht im Constructor
- **Mainnet-Empfehlung:** rewardBps=1000 (10%), annualCap=4M IFR, partnerCap=100K IFR/Builder
  - 10% statt 15% → skalierbar für 500-1000+ Builder ohne Pool-Erschöpfung
  - 100K/Builder statt unbegrenzt → 400 Builder bei Vollausschöpfung
- **KRITISCH Mainnet-Deploy:** feeExempt MUSS VOR dem 40M Transfer gesetzt werden (Step 7, nicht Post-Deploy). Auf Sepolia gingen 1.4M IFR durch Fees verloren.

---

## 3. Aktuelle Dateistruktur

### Contracts (10 Solidity Contracts + 4 Mocks)

```
contracts/
├── token/InfernoToken.sol          # ERC-20 mit Fee-on-Transfer
├── governance/Governance.sol       # 48h Timelock + Guardian
├── lock/IFRLock.sol                # Utility Lock Contract
├── partner/PartnerVault.sol        # Builder Ecosystem Pool
├── liquidity/LiquidityReserve.sol  # LP Token Lock mit Rate Limits
├── burnreserve/BurnReserve.sol     # Strukturiertes Token-Burning
├── buyback/BuybackVault.sol        # ETH→IFR Buyback via Uniswap V2
├── vesting/Vesting.sol             # 48mo Vesting, 12mo Cliff
├── bootstrap/BootstrapVault.sol    # Community Bootstrap (LP Creation)
├── FeeRouterV1.sol                 # Fee-Routing + Voucher System
└── mocks/                          # MockToken, MockRouter, MockInfernoToken, MockAdapter
```

### Scripts (Mainnet + Sepolia)

```
scripts/
├── deploy-bootstrap-mainnet.js     # BootstrapVault Mainnet Deploy
├── create-lp-mainnet.js            # Uniswap V2 LP Creation (Mainnet)
├── transfer-ownership-mainnet.js   # Ownership → Governance (Mainnet)
├── check-ownership.js              # Read-only Ownership Check
├── check-balances.js               # Deployer ETH/IFR Balance Check
├── propose-bootstrap-feeexempt.js  # Governance Proposal: feeExempt(BootstrapVault)
├── execute-proposal.js             # Governance Proposal Execution
├── deploy-testnet.js               # Sepolia Deploy
├── deploy-bootstrap-vault.js       # Sepolia BootstrapVault Deploy
├── deploy-lock.js                  # IFRLock Deploy
├── create-lp.js                    # Sepolia LP Creation
└── ...                             # Weitere Sepolia Scripts
```

### Apps (7 total)

```
apps/
├── dashboard/                      # Port 5173, React 18 + Vite + ethers v5
├── governance-dashboard/           # Port 5174, React 18 + Vite + TS + Tailwind
├── ai-copilot/                     # Port 5175/3003, React 18 + Vite + Express
├── points-backend/                 # Port 3004, Express + Prisma + SQLite + siwe
├── creator-gateway/                # Port 3005, Express + ethers v5 + googleapis
├── benefits-network/backend/       # Port 3001, Express + Prisma + SQLite
└── benefits-network/frontend/      # Port 3000, Next.js 14 + wagmi v2
```

### Wiki (16 HTML Pages)

```
docs/wiki/
├── index.html, contracts.html, tokenomics.html, lock-mechanism.html
├── governance.html, security.html, deployment.html, integration.html
├── bootstrap.html, agent.html, faq.html, transparency.html
├── fair-launch.html, fee-design.html, roadmap.html, testnet.html
```

### Key Files

- `README.md` — Projekt-Übersicht
- `docs/index.html` — Landing Page (GitHub Pages)
- `docs/DEPLOYMENTS.md` — Sepolia + Mainnet Adressen + Governance Proposals
- `docs/DOCS.md` — Projekt-Struktur (10 Contracts, 367 Tests)
- `docs/APP_SECURITY_REVIEW.md` — Security Review (20/25 fixed, 5 documented)
- `docs/WHITEPAPER.md` — v1.0 + CFLM + Fee Design
- `.github/workflows/` — 5 CI Workflows
- `.env.mainnet` — Mainnet RPC + Deployer Key (NICHT committed)

---

## 4. Erledigte Meilensteine

- **Mainnet Deployment** — 10 Contracts deployed + verified (05.03.2026)
- **Ownership Transfer** — 4 Contracts (InfernoToken, LiquidityReserve, BurnReserve, BuybackVault) → Governance
- **BootstrapVault** deployed + verified, feeExempt Proposal submitted
- **Sepolia Testnet** — Full lifecycle getestet (Governance, IFRLock, Fee-on-Transfer, PartnerVault)
- **Security Review** — 20/25 Findings fixed, 5 documented (APP_SECURITY_REVIEW.md)
- **AI Copilot** — Railway deployed, 3-Mode System (chat/learn/quiz)
- **556 tests** (521 protocol + 35 ecosystem) — All passing

---

## 5. Bekannte Probleme & technische Hinweise

#### ethers v5 + Alchemy Bug
- Alchemy returns `to=""` for contract creation TXs — ethers v5 Formatter rejects this
- Fix: Monkey-patch `Formatter.prototype.transactionResponse` → convert `to=""` to `to=null`
- Applied in `scripts/deploy-mainnet-continue.js` und `scripts/deploy-bootstrap-mainnet.js`

#### Legacy-Ordner im Repository
`backend/`, `indexer/`, `infra/`, `patches/`, `testing/`, `logs/`, `reports/` — Legacy-Artefakte, kein aktiver Code.

#### Zeitgebundene Contracts
Vesting (12-Monat Cliff), LiquidityReserve (6-Monat Lock), BuybackVault (60-Tag Activation) — Unit Tests decken die Logik ab.

---

## 6. Was wird explizit NICHT getan

**Überlegung:** Wenn ein neuer Assistent "Verbesserungen" vorschlägt die bewusst ausgeschlossen sind, entsteht unnötige Arbeit. Diese Ausschlüsse müssen klar dokumentiert sein.

### Zusammenfassung

| Ausschluss | Begründung |
|-----------|-----------|
| **Kein Token-Voting / DAO jetzt** | Whale-Manipulation, Flash-Loan-Risiko. Geplant als Phase 4. |
| **Kein automatischer Buyback** | MEV/Sandwich-Risiko, prozyklischer Sell-Pressure. Guarded Automation als Phase 3. |
| **Kein Presale** | CFLM-Modell. Presale.sol wurde bewusst entfernt. |
| **Keine Multi-Chain jetzt** | Erst Ethereum stabil, dann L2/Cross-Chain als Phase 5. |
| **Keine Staking/Yield-Mechanik** | IFRLock ist reiner Utility-Lock, keine Rewards. |
| **Kein Mint** | Keine Mint-Funktion im Contract. Supply kann nur sinken. |
| **Keine Wallet-Speicherung in Apps** | Privacy by Design. Nur stateless Resolver-Queries. |
| **Kein Investment-Narrativ** | Keine Worte wie "moon", "profit", "returns" in Docs/Website. Nur Utility. |
| **18 Decimals** | IFR nutzt 9 Decimals. Keine Änderung möglich (deployed). |

---

## 7. Wichtige Konventionen

**Überlegung:** Code-Style, Namensgebung und Workflow-Konventionen verhindern Inkonsistenzen wenn verschiedene Assistenten am Projekt arbeiten.

### Zusammenfassung

#### Entwicklungsumgebung

- **Framework:** Hardhat v2 (Solidity ^0.8.20, OpenZeppelin v5, Chai v4)
- **Network:** Ethereum Mainnet + Sepolia Testnet (Alchemy RPC)
- **Frontend:** React + Vite + ethers.js v5
- **CJS-only** (Hardhat v2), kein ESM
- **Config:** `.env` (Sepolia) + `.env.mainnet` (Mainnet) — NICHT committed

#### Solidity-Konventionen

- OpenZeppelin v5 Imports (`@openzeppelin/contracts/...`)
- `ReentrancyGuard` für alle Contracts mit Token-Transfers
- CEI Pattern (Checks-Effects-Interactions)
- Events für alle State-Änderungen
- `guardian` statt `owner` für Pause-Funktionalität (IFRLock)
- Fee-Rates in Basis Points (100 = 1%)

#### Testing

```bash
npx hardhat test                    # Alle 367 Contract Tests
npx hardhat test test/IFRLock.test.js  # Einzelner Test
```

- Tests in JavaScript (nicht TypeScript)
- ethers.js v5 Syntax (`ethers.utils.parseUnits("1000", 9)`)
- **IMMER 9 Decimals** in parseUnits

#### Deploy-Workflow

```bash
# 1. Deploy
npx hardhat run scripts/deploy-testnet.js --network sepolia

# 2. LP erstellen
npx hardhat run scripts/create-lp.js --network sepolia

# 3. Ownership transferieren
npx hardhat run scripts/transfer-ownership.js --network sepolia

# 4. Verify (automatisch via hardhat-etherscan)
npx hardhat verify --network sepolia <CONTRACT_ADDR> <CONSTRUCTOR_ARGS>
```

#### Git-Konventionen

- Branch: `main`
- Commit-Messages: `feat:`, `fix:`, `docs:`, `test:` Prefix
- Keine `node_modules/` im Repo
- `.env` in `.gitignore`

#### Qualitätsprinzip

> **"Vertrauen ist gut, Kontrolle ist besser."**

- Niemals Completion-Claims ohne Verifikation akzeptieren
- Immer `grep -n` oder `cat` nutzen um Änderungen zu bestätigen
- Live-Seite IMMER nach Push prüfen (GitHub Pages CDN-Cache beachten)

#### Website/Docs-Konventionen

- Dark Theme: `#0a0a0a` Background, `#ff4500` Accent (Inferno Orange)
- Google Fonts: Inter
- Alle Docs auf Englisch
- Kommunikation mit Entwickler auf Deutsch
- Keine Investment-Sprache, nur Utility-Narrativ

---

## 8. Nächster konkreter Schritt

**Stand: 05.03.2026** — Mainnet deployed, Ownership transferred, BootstrapVault deployed.

**Nächster Schritt:**
1. **Governance Proposal #0 ausführen** — ETA: **07.03.2026 20:12 CET**
   ```bash
   PROPOSAL_ID=0 npx hardhat run scripts/execute-proposal.js --network mainnet
   ```
2. Treasury Safe (150M) + Community Safe (50M) → BootstrapVaultV3
3. 2-of-4 Multisig aufsetzen (warte auf Wallet-Adressen)
4. Governance owner → Gnosis Safe transferieren

---

## Anhang: Wichtige Links

| Ressource | URL |
|-----------|-----|
| GitHub Repository | https://github.com/NeaBouli/inferno |
| Landing Page | https://neabouli.github.io/inferno/ |
| Wiki | https://neabouli.github.io/inferno/wiki/ |
| X / Twitter | https://x.com/IFRtoken |
| InfernoToken (Mainnet) | https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code |
| Governance (Mainnet) | https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#code |
| IFRLock (Mainnet) | https://etherscan.io/address/0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb#code |
| BootstrapVaultV3 (Mainnet) | https://etherscan.io/address/0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141#code |
| Gnosis Safe | https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b |
| AI Copilot (Railway) | https://ifr-ai-copilot-production.up.railway.app |

---

## Aufgabenliste

Siehe **[TODO.md](TODO.md)** fuer die vollstaendige Projekt-Aufgabenliste (Stand: 08.03.2026).

---

## IFR Governance Konzept v1.0 (08.03.2026)

Zwei-Kammern-System ueber Telegram:
- Kammer 1: Der Rat (Team-Governance) — Merkle Tree + RatVoting.sol
- Kammer 2: Das Forum (Community) — 10 IFR Spamschutz + ForumVoting.sol
- Bot-Layer Node.js: Wallet-Mapper, IFR-Reader, Reaction-Tracker, Cron-Jobs
- Neue Contracts (Phase 5): RatVoting.sol, ForumVoting.sol, IFRSpamProtection.sol
- Telegram Kanaele: @IFR_News, @IFR_Rat, @IFR_Forum, @IFR_Abstimmung
- Konzept: docs/IFR_GOVERNANCE_KONZEPT.md
- Wiki: docs/wiki/dao-governance.html
- Status: Vision/Konzept — Umsetzung Phase 5
