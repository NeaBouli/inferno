#!/bin/bash
set -euo pipefail

cat > docs/README.md <<'MD'
# 🔥 Inferno – Projektüberblick

Inferno ist ein deflationärer Token mit Burn-Mechanismen und einem on-chain Buyback-System.
Ziel: Angebotsreduktion und langfristige Wertsteigerung.

## Status (Legende)
- 🟢 erledigt
- 🔵 offen
- 🔴 Fehler/Debug

## Aktueller Statusbaum
    inferno
    ├── 🟢 docs/
    │   ├── 🟢 README.md
    │   ├── 🟢 WHITEPAPER.md
    │   └── 🟢 logs/project.log
    ├── 🟢 arch/{diagrams,decisions}
    ├── 🟢 languages/
    │   ├── 🟢 solidity/{contracts,tests,scripts}
    │   ├── 🟢 rust/{contracts,tests}
    │   ├── 🟢 cpp/{contracts,tests}
    │   └── 🟢 java/{contracts,tests}
    ├── 🟢 infra/{ci,docker}
    ├── 🟢 scripts/
    ├── 🟢 setup_structure.sh
    ├── 🟢 write_docs.sh
    └── 🟢 commit_push.sh

## Dokumentation
- Siehe [WHITEPAPER](WHITEPAPER.md).

## Nächste Schritte
1. Smart-Contract Boilerplate anlegen (Solidity)
2. Tests vorbereiten (Presale, Vesting, Buyback)
3. CI/Infra (GitHub Actions, Docker) einrichten
MD

ts="$(date '+%Y-%m-%d %H:%M')"
sha="$(git rev-parse --short HEAD)"
echo "$ts | ARCHITEKT | DOCS | README.md Statusbaum aktualisiert | Status: LOCAL | basiert auf Commit $sha" >> docs/logs/project.log

echo "✅ README.md aktualisiert, Statusbaum auf Stand gebracht."
