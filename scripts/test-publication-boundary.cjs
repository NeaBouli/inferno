#!/usr/bin/env node
// Bounded publication-boundary check (structural, NOT a credential scanner).
//
// Scans the operations publication surfaces owned by the publication-separation
// task (deploy/ops clients, their runbooks/trackers and fixtures) for three
// generic structural classes:
//   1. personal-path      absolute paths inside a personal home directory
//   2. public-ipv4        IPv4 literals outside standards-reserved
//                         example/loopback/private/link-local/benchmark ranges
//   3. remote-default     a live shell `:-` default on a connection-scoped
//                         variable (host/root/volume/env-file/gate config)
// Intentional test fixtures and historical evidence are preserved through the
// explicit ALLOWLIST below; every entry must state a neutral reason, and an
// entry that matches nothing fails the run (no silent broad exclusions).
// Exact live-value comparison stays in the private evidence; this file must
// never contain real production hosts, IPs or deployment paths.
//
// Usage: node scripts/test-publication-boundary.cjs   (exit 1 on findings)
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Operations publication surfaces (the separation allowlist, its deploy/ops
// clients and the fixtures that exercise them). Extend only with the owning
// task; this is deliberately not a repo-wide scan.
const SURFACE_FILES = [
  'TODO.md',
  'STATUS-REPORT.md',
  'BACKLOG.md',
  'SKYWALKER.md',
  'docs/runbooks/SERVER_CAPACITY_RUNBOOK.md',
  'docs/BENEFITS_CAPACITY_RUNBOOK.md',
  'docs/DEPLOYMENTS.md',
  'docs/COMPOSE_SERVICE_RELEASE.md',
  'docs/WEB3_SITE_RELEASE.md',
  'docs/POINTS_BACKEND_MIGRATION.md',
  'docs/BENEFITS_MIGRATION_MODEL_B_PERIOD_DEDUP.md',
  'docs/CORE_DEVELOPER_HANDOVER.md',
  'docs/COPILOT_CHAT_RETIREMENT.md',
  'docs/RESTART_SNAPSHOT_2026-06-14.md',
  'docs/HANDOVER_07042026.md',
  'docs/HANDOVER_13042026.md',
  'docs/HANDOVER_19032026.md',
  'docs/HANDOVER_20032026.md',
  'internal/operations/TODO.md',
  'internal/operations/TODO.html',
  'scripts/deploy-benefits-network.sh',
  'scripts/deploy-compose-service.sh',
  'scripts/deploy-web3-site.sh',
  'scripts/deploy-gate-lib.sh',
  'scripts/audit-docker-capacity.sh',
  'scripts/ops/rotate-voucher-signer.sh',
  'scripts/ops/benefits-migration-model-b-period-dedup.sh',
  'scripts/ops/benefits-backend-volume-ownership.sh',
  'scripts/test-deploy-benefits-network.sh',
  'scripts/test-deploy-benefits-capacity.sh',
  'scripts/test-deploy-gate-client.sh',
  'scripts/test-deploy-compose-service.sh',
  'scripts/test-deploy-release-guards.sh',
  'scripts/test-rotate-voucher-signer.sh',
];

// Explicit, reasoned exceptions. {file, cls, match?, reason}; `match` narrows
// the entry to findings whose matched text contains it.
const ALLOWLIST = [
  {
    file: 'scripts/test-deploy-benefits-network.sh',
    cls: 'remote-default',
    reason: 'fixture models a generic host layout under a temp root; the fake ssh/rsync rewrite it; not a live pointer',
  },
  {
    file: 'scripts/test-deploy-compose-service.sh',
    cls: 'remote-default',
    reason: 'fixture models a generic host layout under a temp root; the fake ssh/rsync rewrite it; not a live pointer',
  },
  {
    file: 'scripts/test-deploy-release-guards.sh',
    cls: 'remote-default',
    reason: 'fixture models a generic host layout and neutral test aliases under a temp root; not a live pointer',
  },
];

// Connection-scoped variables that must never carry a live `:-` default on the
// publication surfaces (a derived default from another variable is allowed).
const CONNECTION_VARS = [
  'SSH_HOST',
  'REMOTE_HOST',
  'REMOTE_ROOT',
  'REMOTE_VOLUME',
  'REMOTE_COMPOSE_ENV_FILE',
  'DEPLOY_GATE_HOST',
  'DEPLOY_GATE_SSH_CONFIG',
  'MIGRATION_REPO',
  'MIGRATION_SOURCE_DIR',
  'MIGRATION_BACKUP_ROOT',
  'MIGRATION_COMPOSE_FILE',
  'MIGRATION_ENV_FILE',
  'MIGRATION_DB_FILE',
  'BACKUP_DIR',
  'BENEFITS_VOLUME_PATH',
];

const PLACEHOLDER_HOMES = new Set([
  'user', 'username', 'your-user', 'example', 'deploy', 'app', 'operator', 'test', 'node',
]);

function isReservedIpv4(ip) {
  const p = ip.split('.').map((x) => parseInt(x, 10));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a >= 224) return true; // "this" network, multicast, reserved, broadcast
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  // https://www.iana.org/assignments/iana-ipv4-special-registry
  // The protocol /24 has globally reachable anycast exceptions; TEST-NET-1
  // is the separate documentation /24. No other 192.0.* range is excluded.
  if (a === 192 && b === 0 && p[2] === 0) return p[3] !== 9 && p[3] !== 10;
  if (a === 192 && b === 0 && p[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && p[2] === 113) return true; // TEST-NET-3
  return false;
}

function findingsForLine(file, lineNo, line) {
  const out = [];
  // 1. personal absolute paths
  for (const re of [/\/Users\/([A-Za-z0-9._-]+)/g, /\/home\/([A-Za-z0-9._-]+)/g]) {
    let m;
    while ((m = re.exec(line)) !== null) {
      if (re.source.startsWith('\\/home') && PLACEHOLDER_HOMES.has(m[1])) continue;
      out.push({ file, line: lineNo, cls: 'personal-path', text: m[0] });
    }
  }
  // 2. actual-looking production IPv4
  const ipRe = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  let im;
  while ((im = ipRe.exec(line)) !== null) {
    if (!isReservedIpv4(im[0])) {
      out.push({ file, line: lineNo, cls: 'public-ipv4', text: im[0] });
    }
  }
  // 3. live remote default shapes: ${VAR:-literal} on connection-scoped vars;
  //    a default derived from another variable ($...) is allowed.
  const defRe = /\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g;
  let dm;
  while ((dm = defRe.exec(line)) !== null) {
    const [, varName, def] = dm;
    if (!CONNECTION_VARS.includes(varName)) continue;
    if (def === '' || def.startsWith('$')) continue; // required-empty or derived
    out.push({ file, line: lineNo, cls: 'remote-default', text: dm[0] });
  }
  return out;
}

function allowlisted(finding) {
  return ALLOWLIST.some(
    (entry) =>
      entry.file === finding.file &&
      entry.cls === finding.cls &&
      (entry.match === undefined || finding.text.includes(entry.match))
  );
}

function main() {
  const tracked = new Set(
    execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
  );
  const findings = [];
  const missing = [];
  for (const rel of SURFACE_FILES) {
    if (!tracked.has(rel)) {
      missing.push(rel);
      continue;
    }
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    content.split('\n').forEach((line, i) => {
      for (const f of findingsForLine(rel, i + 1, line)) {
        if (!allowlisted(f)) findings.push(f);
      }
    });
  }
  // Allowlist hygiene: every entry must still match at least one raw finding.
  const stale = ALLOWLIST.filter((entry) => {
    const abs = path.join(root, entry.file);
    if (!fs.existsSync(abs)) return true;
    const content = fs.readFileSync(abs, 'utf8');
    return !content
      .split('\n')
      .some((line, i) =>
        findingsForLine(entry.file, i + 1, line).some(
          (f) => f.cls === entry.cls && (entry.match === undefined || f.text.includes(entry.match))
        )
      );
  });

  let failed = false;
  for (const rel of missing) {
    console.error(`MISSING SURFACE: ${rel} is not tracked`);
    failed = true;
  }
  for (const f of findings) {
    console.error(`${f.file}:${f.line}: ${f.cls} (matched value suppressed)`);
    failed = true;
  }
  for (const entry of stale) {
    console.error(`STALE ALLOWLIST ENTRY: ${entry.file} ${entry.cls} (${entry.reason})`);
    failed = true;
  }
  if (failed) {
    console.error('\npublication boundary: FAIL (structural check; not a credential scan)');
    process.exit(1);
  }
  console.log(
    `publication boundary: PASS (${SURFACE_FILES.length} surfaces, classes: personal-path, public-ipv4, remote-default; structural check, not a credential scan)`
  );
}

main();
