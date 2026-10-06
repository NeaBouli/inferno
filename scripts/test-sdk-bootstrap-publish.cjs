#!/usr/bin/env node
// Fixture tests for scripts/sdk-bootstrap-publish.sh (T-288). Uses a dummy `npm` on PATH, a throwaway git
// repository, a throwaway HOME and TMPDIR: no real login, no registry access, no user npm config is read.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.join(__dirname, "sdk-bootstrap-publish.sh");
const FAKE_TOKEN = "npm_FIXTURE_ONLY_NOT_A_TOKEN";

const stubNpm = `#!/usr/bin/env bash
echo "$1" >> "$FAKE_LOG"
cfg="$NPM_CONFIG_USERCONFIG"
case "$1" in
  ci|test|run|pack) [ "\${FAKE_PREFLIGHT:-ok}" = ok ] || exit 1; exit 0 ;;
  login)
    case "\${FAKE_LOGIN:-ok}" in
      ok) echo "//registry.npmjs.org/:_authToken=${FAKE_TOKEN}" >> "$cfg"; exit 0 ;;
      partial) echo "//registry.npmjs.org/:_authToken=${FAKE_TOKEN}" >> "$cfg"; exit 1 ;;
      *) exit 1 ;;
    esac ;;
  whoami) echo "\${FAKE_WHOAMI:-ifr-protocol}"; exit 0 ;;
  publish)
    case "\${FAKE_PUBLISH:-ok}" in
      ok) exit 0 ;;
      interrupt) kill -INT "$PPID"; exit 130 ;;
      *) exit 1 ;;
    esac ;;
  logout)
    case "\${FAKE_LOGOUT:-ok}" in
      ok) : > "$cfg"; exit 0 ;;
      keep) exit 0 ;;
      unreadable) : > "$cfg"; chmod 000 "$cfg"; exit 0 ;;
      missing) rm -f "$cfg"; exit 0 ;;
      *) exit 1 ;;
    esac ;;
esac
exit 99
`;

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ifr-bootstrap-test-"));
  const repo = path.join(base, "repo");
  const bin = path.join(base, "bin");
  const home = path.join(base, "home");
  const tmp = path.join(base, "tmp");
  for (const dir of [repo, bin, home, tmp, path.join(repo, "apps", "sdk"), path.join(repo, "scripts")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(repo, "apps", "sdk", "package.json"), JSON.stringify({ name: "ifr-sdk", version: "0.3.0" }));
  fs.copyFileSync(script, path.join(repo, "scripts", "sdk-bootstrap-publish.sh"));
  fs.writeFileSync(path.join(bin, "npm"), stubNpm, { mode: 0o755 });
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "fixture");
  return { base, repo, bin, home, tmp, sha: git(repo, "rev-parse", "HEAD"), log: path.join(base, "npm.log") };
}

function run(fixture, env = {}, args) {
  const result = spawnSync("bash", [path.join(fixture.repo, "scripts", "sdk-bootstrap-publish.sh"), ...(args || ["0.3.0", fixture.sha])], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: {
      PATH: `${fixture.bin}:${process.env.PATH}`,
      HOME: fixture.home,
      TMPDIR: fixture.tmp,
      FAKE_LOG: fixture.log,
      ...env,
    },
  });
  const calls = fs.existsSync(fixture.log) ? fs.readFileSync(fixture.log, "utf8").trim().split("\n") : [];
  const leftovers = fs.existsSync(fixture.tmp) ? fs.readdirSync(fixture.tmp).filter((f) => f.startsWith("ifr-npm-bootstrap.")) : [];
  const output = `${result.stdout}${result.stderr}`;
  assert.doesNotMatch(output, new RegExp(FAKE_TOKEN), "credentials must never be printed");
  assert.equal(fs.existsSync(path.join(fixture.home, ".npmrc")), false, "the user npm config must never be created");
  return { status: result.status, calls, leftovers, output };
}

const cases = [
  ["success", {}, (r) => {
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["ci", "test", "run", "pack", "login", "whoami", "publish", "logout"]);
    assert.deepEqual(r.leftovers, []);
    assert.match(r.output, /OK: ifr-sdk published/);
  }],
  ["approval mismatch (other commit)", { args: ["0.3.0", "0".repeat(40)] }, (r) => {
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.leftovers, []);
    assert.match(r.output, /HOLD: HEAD .* is not the approved commit/);
  }],
  ["approval mismatch (other version)", { args: ["0.3.1", null] }, (r) => {
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.calls, []);
    assert.match(r.output, /HOLD: package version 0.3.0 is not the approved 0.3.1/);
  }],
  ["mktemp failure", { env: { TMPDIR: "/nonexistent/ifr-bootstrap-test" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.calls, []);
    assert.match(r.output, /HOLD: mktemp failed/);
  }],
  ["package check failure", { env: { FAKE_PREFLIGHT: "fail" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.calls, ["ci"]);
    assert.deepEqual(r.leftovers, []);
    assert.match(r.output, /HOLD: npm ci failed/);
  }],
  ["login failure", { env: { FAKE_LOGIN: "fail" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.ok(!r.calls.includes("publish"));
    assert.ok(!r.calls.includes("logout"), "no credential was written, so there is no session to end");
    assert.deepEqual(r.leftovers, []);
    assert.match(r.output, /HOLD: npm login failed/);
  }],
  ["login fails after writing a credential", { env: { FAKE_LOGIN: "partial" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.ok(!r.calls.includes("publish"));
    assert.equal(r.calls.at(-1), "logout");
    assert.deepEqual(r.leftovers, []);
  }],
  ["wrong account", { env: { FAKE_WHOAMI: "someone-else" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.ok(!r.calls.includes("publish"));
    assert.equal(r.calls.at(-1), "logout");
    assert.deepEqual(r.leftovers, []);
    assert.match(r.output, /signed in as 'someone-else', expected 'ifr-protocol'; nothing was published/);
  }],
  ["publish failure keeps its exit status", { env: { FAKE_PUBLISH: "fail" } }, (r) => {
    assert.equal(r.status, 1);
    assert.equal(r.calls.at(-1), "logout");
    assert.deepEqual(r.leftovers, []);
    assert.match(r.output, /HOLD: npm publish failed \(exit 1\)/);
    assert.doesNotMatch(r.output, /OK:/);
  }],
  ["interruption during publish", { env: { FAKE_PUBLISH: "interrupt" } }, (r) => {
    assert.equal(r.status, 130);
    assert.equal(r.calls.at(-1), "logout");
    assert.deepEqual(r.leftovers, []);
    assert.match(r.output, /Interrupted/);
  }],
  ["logout failure", { env: { FAKE_LOGOUT: "fail" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.equal(r.leftovers.length, 1, "temp config must be kept for manual revocation");
    assert.match(r.output, /HOLD: npm logout failed/);
    assert.match(r.output, /Access Tokens/);
    assert.match(r.output, /the package WAS published/);
  }],
  ["credential still present after logout", { env: { FAKE_LOGOUT: "keep" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.equal(r.leftovers.length, 1);
    assert.match(r.output, /credential line is still in/);
  }],
  ["config unreadable after logout", { env: { FAKE_LOGOUT: "unreadable" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.equal(r.leftovers.length, 1);
    assert.match(r.output, /cannot verify the temporary npm config/);
  }],
  ["config missing after logout", { env: { FAKE_LOGOUT: "missing" } }, (r) => {
    assert.notEqual(r.status, 0);
    assert.match(r.output, /cannot verify the temporary npm config/);
    assert.doesNotMatch(r.output, /OK:/);
  }],
];

let passed = 0;
for (const [name, options, check] of cases) {
  if (name.includes("unreadable") && process.getuid && process.getuid() === 0) {
    console.log(`  skip ${name} (root can read mode 000 files)`);
    continue;
  }
  const fixture = makeFixture();
  try {
    const args = options.args ? [options.args[0], options.args[1] || fixture.sha] : undefined;
    check(run(fixture, options.env, args));
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  } finally {
    for (const f of fs.existsSync(fixture.tmp) ? fs.readdirSync(fixture.tmp) : []) fs.chmodSync(path.join(fixture.tmp, f), 0o600);
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
}
console.log(`[sdk-bootstrap-publish] PASS - ${passed} fail-closed fixture cases`);
