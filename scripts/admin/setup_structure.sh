#!/bin/bash
# Inferno Projektstruktur anlegen

# Dokumentation & Logs
mkdir -p docs/logs

# Architekturunterlagen
mkdir -p arch/diagrams arch/decisions

# Sprachsilos
mkdir -p languages/solidity/{contracts,tests,scripts}
mkdir -p languages/rust/{contracts,tests}
mkdir -p languages/cpp/{contracts,tests}
mkdir -p languages/java/{contracts,tests}

# Infrastruktur
mkdir -p infra/{ci,docker}

# Skripte
mkdir -p scripts

# Platzhalterdateien (.gitkeep) hinzufügen
find . -type d \( -name contracts -o -name tests -o -name scripts -o -name diagrams -o -name decisions -o -name ci -o -name docker -o -name logs \) -exec touch {}/.gitkeep \;

echo "✅ Struktur erstellt."
