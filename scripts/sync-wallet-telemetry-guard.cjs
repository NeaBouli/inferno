#!/usr/bin/env node

// Keep isolated Benefits builds self-contained; the reviewed Docs guard is canonical.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/assets/wallet-telemetry-guard.js'));
const copies = ['apps/benefits-network/frontend/src/lib/wallet-telemetry-guard.mjs'];

for (const relative of copies) {
  const target = path.join(root, relative);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(target, source);
  } else if (!fs.existsSync(target) || !fs.readFileSync(target).equals(source)) {
    throw new Error(`${relative} differs from the canonical guard; run node scripts/sync-wallet-telemetry-guard.cjs --write`);
  }
}
const hash = createHash('sha256').update(source).digest('hex');
console.log(`[wallet-telemetry-mirror] ${process.argv.includes('--write') ? 'synced' : 'checked'} ${copies.length} canonical guard copy sha256=${hash}`);
