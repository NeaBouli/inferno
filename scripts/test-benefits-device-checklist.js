#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const validator = path.join(root, 'scripts/validate-benefits-device-checklist.js');
const recorder = path.join(root, 'scripts/record-benefits-device-evidence.js');
const source = JSON.parse(fs.readFileSync(
  path.join(root, 'docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json'),
  'utf8',
));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-device-checklist-'));

function validate(checklist) {
  const checklistPath = path.join(tempDir, 'checklist.json');
  fs.writeFileSync(checklistPath, `${JSON.stringify(checklist, null, 2)}\n`);
  return spawnSync(process.execPath, [validator], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: checklistPath },
  });
}

function expectFailure(mutator, message) {
  const checklist = structuredClone(source);
  mutator(checklist);
  const result = validate(checklist);
  assert.notEqual(result.status, 0, `validator accepted invalid checklist: ${message}`);
  assert.match(`${result.stdout}${result.stderr}`, new RegExp(message, 'i'));
}

function evidence(result, evidenceSource = 'physical-device') {
  return {
    dateTime: '2026-08-05T12:00:00Z',
    result,
    evidenceSource,
    note: 'Test-only acceptance evidence.',
  };
}

function recordAsync(checklistPath, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [recorder, ...args], {
      cwd: root,
      env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: checklistPath },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function main() {
  try {
  assert.equal(validate(structuredClone(source)).status, 0, 'current device checklist must validate');

  // Static regression: the retired /api/verification routes must not return in
  // the backend wiring, the local E2E wrapper or the test guide.
  for (const relativePath of [
    'apps/benefits-network/backend/src/index.ts',
    'apps/benefits-network/backend/scripts/e2e-test.sh',
    'docs/BENEFITS_NETWORK_TEST.md',
  ]) {
    const fileContent = fs.readFileSync(path.join(root, relativePath), 'utf8');
    for (const removedRoute of ['/api/verification/start', '/api/verification/status']) {
      assert.ok(
        !fileContent.includes(removedRoute),
        `removed route ${removedRoute} referenced in ${relativePath}`,
      );
    }
  }
  const backendIndex = fs.readFileSync(
    path.join(root, 'apps/benefits-network/backend/src/index.ts'),
    'utf8',
  );
  assert.ok(
    !backendIndex.includes('/api/verification'),
    'backend must not mount removed /api/verification routes',
  );

  const historicalEvidencePath = path.join(tempDir, 'historical-evidence.json');
  fs.writeFileSync(historicalEvidencePath, `${JSON.stringify(source, null, 2)}\n`);
  const historicalEvidence = spawnSync(process.execPath, [
    recorder,
    '--id', 'ios-safari-pwa',
    '--status', 'pending',
    '--note', 'Historical evidence import remains pending.',
    '--date-time', '2026-07-01T12:00:00Z',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: historicalEvidencePath },
  });
  assert.equal(historicalEvidence.status, 0, historicalEvidence.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(historicalEvidencePath, 'utf8')).lastUpdated,
    source.lastUpdated,
    'historical evidence must not move lastUpdated backwards',
  );

  const invalidDateBefore = fs.readFileSync(historicalEvidencePath, 'utf8');
  const invalidDateEvidence = spawnSync(process.execPath, [
    recorder,
    '--id', 'ios-safari-pwa',
    '--status', 'pending',
    '--note', 'Invalid date must fail before write.',
    '--date-time', 'not-an-iso-timestamp',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: historicalEvidencePath },
  });
  assert.notEqual(invalidDateEvidence.status, 0, 'invalid evidence date must fail');
  assert.match(invalidDateEvidence.stderr, /valid ISO-8601 timestamp/);
  assert.equal(
    fs.readFileSync(historicalEvidencePath, 'utf8'),
    invalidDateBefore,
    'invalid evidence date must not mutate the checklist',
  );

  const missingSourceBefore = fs.readFileSync(historicalEvidencePath, 'utf8');
  const missingSourceEvidence = spawnSync(process.execPath, [
    recorder,
    '--id', 'ios-safari-pwa',
    '--status', 'pass',
    '--note', 'A pass without a physical source must fail.',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: historicalEvidencePath },
  });
  assert.notEqual(missingSourceEvidence.status, 0, 'pass evidence without source must fail');
  assert.match(missingSourceEvidence.stderr, /source.*non-pending/i);
  assert.equal(
    fs.readFileSync(historicalEvidencePath, 'utf8'),
    missingSourceBefore,
    'missing evidence source must not mutate the checklist',
  );

  const physicalEvidence = spawnSync(process.execPath, [
    recorder,
    '--id', 'ios-safari-pwa',
    '--status', 'pass',
    '--source', 'physical-device',
    '--note', 'Physical test-only acceptance evidence.',
    '--date-time', '2026-08-05T12:00:00Z',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: historicalEvidencePath },
  });
  assert.equal(physicalEvidence.status, 0, physicalEvidence.stderr);
  const recorded = JSON.parse(fs.readFileSync(historicalEvidencePath, 'utf8'));
  assert.equal(recorded.matrix[0].status, 'pass');
  assert.equal(recorded.matrix[0].evidence[0].evidenceSource, 'physical-device');
  assert.equal(recorded.status, 'open');

  const invalidExistingPath = path.join(tempDir, 'invalid-existing.json');
  const invalidExisting = structuredClone(source);
  const invalidExistingItem = invalidExisting.matrix.find(({ id }) => id === 'desktop-metamask-seller');
  invalidExistingItem.status = 'blocked';
  invalidExistingItem.evidence = ['legacy evidence without a source'];
  invalidExisting.status = 'blocked';
  fs.writeFileSync(invalidExistingPath, `${JSON.stringify(invalidExisting, null, 2)}\n`);
  const invalidExistingBefore = fs.readFileSync(invalidExistingPath, 'utf8');
  const invalidExistingRecord = spawnSync(process.execPath, [
    recorder,
    '--id', 'ios-safari-pwa',
    '--status', 'pass',
    '--source', 'physical-device',
    '--note', 'A pre-invalid checklist must remain unchanged.',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: invalidExistingPath },
  });
  assert.notEqual(invalidExistingRecord.status, 0, 'pre-invalid checklist must fail validation');
  assert.equal(
    fs.readFileSync(invalidExistingPath, 'utf8'),
    invalidExistingBefore,
    'failed post-mutation validation must not alter the original checklist',
  );

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'desktop-metamask-seller');
    item.capabilities = item.capabilities.filter((capability) => capability !== 'customer-pass-bind');
  }, 'missing required capability');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'desktop-metamask-seller');
    item.capabilities = item.capabilities.filter((capability) => capability !== 'wallet-disconnect');
  }, 'missing required capability');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-metamask-customer-proof');
    item.capabilities = item.capabilities.filter((capability) => capability !== 'reload-reconnect');
  }, 'missing required capability');

  expectFailure((checklist) => {
    checklist.completionGate = checklist.completionGate.map((item) => (
      item.includes('/p pass')
        ? 'A legacy seller-issued customer proof is redeemed.'
        : item
    ));
  }, 'primary /p pass');

  for (const phrase of [
    'iOS/iPadOS wallet-browser customer proof',
    'Android wallet-browser customer proof',
    'desktop injected seller wallet',
    'rejected or ineligible customer proof',
  ]) {
    expectFailure((checklist) => {
      checklist.completionGate = checklist.completionGate.map((item) => (
        item.includes(phrase) ? 'A different acceptance condition passes.' : item
      ));
    }, phrase);
  }

  expectFailure((checklist) => {
    checklist.target = 'https://example.com';
  }, 'canonical');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-metamask-customer-proof');
    item.status = 'pass';
    item.evidence = ['legacy unstructured evidence'];
  }, 'structured recorder entry');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-metamask-customer-proof');
    item.status = 'pass';
    item.evidence = [evidence('PASS', 'automated')];
  }, 'physical-device evidence');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-safari-pwa');
    item.evidence = [evidence('PASS')];
  }, 'pending but still has evidence');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-safari-pwa');
    item.status = 'blocked';
    item.evidence = [{ ...evidence('BLOCKED', 'automated'), dateTime: 'not-an-iso-date' }];
    checklist.status = 'blocked';
  }, 'valid ISO-8601 timestamp');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-safari-pwa');
    item.status = 'blocked';
    item.evidence = [{ ...evidence('BLOCKED', 'automated'), note: 'seed phrase captured' }];
    checklist.status = 'blocked';
  }, 'sensitive material');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-safari-pwa');
    item.status = 'blocked';
    item.evidence = [evidence('BLOCKED', 'automated')];
  }, 'status must be blocked');

  expectFailure((checklist) => {
    checklist.matrix.forEach((item) => {
      item.status = 'pass';
      item.evidence = [evidence('PASS')];
    });
  }, 'status must be complete');

  const concurrentPath = path.join(tempDir, 'concurrent-evidence.json');
  fs.writeFileSync(concurrentPath, `${JSON.stringify(source, null, 2)}\n`);
  const [iosRecord, androidRecord] = await Promise.all([
    recordAsync(concurrentPath, [
      '--id', 'ios-safari-pwa',
      '--status', 'blocked',
      '--source', 'automated',
      '--note', 'Concurrent iOS test evidence.',
      '--date-time', '2026-08-06T12:00:00Z',
    ]),
    recordAsync(concurrentPath, [
      '--id', 'android-chrome-pwa',
      '--status', 'blocked',
      '--source', 'automated',
      '--note', 'Concurrent Android test evidence.',
      '--date-time', '2026-08-06T12:00:01Z',
    ]),
  ]);
  assert.equal(iosRecord.status, 0, iosRecord.stderr);
  assert.equal(androidRecord.status, 0, androidRecord.stderr);
  const concurrentChecklist = JSON.parse(fs.readFileSync(concurrentPath, 'utf8'));
  const iosItem = concurrentChecklist.matrix.find(({ id }) => id === 'ios-safari-pwa');
  const androidItem = concurrentChecklist.matrix.find(({ id }) => id === 'android-chrome-pwa');
  assert.equal(iosItem.evidence.at(-1).note, 'Concurrent iOS test evidence.');
  assert.equal(androidItem.evidence.at(-1).note, 'Concurrent Android test evidence.');
  assert.equal(concurrentChecklist.status, 'blocked');

  console.log('[benefits-device-checklist-test] PASS');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[benefits-device-checklist-test] FAIL: ${error.message}`);
  process.exit(1);
});
