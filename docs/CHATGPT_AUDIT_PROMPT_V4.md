# ChatGPT Independent Audit Prompt — V4

Stand: 26. Februar 2026 | 10 Contracts | 396 Tests | 91% Branch Coverage

## Anleitung

Kopiere diesen Prompt in ChatGPT (GPT-4o) und fuehre die 8 Self-Checks aus.
Jeder Check prueft einen spezifischen Aspekt des Projekts gegen die aktuelle Codebasis.

---

## Self-Check A: Anti-Sybil Middleware vorhanden

Pruefe ob im Points Backend (`apps/points-backend/src/middleware/`) folgende Dateien existieren:
1. `lockProof.ts` — On-Chain IFR Lock Verification (min 1000 IFR, Bronze tier)
2. `captcha.ts` — Cloudflare Turnstile Verification

**PASS-Kriterien:**
- `lockProof.ts` existiert und enthaelt `isLocked(wallet, minAmount)` Aufruf
- `captcha.ts` existiert und enthaelt Cloudflare Turnstile URL
- Fail-closed Pattern in lockProof (503 bei RPC-Fehler, nicht fail-open)
- Dev-Bypass in captcha nur wenn `CAPTCHA_SECRET` leer (nicht basierend auf NODE_ENV)

---

## Self-Check B: Creator Gateway SIWE Auth

Pruefe ob `apps/creator-gateway/src/routes/auth.ts` SIWE (Sign-In with Ethereum) implementiert:
1. `GET /auth/siwe/nonce` — Generiert Nonce mit 10-Minuten TTL
2. `POST /auth/siwe/verify` — Verifiziert SIWE Signatur, prueft Nonce + Chain ID, gibt JWT zurueck

**PASS-Kriterien:**
- `siwe` Package importiert (`SiweMessage`, `generateNonce`)
- Nonce Store mit TTL (nicht unbegrenzt)
- Chain ID Validierung gegen `CONFIG.chainId`
- JWT wird erst nach erfolgreicher Verifikation ausgestellt
- Legacy `/wallet` Endpoint bleibt fuer Backward Compatibility

---

## Self-Check C: PartnerVault Integration Tests

Pruefe ob `test/PartnerVault.test.js` einen `describe("Integration: full lifecycle")` Block enthaelt:

**PASS-Kriterien:**
- Mindestens 5 Integration-Tests vorhanden
- Full Lifecycle Test: create → activate → milestone → lockReward → vest → claim
- Multi-Partner Test mit unabhaengigen Vesting-Timelines
- Anti-Double-Count in Integration getestet
- authorizedCaller in Integration getestet
- Guardian Pause/Unpause in Integration getestet

---

## Self-Check D: Test-Zahlen Konsistenz

Pruefe ob folgende Zahlen in allen Docs konsistent sind:

| Metrik | Soll-Wert |
|--------|-----------|
| Contract Tests | 321 |
| Creator Gateway Tests | 32 |
| Points Backend Tests | 35 |
| Benefits Network Tests | 8 |
| Gesamt Tests | 396 |
| Branch Coverage | 91% |

**Dateien zu pruefen:**
- README.md
- STATUS-REPORT.md
- docs/PROJECT-SUMMARY.md
- docs/ONE-PAGER.md
- docs/PRESS_KIT.md
- docs/COVERAGE_REPORT.md
- docs/AUDIT_SUBMISSION.md
- docs/AUDIT_BRIEF.md
- docs/wiki/security.html
- docs/index.html

**PASS:** Keine veralteten Zahlen (276, 315, 330, 369) in den genannten Dateien.

---

## Self-Check E: AI Copilot Wiki RAG

Pruefe ob `apps/ai-copilot/server/wiki-rag.ts` existiert und:
1. Wiki-Dokumente laedt (HTML parsing)
2. Modus-spezifische System-Prompts generiert (Customer, Partner, Developer)
3. In `apps/ai-copilot/server/index.ts` eingebunden ist

**PASS-Kriterien:**
- Datei existiert unter `apps/ai-copilot/server/wiki-rag.ts`
- Mindestens 3 Modi definiert
- HTML-Parsing (cheerio oder regex)
- System-Prompt-Generierung exportiert

---

## Self-Check F: EIP-712 Voucher Validation Endpoint

Pruefe ob `apps/points-backend/src/routes/voucher.ts` einen GET `/validate/:nonce` Endpoint hat:

**PASS-Kriterien:**
- Route existiert und gibt Status + Ablaufdatum zurueck
- Nonce-basierte Abfrage (nicht Wallet-basiert)
- Unterscheidung: unused, redeemed, expired, unknown

---

## Self-Check G: Zahlen in CHANGELOG aktuell

Pruefe ob `docs/CHANGELOG.md` im [Unreleased] Abschnitt die aktuellen Zahlen enthaelt:

**PASS-Kriterien:**
- Contract Test Zaehler erwaehnt (276 → 321 oder 315 → 321)
- Gesamt-Tests erwaehnt (369 oder 396)
- Branch Coverage erwaehnt (91%)
- Neue Dateien aufgelistet (lockProof.ts, captcha.ts, siwe.test.ts)

---

## Self-Check H: Sepolia Deployment vollstaendig

Pruefe ob `docs/DEPLOYMENTS.md` und `README.md` alle 10 On-Chain Components listen:

**PASS-Kriterien:**
- 10 Adressen gelistet (InfernoToken, LiquidityReserve, Vesting, BuybackVault, BurnReserve, Governance, IFRLock, PartnerVault, FeeRouterV1, LP Pair)
- Alle verified auf Sepolia Etherscan
- Ownership an Governance transferiert erwaehnt

---

## Ergebnis-Template

| Check | Status | Kommentar |
|-------|--------|-----------|
| A) Anti-Sybil Middleware | ? | |
| B) Creator Gateway SIWE | ? | |
| C) PartnerVault Integration | ? | |
| D) Test-Zahlen Konsistenz | ? | |
| E) AI Copilot Wiki RAG | ? | |
| F) EIP-712 Voucher Validate | ? | |
| G) CHANGELOG aktuell | ? | |
| H) Sepolia Deployment | ? | |

**Gesamt:** ?/8 PASS
