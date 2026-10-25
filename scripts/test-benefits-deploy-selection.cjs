#!/usr/bin/env node
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const path = require("node:path");

const source = readFileSync(path.join(__dirname, "deploy-benefits-network.sh"), "utf8");
const mode = source.match(/^MODE=.*$/m)?.[0];
const usage = source.match(/^usage\(\) \{\n[\s\S]*?^\}/m)?.[0];
const selection = source.match(/^case "\$MODE" in\n[\s\S]*?^esac$/m)?.[0];
assert.ok(mode && usage && selection, "Expected top-level MODE, usage and first MODE case");

// Fail closed on syntax changes: execute only assignments and the inert usage body.
assert.match(mode, /^MODE="\$\{1:-[a-z-]+\}"$/);
assert.match(usage, /^usage\(\) \{\n  echo "Usage: \$0 \[[A-Za-z0-9| <>-]+\]" >&2\n  exit 64\n\}$/);
for (const line of selection.split("\n").slice(1, -1)) {
  assert.match(line, /^(?:  [a-z0-9-]+(?:\|[a-z0-9-]+)*\) SERVICES="(?:benefits-(?:backend|frontend)(?: benefits-(?:backend|frontend))*)?" ;;(?:[ \t]+#[^\n]*)?|  \*\) usage ;;)$/);
}

const scratch = mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "benefits-selection-"));
function run(block, argv) {
  const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-s", "--", ...argv], {
    input: `set -euo pipefail\n${mode}\n${usage}\n${block}\nprintf '%s\\n' "$SERVICES"\n`,
    cwd: scratch,
    env: { PATH: scratch, HOME: scratch, TMPDIR: scratch, LC_ALL: "C" },
    encoding: "utf8",
    timeout: 1000,
    maxBuffer: 4096,
    killSignal: "SIGKILL",
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, "Selection shell must terminate normally");
  return result;
}

function expectSelection(block, argv, services) {
  const label = argv.length ? JSON.stringify(argv) : "default";
  const result = run(block, argv);
  assert.equal(result.status, 0, `${label}: selection exit status`);
  assert.equal(result.stderr, "", `${label}: unexpected stderr`);
  assert.equal(result.stdout, `${services}\n`, `${label}: selected deploy targets`);
}

try {
  // Baseline first: the unfixed backend|all branch must fail here, before mutation.
  for (const [argv, services] of [
    [[], "benefits-frontend"],
    [["frontend"], "benefits-frontend"],
    [["backend"], "benefits-backend"],
    [["all"], "benefits-backend benefits-frontend"],
    [[""], "benefits-frontend"],
  ]) expectSelection(selection, argv, services);

  for (const modeName of ["status", "capacity", "verify", "rollback", "env-vault-v2", "env-restore"]) {
    expectSelection(selection, [modeName], "");
  }
  for (const invalid of [
    "invalid", "BACKEND", "frontend backend", "--help", "-c", "--",
    "frontend; printf injected", "$(printf injected)", "`printf injected`",
    "backend\nprintf injected", "backend|all",
  ]) {
    const result = run(selection, [invalid]);
    assert.equal(result.status, 64, `${JSON.stringify(invalid)}: invalid mode exit status`);
    assert.equal(result.stdout, "", "Invalid argv must not select targets or execute code");
    assert.match(result.stderr, /^Usage: /);
  }

  const fixed = /^  backend\) SERVICES="benefits-backend" ;;(?:[ \t]+#[^\n]*)?$/m;
  assert.match(selection, fixed, "Expected standalone backend branch for mutation");
  const mutant = selection.replace(fixed,
    '  backend|all) SERVICES="benefits-backend benefits-frontend" ;;');
  assert.throws(() => expectSelection(mutant, ["backend"], "benefits-backend"), {
    code: "ERR_ASSERTION",
    message: /selected deploy targets/,
  }, "Old backend-both mutation must be detected");
  console.log("[benefits-deploy-selection] PASS (selection only; not live recovery evidence)");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
