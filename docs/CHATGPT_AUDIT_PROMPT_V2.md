# ChatGPT Independent Audit — Prompt V2

Kopiere diesen gesamten Prompt in ein neues ChatGPT-Fenster (GPT-4). Fuege anschliessend den Inhalt der genannten Dateien als Kontext an.

---

## Auftrag

Du bist ein unabhaengiger Auditor fuer das Inferno ($IFR) Projekt. Pruefe ALLE genannten Quellen auf Konsistenz, Korrektheit und Vollstaendigkeit. Antworte auf Deutsch.

## Projekt-Fakten (Referenz)

- **Token:** Inferno ($IFR), ERC-20, 9 Decimals, 1B Supply, deflationary (2.5% burn + 1% pool fee)
- **Modell:** Community Fair Launch (CFLM) — kein Presale, kein VC
- **On-Chain Components:** 10 (9 Repo-Contracts + 1 Uniswap V2 LP Pair)
- **Tests:** 276 (9 Test-Dateien), alle bestanden
- **Contracts:**
  1. InfernoToken — `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`
  2. LiquidityReserve — `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF`
  3. Vesting — `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B`
  4. BuybackVault — `0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C`
  5. BurnReserve — `0x6D4582FCac792FD3880e252fC0a585A0c1823e80`
  6. Governance — `0x6050b22E4EAF3f414d1155fBaF30B868E0107017`
  7. IFRLock — `0x0Cab0A9440643128540222acC6eF5028736675d3`
  8. PartnerVault — `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`
  9. FeeRouterV1 — `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4`
  10. LP Pair (IFR/WETH) — `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`
- **Token Allocation:** 40% DEX, 20% Reserve, 15% Team (vested), 15% Treasury, 6% Community & Grants, 4% Partner Ecosystem
- **FeeRouter:** protocolFeeBps=5 (0.05%), FEE_CAP_BPS=25 (0.25%), EIP-712 Voucher Discounts
- **Points System:** Off-chain (Express + Prisma + SQLite), SIWE Auth, kein Token, nur Protocol Fee Discount

## Pruefbereiche

### A) Zahlen-Konsistenz
Pruefe in ALLEN Dateien ob folgende Zahlen konsistent sind:
- "10 on-chain components" (nicht 9, nicht 8)
- "9 repo contracts" (nicht 8)
- "276 tests" (nicht 256, nicht 243)
- "9 test suites" (nicht 8, nicht 7)
- Token Allocation: 40/20/15/15/6/4 (summe = 100%)
- Contract-Adressen stimmen ueberall ueberein

### B) FeeRouter Parameter
Pruefe ob FeeRouter-Parameter korrekt dokumentiert sind:
- protocolFeeBps = 5 (0.05%) — nicht 50, nicht 0.5%
- FEE_CAP_BPS = 25 (0.25%) — hard cap
- Voucher discount: max 15 bps (aus Points Config)
- EIP-712 Domain: name="InfernoFeeRouter", version="1", chainId=11155111

### C) Points System Kommunikation
Pruefe ob klar kommuniziert wird:
- Punkte sind KEIN Token
- Nicht uebertragbar, kein Handelswert
- Nur Rabatt auf Protocol Fee
- Kein Versprechen auf zukuenftige Rewards
- Daily Limits dokumentiert

### D) Alle neuen Dokumente verlinkt?
Pruefe ob alle diese Dateien in README.md und/oder DOCS.md referenziert sind:
- docs/WHITEPAPER.md
- docs/SDK_QUICKSTART.md
- docs/TESTNET_GUIDE.md
- docs/CREATOR_GATEWAY.md
- docs/GOVERNANCE_CONSTITUTION.md
- docs/BUSINESS_ONBOARDING.md
- docs/PARTNER_INTEGRATION_SPEC.md
- docs/MAINNET_CHECKLIST.md
- docs/AUDIT_BRIEF.md
- docs/MULTISIG_SETUP.md

### E) Wiki Navigation
Pruefe ob:
- agent.html in der Sidebar aller Wiki-Seiten verlinkt ist
- AI Copilot Widget in allen Wiki-Seiten + Landing Page eingebettet ist
- Alle Wiki-Links funktionieren (keine toten Links)

### F) Keine alten Adressen
Pruefe ob folgende ALTE Adressen NIRGENDS mehr auftauchen:
- `0x6EF0...6A36f90` (alte PartnerVault v1)
- `0xA4A1ea...6A36f90` (alte Test-Adresse)
- Alle "9 contracts" / "243 tests" / "8 repo" Referenzen entfernt

### G) Apps-Sektion
Pruefe ob alle Apps korrekt dokumentiert sind:
- apps/dashboard/ — React Dashboard (Port 5173)
- apps/governance-dashboard/ — Governance Dashboard (Port 5174)
- apps/ai-copilot/ — AI Copilot (Port 5175/3003)
- apps/points-backend/ — Points Backend (Port 3004)
- apps/benefits-network/backend/ — Benefits Network Backend (Port 3001)
- apps/benefits-network/frontend/ — Benefits Network Frontend (Port 3000)

## Dateien zum Pruefen

Kopiere den Inhalt dieser Dateien in den Chat:
1. README.md
2. docs/DOCS.md
3. docs/DEPLOYMENTS.md
4. docs/index.html (nur die Stats-Section, Roadmap, FAQ, Trust Section)
5. docs/wiki/index.html (nur Quick Stats + Card Descriptions)
6. docs/wiki/security.html (nur Test Stats Callout)
7. docs/wiki/contracts.html (nur die Intro-Zeile mit Anzahl)

## Antwort-Format

Fuer JEDEN Pruefbereich (A-G):
```
## [Bereich]: [PASS/FAIL]
- Befund 1
- Befund 2
...
```

Am Ende:
```
## Gesamtergebnis: X/7 PASS
[Zusammenfassung der Findings]
```
