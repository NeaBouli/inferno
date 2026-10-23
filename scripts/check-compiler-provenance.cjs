#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
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
  if (!fs.existsSync(path.join(directory, source))) return null;
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
  if (settings.optimizer !== undefined && !isObject(settings.optimizer)) {
    throw new Error("Invalid optimizer settings");
  }
  const enabled = settings.optimizer?.enabled ?? false;
  const runs = settings.optimizer?.runs ?? 200;
  if (typeof enabled !== "boolean" || !Number.isSafeInteger(runs) || runs < 0) {
    throw new Error("Invalid optimizer settings");
  }
  return `${enabled ? "on" : "off"}/${runs}`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectPath(source) {
  if (typeof source !== "string" || !source.startsWith("contracts/") ||
      source.includes("\\") || source.split("/").some((part) => ["", ".", ".."].includes(part))) {
    throw new Error(`Invalid project source path: ${source}`);
  }
  return source;
}

function readProvenance(directory) {
  const file = path.join(directory, "audit/compiler-provenance-mainnet.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.schemaVersion !== 1 || data.chainId !== 1 || !Array.isArray(data.contracts)) {
    throw new Error("Invalid Mainnet compiler provenance schema");
  }
  const records = new Map();
  for (const record of data.contracts) {
    if (!isObject(record) || typeof record.name !== "string" || !record.name ||
        records.has(record.name) || !/^0x[0-9a-fA-F]{40}$/.test(record.address) ||
        typeof record.source !== "string" || !record.source.trim() ||
        !isObject(record.optimizer) || typeof record.optimizer.enabled !== "boolean" ||
        !Number.isSafeInteger(record.optimizer.runs) || record.optimizer.runs < 0 ||
        typeof record.evmVersion !== "string" || !/^[a-z][a-z0-9]*$/.test(record.evmVersion) ||
        (record.viaIR !== undefined && typeof record.viaIR !== "boolean") ||
        !["exact_match", "match", null].includes(record.creationMatch) ||
        !["exact_match", "match", null].includes(record.runtimeMatch) ||
        !isObject(record.sourceHashes) || !Object.keys(record.sourceHashes).length) {
      throw new Error(`Malformed compiler provenance record: ${record?.name ?? "unknown"}`);
    }
    versionParts(record.compilerVersion);
    const qualified = /^(.+):([A-Za-z_$][\w$]*)$/.exec(record.fullyQualifiedName);
    if (!qualified) throw new Error(`Invalid fullyQualifiedName: ${record.name}`);
    const source = projectPath(qualified[1].replace(/^project\//, ""));
    if (!Object.hasOwn(record.sourceHashes, source)) {
      throw new Error(`Missing root source hash: ${record.name}`);
    }
    for (const [file, entry] of Object.entries(record.sourceHashes)) {
      projectPath(file);
      if (!isObject(entry) || !/^[0-9a-f]{64}$/.test(entry.sha256) ||
          ![true, false, "missing"].includes(entry.repoMatch) ||
          ![file, `project/${file}`].includes(entry.sourcePath)) {
        throw new Error(`Invalid source hash: ${record.name}: ${file}`);
      }
    }
    records.set(record.name, record);
  }
  return records;
}

function sourceComparison(directory, record) {
  return Object.entries(record.sourceHashes).map(([file, entry]) => {
    const absolute = path.join(directory, file);
    // repoMatch is the evidence snapshot; always compare the current working tree afresh.
    const repoMatch = fs.existsSync(absolute)
      ? crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") === entry.sha256
      : "missing";
    return { file, repoMatch };
  });
}

function checkProvenance(directory = root) {
  const solidity = readCompilerConfig(directory);
  const manifestPath = path.join(directory, "deployments/mainnet.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!isObject(manifest)) throw new Error("Invalid Mainnet deployment manifest");
  const records = readProvenance(directory);
  const rows = [];
  const sources = {};
  const missingRecords = [];
  let drift = 0;
  let unknown = 0;
  for (const [name, deployment] of Object.entries(manifest)) {
    if (name.startsWith("_")) continue;
    if (!isObject(deployment) || deployment.network !== "mainnet" ||
        !/^0x[0-9a-fA-F]{40}$/.test(deployment.address)) {
      throw new Error(`Incomplete Mainnet deployment entry: ${name}`);
    }
    projectPath(deployment.source);
    const current = configuredCompiler(directory, solidity, deployment.source);
    if (current) versionParts(current.version);
    const currentOptimizer = current ? optimizer(current.settings ?? {}) : "unknown";
    const currentEvm = current?.settings?.evmVersion ?? "unknown";
    if (typeof currentEvm !== "string") throw new Error(`Invalid configured EVM version: ${name}`);
    const recorded = records.get(name);
    let status = "UNKNOWN";
    let recordedVersion = "unknown";
    let recordedOptimizer = "unknown";
    let recordedEvm = "unknown";
    let sourceDrift = "unknown";
    if (recorded) {
      if (recorded.address.toLowerCase() !== deployment.address.toLowerCase() ||
          recorded.fullyQualifiedName.split(":")[0].replace(/^project\//, "") !== deployment.source) {
        throw new Error(`Provenance identity differs from Mainnet manifest: ${name}`);
      }
      recordedVersion = recorded.compilerVersion;
      recordedOptimizer = optimizer(recorded);
      recordedEvm = recorded.evmVersion;
      sources[name] = sourceComparison(directory, recorded);
      sourceDrift = `${sources[name].filter((entry) => entry.repoMatch !== true).length}/${sources[name].length}`;
      if (current && currentEvm !== "unknown") {
        const matches = compareVersions(current.version, recordedVersion) === 0 &&
          (!current.version.includes("+") || !recordedVersion.includes("+") ||
            current.version.replace(/^v/, "") === recordedVersion.replace(/^v/, "")) &&
          currentOptimizer === recordedOptimizer && currentEvm === recordedEvm;
        status = matches ? "MATCH" : "DRIFT";
        if (!matches) drift += 1;
      }
    } else {
      missingRecords.push(name);
    }
    if (status === "UNKNOWN") unknown += 1;
    rows.push({ contract: name, configured: current?.version ?? "unknown", optimizer: currentOptimizer,
      evm: currentEvm, recorded: recordedVersion, recordedOptimizer, recordedEvm, status, sourceDrift });
  }
  if (!rows.length) throw new Error("No Mainnet contracts found in deployments/mainnet.json");
  return { rows, drift, unknown, missingRecords, sources };
}

function main(directory = root) {
  const { rows, drift, unknown, missingRecords, sources } = checkProvenance(directory);
  console.table(rows);
  console.log("[compiler-provenance] optimizer columns: enabled/runs (solc defaults: off/200).");
  console.log("[compiler-provenance] sourceDrift: differing or missing project files / recorded project files (fresh SHA-256 comparison; snapshot repoMatch is not trusted).");
  console.log("[compiler-provenance] Config selection uses source overrides or the highest root-pragma-compatible compiler; no compilation, dependency-pragma or bytecode verification.");
  console.log("[compiler-provenance] MATCH compares compiler version, optimizer enabled/runs and explicit evmVersion only; it does not certify bytecode reproducibility.");
  if (unknown) {
    console.log(`[compiler-provenance] UNKNOWN: ${unknown}/${rows.length} Mainnet contracts lack provenance or a selectable current compiler with explicit evmVersion.`);
  }
  if (drift) {
    console.log(`[compiler-provenance] DRIFT: ${drift}/${rows.length} deployed builds differ from hardhat.config.js (informational; expected for historical deployments). A redeploy from current config would NOT reproduce deployed bytecode for these contracts.`);
  }
  const files = Object.values(sources).flat();
  console.log(`[compiler-provenance] source drift: ${files.filter((entry) => entry.repoMatch !== true).length}/${files.length} project file comparisons differ or are missing.`);
  if (missingRecords.length) {
    console.error(`[compiler-provenance] FAIL: missing provenance record(s) in audit/compiler-provenance-mainnet.json: ${missingRecords.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`[compiler-provenance] PASS: ${rows.length}/${rows.length} Mainnet provenance records present; ${rows.length - drift - unknown} MATCH, ${drift} DRIFT, ${unknown} UNKNOWN.`);
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[compiler-provenance] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkProvenance, main };
