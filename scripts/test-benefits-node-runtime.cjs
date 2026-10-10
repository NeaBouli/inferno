const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apps = ['frontend', 'backend'];

function assertFrontendLockProvenance(manifest, lock) {
  const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const owns = (value, key) => Object.hasOwn(value, key);
  const namePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const packagePathPattern = /^(?:node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*\/)*node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  const sourceFields = ['dependencies', 'devDependencies', 'optionalDependencies'];
  assert.equal(lock.lockfileVersion, 3, 'frontend provenance requires lockfileVersion 3');
  assert.ok(isMap(lock.packages) && isMap(lock.packages['']), 'frontend lock must contain its root');
  const packages = lock.packages;
  for (const field of ['name', 'version', 'engines', 'workspaces', ...sourceFields]) {
    assert.deepEqual(packages[''][field], manifest[field], `frontend manifest/root lock ${field} drift`);
  }

  const requests = new Map();
  const resolveRequest = (owner, name) => {
    let current = owner;
    for (;;) {
      const candidate = `${current ? `${current}/` : ''}node_modules/${name}`;
      if (owns(packages, candidate)) return candidate;
      if (!current) return null;
      current = path.posix.dirname(current);
      if (current === '.') current = '';
    }
  };
  for (const [owner, entry] of Object.entries(packages)) {
    assert.ok(isMap(entry), `frontend lock invalid record ${owner || '<root>'}`);
    for (const field of sourceFields) {
      if (!owns(entry, field)) continue;
      assert.ok(isMap(entry[field]), `frontend lock invalid ${owner || '<root>'}.${field}`);
      for (const [name, spec] of Object.entries(entry[field])) {
        assert.ok(namePattern.test(name) && typeof spec === 'string', `frontend invalid request ${owner}:${name}`);
        const target = resolveRequest(owner, name);
        if (!target) {
          const optionalRegistry = field === 'optionalDependencies' && !/[:/\\]/.test(spec);
          const unusedTransitiveDev = owner !== '' && field === 'devDependencies';
          assert.ok(optionalRegistry || unusedTransitiveDev, `frontend unresolved source ${owner || '<root>'}:${name}`);
          continue;
        }
        const incoming = requests.get(target) || [];
        incoming.push({ owner, name, spec });
        requests.set(target, incoming);
      }
    }
  }

  const aliases = (key, label, entry) => {
    const incoming = requests.get(key) || [];
    const overrides = manifest.overrides || {};
    assert.ok(isMap(overrides), `frontend invalid overrides for ${key}`);
    const effective = incoming.map(({ spec }) => {
      const override = overrides[label];
      if (typeof override !== 'string') return spec;
      if (!override.startsWith('$')) return override;
      const reference = override.slice(1);
      const values = sourceFields.flatMap((field) => owns(manifest[field] || {}, reference) ? [manifest[field][reference]] : []);
      assert.ok(values.length && values.every((value) => value === values[0]), `frontend ambiguous override reference ${key}`);
      return values[0];
    });
    assert.ok(!owns(entry, 'name') || typeof entry.name === 'string', `frontend invalid explicit identity ${key}`);
    const name = entry.name ?? label;
    assert.ok(typeof name === 'string' && namePattern.test(name), `frontend invalid identity ${key}`);
    const hasAlias = effective.some((spec) => spec.startsWith('npm:')) || name !== label;
    if (hasAlias) {
      assert.ok(!Object.entries(overrides).some(([selector, value]) => !namePattern.test(selector) || typeof value !== 'string'), `frontend unsupported alias override context ${key}`);
      assert.ok(effective.length && effective.every((spec) => spec === `npm:${name}@${entry.version}`), `frontend ambiguous or non-exact alias ${key} -> ${name}@${entry.version}`);
      assert.equal(entry.name, name, `frontend alias target must be explicit ${key}`);
    } else {
      assert.ok(effective.every((spec) => !/[:/\\]/.test(spec)), `frontend unsupported nonregistry source ${key}`);
    }
    return name;
  };

  const pinned = new Map();
  const assertPins = (key, entry, name) => {
    const context = `frontend lock ${key} (${name}@${entry.version})`;
    assert.ok(typeof entry.resolved === 'string' && entry.resolved.length, `${context}: missing resolved`);
    let url;
    try {
      url = new URL(entry.resolved);
    } catch {
      assert.fail(`${context}: invalid resolved URL`);
    }
    assert.ok(url.origin === 'https://registry.npmjs.org' && !url.username && !url.password && !url.search && !url.hash, `${context}: forbidden registry origin/credentials`);
    assert.equal(entry.resolved, `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${entry.version}.tgz`, `${context}: tarball identity/version mismatch`);
    assert.ok(typeof entry.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/.test(entry.integrity), `${context}: missing or malformed SHA-512 integrity`);
    const digest = Buffer.from(entry.integrity.slice(7), 'base64');
    assert.ok(digest.length === 64 && digest.toString('base64') === entry.integrity.slice(7), `${context}: noncanonical SHA-512 integrity`);
    const pair = `${name}@${entry.version}`;
    const pins = { resolved: entry.resolved, integrity: entry.integrity };
    if (pinned.has(pair)) assert.deepEqual(pins, pinned.get(pair), `${context}: duplicate-pair pin drift`);
    pinned.set(pair, pins);
  };

  const localTargets = new Set();
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || entry.link !== true) continue;
    assert.ok(packagePathPattern.test(key), `frontend invalid link installation path ${key}`);
    const label = key.split('node_modules/').at(-1);
    const target = entry.resolved;
    const incoming = requests.get(key) || [];
    assert.ok(typeof target === 'string' && target && path.posix.normalize(target) === target && !path.posix.isAbsolute(target) && !target.startsWith('../'), `frontend invalid link target ${key}`);
    assert.ok(owns(packages, target) && target !== key && packages[target].link !== true, `frontend missing/cyclic link target ${key}`);
    // Only exact in-root workspace membership proves a local-directory source here.
    assert.ok(Array.isArray(manifest.workspaces) && manifest.workspaces.includes(target) && !packagePathPattern.test(target), `frontend unsupported/unproven local link ${key}`);
    const local = packages[target];
    assert.equal(local.name, label, `frontend link target identity mismatch ${key}`);
    assert.ok(typeof local.version === 'string' && versionPattern.test(local.version), `frontend invalid local target version ${key}`);
    assert.ok(!owns(local, 'resolved') && !owns(local, 'integrity') && !local.inBundle && !local.bundled, `frontend contradictory/unpinned local target origin ${key}`);
    assert.ok(incoming.length && incoming.every(({ owner, spec }) => spec === `workspace:${local.version}` || spec === 'workspace:*' || spec === '*' || spec === local.version || (spec.startsWith('file:') && path.posix.normalize(path.posix.join(owner, spec.slice(5))) === target)), `frontend link source declaration mismatch ${key}`);
    assert.ok(!owns(manifest.overrides || {}, label), `frontend unsupported link override ${key}`);
    assert.ok(!Object.entries(manifest.overrides || {}).some(([selector, value]) => !namePattern.test(selector) || typeof value !== 'string'), `frontend unsupported link override context ${key}`);
    assert.ok(!owns(entry, 'integrity') && !entry.inBundle && !entry.bundled, `frontend contradictory link flags/pins ${key}`);
    localTargets.add(target);
  }

  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || localTargets.has(key) || entry.link === true) continue;
    assert.ok(packagePathPattern.test(key), `frontend unsupported local/workspace/git record ${key}`);
    assert.ok(!owns(entry, 'link') || typeof entry.link === 'boolean', `frontend invalid link flag ${key}`);
    assert.ok(!owns(entry, 'inBundle') || typeof entry.inBundle === 'boolean', `frontend invalid bundle flag ${key}`);
    assert.ok(!entry.bundled, `frontend unsupported bundled flag ${key}`);
    assert.ok(typeof entry.version === 'string' && versionPattern.test(entry.version), `frontend invalid registry version ${key}`);
    const label = key.split('node_modules/').at(-1);
    const name = aliases(key, label, entry);
    if (entry.inBundle === true) {
      const separator = key.lastIndexOf('/node_modules/');
      const parentKey = separator < 0 ? '' : key.slice(0, separator);
      const parent = packages[parentKey];
      const bundles = parent?.bundleDependencies ?? parent?.bundledDependencies;
      if (parent && owns(parent, 'bundleDependencies') && owns(parent, 'bundledDependencies')) {
        assert.deepEqual(parent.bundleDependencies, parent.bundledDependencies, `frontend contradictory bundle declarations ${key}`);
      }
      assert.ok(parentKey && parent && !parent.link && !parent.inBundle && Array.isArray(bundles) && bundles.includes(label), `frontend unproven bundled parent ${key}`);
      assert.ok(owns(parent.dependencies || {}, label) || owns(parent.optionalDependencies || {}, label), `frontend undeclared bundled dependency ${key}`);
      const parentName = aliases(parentKey, parentKey.split('node_modules/').at(-1), parent);
      assertPins(parentKey, parent, parentName);
      if (!owns(entry, 'resolved') && !owns(entry, 'integrity')) continue;
    }
    assertPins(key, entry, name);
  }
}

function assertFrontendLockFixtures() {
  // Real registry pins, synthetic lock topology; these fixtures never fetch or install.
  const fixturePins = {
    "ws": {
      "version": "8.21.0",
      "resolved": "https://registry.npmjs.org/ws/-/ws-8.21.0.tgz",
      "integrity": "sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g=="
    },
    "@alloc/quick-lru": {
      "version": "5.2.0",
      "resolved": "https://registry.npmjs.org/@alloc/quick-lru/-/quick-lru-5.2.0.tgz",
      "integrity": "sha512-UrcABB+4bUrFABwbluTIBErXwvbsU/V7TZWfmbgJfbkwiBuziS9gxdODUyuiecfdGQ85jglMW6juS3+z5TsKLw=="
    },
    "glob-parent": {
      "version": "5.1.2",
      "resolved": "https://registry.npmjs.org/glob-parent/-/glob-parent-5.1.2.tgz",
      "integrity": "sha512-AOIgSQCepiJYwP3ARnGx+5VnTu2HBYdzbGP45eLw1vr3zB3vZLeyed1sC9hnbcOc9/SrMyM5RPQrkGz4aS9Zow=="
    },
    "chokidar": {
      "version": "3.6.0",
      "resolved": "https://registry.npmjs.org/chokidar/-/chokidar-3.6.0.tgz",
      "integrity": "sha512-7VT13fmjotKpGipCW9JEQAusEPE+Ei8nl6/g4FBAmIm0GOOLMua9NDDo/DWp0ZAxCr3cPq5ZpBqmPAQgDda2Pw=="
    },
    "fast-glob": {
      "version": "3.3.3",
      "resolved": "https://registry.npmjs.org/fast-glob/-/fast-glob-3.3.3.tgz",
      "integrity": "sha512-7MptL8U0cqcFdzIzwOTHoilX9x5BrNqye7Z/LuC7kCMRio1EMSyqRK3BEAUD7sXRq4iT4AzTVuZdhgQ2TCvYLg=="
    }
  };
  const make = () => {
    const manifest = { name: 'provenance-fixture', version: '1.0.0', dependencies: { ws: '8.21.0' } };
    return { manifest, lock: { lockfileVersion: 3, packages: {
      '': structuredClone(manifest),
      'node_modules/ws': structuredClone(fixturePins.ws),
    } } };
  };
  const setDependencies = (fixture, dependencies) => {
    fixture.manifest.dependencies = dependencies;
    fixture.lock.packages[''].dependencies = structuredClone(dependencies);
  };
  const alias = (fixture) => {
    setDependencies(fixture, { socket: 'npm:ws@8.21.0' });
    fixture.lock.packages['node_modules/socket'] = { ...fixture.lock.packages['node_modules/ws'], name: 'ws' };
    delete fixture.lock.packages['node_modules/ws'];
  };
  const linked = (fixture) => {
    setDependencies(fixture, { ws: 'file:packages/ws' });
    fixture.manifest.workspaces = ['packages/ws'];
    fixture.lock.packages[''].workspaces = ['packages/ws'];
    fixture.lock.packages['node_modules/ws'] = { link: true, resolved: 'packages/ws' };
    fixture.lock.packages['packages/ws'] = { name: 'ws', version: '8.21.0' };
  };
  const bundled = (fixture) => {
    fixture.lock.packages['node_modules/ws'].dependencies = { '@alloc/quick-lru': '5.2.0' };
    fixture.lock.packages['node_modules/ws'].bundleDependencies = ['@alloc/quick-lru'];
    fixture.lock.packages['node_modules/ws/node_modules/@alloc/quick-lru'] = { version: '5.2.0', inBundle: true };
  };
  const duplicated = (fixture) => {
    setDependencies(fixture, { chokidar: '3.6.0', 'fast-glob': '3.3.3' });
    delete fixture.lock.packages['node_modules/ws'];
    for (const parent of ['chokidar', 'fast-glob']) {
      fixture.lock.packages['node_modules/' + parent] = {
        ...fixturePins[parent], dependencies: { 'glob-parent': '5.1.2' },
      };
      fixture.lock.packages['node_modules/' + parent + '/node_modules/glob-parent'] = { ...fixturePins['glob-parent'] };
    }
  };
  const cases = [
    ['registry/root', () => {}, false],
    ['omitted optional registry', (f) => {
      f.manifest.optionalDependencies = { omitted: '1.0.0' };
      f.lock.packages[''].optionalDependencies = { omitted: '1.0.0' };
    }, false],
    ['missing required source', (f) => { delete f.lock.packages['node_modules/ws']; }, true],
    ['unresolved optional nonregistry source', (f) => {
      f.manifest.optionalDependencies = { omitted: 'file:packages/omitted' };
      f.lock.packages[''].optionalDependencies = { omitted: 'file:packages/omitted' };
    }, true],
    ['scoped registry', (f) => {
      setDependencies(f, { '@alloc/quick-lru': '5.2.0' });
      delete f.lock.packages['node_modules/ws'];
      f.lock.packages['node_modules/@alloc/quick-lru'] = { ...fixturePins['@alloc/quick-lru'] };
    }, false],
    ['nested registry', (f) => {
      f.lock.packages['node_modules/ws'].dependencies = { ws: '8.21.0' };
      f.lock.packages['node_modules/ws/node_modules/ws'] = { ...fixturePins.ws };
    }, false],
    ['exact alias', alias, false],
    ['simple exact alias override', (f) => {
      alias(f);
      setDependencies(f, { socket: '8.21.0' });
      f.manifest.overrides = { socket: 'npm:ws@8.21.0' };
    }, false],
    ['proven workspace link', linked, false],
    ['proven pinned bundle', bundled, false],
    ['duplicate glob-parent paths', duplicated, false],
    ...['resolved', 'integrity'].flatMap((field) => [
      ['missing ' + field, (f) => { delete f.lock.packages['node_modules/ws'][field]; }, true],
      ['empty ' + field, (f) => { f.lock.packages['node_modules/ws'][field] = ''; }, true],
      ['null ' + field, (f) => { f.lock.packages['node_modules/ws'][field] = null; }, true],
    ]),
    ['both pins missing', (f) => {
      delete f.lock.packages['node_modules/ws'].resolved;
      delete f.lock.packages['node_modules/ws'].integrity;
    }, true],
    ['invalid URL', (f) => { f.lock.packages['node_modules/ws'].resolved = ':'; }, true],
    ['foreign origin', (f) => { f.lock.packages['node_modules/ws'].resolved = 'https://example.test/ws.tgz'; }, true],
    ['credential URL', (f) => { f.lock.packages['node_modules/ws'].resolved = 'https://user@registry.npmjs.org/ws/-/ws-8.21.0.tgz'; }, true],
    ['HTTP URL', (f) => { f.lock.packages['node_modules/ws'].resolved = fixturePins.ws.resolved.replace('https:', 'http:'); }, true],
    ['wrong tarball identity', (f) => { f.lock.packages['node_modules/ws'].resolved = fixturePins['glob-parent'].resolved; }, true],
    ['wrong tarball version', (f) => { f.lock.packages['node_modules/ws'].version = '8.20.0'; }, true],
    ['malformed SRI', (f) => { f.lock.packages['node_modules/ws'].integrity = 'sha512-invalid'; }, true],
    ['SHA-1 unsupported', (f) => { f.lock.packages['node_modules/ws'].integrity = 'sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA='; }, true],
    ['root-map drift', (f) => { f.lock.packages[''].dependencies.ws = '^8.0.0'; }, true],
    ['unproven identity', (f) => { f.lock.packages['node_modules/ws'].name = 'other'; }, true],
    ['null explicit identity', (f) => { f.lock.packages['node_modules/ws'].name = null; }, true],
    ['non-exact alias', (f) => { alias(f); setDependencies(f, { socket: 'npm:ws@^8.0.0' }); }, true],
    ['missing alias target name', (f) => { alias(f); delete f.lock.packages['node_modules/socket'].name; }, true],
    ['unsupported nested alias override', (f) => { alias(f); f.manifest.overrides = { parent: { socket: 'npm:ws@8.21.0' } }; }, true],
    ['unsupported version-qualified alias override', (f) => { alias(f); f.manifest.overrides = { 'socket@8.21.0': 'npm:ws@8.21.0' }; }, true],
    ['unsupported git source', (f) => { setDependencies(f, { ws: 'git+https://example.test/ws.git' }); }, true],
    ['unsupported file source', (f) => { setDependencies(f, { ws: 'file:packages/ws' }); }, true],
    ['forged link', (f) => { f.lock.packages['node_modules/ws'].link = true; }, true],
    ['missing link target', (f) => { linked(f); delete f.lock.packages['packages/ws']; }, true],
    ['unproven workspace membership', (f) => {
      linked(f); f.manifest.workspaces = ['packages/*']; f.lock.packages[''].workspaces = ['packages/*'];
    }, true],
    ['link source mismatch', (f) => { linked(f); setDependencies(f, { ws: 'file:packages/other' }); }, true],
    ['link target identity mismatch', (f) => { linked(f); f.lock.packages['packages/ws'].name = 'other'; }, true],
    ['unpinned/contradictory link target', (f) => {
      linked(f); f.lock.packages['packages/ws'].resolved = fixturePins.ws.resolved;
    }, true],
    ['cyclic link target', (f) => { linked(f); f.lock.packages['packages/ws'].link = true; }, true],
    ['forged inBundle', (f) => { f.lock.packages['node_modules/ws'].inBundle = true; }, true],
    ['undeclared bundle', (f) => { bundled(f); delete f.lock.packages['node_modules/ws'].bundleDependencies; }, true],
    ['unpinned bundle parent', (f) => { bundled(f); delete f.lock.packages['node_modules/ws'].integrity; }, true],
    ['contradictory bundle declarations', (f) => {
      bundled(f); f.lock.packages['node_modules/ws'].bundledDependencies = ['other'];
    }, true],
    ['partial bundled child pins', (f) => {
      bundled(f); f.lock.packages['node_modules/ws/node_modules/@alloc/quick-lru'].integrity = fixturePins['@alloc/quick-lru'].integrity;
    }, true],
    ['duplicate pin drift', (f) => {
      duplicated(f);
      f.lock.packages['node_modules/fast-glob/node_modules/glob-parent'].integrity = fixturePins.ws.integrity;
    }, true],
    ...['chokidar', 'fast-glob'].map((parent) => [
      'missing nested glob-parent pin under ' + parent,
      (f) => { duplicated(f); delete f.lock.packages['node_modules/' + parent + '/node_modules/glob-parent'].integrity; },
      true,
    ]),
    ...['dev', 'optional', 'peer', 'devOptional'].map((flag) => [
      flag + ' cannot waive pins',
      (f) => { f.lock.packages['node_modules/ws'][flag] = true; delete f.lock.packages['node_modules/ws'].integrity; },
      true,
    ]),
  ];
  for (const [name, edit, shouldFail] of cases) {
    const fixture = make();
    edit(fixture);
    const check = () => assertFrontendLockProvenance(fixture.manifest, fixture.lock);
    if (shouldFail) assert.throws(check, /frontend/, 'provenance fixture: ' + name);
    else assert.doesNotThrow(check, 'provenance fixture: ' + name);
  }
}

assert.equal(
  Number(process.versions.node.split('.')[0]),
  22,
  `Benefits runtime checks require Node 22, received ${process.version}`
);

assertFrontendLockFixtures();

for (const app of apps) {
  const appRoot = path.join(root, 'apps', 'benefits-network', app);
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(appRoot, 'package-lock.json'), 'utf8'));
  if (app === 'frontend') assertFrontendLockProvenance(manifest, lock);
  const dockerfile = fs.readFileSync(path.join(appRoot, 'Dockerfile'), 'utf8');
  const baseImages = [...dockerfile.matchAll(/^FROM\s+(node:[^\s]+).*$/gm)].map((match) => match[1]);

  // Backend needs 22.12+: the owner-B read-only scan relies on node:sqlite DatabaseSync readOnly.
  const expectedEngine = app === 'frontend' ? '>=22.6.0 <23' : '>=22.12 <23';
  assert.equal(manifest.engines?.node, expectedEngine, `${app} package engine drifted from Node 22`);
  assert.equal(manifest.devDependencies?.['@types/node'], '^22.0.0', `${app} Node types drifted`);
  assert.equal(lock.packages?.['']?.engines?.node, expectedEngine, `${app} lock engine drifted`);
  assert.match(lock.packages?.['node_modules/@types/node']?.version || '', /^22\./, `${app} lock has non-22 Node types`);
  assert.ok(baseImages.length >= 3, `${app} Dockerfile is missing expected build stages`);
  assert.ok(baseImages.every((image) => image === 'node:22-alpine'), `${app} Docker stages must all use node:22-alpine`);
}

const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'benefits-network.yml'), 'utf8');
const walletConnectCiProjectId = '0123456789abcdef0123456789abcdef';
const workflowNodeVersions = [...workflow.matchAll(/node-version:\s*['"]?(\d+)['"]?/g)].map((match) => match[1]);
const backendImageStep = workflow.slice(
  workflow.indexOf('- name: Build and verify Node 22 backend image'),
  workflow.indexOf('  test-frontend:')
);
assert.equal(workflowNodeVersions.length, 4, 'Benefits CI must define four explicit Node runtimes');
assert.ok(workflowNodeVersions.every((version) => version === '22'), 'Every Benefits CI job must use Node 22');
assert.equal((workflow.match(/docker run -d/g) || []).length, 2, 'Both Benefits runner images must start normally in CI');
assert.ok(workflow.includes('/api/ready'), 'Backend runner image must pass database readiness in CI');
assert.ok(
  backendImageStep.includes('-e SELLER_AUTH_DOMAIN=shop.example.test'),
  'Backend runner image must provide the production-required seller auth domain in CI'
);
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
  workflow.includes(`--build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${walletConnectCiProjectId}`),
  'Benefits CI must build the frontend with a syntactically valid non-secret WalletConnect test identifier'
);
assert.ok(
  workflow.includes(`grep -R -F '${walletConnectCiProjectId}' .next/static`),
  'Benefits CI must prove the WalletConnect identifier reached the browser bundle'
);

console.log('Benefits Node 22 runtime contract OK');
