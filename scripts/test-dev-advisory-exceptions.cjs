// Self-test for scripts/check-dev-advisory-exceptions.cjs: a dev-only braces 3.0.3 passes,
// the same package as a production dependency fails. Uses throwaway projects in a temp directory.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const checker = path.join(__dirname, "check-dev-advisory-exceptions.cjs");
function project(field) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-advisory-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", private: true, [field]: { braces: "3.0.3" } }));
  const lock = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, encoding: "utf8" });
  assert.equal(lock.status, 0, lock.stderr);
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [checker], { cwd: dir, encoding: "utf8" });

const dev = run(project("devDependencies"));
assert.equal(dev.status, 0, dev.stderr);
assert.match(dev.stdout, /GHSA-vfj7-8cjw-p6xm/);

const prod = run(project("dependencies"));
assert.equal(prod.status, 1, "a production braces dependency must fail");
assert.match(prod.stderr, /production dependencies have advisories/);
console.log("[dev-advisory-exceptions self-test] PASS");
