#!/usr/bin/env node

"use strict";

// Project-owned Zod4 compatibility adapter for the JavaScript root Hardhat
// toolchain. Patches exactly one compiled file of the installed
// @nomicfoundation/hardhat-zod-utils@3.0.5 helper so Hardhat 3.20.0 config
// validation works against the root zod 4.6.7 override, and closes the Zod4
// own-enumerable "__proto__" record bypass fail-closed before safeParse.
// Scope: compiled JS runtime only. No upstream Zod4 or TypeScript
// compatibility is claimed; no zod/v3 routing, no vendor metadata changes,
// no network/shell access. See docs/tooling/root-zod4-compat.md.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HELPER_VERSION = "3.0.5";
const ZOD_VERSION = "4.6.7";
const HELPER_PACKAGE = "@nomicfoundation/hardhat-zod-utils";
const TARGET_REL = path.join(
  "node_modules",
  "@nomicfoundation",
  "hardhat-zod-utils",
  "dist",
  "src",
  "index.js"
);
const ORIGINAL_SHA256 =
  "8e10e6327da319ea5491bad7fe686fa0653cfc6db270457743eaca800a84c04e";
const PATCHED_SHA256 =
  "7104b0c759610430c11bc82cc0e477d1cc0c82f5584bc3c9b863b7d7816e2caa";

const REPLACEMENTS = [
  {
    name: "incompatibleFieldType message parameter",
    from: `export const incompatibleFieldType = (errorMessage = "Unexpected field") => z
    .never({
    errorMap: () => ({
        message: errorMessage,
    }),
})
    .optional();`,
    to: `export const incompatibleFieldType = (errorMessage = "Unexpected field") => z
    .never({
    message: errorMessage,
})
    .optional();`,
  },
  {
    name: "ZodError issues accessor",
    from: "        return result.error.errors.map((issue) => ({",
    to: "        return result.error.issues.map((issue) => ({",
  },
  {
    name: "fail-closed __proto__ guard",
    from: `export function validateUserConfigZodType(hardhatUserConfig, configType) {
    const result = configType.safeParse(hardhatUserConfig);`,
    to: `const findUnsupportedConfigPath = (value, path, seen) => {
    if (typeof value !== "object" || value === null || seen.has(value)) {
        return undefined;
    }
    seen.add(value);
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) {
        return path;
    }
    for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        const numericKey = Number(key);
        const childPath = [...path, isArray && Number.isInteger(numericKey) && numericKey >= 0 && numericKey < 4294967295 && String(numericKey) === key ? numericKey : key];
        if (key === "__proto__" || descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
            return childPath;
        }
        const nested = findUnsupportedConfigPath(descriptor.value, childPath, seen);
        if (nested !== undefined) {
            return nested;
        }
    }
    return undefined;
};
export function validateUserConfigZodType(hardhatUserConfig, configType) {
    const reservedKeyPath = findUnsupportedConfigPath(hardhatUserConfig, [], new Set());
    if (reservedKeyPath !== undefined) {
        return [
            {
                path: reservedKeyPath,
                message: 'Hardhat configuration requires plain data objects without accessors or the reserved key "__proto__"',
            },
        ];
    }
    const result = configType.safeParse(hardhatUserConfig);`,
  },
];

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function buildPatchedSource(originalText) {
  let patched = originalText;
  for (const { name, from, to } of REPLACEMENTS) {
    const occurrences = patched.split(from).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `replacement "${name}" matched ${occurrences} times; expected exactly 1`
      );
    }
    patched = patched.replace(from, to);
  }
  return patched;
}

class AdapterRejection extends Error {}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function realpathContained(realBase, targetPath, label) {
  let real;
  try {
    real = fs.realpathSync(targetPath);
  } catch {
    throw new AdapterRejection(`${label} is missing: ${targetPath}`);
  }
  if (real !== realBase && !real.startsWith(realBase + path.sep)) {
    throw new AdapterRejection(
      `${label} resolves outside the expected installed tree: ${real}`
    );
  }
  return real;
}

function applyAdapter(root) {
  const nodeModules = path.join(root, "node_modules");
  let realNodeModules;
  try {
    realNodeModules = fs.realpathSync(nodeModules);
  } catch {
    throw new AdapterRejection(`node_modules is missing under ${root}`);
  }
  const modulesStat = fs.lstatSync(nodeModules);
  if (!modulesStat.isDirectory() || modulesStat.isSymbolicLink()) {
    throw new AdapterRejection("node_modules must be a regular installed directory");
  }

  const zodPackageJson = path.join(nodeModules, "zod", "package.json");
  const helperPackageJson = path.join(
    nodeModules,
    "@nomicfoundation",
    "hardhat-zod-utils",
    "package.json"
  );
  const target = path.join(root, TARGET_REL);
  if (![zodPackageJson, helperPackageJson, path.join(nodeModules, "hardhat", "package.json")].some(fs.existsSync)) {
    return { changed: false, omitted: true };
  }

  realpathContained(realNodeModules, zodPackageJson, "zod package");
  realpathContained(realNodeModules, helperPackageJson, `${HELPER_PACKAGE} package`);
  realpathContained(realNodeModules, target, "helper compiled entry");

  const zodVersion = readJsonFile(zodPackageJson).version;
  if (zodVersion !== ZOD_VERSION) {
    throw new AdapterRejection(
      `expected zod ${ZOD_VERSION}, found ${zodVersion ?? "unknown"}`
    );
  }
  const helperVersion = readJsonFile(helperPackageJson).version;
  if (helperVersion !== HELPER_VERSION) {
    throw new AdapterRejection(
      `expected ${HELPER_PACKAGE} ${HELPER_VERSION}, found ${helperVersion ?? "unknown"}`
    );
  }

  const targetStat = fs.lstatSync(target);
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
    throw new AdapterRejection("helper compiled entry is not a regular file");
  }

  const currentText = fs.readFileSync(target, "utf8");
  const currentHash = sha256(currentText);
  if (currentHash === PATCHED_SHA256) {
    return { changed: false };
  }
  if (currentHash !== ORIGINAL_SHA256) {
    throw new AdapterRejection(
      `unexpected ${TARGET_REL} sha256 ${currentHash}; expected original ${ORIGINAL_SHA256} or patched ${PATCHED_SHA256}`
    );
  }

  const patchedText = buildPatchedSource(currentText);
  const patchedHash = sha256(patchedText);
  if (patchedHash !== PATCHED_SHA256) {
    throw new AdapterRejection(
      `adapter produced sha256 ${patchedHash}; expected ${PATCHED_SHA256}`
    );
  }

  fs.writeFileSync(target, patchedText, "utf8");
  const writtenHash = sha256(fs.readFileSync(target, "utf8"));
  if (writtenHash !== PATCHED_SHA256) {
    throw new AdapterRejection(
      `post-write verification failed: sha256 ${writtenHash}`
    );
  }
  return { changed: true };
}

function parseRoot(argv) {
  const index = argv.indexOf("--root");
  if (index === -1) {
    return path.resolve(__dirname, "..");
  }
  const value = argv[index + 1];
  if (value === undefined) {
    throw new AdapterRejection("--root requires a directory argument");
  }
  return path.resolve(value);
}

if (require.main === module) {
  try {
    const result = applyAdapter(parseRoot(process.argv.slice(2)));
    console.log(
      result.omitted
        ? "hardhat-zod4-compat: skipped (Hardhat dev dependencies omitted)"
        : result.changed
        ? `hardhat-zod4-compat: patched ${HELPER_PACKAGE}@${HELPER_VERSION} for zod ${ZOD_VERSION}`
        : `hardhat-zod4-compat: already applied (${HELPER_PACKAGE}@${HELPER_VERSION}, zod ${ZOD_VERSION})`
    );
  } catch (error) {
    if (error instanceof AdapterRejection) {
      console.error(`hardhat-zod4-compat: rejected: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

module.exports = {
  HELPER_VERSION,
  ZOD_VERSION,
  TARGET_REL,
  ORIGINAL_SHA256,
  PATCHED_SHA256,
  REPLACEMENTS,
  AdapterRejection,
  applyAdapter,
  buildPatchedSource,
  sha256,
};
