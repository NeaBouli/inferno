const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(appRoot, 'package-lock.json'), 'utf8'));

assert.equal(manifest.dependencies.express, '^4.22.2');
assert.equal(manifest.devDependencies.tsx, '^4.23.1');

const expectedVersions = {
  'node_modules/express': '4.22.2',
  'node_modules/body-parser': '1.20.6',
  'node_modules/qs': '6.15.3',
  'node_modules/path-to-regexp': '0.1.13',
  'node_modules/form-data': '4.0.6',
  'node_modules/js-yaml': '3.15.1',
  'node_modules/brace-expansion': '5.0.9',
  'node_modules/test-exclude/node_modules/brace-expansion': '1.1.18',
  'node_modules/picomatch': '2.3.2',
  'node_modules/jest-util/node_modules/picomatch': '4.0.5',
  'node_modules/@babel/core': '7.29.7',
  'node_modules/esbuild': '0.28.1',
};

for (const [packagePath, expectedVersion] of Object.entries(expectedVersions)) {
  assert.equal(
    lockfile.packages[packagePath]?.version,
    expectedVersion,
    `${packagePath} must resolve to ${expectedVersion}`
  );
}

const blockedAxiosVersions = new Set(['0.30.4', '1.14.1']);
for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
  if (
    (packagePath === 'node_modules/axios' || packagePath.endsWith('/node_modules/axios')) &&
    blockedAxiosVersions.has(metadata.version)
  ) {
    assert.fail(`${packagePath} resolves blocked axios ${metadata.version}`);
  }
}

console.log('[creator-gateway-dependencies] PASS');
