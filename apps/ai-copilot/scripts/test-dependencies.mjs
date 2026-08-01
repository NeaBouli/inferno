import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const lock = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const esbuildInstallations = Object.entries(lock.packages)
  .filter(([path]) => path.endsWith('/node_modules/esbuild') || path === 'node_modules/esbuild')
  .map(([path, metadata]) => ({ path, version: metadata.version }));

assert.ok(esbuildInstallations.length > 0, 'esbuild must be present in the lockfile');
const compareVersions = (left, right) => {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  return 0;
};

for (const installation of esbuildInstallations) {
  const isVulnerable = compareVersions(installation.version, '0.27.3') >= 0
    && compareVersions(installation.version, '0.28.1') < 0;
  assert.equal(
    isVulnerable,
    false,
    `${installation.path} resolves vulnerable esbuild ${installation.version}`,
  );
}

console.log('AI Copilot dependency baseline passed.');
