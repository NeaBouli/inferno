const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apps = ['frontend', 'backend'];

assert.equal(
  Number(process.versions.node.split('.')[0]),
  22,
  `Benefits runtime checks require Node 22, received ${process.version}`
);

for (const app of apps) {
  const appRoot = path.join(root, 'apps', 'benefits-network', app);
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(appRoot, 'package-lock.json'), 'utf8'));
  const dockerfile = fs.readFileSync(path.join(appRoot, 'Dockerfile'), 'utf8');
  const baseImages = [...dockerfile.matchAll(/^FROM\s+(node:[^\s]+).*$/gm)].map((match) => match[1]);

  assert.equal(manifest.engines?.node, '>=22 <23', `${app} package engine drifted from Node 22`);
  assert.equal(manifest.devDependencies?.['@types/node'], '^22.0.0', `${app} Node types drifted`);
  assert.equal(lock.packages?.['']?.engines?.node, '>=22 <23', `${app} lock engine drifted`);
  assert.match(lock.packages?.['node_modules/@types/node']?.version || '', /^22\./, `${app} lock has non-22 Node types`);
  assert.ok(baseImages.length >= 3, `${app} Dockerfile is missing expected build stages`);
  assert.ok(baseImages.every((image) => image === 'node:22-alpine'), `${app} Docker stages must all use node:22-alpine`);
}

const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'benefits-network.yml'), 'utf8');
const workflowNodeVersions = [...workflow.matchAll(/node-version:\s*['"]?(\d+)['"]?/g)].map((match) => match[1]);
assert.equal(workflowNodeVersions.length, 4, 'Benefits CI must define four explicit Node runtimes');
assert.ok(workflowNodeVersions.every((version) => version === '22'), 'Every Benefits CI job must use Node 22');
assert.equal((workflow.match(/docker run -d/g) || []).length, 2, 'Both Benefits runner images must start normally in CI');
assert.ok(workflow.includes('/api/ready'), 'Backend runner image must pass database readiness in CI');
assert.equal((workflow.match(/docker exec \"\$container\" node --version/g) || []).length, 2, 'Both running images must report Node 22');

console.log('Benefits Node 22 runtime contract OK');
