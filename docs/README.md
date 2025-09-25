# 📂 Inferno – Projektstatus & Struktur

## ✅ Legende
- 🟢 erledigt → Code + Tests abgeschlossen, stabil
- 🔵 offen → noch nicht implementiert oder in Arbeit
- 🔴 Fehler/Debug → Code implementiert, aber Tests fehlerhaft oder nie grün gelaufen
- 📘 dokumentarisch → nur Text, keine Implementierung

---

## 📌 Repository-Struktur

```
inferno
├── contracts/              (Smart Contracts)
│   ├── token/              🔵
│   ├── presale/            🟢
│   ├── vesting/            🟢
│   ├── burnreserve/        🔵
│   ├── buyback/            🔴 (implementiert, Tests fehlerhaft)
│   └── governance/         🔵
├── scripts/                📘 Utility & Deployment Scripts
├── abi/                    📘 Compiled ABIs
├── testing/                📘 QA & Unit Tests
├── arch/                   Architektur
│   ├── diagrams/           🔵
│   └── decisions/          📘
├── docs/                   📘 Whitepaper, Reports, Readmes
├── logs/                   📘 Project Log (Single Source of Truth)
├── infra/                  📘 CI/CD, Docker, K8s
├── apps/                   📘 Admin Console, Investor UI
├── backend/                📘 API & Services
├── indexer/                📘 Multichain Indexer
└── patches/                🔵 Applied Patches
```

---

## 📝 Status-Updates (Changelog)
- [2025-09-23] Presale Contract implementiert, getestet, dokumentiert → Presale 🟢
- [2025-09-23] Vesting Contract implementiert, getestet, dokumentiert → Vesting 🟢
- [2025-09-24] BuybackVault implementiert, Tests fehlerhaft → Buyback 🔴
- [2025-09-25] Root-README.md überschrieben (zweisprachig) → Dokumentation aktualisiert
- [2025-09-25] Baumdarstellung in docs/README.md final als fenced block gesetzt (Patch DocFix)
