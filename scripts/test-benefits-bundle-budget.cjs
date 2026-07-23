const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const nextDir = path.join(root, 'apps/benefits-network/frontend/.next');
const buildIdPath = path.join(nextDir, 'BUILD_ID');
const manifestPath = path.join(nextDir, 'app-build-manifest.json');
const loadableManifestPath = path.join(nextDir, 'react-loadable-manifest.json');

assert.ok(fs.existsSync(buildIdPath), 'Benefits production build is missing; run the frontend build immediately before this gate');
assert.ok(fs.existsSync(manifestPath), 'Benefits production build is missing; run the frontend build first');
assert.ok(fs.existsSync(loadableManifestPath), 'Benefits dynamic-import manifest is missing');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const loadableManifest = JSON.parse(fs.readFileSync(loadableManifestPath, 'utf8'));
const initialFiles = manifest.pages?.['/page'];
assert.ok(Array.isArray(initialFiles) && initialFiles.length > 0, 'Benefits home route is missing from the app build manifest');

const initialPaths = initialFiles.map((file) => path.join(nextDir, file));
const initialGzipBytes = initialPaths.reduce(
  (total, file) => total + zlib.gzipSync(fs.readFileSync(file)).length,
  0
);
const routeBytes = initialPaths
  .filter((file) => /[/\\]static[/\\]chunks[/\\]app[/\\]page-[^/\\]+\.js$/.test(file))
  .reduce((total, file) => total + fs.statSync(file).size, 0);

const sellerEntry = Object.entries(loadableManifest).find(
  ([key]) => key.endsWith('-> @/components/SellerRuleBuilder')
);
assert.ok(sellerEntry, 'Seller workspace is missing from the Next dynamic-import manifest');
const sellerFiles = sellerEntry[1]?.files?.filter((file) => file.endsWith('.js')) || [];
assert.ok(sellerFiles.length > 0, 'Seller workspace dynamic import has no JavaScript chunk');
const initialSet = new Set(initialFiles);
assert.ok(
  sellerFiles.every((file) => !initialSet.has(file)),
  'Customer initial bundle contains the Seller workspace; preserve the role-scoped dynamic import'
);

for (const file of sellerFiles) {
  assert.ok(fs.existsSync(path.join(nextDir, file)), `Seller workspace chunk is missing: ${file}`);
}
assert.ok(routeBytes > 0, 'Benefits home route chunk could not be measured');
assert.ok(routeBytes <= 100_000, `Benefits home route chunk exceeds 100,000 bytes (${routeBytes})`);
assert.ok(
  initialGzipBytes <= 240_000,
  `Benefits home initial JavaScript exceeds the 240,000-byte gzip budget (${initialGzipBytes})`
);

console.log(
  `[benefits-bundle-budget] PASS initial-gzip=${initialGzipBytes} route=${routeBytes} seller-chunks=${sellerFiles.length}`
);
