#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertCompilerDigest,
  assertToolchain,
  assertVersion,
  collectReports,
  describeIssue,
  discoverConcreteContracts,
  mapConcurrent,
  run,
  summarizeCoverage,
  validateConfig,
  validateReports,
} = require("./check-mythril.cjs");

const root = path.resolve(__dirname, "..");
const config = validateConfig(JSON.parse(fs.readFileSync(path.join(root, "audit", "mythril-config.json"), "utf8")));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "mythril-analysis.yml"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts", "check-mythril.cjs"), "utf8");
const requirementsInput = fs.readFileSync(path.join(root, "audit", "requirements-mythril.in"), "utf8");
const requirementsLock = fs.readFileSync(path.join(root, "audit", "requirements-mythril.txt"), "utf8");
const entry = config.contracts.find((candidate) => candidate.contract === "InfernoToken");

function report(overrides = {}) {
  return {
    issues: [],
    sourceType: "solidity-file",
    sourceFormat: "text",
    sourceList: [entry.source],
    meta: {
      logs: [],
      mythril_execution_info: {
        analysis_duration: 1,
        coverage: [{
          code_hash: "fixture",
          branches_covered: 8,
          total_branches: 10,
          instructions_covered: 50,
          total_instructions: 100,
        }],
      },
    },
    ...overrides,
  };
}

assert.equal(config.schemaVersion, 1);
assert.equal(config.tool.mythril, "0.24.8");
assert.equal(config.tool.solc, "0.8.28");
assert.equal(config.tool.solcLinuxAmd64Sha256, "9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25");
assert.equal(config.tool.setuptools, "80.10.2");
assert.equal(config.contracts.length, 17, "all concrete production contracts must be explicit");
assert.equal(new Set(config.contracts.map((item) => `${item.source}:${item.contract}`)).size, 17);
assert.equal(config.contracts.some((item) => item.source.includes("/mocks/")), false);
assert.deepEqual(config.analysis.gatedSeverities, ["Critical", "High", "Medium"]);
assert.deepEqual(config.analysis.informationalSeverities, ["Low"]);
assert.deepEqual(discoverConcreteContracts(), [...config.contracts].sort((left, right) =>
  `${left.source}:${left.contract}`.localeCompare(`${right.source}:${right.contract}`)));
for (const pin of ["setuptools==80.10.2", "mythril==0.24.8", "solc-select==1.2.0"]) {
  assert.ok(requirementsInput.includes(pin), `Mythril input must pin ${pin}`);
  assert.ok(requirementsLock.includes(pin), `Mythril lock must contain ${pin}`);
}
assert.ok(requirementsLock.includes("--generate-hashes"));
assert.ok(requirementsLock.includes("--hash=sha256:"));
assert.equal(requirementsLock.includes("--index-url"), false, "Mythril lock must use the configured default package index");

assert.doesNotThrow(() => assertVersion("Mythril", "Mythril version v0.24.8", "0.24.8"));
assert.throws(() => assertVersion("Mythril", "Mythril version v0.24.7", "0.24.8"), /0\.24\.8 required/);
assert.deepEqual(collectReports(JSON.stringify([report()]), "fixture"), [report()]);
assert.throws(() => collectReports("not json", "fixture"), /invalid JSON/);
assert.throws(() => collectReports("[]", "fixture"), /no report/);
assert.deepEqual(validateReports([report()], entry), []);
assert.throws(() => validateReports([report({ meta: { logs: [{ level: "error", msg: "compiler failed" }] } })], entry), /internal error/);
assert.throws(() => validateReports([report({ sourceList: [] })], entry), /did not analyze/);
assert.throws(() => validateReports([report({ meta: { mythril_execution_info: { analysis_duration: 0, coverage: [] } } })], entry), /metadata is missing/);
assert.throws(() => validateReports([report({ issues: null })], entry), /issues array is missing/);
assert.deepEqual(summarizeCoverage([report()]), { branches: "80.0%", instructions: "50.0%" });
assert.deepEqual(summarizeCoverage([{ meta: {} }]), { branches: "n/a", instructions: "n/a" });

const issue = { severity: "High", swcID: "SWC-107", title: "Reentrancy" };
assert.match(describeIssue(entry, issue), /High SWC-107 Reentrancy/);
assert.ok(config.analysis.gatedSeverities.includes(issue.severity));
assert.ok(config.analysis.gatedSeverities.includes("Critical"));
assert.ok(config.analysis.gatedSeverities.includes("Medium"));
assert.equal(config.analysis.gatedSeverities.includes("Low"), false);
assert.equal(config.analysis.informationalSeverities.includes("Low"), true);
assert.equal(config.analysis.informationalSeverities.includes("Unknown"), false);

const digestFixture = path.join(os.tmpdir(), `inferno-solc-digest-${process.pid}`);
fs.writeFileSync(digestFixture, "compiler fixture");
const digest = require("node:crypto").createHash("sha256").update("compiler fixture").digest("hex");
assert.doesNotThrow(() => assertCompilerDigest({ tool: { solcLinuxAmd64Sha256: digest } }, digestFixture, "linux", "x64"));
assert.throws(() => assertCompilerDigest(config, digestFixture, "linux", "x64"), /SHA-256 mismatch/);
assert.throws(() => assertCompilerDigest(config, digestFixture, "linux", "arm64"), /Unsupported Linux architecture/);
fs.rmSync(digestFixture, { force: true });

(async () => {
  const toolDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-mythril-tools-"));
  const fakeTool = (name, output) => {
    const target = path.join(toolDirectory, name);
    fs.writeFileSync(target, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(output)}\n`);
    fs.chmodSync(target, 0o755);
    return target;
  };
  const toolEnv = {
    ...process.env,
    MYTHRIL_BIN: fakeTool("myth", "Mythril version v0.24.8"),
    MYTHRIL_PYTHON: fakeTool("python", "80.10.2"),
    SOLC_BIN: fakeTool("solc", "Version: 0.8.28+commit.7893614a"),
  };
  await assert.doesNotReject(assertToolchain(config, toolEnv, { platform: "darwin", architecture: "x64" }));
  await assert.rejects(
    assertToolchain(config, { ...toolEnv, SOLC_BIN: fakeTool("wrong-solc", "Version: 0.8.35") }, { platform: "darwin", architecture: "x64" }),
    /solc 0\.8\.28 required/,
  );
  fs.rmSync(toolDirectory, { recursive: true, force: true });

  const starts = [];
  const values = await mapConcurrent([1, 2, 3], 2, async (value) => {
    starts.push(value);
    await new Promise((resolve) => setTimeout(resolve, value === 1 ? 10 : 1));
    return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6]);
  assert.deepEqual(starts.slice(0, 2), [1, 2]);

  let peerCompleted = false;
  await assert.rejects(
    mapConcurrent(["fail", "peer", "not-started"], 2, async (value) => {
      if (value === "fail") throw new Error("expected failure");
      await new Promise((resolve) => setTimeout(resolve, 5));
      peerCompleted = true;
      return value;
    }),
    /expected failure/,
  );
  assert.equal(peerCompleted, true, "active peer work must settle before cleanup");

  await assert.rejects(
    run(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"], { timeoutMs: 25 }),
    /timed out after 25ms/,
  );

  if (process.platform !== "win32") {
    const pidFile = path.join(os.tmpdir(), `inferno-mythril-child-${process.pid}.txt`);
    const source = [
      "const fs=require('node:fs')",
      "const {spawn}=require('node:child_process')",
      `const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})`,
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid))`,
      "process.on('SIGTERM',()=>process.exit(0))",
      "setInterval(()=>{},1000)",
    ].join(";");
    await assert.rejects(run(process.execPath, ["-e", source], { timeoutMs: 100 }), /timed out/);
    const descendantPid = Number(fs.readFileSync(pidFile, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(() => process.kill(descendantPid, 0), /ESRCH/, "timed-out descendants must be terminated");
    fs.rmSync(pidFile, { force: true });
  }

  for (const marker of [
    "workflow_dispatch:",
    "schedule:",
    "pull_request:",
    "push:",
    "- 'contracts/**'",
    "python-version: '3.12.13'",
    "--require-hashes",
    "-r audit/requirements-mythril.txt",
    "solc-select install 0.8.28",
    "sha256sum -c",
    "SOLC_BIN=$SOLC_ARTIFACT",
    "npm run test:mythril",
    "npm run check:mythril",
  ]) assert.ok(workflow.includes(marker), `Mythril workflow must include ${marker}`);
  assert.match(runner, /--no-onchain-data/);
  assert.match(runner, /--strategy", "bfs"/);
  assert.ok(runner.includes('["error", "fatal", "critical"]'));
  assert.match(runner, /processTimeoutSeconds/);
  assert.match(runner, /if \(failure\) throw failure/);
  assert.match(runner, /process\.kill\(-child\.pid/);
  assert.match(runner, /timedOut/);
  assert.match(runner, /solcLinuxAmd64Sha256/);
  assert.match(runner, /symlinkSync.*workspace\.bin/);
  console.log("[mythril-test] PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
