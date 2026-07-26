#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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

try {
  assert.equal(validate(structuredClone(source)).status, 0, 'current device checklist must validate');

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

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'desktop-metamask-seller');
    item.capabilities = item.capabilities.filter((capability) => capability !== 'customer-pass-bind');
  }, 'missing required capability');

  expectFailure((checklist) => {
    checklist.completionGate = checklist.completionGate.map((item) => (
      item.includes('/p pass')
        ? 'A legacy seller-issued customer proof is redeemed.'
        : item
    ));
  }, 'primary /p pass');

  expectFailure((checklist) => {
    checklist.target = 'https://example.com';
  }, 'canonical');

  expectFailure((checklist) => {
    const item = checklist.matrix.find(({ id }) => id === 'ios-metamask-customer-proof');
    item.status = 'pass';
    item.evidence = ['legacy unstructured evidence'];
  }, 'structured recorder entry');

  console.log('[benefits-device-checklist-test] PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
