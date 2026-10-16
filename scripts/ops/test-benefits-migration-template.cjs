#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const template = fs.readFileSync(path.join(__dirname, "benefits-migration-template.sh"), "utf8");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "benefits-migration-test-"));
const repo = path.join(temporary, "checkout with spaces");
const runtime = path.join(temporary, "runtime");
const backups = path.join(temporary, "backups");
const bin = path.join(temporary, "bin");
const log = path.join(temporary, "calls");
const state = path.join(temporary, "state");
const script = path.join(repo, "migration.sh");
const secret = "PRIVATE_SENTINEL_MUST_NEVER_APPEAR";
let checks = 0;

function command(name, args, options = {}) {
  const result = spawnSync(name, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${name} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function shim(name, body) {
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
}

function snapshot(directory) {
  const entries = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) entries[entry.name] = snapshot(file);
    else entries[entry.name] = fs.readFileSync(file).toString("base64");
  }
  return entries;
}

try {
  for (const directory of [repo, runtime, backups, bin]) fs.mkdirSync(directory);
  fs.writeFileSync(script, template);
  command("git", ["init", "-q", repo]);
  command("git", ["-C", repo, "add", "migration.sh"]);
  const commit = () => {
    command("git", ["-C", repo, "add", "migration.sh"]);
    command("git", ["-C", repo, "-c", "user.name=Migration Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "test: fixture"]);
    return command("git", ["-C", repo, "rev-parse", "HEAD"]);
  };
  const originalSha = commit();
  command("python3", ["-I", "-B", "-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE fixture (id INTEGER PRIMARY KEY)'); c.execute('INSERT INTO fixture VALUES (1)'); c.commit(); c.close()", path.join(runtime, "benefits.db")]);
  fs.writeFileSync(path.join(runtime, "compose.yml"), "services: {}\n");
  fs.writeFileSync(path.join(runtime, "runtime.env"), `ADMIN_SECRET=${secret}\n`, { mode: 0o600 });

  shim("docker", `
printf '%s\\n' "$*" >>"$STUB_LOG"
printf '%s\\n' "$STUB_SECRET" >&2
image=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
if [[ "$1" == inspect ]]; then
  container=\${@: -1}
  case "$3" in
    *State.Health*)
      [[ "$STUB_UNHEALTHY" != 1 ]] || { echo 'true unhealthy'; exit 0; }
      echo 'true healthy' ;;
    *State.Running*) [[ "$(cat "$STUB_STATE")" == stopped ]] && echo false || echo true ;;
    *'.Id'*) echo "id-$container" ;;
    *'.Image'*) echo "$image" ;;
    *) exit 90 ;;
  esac
elif [[ "$1 $2" == 'image tag' ]]; then
  :
elif [[ "$1 $2" == 'image inspect' ]]; then
  echo "$image"
elif [[ "$1" == compose ]]; then
  shift
  while [[ "$1" == --* ]]; do shift 2; done
  action=$1; shift
  case "$action" in
    ps)
      if [[ "$1" == --all ]]; then
        echo "id-inferno-\${@: -1}"
        [[ "\${STUB_EXTRA_REPLICA:-0}" != 1 ]] || echo extra-replica
      elif [[ "$(cat "$STUB_STATE")" != stopped ]]; then echo running
      fi ;;
    stop) echo stopped >"$STUB_STATE" ;;
    up) echo running >"$STUB_STATE" ;;
    *) exit 91 ;;
  esac
else
  exit 92
fi`);
  shim("curl", `printf 'curl\\n' >>"$STUB_LOG"; printf '%s\\n' "$STUB_SECRET" >&2; printf '%s' "$STUB_HTTP_CODE"`);
  shim("df", `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 99999999 1 %s 1%% /\\n' "$STUB_FREE_KIB"`);
  // macOS ships shasum; the production template intentionally requires sha256sum.
  if (spawnSync("sha256sum", ["--version"]).error?.code === "ENOENT") {
    shim("sha256sum", 'exec shasum -a 256 "$@"');
  }
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    MIGRATION_REPO: repo,
    MIGRATION_EXPECTED_SHA: originalSha,
    MIGRATION_PREVIOUS_SHA: originalSha,
    MIGRATION_DB_FILE: path.join(runtime, "benefits.db"),
    MIGRATION_BACKUP_ROOT: backups,
    MIGRATION_COMPOSE_FILE: path.join(runtime, "compose.yml"),
    MIGRATION_ENV_FILE: path.join(runtime, "runtime.env"),
    MIGRATION_HEALTH_URL: "https://example.invalid/api/health",
    MIGRATION_READY_URL: "https://example.invalid/api/ready",
    MIGRATION_DISK_FLOOR_MIB: "4096",
    STUB_LOG: log,
    STUB_STATE: state,
    STUB_SECRET: secret,
    STUB_UNHEALTHY: "0",
    STUB_HTTP_CODE: "200",
    STUB_FREE_KIB: "99999999",
  };

  function run(args = [], overrides = {}, expected = 0, reason = "") {
    fs.writeFileSync(log, "");
    fs.writeFileSync(state, "running\n");
    const result = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...env, ...overrides } });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, expected, output);
    assert.ok(!output.includes(secret), "secret or raw tool output leaked");
    if (reason) assert.ok(output.includes(reason), output);
    checks += 1;
    return { output, calls: fs.readFileSync(log, "utf8") };
  }

  const before = { repo: snapshot(repo), runtime: snapshot(runtime), backups: snapshot(backups) };
  for (const args of [[], ["plan"]]) {
    const result = run(args);
    assert.match(result.output, /status=PLAN_ONLY/);
    assert.doesNotMatch(result.calls, /\b(stop|up|run|build|tag)\b/);
  }
  run(["apply"], {}, 1, "phase=migration_hook_check");
  assert.deepEqual({ repo: snapshot(repo), runtime: snapshot(runtime), backups: snapshot(backups) }, before, "plan/default refusal changed files");
  assert.equal(fs.readFileSync(state, "utf8"), "running\n");
  assert.doesNotMatch(fs.readFileSync(log, "utf8"), /\b(stop|up|run|build|tag)\b/);

  run(["plan"], { MIGRATION_EXPECTED_SHA: "0".repeat(40) }, 2, "EXACT_SHA_MISMATCH");
  run(["plan"], { STUB_FREE_KIB: "1024" }, 2, "DISK_FLOOR");
  run(["plan"], { STUB_UNHEALTHY: "1" }, 2, "CONTAINERS_OR_REPLICAS_UNHEALTHY");
  run(["plan"], { STUB_EXTRA_REPLICA: "1" }, 2, "CONTAINERS_OR_REPLICAS_UNHEALTHY");
  run(["plan"], { STUB_HTTP_CODE: "503" }, 2, "ENDPOINT_UNHEALTHY");
  fs.writeFileSync(path.join(repo, "untracked"), secret);
  run(["plan"], {}, 2, "DIRTY_CHECKOUT");
  fs.unlinkSync(path.join(repo, "untracked"));
  fs.appendFileSync(script, "\n# unreviewed change\n");
  run(["apply"], {}, 2, "DIRTY_CHECKOUT");
  fs.writeFileSync(script, template);
  fs.writeFileSync(path.join(runtime, "benefits.db-wal"), "sidecar");
  run(["apply"], {}, 2, "SQLITE_SIDECAR_PRESENT");
  fs.unlinkSync(path.join(runtime, "benefits.db-wal"));

  // Reviewed fixture hooks exercise the actual backup/cutover and failure cleanup.
  // These changes exist only in the temporary repository, never in the shipped template.
  let customized = template.replace(/migration_hook\(\) \{[\s\S]*?\n\}/, `migration_hook() {
  printf '%s\\n' "$STUB_SECRET"
  [[ "$1" != migrate || "\${STUB_FAIL_MIGRATION:-0}" != 1 ]]
}`);
  customized = customized.replace(/invariant_hook\(\) \{[\s\S]*?\n\}/, `invariant_hook() {
  [[ "$1" != online || "\${STUB_FAIL_ONLINE:-0}" != 1 ]] || return 1
  [[ "$1" != after || "\${STUB_FAIL_INVARIANT:-0}" != 1 ]]
}`);
  fs.writeFileSync(script, customized);
  env.MIGRATION_EXPECTED_SHA = commit();
  const success = run(["apply"]);
  assert.match(success.output, /status=PASS/);
  const backupDirectory = fs.readdirSync(backups).find((entry) => entry.startsWith("benefits-migration-"));
  const backup = path.join(backups, backupDirectory);
  command("sha256sum", ["--check", "--status", "SHA256SUMS"], { cwd: backup, env });
  assert.ok(fs.readFileSync(path.join(backup, "RESTORE.txt"), "utf8").includes("old images"));
  assert.deepEqual(fs.readFileSync(path.join(backup, "database.sqlite")), fs.readFileSync(env.MIGRATION_DB_FILE));
  assert.equal(fs.statSync(backup).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(backup, "runtime.env")).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(path.join(backups, ".benefits-migration.lock")));

  run(["apply"], { STUB_FAIL_MIGRATION: "1" }, 1, "phase=migrate");
  assert.equal(fs.readFileSync(state, "utf8"), "stopped\n");
  assert.doesNotMatch(fs.readFileSync(log, "utf8"), /compose.*\bup\b/);
  fs.rmdirSync(path.join(backups, ".benefits-migration.lock"));
  run(["apply"], { STUB_FAIL_ONLINE: "1" }, 1, "phase=postcheck");
  assert.equal(fs.readFileSync(state, "utf8"), "stopped\n");
  const onlineCalls = fs.readFileSync(log, "utf8");
  assert.match(onlineCalls, /compose.*\bup\b/);
  assert.ok(onlineCalls.lastIndexOf(" stop ") > onlineCalls.lastIndexOf(" up "), "failed postcheck must stop the restarted release");
  assert.ok(fs.existsSync(path.join(backups, ".benefits-migration.lock")), "failed maintenance must retain the lock");
  run(["apply"], {}, 2, "MIGRATION_LOCKED");
  fs.rmdirSync(path.join(backups, ".benefits-migration.lock"));
  run(["apply"], { STUB_FAIL_INVARIANT: "1" }, 1, "phase=invariants_after");
  assert.equal(fs.readFileSync(state, "utf8"), "stopped\n");
  assert.doesNotMatch(fs.readFileSync(log, "utf8"), /compose.*\bup\b/);
  console.log(`[benefits-migration-template-test] PASS (${checks} scenarios; plan/default refusal, guards, backup, cutover, failure isolation)`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
