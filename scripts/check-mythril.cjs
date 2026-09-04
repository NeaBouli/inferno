#!/usr/bin/env node

const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "audit", "mythril-config.json");

function assertVersion(label, output, expected) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(output)) {
    throw new Error(`${label} ${expected} required, received: ${output.trim() || "no version output"}`);
  }
}

function assertCompilerDigest(config, solc, platform = process.platform, architecture = process.arch) {
  if (platform !== "linux") return;
  if (architecture !== "x64") throw new Error(`Unsupported Linux architecture for pinned solc: ${architecture}`);
  if (!path.isAbsolute(solc) || !fs.existsSync(solc)) {
    throw new Error("SOLC_BIN must be an absolute compiler artifact path on Linux");
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(solc)).digest("hex");
  if (actual !== config.tool.solcLinuxAmd64Sha256) {
    throw new Error(`solc Linux amd64 SHA-256 mismatch: expected ${config.tool.solcLinuxAmd64Sha256}, received ${actual}`);
  }
}

function walkSolidityFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "mocks" ? [] : walkSolidityFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".sol") ? [absolute] : [];
  });
}

function discoverConcreteContracts() {
  const discovered = [];
  for (const absolute of walkSolidityFiles(path.join(root, "contracts"))) {
    const source = path.relative(root, absolute).split(path.sep).join("/");
    const contents = fs.readFileSync(absolute, "utf8");
    for (const match of contents.matchAll(/^\s*contract\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)) {
      discovered.push({ source, contract: match[1] });
    }
  }
  return discovered.sort((left, right) =>
    `${left.source}:${left.contract}`.localeCompare(`${right.source}:${right.contract}`));
}

function validateConfig(config) {
  if (config.schemaVersion !== 1 || !config.tool || !config.analysis) {
    throw new Error("Mythril config must use schemaVersion 1 with tool and analysis objects");
  }
  if (!Array.isArray(config.contracts) || config.contracts.length === 0) {
    throw new Error("Mythril config must declare at least one contract");
  }
  if (!Array.isArray(config.analysis.gatedSeverities) || config.analysis.gatedSeverities.length === 0) {
    throw new Error("Mythril config must declare gated severities");
  }
  if (!Array.isArray(config.analysis.informationalSeverities)) {
    throw new Error("Mythril config must declare informational severities");
  }

  const identities = new Set();
  for (const entry of config.contracts) {
    if (!entry.source?.startsWith("contracts/") || !entry.source.endsWith(".sol") || !entry.contract) {
      throw new Error(`Invalid Mythril contract entry: ${JSON.stringify(entry)}`);
    }
    if (entry.source.includes("/mocks/")) {
      throw new Error(`Mock contract must not enter the production Mythril scope: ${entry.source}`);
    }
    const identity = `${entry.source}:${entry.contract}`;
    if (identities.has(identity)) throw new Error(`Duplicate Mythril contract entry: ${identity}`);
    identities.add(identity);
    if (!fs.existsSync(path.join(root, entry.source))) {
      throw new Error(`Missing Mythril source: ${entry.source}`);
    }
  }
  const configured = [...identities].sort((left, right) => left.localeCompare(right));
  const discovered = discoverConcreteContracts().map((entry) => `${entry.source}:${entry.contract}`);
  if (JSON.stringify(configured) !== JSON.stringify(discovered)) {
    throw new Error(`Mythril scope differs from concrete production contracts; configured=${configured.join(",")}; discovered=${discovered.join(",")}`);
  }
  return config;
}

function collectReports(raw, identity) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Mythril returned invalid JSON for ${identity}: ${error.message}`);
  }
  const reports = Array.isArray(parsed) ? parsed : [parsed];
  if (!reports.length) throw new Error(`Mythril returned no report for ${identity}`);
  return reports;
}

function validateReports(reports, entry) {
  const identity = `${entry.source}:${entry.contract}`;
  const errors = reports.flatMap((report) => report.meta?.logs || [])
    .filter((log) => ["error", "fatal", "critical"].includes(String(log.level).toLowerCase()));
  if (errors.length) {
    throw new Error(`Mythril reported an internal error for ${identity}: ${errors.map((log) => log.msg).join(" | ")}`);
  }

  const relevant = reports.filter((report) =>
    report.sourceType === "solidity-file"
      && report.sourceFormat === "text"
      && Array.isArray(report.sourceList)
      && report.sourceList.includes(entry.source));
  if (!relevant.length) throw new Error(`Mythril did not analyze the requested source for ${identity}`);

  for (const report of relevant) {
    const execution = report.meta?.mythril_execution_info;
    if (!execution || !Number.isFinite(execution.analysis_duration) || execution.analysis_duration <= 0) {
      throw new Error(`Mythril execution metadata is missing for ${identity}`);
    }
    if (!Array.isArray(execution.coverage) || execution.coverage.length === 0) {
      throw new Error(`Mythril coverage evidence is missing for ${identity}`);
    }
    if (!Array.isArray(report.issues)) throw new Error(`Mythril issues array is missing for ${identity}`);
  }

  return relevant.flatMap((report) => report.issues);
}

function summarizeCoverage(reports) {
  const entries = reports.flatMap((report) => report.meta?.mythril_execution_info?.coverage || []);
  if (!entries.length) return { branches: "n/a", instructions: "n/a" };
  const latestByCode = new Map();
  for (const entry of entries) latestByCode.set(entry.code_hash, entry);
  const totals = [...latestByCode.values()].reduce((sum, entry) => ({
    branchesCovered: sum.branchesCovered + (entry.branches_covered || 0),
    totalBranches: sum.totalBranches + (entry.total_branches || 0),
    instructionsCovered: sum.instructionsCovered + (entry.instructions_covered || 0),
    totalInstructions: sum.totalInstructions + (entry.total_instructions || 0),
  }), { branchesCovered: 0, totalBranches: 0, instructionsCovered: 0, totalInstructions: 0 });
  const percent = (covered, total) => total ? `${((covered / total) * 100).toFixed(1)}%` : "n/a";
  return {
    branches: percent(totals.branchesCovered, totals.totalBranches),
    instructions: percent(totals.instructionsCovered, totals.totalInstructions),
  };
}

function describeIssue(entry, issue) {
  const title = issue.title || issue.swcTitle || "untitled issue";
  const swc = issue.swcID ? ` ${issue.swcID}` : "";
  return `${issue.severity || "Unknown"}${swc} ${title} in ${entry.source}:${entry.contract}`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      detached: process.platform !== "win32",
      env: options.env || process.env,
      stdio: options.stdoutFile ? ["ignore", options.stdoutFile, "pipe"] : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer;
    const signalTree = (signal) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      signalTree("SIGTERM");
      killTimer = setTimeout(() => signalTree("SIGKILL"), 5_000);
      killTimer.unref();
    }, options.timeoutMs || 180_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        if (killTimer) clearTimeout(killTimer);
        signalTree("SIGKILL");
        return reject(new Error(`${command} timed out after ${options.timeoutMs || 180_000}ms`));
      }
      if (signal) return reject(new Error(`${command} terminated by ${signal}`));
      resolve({ status, stdout, stderr });
    });
  });
}

async function assertToolchain(config, env, runtime = {}) {
  const mythril = env.MYTHRIL_BIN || "myth";
  const python = env.MYTHRIL_PYTHON || "python3";
  const solc = env.SOLC_BIN || "solc";
  const timeoutMs = config.analysis.processTimeoutSeconds * 1000;
  const [mythrilVersion, solcVersion, setuptoolsVersion] = await Promise.all([
    run(mythril, ["version"], { env, timeoutMs }),
    run(solc, ["--version"], { env, timeoutMs }),
    run(python, ["-c", "import importlib.metadata; print(importlib.metadata.version('setuptools'))"], { env, timeoutMs }),
  ]);
  for (const [label, result] of [["Mythril", mythrilVersion], ["solc", solcVersion], ["setuptools", setuptoolsVersion]]) {
    if (result.status !== 0) throw new Error(`${label} version check failed: ${result.stderr.trim()}`);
  }
  assertVersion("Mythril", `${mythrilVersion.stdout}\n${mythrilVersion.stderr}`, config.tool.mythril);
  assertVersion("solc", `${solcVersion.stdout}\n${solcVersion.stderr}`, config.tool.solc);
  assertVersion("setuptools", setuptoolsVersion.stdout, config.tool.setuptools);
  assertCompilerDigest(config, solc, runtime.platform, runtime.architecture);
}

async function prepareCompiler(config, outputRoot, env) {
  const python = env.MYTHRIL_PYTHON || "python3";
  const script = [
    "import solcx",
    "versions = solcx.import_installed_solc()",
    `required = '${config.tool.solc}'`,
    "installed = [str(version) for version in solcx.get_installed_solc_versions()]",
    "assert required in installed, f'required solc {required} was not imported; imported={versions}, installed={installed}'",
  ].join("\n");
  const result = await run(python, ["-c", script], {
    env: { ...env, SOLCX_BINARY_PATH: outputRoot },
    timeoutMs: config.analysis.processTimeoutSeconds * 1000,
  });
  if (result.status !== 0) throw new Error(`Unable to prepare isolated solc: ${result.stderr.trim() || result.stdout.trim()}`);
}

async function analyzeContract(config, entry, workspace, env) {
  const identity = `${entry.source}:${entry.contract}`;
  const output = path.join(workspace.reports, `${entry.contract}.json`);
  const outputFd = fs.openSync(output, "w");
  let result;
  try {
    result = await run(env.MYTHRIL_BIN || "myth", [
      "analyze", identity,
      "--solv", config.tool.solc,
      "--solc-json", workspace.settings,
      "--solc-args", `--base-path ${root} --include-path ${path.join(root, "node_modules")} --allow-paths ${root}`,
      "--execution-timeout", String(config.analysis.executionTimeoutSeconds),
      "--create-timeout", String(config.analysis.createTimeoutSeconds),
      "--solver-timeout", String(config.analysis.solverTimeoutMs),
      "--transaction-count", String(config.analysis.transactionCount),
      "--strategy", "bfs",
      "--no-onchain-data",
      "-o", "jsonv2",
    ], {
      env: { ...env, SOLCX_BINARY_PATH: workspace.solcx },
      stdoutFile: outputFd,
      timeoutMs: config.analysis.processTimeoutSeconds * 1000,
    });
  } finally {
    fs.closeSync(outputFd);
  }
  if (result.status !== 0) {
    throw new Error(`Mythril process failed for ${identity}: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  const reports = collectReports(fs.readFileSync(output, "utf8"), identity);
  const issues = validateReports(reports, entry);
  return { entry, issues, coverage: summarizeCoverage(reports) };
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  let failure;
  async function worker() {
    while (!failure && cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        failure ||= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure;
  return results;
}

async function main() {
  const config = validateConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-mythril-"));
  const workspace = {
    root: workspaceRoot,
    bin: path.join(workspaceRoot, "bin"),
    reports: path.join(workspaceRoot, "reports"),
    solcx: path.join(workspaceRoot, "solcx"),
    settings: path.join(workspaceRoot, "solc-settings.json"),
  };
  fs.mkdirSync(workspace.bin);
  fs.mkdirSync(workspace.reports);
  fs.mkdirSync(workspace.solcx);
  fs.writeFileSync(workspace.settings, JSON.stringify({
    optimizer: { enabled: false },
    evmVersion: "cancun",
    remappings: ["@openzeppelin/=node_modules/@openzeppelin/"],
  }));

  const solc = process.env.SOLC_BIN || "solc";
  if (solc.includes(path.sep)) {
    fs.symlinkSync(path.resolve(solc), path.join(workspace.bin, "solc"));
  }
  const env = {
    ...process.env,
    PATH: solc.includes(path.sep)
      ? `${workspace.bin}${path.delimiter}${process.env.PATH}`
      : process.env.PATH,
  };
  try {
    await assertToolchain(config, env);
    await prepareCompiler(config, workspace.solcx, env);
    const configuredConcurrency = Number(process.env.MYTHRIL_CONCURRENCY || config.analysis.concurrency);
    if (!Number.isInteger(configuredConcurrency) || configuredConcurrency < 1 || configuredConcurrency > 4) {
      throw new Error("MYTHRIL_CONCURRENCY must be an integer from 1 to 4");
    }
    const results = await mapConcurrent(config.contracts, configuredConcurrency, async (entry) => {
      const result = await analyzeContract(config, entry, workspace, env);
      console.log(`[mythril] ${entry.contract}: ${result.issues.length} signals; branch ${result.coverage.branches}; instruction ${result.coverage.instructions}`);
      return result;
    });
    const issues = results.flatMap((result) => result.issues.map((issue) => ({ entry: result.entry, issue })));
    const gated = issues.filter(({ issue }) =>
      config.analysis.gatedSeverities.includes(issue.severity)
        || !config.analysis.informationalSeverities.includes(issue.severity));
    console.log(`[mythril] analyzed ${results.length} concrete production contracts with bounded symbolic execution`);
    if (gated.length) {
      for (const { entry, issue } of gated) console.error(`[mythril] GATED ${describeIssue(entry, issue)}`);
      throw new Error(`Mythril reported ${gated.length} Critical/High/Medium signal(s); review required`);
    }
    for (const { entry, issue } of issues) console.warn(`[mythril] INFO ${describeIssue(entry, issue)}`);
    console.log(`[mythril] PASS - no Critical, High or Medium signals in the bounded scope${issues.length ? `; ${issues.length} lower signal(s) reported` : ""}`);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[mythril] FAIL - ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertVersion,
  assertCompilerDigest,
  assertToolchain,
  collectReports,
  describeIssue,
  discoverConcreteContracts,
  mapConcurrent,
  run,
  summarizeCoverage,
  validateConfig,
  validateReports,
};
