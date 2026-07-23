const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const sdkRoot = path.resolve(__dirname, "..");
const requiredFiles = new Set([
  "README.md",
  "dist/benefits.d.ts",
  "dist/benefits.js",
  "dist/index.d.ts",
  "dist/index.js",
  "package.json",
]);
const optionalReleaseFiles = new Set(["LICENSE"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}\n${details}`);
  }

  return result.stdout.trim();
}

function assertPackageFiles(files) {
  const actualFiles = new Set(files.map(({ path: filePath }) => filePath));
  for (const filePath of requiredFiles) {
    assert.equal(actualFiles.has(filePath), true, `npm tarball is missing ${filePath}`);
  }
  for (const filePath of actualFiles) {
    assert.equal(
      requiredFiles.has(filePath) || optionalReleaseFiles.has(filePath),
      true,
      `npm tarball contains unexpected file ${filePath}`
    );
  }

  for (const filePath of actualFiles) {
    assert.doesNotMatch(filePath, /(^|\/)(?:\.env|node_modules|src|test)(?:\/|$)/);
  }
}

function createConsumerLock(tarballPath, packResult, sdkPackageJson) {
  const sdkLock = JSON.parse(
    fs.readFileSync(path.join(sdkRoot, "package-lock.json"), "utf8")
  );
  const runtimePackages = Object.fromEntries(
    Object.entries(sdkLock.packages).filter(([packagePath]) => packagePath.startsWith("node_modules/"))
  );

  return {
    name: "ifr-sdk-package-consumer",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "ifr-sdk-package-consumer",
        version: "1.0.0",
        dependencies: {
          "ifr-sdk": `file:${tarballPath}`,
        },
      },
      ...runtimePackages,
      "node_modules/ifr-sdk": {
        version: sdkPackageJson.version,
        resolved: `file:${tarballPath}`,
        integrity: packResult.integrity,
        license: sdkPackageJson.license,
        dependencies: sdkPackageJson.dependencies,
        engines: sdkPackageJson.engines,
      },
    },
  };
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ifr-sdk-package-"));

  try {
    const packOutput = run(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot],
      { cwd: sdkRoot }
    );
    const packResult = JSON.parse(packOutput);
    assert.equal(packResult.length, 1);
    assertPackageFiles(packResult[0].files);

    const tarballPath = path.join(tempRoot, packResult[0].filename);
    assert.equal(fs.existsSync(tarballPath), true, "npm tarball was not created");

    const sdkPackageJson = JSON.parse(
      fs.readFileSync(path.join(sdkRoot, "package.json"), "utf8")
    );
    const consumerRoot = path.join(tempRoot, "consumer");
    fs.mkdirSync(consumerRoot, { recursive: true });
    const consumerPackageJson = {
      name: "ifr-sdk-package-consumer",
      version: "1.0.0",
      private: true,
      dependencies: {
        "ifr-sdk": `file:${tarballPath}`,
      },
    };
    fs.writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify(consumerPackageJson, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(consumerRoot, "package-lock.json"),
      `${JSON.stringify(createConsumerLock(tarballPath, packResult[0], sdkPackageJson), null, 2)}\n`
    );
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: consumerRoot });

    const installedPackageJson = JSON.parse(
      fs.readFileSync(path.join(consumerRoot, "node_modules", "ifr-sdk", "package.json"), "utf8")
    );
    assert.equal(installedPackageJson.exports["."].types, "./dist/index.d.ts");
    assert.equal(installedPackageJson.exports["."].require, "./dist/index.js");
    assert.equal(installedPackageJson.exports["."].import, "./dist/index.js");
    assert.equal(installedPackageJson.sideEffects, false);
    assert.equal(installedPackageJson.engines.node, ">=20 <23");

    const installedLock = JSON.parse(
      fs.readFileSync(path.join(consumerRoot, "package-lock.json"), "utf8")
    );
    assert.equal(
      installedLock.packages["node_modules/ifr-sdk"].integrity,
      packResult[0].integrity,
      "npm installed a package with unexpected integrity"
    );

    fs.writeFileSync(
      path.join(consumerRoot, "consumer.cjs"),
      [
        'const assert = require("node:assert/strict");',
        'const sdk = require("ifr-sdk");',
        "assert.equal(typeof sdk.IFRClient, \"function\");",
        "assert.equal(typeof sdk.IFRBenefitsClient, \"function\");",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(consumerRoot, "consumer.mjs"),
      [
        'import assert from "node:assert/strict";',
        'import { IFRBenefitsClient, IFRClient } from "ifr-sdk";',
        'assert.equal(typeof IFRClient, "function");',
        'assert.equal(typeof IFRBenefitsClient, "function");',
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(consumerRoot, "consumer.ts"),
      [
        'import { IFRBenefitsClient, IFRClient } from "ifr-sdk";',
        "const client: IFRClient = new IFRClient();",
        "const benefits: IFRBenefitsClient = new IFRBenefitsClient();",
        "void client;",
        "void benefits;",
      ].join("\n")
    );

    run(process.execPath, ["consumer.cjs"], { cwd: consumerRoot });
    run(process.execPath, ["consumer.mjs"], { cwd: consumerRoot });
    run(
      path.join(sdkRoot, "node_modules", ".bin", "tsc"),
      [
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2020",
        "--module",
        "Node16",
        "--moduleResolution",
        "Node16",
        "consumer.ts",
      ],
      { cwd: consumerRoot }
    );
    console.log("[ifr-sdk-package-consumer] PASS");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("[ifr-sdk-package-consumer] FAIL", error);
  process.exitCode = 1;
}
