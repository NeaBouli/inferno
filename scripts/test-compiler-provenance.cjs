#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { checkProvenance } = require("./check-compiler-provenance.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-compiler-provenance-"));
const source = "contracts/Fixture.sol";
const content = "pragma solidity ^0.8.20;\ncontract Fixture {}\n";
const address = `0x${"1".repeat(40)}`;
const record = {
  name: "Fixture", address,
  fullyQualifiedName: `project/${source}:Fixture`,
  compilerVersion: "0.8.28+commit.7893614a",
  optimizer: { enabled: false, runs: 200 },
  evmVersion: "cancun",
  creationMatch: "exact_match", runtimeMatch: "exact_match",
  source: "offline fixture",
  sourceHashes: {
    [source]: {
      sourcePath: `project/${source}`,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      repoMatch: true,
    },
  },
};

function write(relative, value) {
  fs.writeFileSync(path.join(directory, relative), typeof value === "string" ? value : JSON.stringify(value));
}

function provenance(records = [record]) {
  write("audit/compiler-provenance-mainnet.json", { schemaVersion: 1, chainId: 1, contracts: records });
}

function config(overrides = {}) {
  // These unavailable modules must never be imported; the checker only inspects the local config.
  write("hardhat.config.js", 'import "fixture-module-must-not-load";\n' +
    'import { defineConfig } from "hardhat/config";\nexport default defineConfig(' + JSON.stringify({
      solidity: { compilers: [{ version: "0.8.28", settings: { evmVersion: "cancun" } }], overrides },
    }) + ");\n");
}

function cli() {
  return spawnSync(process.execPath, ["-e",
    "require(process.argv[1]).main(process.argv[2]);",
    path.join(__dirname, "check-compiler-provenance.cjs"), directory,
  ], { encoding: "utf8", timeout: 5000 });
}

try {
  for (const subdir of ["contracts", "deployments", "audit"]) fs.mkdirSync(path.join(directory, subdir));
  write(source, content);
  write("deployments/mainnet.json", {
    _manifest: { chainId: 1 }, Fixture: { address, network: "mainnet", source },
  });
  config();
  provenance();
  let result = checkProvenance(directory);
  assert.equal(result.rows[0].status, "MATCH");
  assert.equal(result.rows[0].sourceDrift, "0/1");
  assert.equal(cli().status, 0, "MATCH must exit successfully");

  provenance([{ ...record, compilerVersion: "0.8.20+commit.a1b79de6", evmVersion: "paris" }]);
  result = checkProvenance(directory);
  assert.equal(result.rows[0].status, "DRIFT");
  assert.equal(result.drift, 1);
  const historical = cli();
  assert.equal(historical.status, 0, historical.stderr);
  assert.match(historical.stdout, /would NOT reproduce deployed bytecode/);

  provenance([{ ...record, evmVersion: "paris" }]);
  assert.equal(checkProvenance(directory).rows[0].status, "DRIFT", "EVM-only drift must be detected");
  provenance([{ ...record, optimizer: { enabled: true, runs: 200 } }]);
  assert.equal(checkProvenance(directory).rows[0].status, "DRIFT", "optimizer enablement must be compared");
  provenance([{ ...record, optimizer: { enabled: false, runs: 999 } }]);
  assert.equal(checkProvenance(directory).rows[0].status, "DRIFT", "optimizer runs must be compared");

  provenance([{ ...record, compilerVersion: "0.8.20+commit.a1b79de6", evmVersion: "paris" }]);
  config({ [source]: { version: "0.8.20", settings: { evmVersion: "paris" } } });
  assert.equal(checkProvenance(directory).rows[0].status, "MATCH", "source override must select legacy compiler");
  config();
  provenance();

  write(source, `${content}// changed since the evidence snapshot\n`);
  assert.equal(checkProvenance(directory).rows[0].sourceDrift, "1/1", "rehash instead of trusting repoMatch");
  fs.unlinkSync(path.join(directory, source));
  result = checkProvenance(directory);
  assert.equal(result.sources.Fixture[0].repoMatch, "missing");
  assert.equal(result.rows[0].sourceDrift, "1/1");
  assert.equal(result.rows[0].status, "UNKNOWN");
  assert.equal(cli().status, 0, "a missing repo source is informational, not a missing provenance record");
  write(source, content);

  provenance([]);
  result = checkProvenance(directory);
  assert.equal(result.rows[0].status, "UNKNOWN");
  assert.deepEqual(result.missingRecords, ["Fixture"]);
  const missing = cli();
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stdout, /UNKNOWN/);
  assert.match(missing.stderr, /missing provenance record\(s\).*Fixture/);

  provenance([{ ...record, optimizer: { enabled: "false", runs: 200 } }]);
  assert.throws(() => checkProvenance(directory), /Malformed compiler provenance record/);
  provenance([{ ...record, address: `0x${"2".repeat(40)}` }]);
  assert.throws(() => checkProvenance(directory), /Provenance identity differs/);
  provenance([{ ...record, sourceHashes: { [source]: { ...record.sourceHashes[source], sha256: "bad" } } }]);
  assert.throws(() => checkProvenance(directory), /Invalid source hash/);
  provenance([record, record]);
  assert.throws(() => checkProvenance(directory), /Malformed compiler provenance record/);
  console.log("[compiler-provenance-test] PASS - MATCH, DRIFT (compiler/optimizer/EVM), overrides, fresh source hashes, missing files/records, malformed data; offline CLI exit codes verified");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
