#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

// Inspect the local config offline, without loading Hardhat, dotenv, plugins or credentials.
function readCompilerConfig(directory) {
  const source = fs.readFileSync(path.join(directory, "hardhat.config.js"), "utf8")
    .replace(/^import\s+"[^"]+";\s*$/gm, "")
    .replace(/^import\s+(\w+)\s+from\s+"[^"]+";\s*$/gm, "const $1 = undefined;")
    .replace(/^import\s+\{ defineConfig \}\s+from\s+"hardhat\/config";\s*$/m,
      "const defineConfig = (config) => config;")
    .replace("export default defineConfig(", "defineConfig(");
  const config = vm.runInNewContext(source, { process: { env: {} } }, { timeout: 1000 });
  if (!config?.solidity?.compilers?.length) throw new Error("Unsupported Solidity config");
  return config.solidity;
}

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version);
  if (!match) throw new Error(`Unsupported compiler version: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function configuredCompiler(directory, solidity, source) {
  if (solidity.overrides?.[source]) return solidity.overrides[source];
  const text = fs.readFileSync(path.join(directory, source), "utf8");
  const pragma = /pragma\s+solidity\s+(\^?\d+\.\d+\.\d+)\s*;/.exec(text)?.[1];
  // Fail instead of guessing if future sources introduce a different range syntax.
  if (!pragma) throw new Error(`Unsupported or missing Solidity pragma: ${source}`);
  const minimum = pragma.replace(/^\^/, "");
  const parts = versionParts(minimum);
  const candidates = solidity.compilers.filter(({ version }) => {
    if (!pragma.startsWith("^")) return compareVersions(version, minimum) === 0;
    const candidate = versionParts(version);
    const sameRange = parts[0] > 0 ? candidate[0] === parts[0]
      : parts[1] > 0 ? candidate[0] === 0 && candidate[1] === parts[1]
        : candidate[0] === 0 && candidate[1] === 0 && candidate[2] === parts[2];
    return sameRange && compareVersions(version, minimum) >= 0;
  });
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  if (!candidates.length) throw new Error(`No configured compiler satisfies ${source}: ${pragma}`);
  return candidates[0];
}

function optimizer(settings) {
  const enabled = settings.optimizer?.enabled ?? false;
  const runs = settings.optimizer?.runs ?? 200;
  if (typeof enabled !== "boolean" || !Number.isSafeInteger(runs) || runs < 0) {
    throw new Error("Invalid optimizer settings");
  }
  return `${enabled ? "on" : "off"}/${runs}`;
}

function checkProvenance(directory = root) {
  const solidity = readCompilerConfig(directory);
  const manifestPath = path.join(directory, "deployments/mainnet.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const rows = [];
  let mismatches = 0;
  let unknown = 0;
  for (const [name, deployment] of Object.entries(manifest)) {
    if (name.startsWith("_")) continue;
    if (deployment.network !== "mainnet" || !deployment.source) {
      throw new Error(`Incomplete Mainnet deployment entry: ${name}`);
    }
    const current = configuredCompiler(directory, solidity, deployment.source);
    const currentOptimizer = optimizer(current.settings ?? {});
    // Optional future record: compiler: { version, settings: { optimizer: { enabled, runs } } }.
    // Only deployment-era records count; local artifacts and pragma ranges are not provenance.
    const recorded = deployment.compiler;
    let status = "UNKNOWN";
    let recordedVersion = "unknown";
    let recordedOptimizer = "unknown";
    if (recorded) {
      if (typeof recorded.version !== "string" || !recorded.settings ||
          typeof recorded.settings !== "object" || Array.isArray(recorded.settings)) {
        throw new Error(`Incomplete recorded compiler metadata: ${name}`);
      }
      recordedVersion = recorded.version;
      recordedOptimizer = optimizer(recorded.settings);
      const matches = compareVersions(current.version, recorded.version) === 0 &&
        currentOptimizer === recordedOptimizer;
      status = matches ? "MATCH" : "MISMATCH";
      if (!matches) mismatches += 1;
    } else {
      unknown += 1;
    }
    rows.push({ contract: name, configured: current.version, optimizer: currentOptimizer,
      recorded: recordedVersion, recordedOptimizer, status });
  }
  if (!rows.length) throw new Error("No Mainnet contracts found in deployments/mainnet.json");
  return { rows, mismatches, unknown };
}

function main() {
  const { rows, mismatches, unknown } = checkProvenance();
  console.table(rows);
  console.log("[compiler-provenance] optimizer columns: enabled/runs (solc defaults: off/200).");
  console.log("[compiler-provenance] Config selection uses source overrides or the highest root-pragma-compatible compiler; no compilation, dependency-pragma or bytecode verification.");
  if (unknown) {
    console.log(`[compiler-provenance] UNKNOWN: ${unknown}/${rows.length} Mainnet contracts have no recorded compiler/optimizer metadata in deployments/mainnet.json. Provenance is NOT verified.`);
    console.log("[compiler-provenance] Preserve deployment-era solc input/metadata and record compiler.version plus compiler.settings before claiming a match; see docs/community-audits/README.md (JUL-21).");
  }
  if (mismatches) {
    console.error(`[compiler-provenance] FAIL: ${mismatches} recorded build settings differ from hardhat.config.js.`);
    process.exitCode = 1;
  } else if (!unknown) {
    console.log("[compiler-provenance] PASS: all recorded compiler versions and optimizer settings match.");
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[compiler-provenance] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkProvenance };
