# 🔥 Inferno – Projektüberblick

Inferno ist ein deflationärer Token mit Burn-Mechanismen und einem on-chain Buyback-System.
Ziel: Angebotsreduktion und langfristige Wertsteigerung.

## Status (Legende)
- 🟢 erledigt (Code + Tests abgeschlossen)
- 🔵 offen (Struktur vorhanden, aber noch nicht umgesetzt oder vollständig getestet)
- 🔴 Fehler/Debug

## Aktueller Statusbaum
    inferno
    ├── 🟢 docs/
    │   ├── 🟢 README.md
    │   ├── 🟢 WHITEPAPER.md
    │   └── 🟢 logs/project.log
    ├── 🔵 arch/{diagrams,decisions}
    ├── languages/
    │   ├── 🟢 solidity/
    │   │   ├── 🟢 contracts/InfernoToken.sol
    │   │   ├── 🟢 tests/InfernoToken.test.js
    │   │   ├── 🔵 contracts/Presale.sol      (Contract vorhanden, Deployment-Tests OK, weitere Tests offen)
    │   │   ├── 🔵 tests/Presale.test.js      (erste Deployment-Tests grün, restliche Tests offen)
    │   │   └── 🔵 scripts/deploy.js
    │   ├── 🔵 rust/{contracts,tests}
    │   ├── 🔵 cpp/{contracts,tests}
    │   └── 🔵 java/{contracts,tests}
    ├── 🔵 infra/{ci,docker}
    ├── 🟢 scripts/admin/*
    └── 🟢 Hardhat Setup (package.json, hardhat.config.js)

## Dokumentation
- Siehe [WHITEPAPER](WHITEPAPER.md).

## Letzte Aktionen
- Presale Contract (languages/solidity/contracts/Presale.sol) hinzugefügt und Deployment-Tests ausgeführt (siehe logs).
- Presale-Tests: Deployment-Checks bestehen (2/??). Weitere Presale-Tests (purchase, caps, refunds, reentrancy) noch offen.

