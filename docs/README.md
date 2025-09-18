# 🔥 Inferno – Projektüberblick

Inferno ist ein deflationärer Token mit Burn-Mechanismen und einem on-chain Buyback-System.
Ziel: Angebotsreduktion und langfristige Wertsteigerung.

## Status (Legende)
- 🟢 erledigt (Code + Tests abgeschlossen)
- 🔵 offen (Struktur vorhanden, aber noch nicht umgesetzt oder getestet)
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
    │   │   └── 🔵 scripts/deploy.js
    │   ├── 🔵 rust/{contracts,tests}
    │   ├── 🔵 cpp/{contracts,tests}
    │   └── 🔵 java/{contracts,tests}
    ├── 🔵 infra/{ci,docker}
    ├── 🟢 scripts/admin/*
    └── 🟢 Hardhat Setup (package.json, hardhat.config.js)

## Dokumentation
- Siehe [WHITEPAPER](WHITEPAPER.md).

## Nächste Schritte
1. Presale Contract + Tests
2. Vesting Contract + Tests
3. BuybackVault + Strategy + Tests
4. CI/Infra (GitHub Actions, Docker)
5. Multichain-Erweiterungen (Rust, C++, Java)
