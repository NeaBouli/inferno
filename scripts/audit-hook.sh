#!/bin/bash
# 🧾 Inferno Audit AutoCommit Hook
# Scans the /audit directory and updates /audit/summary.md automatically before commit.

AUDIT_DIR="audit"
SUMMARY_FILE="$AUDIT_DIR/summary.md"

echo "🧾  Checking audit directory for changes..."

if git diff --cached --name-only | grep -q "^$AUDIT_DIR/"; then
  echo "📋  Audit changes detected, regenerating summary..."
  {
    echo "# 🧾 Audit Summary"
    echo ""
    date "+_Last updated: %Y-%m-%d %H:%M:%S_"
    echo ""
    find "$AUDIT_DIR" -type f -name "*.md" ! -name "summary.md" | sort | while read -r file; do
      echo "- [$(basename "$file")]($(basename "$file"))"
    done
    echo ""
  } > "$SUMMARY_FILE"

  git add "$SUMMARY_FILE"
  echo "✅  Audit summary updated and staged."
else
  echo "ℹ️  No audit changes detected."
fi
