#!/bin/bash
set -e

echo "🧹 Cleaning repo (artifacts, cache, node_modules, deployments)..."

# remove generated folders
rm -rf artifacts/
rm -rf cache/
rm -rf deployments/
rm -rf node_modules/

echo "📦 Reinstalling dependencies..."
npm install

echo "🛠 Running Hardhat clean + compile..."
npx hardhat clean
npx hardhat compile || {
  echo "❌ Hardhat compile failed"
  exit 1
}

echo "✅ Cleanup finished successfully!"

echo
echo "ℹ️ Tip: Run tests with"
echo "   npx hardhat test"
echo
