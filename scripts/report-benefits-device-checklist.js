#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const checklistPath = process.env.BENEFITS_DEVICE_CHECKLIST_PATH
  ? path.resolve(process.env.BENEFITS_DEVICE_CHECKLIST_PATH)
  : path.join(repoRoot, 'docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json');

function runValidator() {
  const validation = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/validate-benefits-device-checklist.js')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, BENEFITS_DEVICE_CHECKLIST_PATH: checklistPath },
  });
  if (validation.stdout) process.stdout.write(validation.stdout);
  if (validation.stderr) process.stderr.write(validation.stderr);
  if (validation.status !== 0) process.exit(validation.status || 1);
}

function statusIcon(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'fail') return 'FAIL';
  if (status === 'blocked') return 'BLOCKED';
  return 'PENDING';
}

function latestEvidence(item) {
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) return 'no evidence yet';
  const entry = item.evidence[item.evidence.length - 1];
  if (typeof entry === 'string') return entry;
  const pieces = [entry.result, entry.dateTime, entry.note].filter(Boolean);
  if (entry.businessId) pieces.push(`business=${entry.businessId}`);
  if (entry.sessionId) pieces.push(`session=${entry.sessionId}`);
  if (entry.screenshotPath) pieces.push(`screenshot=${entry.screenshotPath}`);
  return pieces.join(' | ');
}

function printReport(checklist) {
  const counts = checklist.matrix.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { pass: 0, fail: 0, blocked: 0, pending: 0 }
  );
  const total = checklist.matrix.length;
  const done = counts.pass || 0;
  const open = total - done;

  console.log('');
  console.log('IFR Benefits Network Device Wallet Acceptance Report');
  console.log(`Target: ${checklist.target}`);
  console.log(`Status: ${checklist.status}`);
  console.log(`Last updated: ${checklist.lastUpdated}`);
  console.log(`Progress: ${done}/${total} passed, ${open} open`);
  console.log(`Breakdown: pass=${counts.pass || 0}, fail=${counts.fail || 0}, blocked=${counts.blocked || 0}, pending=${counts.pending || 0}`);
  console.log('');

  console.log('Known blockers:');
  checklist.knownBlockers.forEach((item) => console.log(`- ${item}`));
  console.log('');

  console.log('Matrix:');
  checklist.matrix.forEach((item) => {
    console.log(`- ${statusIcon(item.status)} ${item.id}`);
    console.log(`  ${item.device} / ${item.surface} / ${item.wallet}`);
    console.log(`  Path: ${item.path}`);
    console.log(`  Evidence: ${latestEvidence(item)}`);
  });
  console.log('');

  console.log('Completion gates:');
  checklist.completionGate.forEach((item) => console.log(`- ${item}`));
  console.log('');

  if (checklist.status !== 'complete') {
    const remaining = checklist.matrix
      .filter((item) => item.status !== 'pass')
      .map((item) => item.id)
      .join(', ');
    console.log(`Still open: ${remaining || 'none'}`);
  }
}

function main() {
  runValidator();
  const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
  printReport(checklist);
}

main();
