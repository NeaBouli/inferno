#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const contractsRoot = path.join(root, "contracts");
const baselinePath = path.join(root, "audit", "slither-high-baseline.json");

function walkSolidityFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "mocks" ? [] : walkSolidityFiles(absolute);
    }
    return entry.isFile() && entry.name.endsWith(".sol") ? [absolute] : [];
  });
}

function discoverContracts() {
  return walkSolidityFiles(contractsRoot)
    .map((absolute) => path.relative(root, absolute).split(path.sep).join("/"))
    .sort();
}

function relativeSource(element) {
  return element?.source_mapping?.filename_relative?.split(path.sep).join("/") || "";
}

function isDependencyOnly(finding) {
  const elements = finding.elements || [];
  return elements.length > 0 && elements.every((element) => relativeSource(element).startsWith("node_modules/"));
}

function semanticElements(finding) {
  const unique = new Set();
  for (const element of finding.elements || []) {
    const source = relativeSource(element);
    if (!source || source.startsWith("node_modules/")) continue;
    const fields = element.type_specific_fields || {};
    unique.add(JSON.stringify({
      type: element.type || "",
      source,
      parent: fields.parent?.name || "",
      signature: fields.signature || "",
      expression: element.name || "",
    }));
  }
  return [...unique].sort().map((entry) => JSON.parse(entry));
}

function fingerprintFinding(finding) {
  const semantic = {
    check: finding.check,
    impact: finding.impact,
    confidence: finding.confidence,
    elements: semanticElements(finding),
  };
  return crypto.createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
}

function describeFinding(finding) {
  const firstFunction = (finding.elements || []).find((element) => element.type === "function");
  const fields = firstFunction?.type_specific_fields || {};
  const source = relativeSource(firstFunction) || "unknown source";
  const subject = fields.parent?.name && fields.signature
    ? `${fields.parent.name}.${fields.signature}`
    : firstFunction?.name || "unknown subject";
  return `${finding.check} in ${source}:${subject}`;
}

function evaluateBaseline(findings, baseline) {
  const actual = new Map(findings.map((finding) => [fingerprintFinding(finding), finding]));
  const expected = new Map(baseline.findings.map((finding) => [finding.fingerprint, finding]));
  return {
    newFindings: [...actual.entries()]
      .filter(([fingerprint]) => !expected.has(fingerprint))
      .map(([fingerprint, finding]) => ({ fingerprint, finding })),
    staleEntries: [...expected.entries()]
      .filter(([fingerprint]) => !actual.has(fingerprint))
      .map(([fingerprint, entry]) => ({ fingerprint, entry })),
  };
}

function classifyGatedFindings(findings) {
  const sourceFindings = findings.filter((finding) => !isDependencyOnly(finding));
  return {
    criticalFindings: sourceFindings.filter((finding) => finding.impact === "Critical"),
    highFindings: sourceFindings.filter((finding) => finding.impact === "High"),
  };
}

function assertVersion(label, output, expected) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(output)) {
    throw new Error(`${label} ${expected} required, received: ${output.trim() || "no version output"}`);
  }
}

function commandVersion(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} is unavailable: ${result.error?.message || result.stderr?.trim() || "unknown error"}`);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function assertToolchain(baseline) {
  const slitherCommand = process.env.SLITHER_BIN || "slither";
  const solcCommand = process.env.SOLC_BIN || "solc";
  assertVersion("Slither", commandVersion(slitherCommand, ["--version"], "Slither"), baseline.tool.slither);
  assertVersion("solc", commandVersion(solcCommand, ["--version"], "solc"), baseline.tool.solc);
}

function extractDetectors(report, contract) {
  if (report.success !== true || !Array.isArray(report.results?.detectors)) {
    throw new Error(`Slither returned an invalid report for ${contract}`);
  }
  return report.results.detectors;
}

function runSlither(contract, outputDirectory) {
  const output = path.join(outputDirectory, contract.replaceAll("/", "_").replaceAll(".", "_") + ".json");
  const command = process.env.SLITHER_BIN || "slither";
  const result = spawnSync(command, [
    contract,
    "--solc-remaps", "@openzeppelin/=node_modules/@openzeppelin/",
    "--solc-args", "--base-path . --include-path node_modules --allow-paths .,node_modules --evm-version cancun",
    "--exclude-dependencies",
    "--fail-none",
    "--json", output,
  ], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

  if (result.error || result.status !== 0 || !fs.existsSync(output)) {
    const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Slither failed for ${contract}${detail ? `:\n${detail}` : ""}`);
  }

  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  return extractDetectors(report, contract);
}

function main() {
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Missing Slither baseline: ${path.relative(root, baselinePath)}`);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.findings)) {
    throw new Error("Slither baseline must use schemaVersion 1 and a findings array");
  }
  assertToolchain(baseline);

  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-slither-"));
  try {
    const contracts = discoverContracts();
    const allFindings = contracts.flatMap((contract) => runSlither(contract, outputDirectory));
    const { criticalFindings, highFindings } = classifyGatedFindings(allFindings);
    if (criticalFindings.length) {
      for (const finding of criticalFindings) {
        console.error(`[slither] CRITICAL ${describeFinding(finding)}`);
      }
      throw new Error("Slither reported a Critical signal; Critical findings cannot be baselined");
    }
    const uniqueHighFindings = [...new Map(
      highFindings.map((finding) => [fingerprintFinding(finding), finding]),
    ).values()];
    const result = evaluateBaseline(uniqueHighFindings, baseline);

    console.log(`[slither] analyzed ${contracts.length} production Solidity files`);
    console.log(`[slither] observed ${uniqueHighFindings.length} reviewed High signals`);

    if (result.newFindings.length || result.staleEntries.length) {
      for (const { fingerprint, finding } of result.newFindings) {
        console.error(`[slither] NEW ${fingerprint} ${describeFinding(finding)}`);
      }
      for (const { fingerprint, entry } of result.staleEntries) {
        console.error(`[slither] STALE ${fingerprint} ${entry.subject}`);
      }
      throw new Error("Slither High baseline changed; review every delta before updating the baseline");
    }

    console.log("[slither] PASS - no new or changed High signals");
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[slither] FAIL - ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertVersion,
  classifyGatedFindings,
  describeFinding,
  discoverContracts,
  evaluateBaseline,
  extractDetectors,
  fingerprintFinding,
  isDependencyOnly,
  semanticElements,
};
