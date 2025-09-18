#!/bin/bash
set -euo pipefail

# Änderungen aufnehmen
git add docs/README.md docs/logs/project.log

# Commit für README-Update
git commit -m "docs: README Statusbaum aktualisiert"

# Push nach GitHub
git push

# SHA & Log-Eintrag
sha="$(git rev-parse --short HEAD)"
ts="$(date '+%Y-%m-%d %H:%M')"
echo "$ts | ARCHITEKT | GIT | README-Update gepusht | Status: PUSHED | SHA: $sha" >> docs/logs/project.log

# Log committen & pushen
git add docs/logs/project.log
git commit -m "docs(log): Push für README-Update protokolliert ($sha)"
git push

echo "✅ README-Update erfolgreich nach GitHub gepusht. Commit: $sha"
