const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const axios = require('axios');

const repoRoot = path.resolve(__dirname, '../../../..');
const botRoot = path.resolve(__dirname, '..');
const forbiddenAxiosVersions = new Set(['1.14.1', '0.30.4']);

function findDependencyFiles(directory, results = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      findDependencyFiles(entryPath, results);
    } else if (entry.name === 'package.json' || entry.name === 'package-lock.json') {
      results.push(entryPath);
    }
  }
  return results;
}

function parseVersion(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function isAtLeast(actual, required) {
  return compareVersions(actual, required) >= 0;
}

function rangeAllowsVersion(specification, candidate) {
  const normalized = specification.trim();
  if (/^\d+\.\d+\.\d+$/.test(normalized)) {
    return normalized === candidate;
  }

  const match = normalized.match(/^([~^])(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported Axios version specification: ${specification}`);
  }

  const [, operator, majorText, minorText, patchText] = match;
  const lower = `${majorText}.${minorText}.${patchText}`;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  let upper;

  if (operator === '~') {
    upper = `${major}.${minor + 1}.0`;
  } else if (major > 0) {
    upper = `${major + 1}.0.0`;
  } else if (minor > 0) {
    upper = `0.${minor + 1}.0`;
  } else {
    upper = `0.0.${patch + 1}`;
  }

  return compareVersions(candidate, lower) >= 0 && compareVersions(candidate, upper) < 0;
}

function findAxiosDeclarations(value, location = '$', results = []) {
  if (!value || typeof value !== 'object') return results;

  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (key === 'axios' && typeof child === 'string') {
      results.push({ location: childLocation, version: child });
    } else {
      findAxiosDeclarations(child, childLocation, results);
    }
  }
  return results;
}

test('forbidden Axios releases are absent from repository dependency files', () => {
  for (const dependencyFile of findDependencyFiles(repoRoot)) {
    const document = JSON.parse(fs.readFileSync(dependencyFile, 'utf8'));
    const rootPackage = dependencyFile.endsWith('package-lock.json')
      ? document.packages?.[''] || {}
      : document;
    const controlledDeclarations = {
      dependencies: rootPackage.dependencies,
      devDependencies: rootPackage.devDependencies,
      optionalDependencies: rootPackage.optionalDependencies,
      peerDependencies: rootPackage.peerDependencies,
      overrides: rootPackage.overrides || document.overrides,
    };

    for (const declaration of findAxiosDeclarations(controlledDeclarations)) {
      for (const forbiddenVersion of forbiddenAxiosVersions) {
        assert.equal(
          rangeAllowsVersion(declaration.version, forbiddenVersion),
          false,
          `${dependencyFile} permits forbidden axios@${forbiddenVersion} via ${declaration.version} at ${declaration.location}`
        );
      }
    }

    for (const packageNode of Object.values(document.packages || {})) {
      if (packageNode?.name === 'axios' || packageNode?.resolved?.includes('/axios-')) {
        assert.equal(
          forbiddenAxiosVersions.has(packageNode.version),
          false,
          `${dependencyFile} locks forbidden axios@${packageNode.version}`
        );
      }
    }
  }
});

test('Axios range policy detects the previously unsafe declaration', () => {
  assert.equal(rangeAllowsVersion('^1.6.7', '1.14.1'), true);
  assert.equal(rangeAllowsVersion('^1.18.1', '1.14.1'), false);
  assert.equal(rangeAllowsVersion('1.18.1', '1.14.1'), false);
});

test('Telegram bot locks the approved Axios dependency set', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8')
  );
  const lock = JSON.parse(
    fs.readFileSync(path.join(botRoot, 'package-lock.json'), 'utf8')
  );

  assert.equal(manifest.dependencies.axios, '1.18.1');
  assert.equal(lock.packages[''].dependencies.axios, '1.18.1');
  assert.equal(lock.packages['node_modules/axios'].version, '1.18.1');
  assert.equal(
    isAtLeast(lock.packages['node_modules/follow-redirects'].version, '1.16.0'),
    true
  );
  assert.equal(
    isAtLeast(lock.packages['node_modules/form-data'].version, '4.0.6'),
    true
  );
});

test('Axios GET and POST call shapes work without network access', async () => {
  const requests = [];
  const client = axios.create({
    adapter: async (config) => {
      requests.push(config);
      return {
        config,
        data: { ok: true },
        headers: {},
        status: 200,
        statusText: 'OK',
      };
    },
  });

  const getResponse = await client.get('https://example.invalid/supply', {
    timeout: 5000,
  });
  const postResponse = await client.post(
    'https://example.invalid/messages',
    { prompt: 'test' },
    { headers: { 'content-type': 'application/json' }, timeout: 10000 }
  );

  assert.equal(axios.VERSION, '1.18.1');
  assert.equal(getResponse.data.ok, true);
  assert.equal(postResponse.data.ok, true);
  assert.deepEqual(
    requests.map(({ method, timeout }) => ({ method, timeout })),
    [
      { method: 'get', timeout: 5000 },
      { method: 'post', timeout: 10000 },
    ]
  );
});
