# 🔥 Inferno ($IFR) — Vollständige Projekt-Übergabe

> **Erstellt:** 22.02.2026
> **Zweck:** Nahtlose Weiterarbeit in einem neuen Chat ohne Vorwissen
> **Sprache des Entwicklers:** Deutsch (Code & Docs auf Englisch)
> **Lokaler Projektpfad:** `/Users/gio/Desktop/Inferno`
> **GitHub:** https://github.com/NeaBouli/inferno
> **Live-Seite:** https://neabouli.github.io/inferno/
> **Wiki:** https://neabouli.github.io/inferno/wiki/

---

## 1. Projektstatus

**Überlegung:** Ein neuer Assistent muss sofort verstehen: Was ist Inferno, wie weit ist es, was funktioniert bereits live, und was steht unmittelbar an. Die kritischste Information ist der Deployment-Status und die nächste auszuführende Aktion.

### Zusammenfassung

Inferno ($IFR) ist ein **deflationärer ERC-20 Utility-Token** auf Ethereum. Jeder Transfer verbrennt 2.5% permanent (2% Sender + 0.5% Recipient), plus 1% Pool Fee. Der Token dient als **universeller Utility-Lock**: Nutzer locken IFR on-chain, und Partner-Produkte (z.B. SecureCall) verifizieren den Lock-Status, um Lifetime/Premium-Zugang zu gewähren.

**Phase:** Testnet-Deployment abgeschlossen, Mainnet-Launch steht bevor.

### Was ist abgeschlossen

- **9 Smart Contracts** entwickelt und getestet (8 auf Sepolia deployed und verifiziert, PartnerVault pending deploy)
- **221 Unit Tests** — alle bestehen
- **Slither Security Audit** — 0 High/Critical Findings
- **React Dashboard** (Phase 1 + 2) — Token Overview, Transfer, Governance UI
- **GitHub Pages Landing Page** — 9 Sektionen, Dark Theme, responsive
- **Wiki** — 8 HTML-Seiten mit technischer Dokumentation
- **Governance Lifecycle** komplett getestet: Proposal #0 (setFeeExempt) erfolgreich via 48h Timelock ausgeführt
- **Fee-on-Transfer** live verifiziert: 10.000 IFR Transfer → 9.650 IFR empfangen, 250 IFR gebrannt
- **IFRLock Contract** deployed und vollständig getestet (Lock + Unlock: 8/8 Checks bestanden)
- **Governance Proposal #1** executed — `setFeeExempt(IFRLock, true)` via 48h Timelock ([TX](https://sepolia.etherscan.io/tx/0x211b794970abe147b3ab2f3c92bb79b3b3c5a72bc8be8cfb7e1d00fd4253a909))

### Nächste Schritte

Alle Sepolia-Milestones sind abgeschlossen. Der Fokus liegt jetzt auf den organisatorischen Mainnet-Vorbereitungen (Multisig, Adressen, Audit).

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
- Allocation: 40% DEX / 20% Reserve / 15% Team (Vested) / 15% Treasury / 6% Community / 4% Partner

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
3. **Service Layer** (Partner Apps): Plan-basierte Features (MONTHLY oder LIFETIME)
- **Keine Wallet-Speicherung in Apps**, keine On-Chain-Calls vom Client, kein Token-Narrativ im User-Flow

#### Partner Token Allocation mit Milestone-Based Vesting
- 4% (40M IFR) reserviert für Partner Ecosystem Pool
- Verteilung über Lock-triggered Creator Rewards: User lockt IFR → Creator bekommt X% (RewardBps 10-20%) aus Pool, gevestet 6-12 Monate
- Per-Partner Cap + Annual Emission Cap verhindern Pool-Erschöpfung
- Partner-Tokens geben zukünftige DAO-Stimmrechte (Phase 4+)

---

## 3. Aktuelle Dateistruktur

**Überlegung:** Der neue Assistent muss wissen wo was liegt, welche Dateien die "echte" Arbeit enthalten und welche Legacy sind. Besonders wichtig: die Contract-Dateien, Test-Dateien, Deploy-Scripts und die docs/-Struktur.

### Zusammenfassung

```
/Users/gio/Desktop/Inferno/
├── contracts/                    # Solidity Smart Contracts
│   ├── InfernoToken.sol          # ERC-20 mit Fee-on-Transfer (Kern)
│   ├── BurnReserve.sol           # Strukturiertes Token-Burning
│   ├── BuybackVault.sol          # ETH→IFR Buyback via Uniswap V2
│   ├── Governance.sol            # 48h Timelock + Guardian
│   ├── LiquidityReserve.sol      # LP Token Lock mit Rate Limits
│   ├── Vesting.sol               # 48mo Vesting, 12mo Cliff
│   ├── lock/
│   │   └── IFRLock.sol           # Utility Lock Contract (127 LOC)
│   └── partner/
│       └── PartnerVault.sol      # Partner Ecosystem Pool (290 LOC)
│
├── test/                         # Hardhat Test Suite
│   ├── InfernoToken.test.js      # 21 Tests
│   ├── Governance.test.js        # 36 Tests
│   ├── BurnReserve.test.js       # 21 Tests
│   ├── BuybackVault.test.js      # 9 Tests
│   ├── Vesting.test.js           # 7 Tests
│   ├── LiquidityReserve.test.js  # 28 Tests
│   ├── IFRLock.test.js           # 29 Tests
│   └── PartnerVault.test.js      # 67 Tests
│
├── scripts/                      # Deploy & Test Scripts
│   ├── deploy-testnet.js         # Hauptdeploy (6 Contracts + LP)
│   ├── deploy-lock.js            # IFRLock Deploy + Governance Proposal
│   ├── create-lp.js              # Uniswap V2 LP Pair Creation
│   ├── transfer-ownership.js     # Ownership → Governance Contract
│   ├── test-transfer.js          # Live Fee Verification
│   ├── sepolia-smoke-test.js     # 11-Punkt Smoke Test
│   ├── execute-proposal.js       # Governance Proposal Execution
│   └── test-lock.js              # Live Lock/Unlock Test
│
├── apps/
│   └── dashboard/                # React + Vite + ethers.js v5
│       ├── src/
│       │   ├── components/       # Header, TokenOverview, Transfer, Governance
│       │   └── config.js         # Contract-Adressen + ABIs
│       ├── .env                  # VITE_SEPOLIA_RPC_URL (Alchemy)
│       └── package.json
│
├── docs/                         # GitHub Pages (Source: main/docs)
│   ├── index.html                # Landing Page (~1300 LOC, Single-File)
│   ├── .nojekyll                 # Verhindert Jekyll-Processing
│   ├── DOCS.md                   # Alte Docs-Übersicht (umbenannt von README.md)
│   ├── assets/
│   │   ├── ifr_logo.png          # Aktuelles Logo (ifr_400x400.png)
│   │   ├── banner.jpeg           # Hero Banner (1500x500)
│   │   └── securecall_logo.png   # SecureCall Partner Logo
│   └── wiki/                     # Technische Wiki (8 HTML-Seiten)
│       ├── index.html            # Wiki Home + Navigation
│       ├── contracts.html        # Alle 9 Contracts dokumentiert
│       ├── tokenomics.html       # Fee-Mechanik, Deflation, Allocation
│       ├── lock-mechanism.html   # IFRLock System + Resolver
│       ├── governance.html       # Timelock, Proposals, DAO-Zukunft
│       ├── security.html         # Audit, Tests, Access Control
│       ├── deployment.html       # Adressen, Checklist, Verify
│       └── integration.html      # Developer Guide, Partner Tiers
│
├── abi/                          # Contract ABIs (JSON)
├── audit/                        # Slither Audit Reports
├── arch/                         # Architektur-Diagramme
├── hardhat.config.js             # Hardhat Config (Sepolia + Alchemy RPC)
├── .env                          # SEPOLIA_PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY
├── README.md                     # Projekt-Übersicht (neu geschrieben 22.02.2026)
├── STATUS-REPORT.md              # Detaillierter Status
│
├── backend/                      # [Legacy — nicht aktiv]
├── indexer/                      # [Legacy — nicht aktiv]
├── infra/                        # [Legacy — nicht aktiv]
├── patches/                      # [Legacy — nicht aktiv]
├── testing/                      # [Legacy — nicht aktiv]
├── logs/                         # [Legacy — Deployment-Logs]
└── reports/                      # [Legacy — alte Reports]
```

### Deployed Contracts (Sepolia Testnet — alle verifiziert)

| Contract | Adresse |
|----------|---------|
| InfernoToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| LiquidityReserve | `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF` |
| Vesting | `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B` |
| BuybackVault | `0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C` |
| BurnReserve | `0x6D4582FCac792FD3880e252fC0a585A0c1823e80` |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868e0107017` |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| LP Pair (IFR/WETH) | `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7` |

**Token-Owner:** Governance Contract (0x6050...)
**Governance-Owner:** Deployer Wallet
**Uniswap V2 Router:** `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008`

---

## 4. Offene TODOs

**Überlegung:** Der neue Assistent muss zwischen SOFORT-Aufgaben und LANGFRISTIG unterscheiden können. Die zeitkritische Governance-Execution muss ganz oben stehen.

### Zusammenfassung

#### Erledigt (22.02.2026)

1. ~~**Governance Proposal #1 ausführen**~~ — **Done** ([TX](https://sepolia.etherscan.io/tx/0x211b794970abe147b3ab2f3c92bb79b3b3c5a72bc8be8cfb7e1d00fd4253a909))
2. ~~**Vollständiger Lock/Unlock-Test**~~ — **Done** (8/8 Checks bestanden)
3. **GitHub Pages Cache prüfen** — Hard Refresh (Cmd+Shift+R) auf der Live-Seite

#### Vor Mainnet (organisatorisch, kein Code)

4. **Treasury Multisig** erstellen (Gnosis Safe)
5. **Community Wallet** Adresse festlegen
6. **Team Beneficiary** Adresse für Vesting festlegen
7. **Mainnet .env** vorbereiten (neuer RPC, neue Wallet, echte Adressen)
8. **LP Token Lock/Burn Strategie** entscheiden (Rug-Pull-Schutz)
9. **(Empfohlen)** Externer Security Audit (CertiK, Trail of Bits, OpenZeppelin) — 5k-50k USD, 2-6 Wochen

#### Mainnet Deploy

10. **Mainnet Deployment** — gleiche Scripts wie Sepolia
11. **LP Pairing** auf Uniswap V2
12. **Ownership Transfer** an Governance
13. **Contract Verification** auf Etherscan

#### Nach Launch

14. **Partner-Onboarding-Prozess** definieren
15. **License Resolver** für SecureCall implementieren
16. **Guarded Buyback Automation** (Phase 3)
17. **DAO Governance Migration** (Phase 4)

---

## 5. Bekannte Probleme & Bugs

**Überlegung:** Kritisch sind vor allem die Dinge die auf der Live-Seite falsch angezeigt werden (CDN-Cache), der nicht abgeschlossene Unlock-Test, und die Legacy-Ordner im Repo.

### Zusammenfassung

#### GitHub Pages CDN-Cache (nicht-blockierend)

Die `docs/index.html` ist lokal korrekt (verifiziert per grep), aber GitHub Pages liefert teilweise noch alte Versionen aus. **Lösung:** Hard Refresh (Cmd+Shift+R) oder warten. Falls nach 24h immer noch alt:
```bash
cd /Users/gio/Desktop/Inferno
git commit --allow-empty -m "trigger pages rebuild" && git push
```

#### IFRLock Unlock-Test — Erledigt

Lock/Unlock-Cycle vollständig getestet (8/8 Checks). Governance Proposal #1 wurde am 22.02.2026 executed. `feeExempt(IFRLock) = true` verifiziert. Stale Lock aus Pre-feeExempt-Phase wurde automatisch bereinigt (175 IFR Deficit top-up).

#### BurnReserve nie live getestet

Der `poolFeeReceiver` zeigt noch auf den Deployer, nicht auf die BurnReserve. `BurnReserve.burn()` wurde nie on-chain aufgerufen. Unit Tests bestehen, aber kein Sepolia-Live-Test.

#### Legacy-Ordner im Repository

`backend/`, `indexer/`, `infra/`, `patches/`, `testing/`, `logs/`, `reports/` sind Legacy-Artefakte aus einer früheren Projektphase. Sie enthalten keinen aktiven Code, blähen aber das Repo auf. **Empfehlung:** Aufräumen nach Mainnet-Launch.

#### node_modules war im Repo

Wurde aus dem Git-Tracking entfernt (`git rm -r --cached`), ist aber historisch in älteren Commits noch vorhanden. Betrifft nur Repo-Größe, nicht Funktionalität.

#### Zeitgebundene Contracts nicht live testbar

Vesting (12-Monat Cliff), LiquidityReserve (6-Monat Lock), BuybackVault (60-Tag Activation) können auf Sepolia nicht vollständig getestet werden ohne Monate zu warten. Unit Tests decken die Logik ab.

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

- **Framework:** Hardhat (Solidity ^0.8.20, OpenZeppelin v5)
- **Network:** Sepolia Testnet (Alchemy RPC)
- **Frontend:** React + Vite + ethers.js v5
- **Node:** Version in package.json definiert
- **Config:** `.env` Datei im Root (NICHT committed)

#### Solidity-Konventionen

- OpenZeppelin v5 Imports (`@openzeppelin/contracts/...`)
- `ReentrancyGuard` für alle Contracts mit Token-Transfers
- CEI Pattern (Checks-Effects-Interactions)
- Events für alle State-Änderungen
- `guardian` statt `owner` für Pause-Funktionalität (IFRLock)
- Fee-Rates in Basis Points (100 = 1%)

#### Testing

```bash
npx hardhat test                    # Alle 221 Tests
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

**Überlegung:** Der neue Chat muss wissen, dass alle Sepolia-Milestones abgeschlossen sind und was als nächstes kommt.

### Zusammenfassung

**Alle Sepolia-Milestones sind abgeschlossen** (Stand: 22.02.2026).

Governance Proposal #1 wurde executed ([TX](https://sepolia.etherscan.io/tx/0x211b794970abe147b3ab2f3c92bb79b3b3c5a72bc8be8cfb7e1d00fd4253a909)), IFRLock Lock/Unlock-Cycle vollständig verifiziert (8/8 Checks).

**Nächster Fokus:** Organisatorische Mainnet-Vorbereitungen:
1. Treasury Multisig erstellen (Gnosis Safe)
2. Community Wallet + Team Beneficiary Adressen festlegen
3. Externer Security Audit (empfohlen)
4. Mainnet Deployment

---

## Anhang: Wichtige Links

| Ressource | URL |
|-----------|-----|
| GitHub Repository | https://github.com/NeaBouli/inferno |
| Landing Page | https://neabouli.github.io/inferno/ |
| Wiki | https://neabouli.github.io/inferno/wiki/ |
| X / Twitter | https://x.com/IFRtoken |
| InfernoToken (Etherscan) | https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4#code |
| Governance (Etherscan) | https://sepolia.etherscan.io/address/0x6050b22E4EAF3f414d1155fBaF30B868e0107017#code |
| IFRLock (Etherscan) | https://sepolia.etherscan.io/address/0x0Cab0A9440643128540222acC6eF5028736675d3 |
| SecureCall (Partner) | https://neabouli.github.io/stealth/ |
| SecureCall Repo | https://github.com/NeaBouli/stealth |
| Dashboard | `cd apps/dashboard && npm run dev` → http://localhost:5173 |

## Anhang: Commit-Historie (Session-Highlights)

| Commit | Beschreibung |
|--------|-------------|
| `45560512` | fix: wiki index Quick Stats 7→8 |
| `25964ae9` | fix: correct contract count 7→8 in testnet section |
| `ea2acc47` | feat: audit fix — rewrite README, fix contract count to 8 |
| `0ccd74b0` | feat: deploy IFRLock on Sepolia, add live tests, create wiki |
| `2a92d475` | feat: implement IFRLock contract with 29 tests (154 total) |
| `9303439d` | feat: add GitHub Pages landing page |
| `2bd80909` | feat: execute Governance Proposal #0 — setFeeExempt via Timelock |
| `55b38a3e` | feat: add Sepolia smoke test — 11/11 checks passed |
| `4da1bdbd` | feat: add React dashboard (Phase 1) |
| `2954854f` | feat: add Governance UI (Dashboard Phase 2) |
