import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor/rainbowkit-compat');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const manifest = await json(path.join(root, 'package.json'));
const lock = await json(path.join(root, 'package-lock.json'));
const provenance = await json(path.join(vendor, 'provenance.json'));
const payloads = await json(path.join(vendor, 'payload-hashes.json'));
const expectedFile = 'file:vendor/rainbowkit-compat/ifr-rainbowkit-compat-2.2.11-ifr.1.tgz';

assert.equal(manifest.dependencies['@rainbow-me/rainbowkit'], expectedFile);
assert.deepEqual(manifest.overrides, {
  axios: '1.20.0',
  'query-string': '9.5.1',
  uuid: '11.1.1',
  'ws@>=8': '8.21.0',
});
const record = lock.packages['node_modules/@rainbow-me/rainbowkit'];
assert.equal(record.name, '@ifr/rainbowkit-compat');
assert.equal(record.version, '2.2.11-ifr.1');
assert.equal(record.resolved, expectedFile);
assert.equal(record.integrity, provenance.owned.integrity);

const entry = import.meta.resolve('@rainbow-me/rainbowkit');
const installed = fileURLToPath(new URL('../', entry));
const ownedPackage = await json(path.join(installed, 'package.json'));
assert.equal(ownedPackage.name, provenance.owned.name);
assert.equal(ownedPackage.dependencies['@vanilla-extract/css'], '1.21.3');
for (const [member, expected] of Object.entries(payloads)) {
  assert.ok(member.startsWith('package/') && !member.split('/').includes('..'));
  const location = path.join(installed, member.slice('package/'.length));
  const bytes = await readFile(location);
  assert.equal(bytes.length, expected.bytes, member);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.owned_sha256, member);
  assert.equal((await stat(location)).mode & 0o777, Number(expected.mode), member + ' mode');
}
assert.equal(Object.keys(payloads).length, 971);
for (const [field, expected] of Object.entries(provenance.preserved_metadata)) {
  assert.deepEqual(ownedPackage[field], expected, field);
}

const resolutions = {};
for (const name of [
  '@rainbow-me/rainbowkit',
  '@rainbow-me/rainbowkit/styles.css',
  '@rainbow-me/rainbowkit/wallets',
  '@rainbow-me/rainbowkit/components',
]) {
  resolutions[name] = import.meta.resolve(name);
  assert.ok(fileURLToPath(resolutions[name]).startsWith(installed), name);
  await readFile(fileURLToPath(resolutions[name]));
}
const applicationRequire = createRequire(new URL('../package.json', import.meta.url));
const ownedRequire = createRequire(entry);
for (const peer of ['react', 'react-dom', 'wagmi', 'viem', '@tanstack/react-query']) {
  assert.equal(
    await realpath(ownedRequire.resolve(peer)),
    await realpath(applicationRequire.resolve(peer)),
    'peer must resolve to the same application instance: ' + peer,
  );
}

async function installedPackages(directory) {
  const packages = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    assert.equal(item.isSymbolicLink(), false,
      'unexpected linked package could evade the all-copies inventory: ' + item.name);
    if (!item.isDirectory()) continue;
    if (item.name.startsWith('@')) {
      packages.push(...await installedPackages(path.join(directory, item.name)));
      continue;
    }
    const location = path.join(directory, item.name);
    try {
      const metadata = await json(path.join(location, 'package.json'));
      packages.push({ path: path.relative(root, location), ...metadata });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      packages.push(...await installedPackages(path.join(location, 'node_modules')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return packages;
}

const physical = await installedPackages(path.join(root, 'node_modules'));
const lockedDeepmerge = Object.entries(lock.packages)
  .filter(([name, metadata]) => name.endsWith('/deepmerge') || metadata.name === 'deepmerge')
  .map(([name]) => name);
const installedDeepmerge = physical.filter((item) => item.name === 'deepmerge');
assert.deepEqual(lockedDeepmerge, []);
assert.deepEqual(installedDeepmerge, []);
const decoders = physical.filter((item) => item.name === 'decode-uri-component');
assert.ok(decoders.length > 0);
assert.ok(decoders.every((item) => item.version === '0.5.1'));
assert.equal(lock.packages['node_modules/vite'].version, '6.4.5');
const zod = physical.filter((item) => item.name === 'zod')
  .map(({ path: location, version }) => ({ path: location, version }));
assert.ok(zod.some((item) => item.version.startsWith('3.')), 'retained Zod context must stay visible');

console.log(JSON.stringify({
  result: 'PASS',
  ownedName: ownedPackage.name,
  importKey: '@rainbow-me/rainbowkit',
  payloadsVerified: Object.keys(payloads).length,
  lockedDeepmerge,
  installedDeepmerge,
  decoders: decoders.map(({ path: location, version }) => ({ path: location, version })),
  vite: lock.packages['node_modules/vite'].version,
  zodRemaining: zod,
  resolutions,
  existingOverridesUnchanged: true,
  auditZeroClaim: false,
}, null, 2));
