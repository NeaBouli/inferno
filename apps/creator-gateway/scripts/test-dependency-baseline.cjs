const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(appRoot, 'package-lock.json'), 'utf8'));

assert.equal(manifest.dependencies.express, '4.22.3');
assert.equal(manifest.dependencies.googleapis, '178.1.1');
assert.equal(manifest.engines.node, '>=22');
assert.equal(Object.hasOwn(manifest.overrides, 'qs'), false, 'qs must resolve through supported parent ranges');
assert.equal(manifest.devDependencies.tsx, '^4.23.1');

const expectedVersions = {
  'node_modules/express': '4.22.3',
  'node_modules/body-parser': '1.20.9',
  'node_modules/qs': '6.16.2',
  'node_modules/path-to-regexp': '0.1.13',
  'node_modules/form-data': '4.0.6',
  'node_modules/proxy-addr': '2.0.8',
  'node_modules/esbuild': '0.28.1',
  'node_modules/vitest': '5.0.5',
  'node_modules/vite': '8.3.5',
  'node_modules/googleapis': '178.1.1',
  'node_modules/googleapis-common': '9.3.1',
  'node_modules/google-auth-library': '11.3.2',
  'node_modules/gaxios': '8.3.2',
  'node_modules/gcp-metadata': '9.2.3',
  'node_modules/google-logging-utils': '2.1.1',
};

assert.equal(lockfile.packages['node_modules/sprintf-js'], undefined, 'sprintf-js must not be installed');
// The supported runner replaces the entire Jest development chain, including its
// unpatched deepmerge dependency and the obsolete js-yaml override consumer.
const removedPackages = ['jest', 'jest-config', 'ts-jest', '@types/jest', 'deepmerge', 'js-yaml', 'test-exclude', '@babel/core'];
for (const packagePath of Object.keys(lockfile.packages)) {
  assert.equal(
    removedPackages.some(name => packagePath === `node_modules/${name}` || packagePath.endsWith(`/node_modules/${name}`)),
    false,
    `${packagePath} must not restore the removed Jest dependency chain`
  );
}

for (const [packagePath, expectedVersion] of Object.entries(expectedVersions)) {
  assert.equal(
    lockfile.packages[packagePath]?.version,
    expectedVersion,
    `${packagePath} must resolve to ${expectedVersion}`
  );
}

// The supported Google parent graph removes this entire former runtime branch.
const removedGooglePackages = ['rimraf', 'glob', 'minimatch', 'brace-expansion'];
for (const packagePath of Object.keys(lockfile.packages)) {
  assert.equal(
    removedGooglePackages.some(name => packagePath === `node_modules/${name}` || packagePath.endsWith(`/node_modules/${name}`)),
    false,
    `${packagePath} must not restore the removed Google filesystem traversal chain`
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
