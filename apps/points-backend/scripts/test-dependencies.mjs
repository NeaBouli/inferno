import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const lock = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const expectedVersions = {
  'body-parser': '2.3.0',
  esbuild: '0.28.1',
  'path-to-regexp': '8.4.0',
  qs: '6.15.3',
};

for (const [name, expected] of Object.entries(expectedVersions)) {
  const installations = Object.entries(lock.packages)
    .filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`)
    .map(([path, metadata]) => ({ path, version: metadata.version }));

  assert.ok(installations.length > 0, `${name} must be present in the lockfile`);
  for (const installation of installations) {
    assert.equal(
      installation.version,
      expected,
      `${installation.path} resolves ${installation.version}; expected ${expected}`,
    );
  }
}

console.log('Points backend dependency baseline passed.');
