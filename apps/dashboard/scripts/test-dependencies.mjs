import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const lock = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const minimumVersions = {
  axios: '1.18.0',
  uuid: '11.1.1',
};

function compareVersions(left, right) {
  const normalize = (value) => value.split('.').map((part) => Number.parseInt(part, 10));
  const leftParts = normalize(left);
  const rightParts = normalize(right);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  return 0;
}

for (const [name, minimum] of Object.entries(minimumVersions)) {
  const installations = Object.entries(lock.packages)
    .filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`)
    .map(([path, metadata]) => ({ path, version: metadata.version }));

  assert.ok(installations.length > 0, `${name} must be present in the lockfile`);
  for (const installation of installations) {
    assert.ok(
      compareVersions(installation.version, minimum) >= 0,
      `${installation.path} resolves ${installation.version}; expected at least ${minimum}`,
    );
  }
}

const websocketInstallations = Object.entries(lock.packages)
  .filter(([path]) => path.endsWith('/node_modules/ws') || path === 'node_modules/ws')
  .map(([path, metadata]) => ({ path, version: metadata.version }));

assert.ok(websocketInstallations.length > 0, 'ws must be present in the lockfile');
for (const installation of websocketInstallations) {
  const major = Number.parseInt(installation.version.split('.')[0], 10);
  assert.ok(
    major < 8 || compareVersions(installation.version, '8.21.0') >= 0,
    `${installation.path} resolves vulnerable ws ${installation.version}`,
  );
}

console.log('Dashboard dependency baseline passed.');
