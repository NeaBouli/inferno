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

const frontendDockerfile = fs.readFileSync(
  path.join(root, 'apps', 'benefits-network', 'frontend', 'Dockerfile'),
  'utf8'
);
const productionCompose = fs.readFileSync(
  path.join(root, 'apps', 'benefits-network', 'docker-compose.production.example.yml'),
  'utf8'
);
const frontendBuildIndex = frontendDockerfile.indexOf('RUN npm run build');
const frontendServiceIndex = productionCompose.indexOf('  benefits-frontend:');
const frontendService = productionCompose.slice(frontendServiceIndex);
const frontendArgsIndex = frontendService.indexOf('      args:');
const frontendContainerIndex = frontendService.indexOf('    container_name:');
const frontendBuildArgs = frontendService.slice(frontendArgsIndex, frontendContainerIndex);
const publicBuildVariables = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_CHAIN_ID',
  'NEXT_PUBLIC_IFR_TOKEN_ADDRESS',
  'NEXT_PUBLIC_IFRLOCK_ADDRESS',
  'NEXT_PUBLIC_COMMITMENT_VAULT_ADDRESS',
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
];

for (const variable of publicBuildVariables) {
  const argIndex = frontendDockerfile.indexOf(`ARG ${variable}`);
  const envIndex = frontendDockerfile.indexOf(`ENV ${variable}=\${${variable}}`);
  assert.ok(argIndex >= 0 && argIndex < frontendBuildIndex, `${variable} must be a frontend Docker build argument`);
  assert.ok(
    envIndex >= 0 && envIndex < frontendBuildIndex,
    `${variable} must be available to the Next.js build before it runs`
  );
  assert.match(
    frontendBuildArgs,
    new RegExp(`^\\s{8}${variable}:`, 'm'),
    `production Compose must forward ${variable} as a build argument`
  );
}

assert.ok(
  productionCompose.includes('docker compose --env-file .env.benefits'),
  'production Compose example must state how build-argument interpolation receives its env values'
);
assert.ok(
  workflow.includes('--build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=ci-walletconnect-project-id'),
  'Benefits CI must build the frontend with a non-secret WalletConnect test identifier'
);
assert.ok(
  workflow.includes("grep -R -F 'ci-walletconnect-project-id' .next/static"),
  'Benefits CI must prove the WalletConnect identifier reached the browser bundle'
);

console.log('Benefits Node 22 runtime contract OK');
