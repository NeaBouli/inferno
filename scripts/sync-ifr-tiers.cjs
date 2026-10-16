#!/usr/bin/env node

// docs/specs is authoritative. Keep isolated app/package builds self-contained.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/specs/ifr-benefits-tiers.v1.json'));
const copies = [
  'apps/benefits-verify/tiers.v1.json',
  'apps/benefits-network/frontend/src/lib/ifr-tiers.v1.json',
];

for (const relative of copies) {
  const target = path.join(root, relative);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(target, source);
  } else if (!fs.existsSync(target) || !fs.readFileSync(target).equals(source)) {
    throw new Error(`${relative} differs from the canonical tier file; run node scripts/sync-ifr-tiers.cjs --write`);
  }
}
console.log(`[ifr-tiers] ${process.argv.includes('--write') ? 'synced' : 'checked'} ${copies.length} canonical tier copies`);
