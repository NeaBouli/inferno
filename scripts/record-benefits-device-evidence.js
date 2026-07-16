#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const checklistPath = process.env.BENEFITS_DEVICE_CHECKLIST_PATH
  ? path.resolve(process.env.BENEFITS_DEVICE_CHECKLIST_PATH)
  : path.join(repoRoot, 'docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json');
const validStatuses = new Set(['pass', 'fail', 'blocked', 'pending']);
const sensitivePatterns = [
  /private[_ -]?key/i,
  /seed phrase/i,
  /mnemonic/i,
  /\b0x[a-fA-F0-9]{64}\b/,
];

function usage() {
  console.error(`Usage:
  node scripts/record-benefits-device-evidence.js \\
    --id ios-safari-pwa \\
    --status pass \\
    --note "iPadOS Safari install guidance visible." \\
    [--screenshot-path /Users/gio/Desktop/example.png] \\
    [--business-id test-business-id] \\
    [--session-id test-session-id] \\
    [--date-time 2026-07-16T18:00:00Z]

Statuses: pass, fail, blocked, pending.
Never include private keys, seed phrases, mnemonics or full personal wallet inventories.`);
}

function fail(message) {
  console.error(`[benefits-device-record] FAIL: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`unexpected argument ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function assertSafe(value, label) {
  if (value === undefined) return;
  for (const pattern of sensitivePatterns) {
    if (pattern.test(value)) fail(`${label} appears to contain sensitive material: ${pattern}`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
  assertSafe(value, label);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const itemId = args.id;
  const status = args.status;
  const note = args.note;
  const dateTime = args['date-time'] || new Date().toISOString();
  const screenshotPath = args['screenshot-path'];
  const businessId = args['business-id'];
  const sessionId = args['session-id'];

  if (!itemId || !status || !note) {
    usage();
    fail('--id, --status and --note are required');
  }
  if (!validStatuses.has(status)) fail(`--status must be one of ${[...validStatuses].join(', ')}`);
  assertString(itemId, '--id');
  assertString(note, '--note');
  assertString(dateTime, '--date-time');
  if (screenshotPath !== undefined) assertString(screenshotPath, '--screenshot-path');
  if (businessId !== undefined) assertString(businessId, '--business-id');
  if (sessionId !== undefined) assertString(sessionId, '--session-id');

  const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
  const item = checklist.matrix.find((entry) => entry.id === itemId);
  if (!item) fail(`unknown checklist id: ${itemId}`);

  if (status === 'pending') {
    item.status = 'pending';
    item.evidence = [];
  } else {
    const evidence = {
      dateTime,
      result: status.toUpperCase(),
      note,
    };
    if (screenshotPath) evidence.screenshotPath = screenshotPath;
    if (businessId) evidence.businessId = businessId;
    if (sessionId) evidence.sessionId = sessionId;

    item.status = status;
    item.evidence = [...item.evidence, evidence];
  }

  checklist.lastUpdated = dateTime.slice(0, 10);
  if (checklist.matrix.every((entry) => entry.status === 'pass')) {
    checklist.status = 'complete';
  } else if (checklist.matrix.some((entry) => entry.status === 'blocked')) {
    checklist.status = 'blocked';
  } else {
    checklist.status = 'open';
  }

  fs.writeFileSync(checklistPath, `${JSON.stringify(checklist, null, 2)}\n`);

  const validation = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/validate-benefits-device-checklist.js')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: checklistPath },
  });
  if (validation.stdout) process.stdout.write(validation.stdout);
  if (validation.stderr) process.stderr.write(validation.stderr);
  if (validation.status !== 0) process.exit(validation.status || 1);

  console.log(`[benefits-device-record] ${status.toUpperCase()} evidence recorded for ${itemId}`);
}

main();
