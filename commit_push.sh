#!/bin/bash
set -euo pipefail

git add .
git commit -m "chore(docs): bootstrap Struktur + README/WHITEPAPER + Logs"
git branch -M main
git push -u origin main

sha="$(git rev-parse --short HEAD)"
ts="$(date '+%Y-%m-%d %H:%M')"
echo "$ts | ARCHITEKT | GIT | Initial Commit + Push | Status: PUSHED | SHA: $sha" >> docs/logs/project.log

git add docs/logs/project.log
git commit -m "docs(log): Push protokolliert ($sha)"
git push

echo "✅ Push abgeschlossen. Commit: $sha"
