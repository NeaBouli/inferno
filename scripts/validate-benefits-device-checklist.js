#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const checklistPath = process.env.BENEFITS_DEVICE_CHECKLIST_PATH
  ? path.resolve(process.env.BENEFITS_DEVICE_CHECKLIST_PATH)
  : path.join(repoRoot, 'docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json');
const validStatuses = new Set(['open', 'complete', 'blocked']);
const validItemStatuses = new Set(['pending', 'pass', 'fail', 'blocked']);
const requiredMatrixIds = [
  'ios-safari-pwa',
  'ios-metamask-customer-proof',
  'ios-coinbase-customer-proof',
  'android-chrome-pwa',
  'android-metamask-customer-proof',
  'android-trust-customer-proof',
  'android-okx-customer-proof',
  'phantom-evm-fallback',
  'desktop-metamask-seller',
  'approved-redeemed-eligible-wallet',
];
const suspiciousEvidencePatterns = [
  /private[_ -]?key/i,
  /seed phrase/i,
  /mnemonic/i,
  /\b0x[a-fA-F0-9]{64}\b/,
];

function fail(message) {
  throw new Error(message);
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
}

function assertArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
}

function assertNoSensitiveEvidence(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const pattern of suspiciousEvidencePatterns) {
    if (pattern.test(text)) fail(`${label} appears to contain sensitive material: ${pattern}`);
  }
}

function validateEvidence(item) {
  assertArray(item.evidence, `${item.id}.evidence`);
  if (item.status === 'pass' && item.evidence.length === 0) {
    fail(`${item.id} is pass but has no evidence`);
  }
  if ((item.status === 'fail' || item.status === 'blocked') && item.evidence.length === 0) {
    fail(`${item.id} is ${item.status} but has no evidence note`);
  }

  item.evidence.forEach((entry, index) => {
    const label = `${item.id}.evidence[${index}]`;
    if (typeof entry === 'string') {
      assertString(entry, label);
      assertNoSensitiveEvidence(entry, label);
      return;
    }

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${label} must be a string or object`);
    }

    assertString(entry.dateTime, `${label}.dateTime`);
    assertString(entry.result, `${label}.result`);
    assertString(entry.note, `${label}.note`);
    if (entry.screenshotPath !== undefined) assertString(entry.screenshotPath, `${label}.screenshotPath`);
    if (entry.businessId !== undefined) assertString(entry.businessId, `${label}.businessId`);
    if (entry.sessionId !== undefined) assertString(entry.sessionId, `${label}.sessionId`);
    assertNoSensitiveEvidence(entry, label);
  });
}

function validateChecklist(checklist) {
  assertString(checklist.name, 'name');
  assertString(checklist.target, 'target');
  if (!validStatuses.has(checklist.status)) {
    fail(`status must be one of ${[...validStatuses].join(', ')}`);
  }
  assertString(checklist.lastUpdated, 'lastUpdated');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checklist.lastUpdated)) {
    fail('lastUpdated must use YYYY-MM-DD');
  }

  if (!checklist.rules || typeof checklist.rules !== 'object') fail('rules must be an object');
  if (checklist.rules.noSecrets !== true) fail('rules.noSecrets must be true');
  if (checklist.rules.recordOnlyTestIds !== true) fail('rules.recordOnlyTestIds must be true');

  assertArray(checklist.knownBlockers, 'knownBlockers');
  checklist.knownBlockers.forEach((item, index) => {
    assertString(item, `knownBlockers[${index}]`);
    assertNoSensitiveEvidence(item, `knownBlockers[${index}]`);
  });

  assertArray(checklist.matrix, 'matrix');
  const ids = new Set();
  for (const item of checklist.matrix) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('matrix items must be objects');
    assertString(item.id, 'matrix[].id');
    if (ids.has(item.id)) fail(`duplicate matrix id: ${item.id}`);
    ids.add(item.id);
    assertString(item.device, `${item.id}.device`);
    assertString(item.surface, `${item.id}.surface`);
    assertString(item.wallet, `${item.id}.wallet`);
    assertString(item.path, `${item.id}.path`);
    if (!validItemStatuses.has(item.status)) {
      fail(`${item.id}.status must be one of ${[...validItemStatuses].join(', ')}`);
    }
    validateEvidence(item);
  }

  for (const requiredId of requiredMatrixIds) {
    if (!ids.has(requiredId)) fail(`missing required matrix id: ${requiredId}`);
  }

  assertArray(checklist.completionGate, 'completionGate');
  if (checklist.completionGate.length < 5) fail('completionGate must include all required acceptance gates');
  checklist.completionGate.forEach((item, index) => {
    assertString(item, `completionGate[${index}]`);
    assertNoSensitiveEvidence(item, `completionGate[${index}]`);
  });

  if (checklist.status === 'complete') {
    for (const item of checklist.matrix) {
      if (item.status !== 'pass') fail(`checklist is complete but ${item.id} is ${item.status}`);
    }
  }
}

function main() {
  const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
  validateChecklist(checklist);
  console.log(`[benefits-device-checklist] PASS ${path.relative(repoRoot, checklistPath)}`);
}

main();
