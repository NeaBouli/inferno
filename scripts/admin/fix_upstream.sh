#!/bin/bash
set -euo pipefail

# Upstream-Branch setzen und pushen
git push --set-upstream origin main

# SHA & Log-Eintrag
sha="$(git rev-parse --short HEAD)"
ts="$(date '+%Y-%m-%d %H:%M')"
echo "$ts | ARCHITEKT | GIT | Upstream für main gesetzt + Push ausgeführt | Status: PUSHED | SHA: $sha" >> docs/logs/project.log

# Log committen & pushen
git add docs/logs/project.log
git commit -m "docs(log): Upstream gesetzt + Push protokolliert ($sha)"
git push

echo "✅ Upstream erfolgreich gesetzt, Push abgeschlossen. Commit: $sha"
