#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const childProcess = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const dns = require("node:dns");
const dgram = require("node:dgram");

const checkerFile = require.resolve("./check-benefits-wallet-advisory-baseline.cjs");
const MAX_LOADER_PATH_LOOKUPS = 4;

// Imports targetFile with every fs/net/child_process/process/console escape spied
// and denied. Only the CJS loader itself may resolve targetFile's path (realpath/
// stat of that file or its directory chain, strictly before the source read,
// counted and bounded) and perform its single source read; module-side calls
// stay fatal.
function importInert(targetFile) {
  const fsPromises = fs.promises;
  const dnsPromises = dns.promises;
  const stdout = process.stdout;
  const stderr = process.stderr;
  const previousCache = require.cache[targetFile];
  delete require.cache[targetFile];
  const restorers = [];
  const attempts = [];
  let loaderReads = 0;
  let loaderPathLookups = 0;
  let loadingSource = false;
  let imported;
  let importError = null;

  function isTargetPath(value) {
    return typeof value === "string" &&
      (value === targetFile || targetFile.startsWith(value + path.sep));
  }

  function spy(object, key, label) {
    const original = object[key];
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    assert.equal(typeof original, "function", label);
    object[key] = function (...args) {
      // Permit only the CJS loader's one source read, never a module-side read.
      if (object === fs && key === "readFileSync" && !loadingSource &&
          loaderReads === 0 && args[0] === targetFile) {
        loaderReads++;
        loadingSource = true;
        try { return original.apply(this, args); }
        finally { loadingSource = false; }
      }
      if (object === fs && loadingSource) return original.apply(this, args);
      // Permit only the loader's own path resolution of the target, which always
      // precedes the source read (loaderReads === 0); module code runs after it.
      if (object === fs && loaderReads === 0 &&
          (key === "realpathSync" || key === "statSync" || key === "lstatSync") &&
          isTargetPath(args[0])) {
        loaderPathLookups++;
        assert.ok(loaderPathLookups <= MAX_LOADER_PATH_LOOKUPS,
          "Loader path lookups must stay bounded: " + label);
        return original.apply(this, args);
      }
      attempts.push(label);
      throw new Error("Checker import must be inert: " + label);
    };
    restorers.push(() => {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else delete object[key];
    });
  }

  try {
    spy(net.Socket.prototype, "connect", "Socket.connect");
    spy(net.Server.prototype, "listen", "Server.listen");
    spy(dgram.Socket.prototype, "bind", "Datagram.bind");
    spy(dgram.Socket.prototype, "send", "Datagram.send");
    for (const [label, object] of [
      ["fs", fs], ["fs.promises", fsPromises], ["child_process", childProcess],
      ["net", net], ["http", http], ["https", https], ["tls", tls],
      ["dns", dns], ["dns.promises", dnsPromises], ["dgram", dgram], ["console", console],
    ]) {
      for (const key of Object.keys(object)) {
        if (typeof object[key] === "function") spy(object, key, label + "." + key);
      }
    }
    for (const key of ["exit", "abort", "kill", "chdir", "emitWarning"]) spy(process, key, "process." + key);
    spy(stdout, "write", "stdout.write");
    spy(stderr, "write", "stderr.write");
    imported = require(targetFile);
  } catch (error) {
    importError = error;
  } finally {
    for (const restore of restorers.reverse()) restore();
    if (previousCache) require.cache[targetFile] = previousCache;
    else delete require.cache[targetFile];
  }
  return { imported, importError, attempts, loaderReads, loaderPathLookups };
}

const probe = importInert(checkerFile);
assert.ifError(probe.importError);
assert.equal(probe.loaderReads, 1, "Fresh import must use the sole permitted loader source read");
assert.ok(probe.loaderPathLookups <= MAX_LOADER_PATH_LOOKUPS,
  "Loader path resolution of the checker must stay bounded");
assert.deepEqual(probe.attempts, [], "Import must not read app files, spawn, use network or log");
assert.deepEqual(Object.keys(probe.imported), ["checkAuditReport"]);
assert.equal(typeof probe.imported.checkAuditReport, "function");
const { checkAuditReport } = probe.imported;

// Self-check: the spy must still flag a deliberately non-inert module.
const nonInertPath = path.join(os.tmpdir(), "advisory-non-inert-selfcheck-" + process.pid + ".cjs");
fs.writeFileSync(nonInertPath, "require(\"node:fs\").readdirSync(\".\");\nmodule.exports = {};\n");
try {
  const nonInert = importInert(fs.realpathSync(nonInertPath));
  assert.ok(nonInert.importError instanceof Error, "Non-inert self-check module must be rejected");
  assert.equal(nonInert.importError.message, "Checker import must be inert: fs.readdirSync");
  assert.equal(nonInert.loaderReads, 1, "Self-check module must run after the loader read");
  assert.deepEqual(nonInert.attempts, ["fs.readdirSync"]);
} finally {
  fs.unlinkSync(nonInertPath);
}

// Original immutable synthetic artifact, embedded byte-for-byte; no runtime fixture path.
const fixtureSource = [
  "{\n  \"purpose\": \"Prepared synthetic audit-report regression inputs; NOT EXECUTED. These cannot substitute for actual npm audit, dependency closure or wallet/runtime validation.\",\n  \"cases\": [\n    {\n      \"id\": \"clean_v2\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n           ",
  " \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"PASS\"\n    },\n    {\n      \"id\": \"empty\",\n      \"exit\": 0,\n      \"report\": {},\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"null\",\n      \"exit\": 0,\n      \"report\": null,\n      \"expected\": \"FAIL\"\n ",
  "   },\n    {\n      \"id\": \"array\",\n      \"exit\": 0,\n      \"report\": [],\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"version_undefined\",\n      \"exit\": 0,\n      \"report\": {\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n  ",
  "          \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"version_1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 1,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\"",
  ": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"version_3\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 3,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"cr",
  "itical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"version_2\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": \"2\",\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n      ",
  "      \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"metadata_null\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": null\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"metadata_{}\",\n      \"exit\": 0,\n      \"report\": {\n        \"",
  "auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {}\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"metadata_[]\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": []\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"metadata_missing\",\n      \"exit\": 0,\n      \"report\"",
  ": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {}\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"counts_null\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": null\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"counts_{}\",\n      ",
  "\"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {}\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"counts_[]\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": []\n  ",
  "      }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"counts_missing\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {}\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_info_undefined\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\":",
  " {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_info_0\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        ",
  "\"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": \"0\",\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_info_-1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\":",
  " {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": -1,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_info_0.5\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vuln",
  "erabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0.5,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_info_1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n ",
  "       \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 1,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_low_undefined\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditRep",
  "ortVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_low_0\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": ",
  "2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": \"0\",\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_low_-1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditRepo",
  "rtVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": -1,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_low_0.5\",\n      \"exit\": 0,\n      \"report\": {\n      ",
  "  \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0.5,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_low_1\",\n      \"exit\": 0,\n      \"report",
  "\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 1,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_moderate_undefined\",\n      \"e",
  "xit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_moderate_0\",\n      \"exit\": 0,\n    ",
  "  \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": \"0\",\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_moderate_-1\",\n    ",
  "  \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": -1,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_mo",
  "derate_0.5\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0.5,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n   ",
  "   \"id\": \"count_moderate_1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 1,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n  ",
  "  },\n    {\n      \"id\": \"count_high_undefined\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n",
  "    {\n      \"id\": \"count_high_0\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": \"0\",\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"F",
  "AIL\"\n    },\n    {\n      \"id\": \"count_high_-1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": -1,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"e",
  "xpected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_high_0.5\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0.5,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n   ",
  "   },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_high_1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 1,\n            \"critical\": 0,\n            \"total\": 0\n          }\n   ",
  "     }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_critical_undefined\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"total\": 0\n          }\n        ",
  "}\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_critical_0\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": \"0\",\n            \"total\": 0\n    ",
  "      }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_critical_-1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": -1,\n           ",
  " \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_critical_0.5\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\"",
  ": 0.5,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_critical_1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n      ",
  "      \"critical\": 1,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_total_undefined\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n          ",
  "  \"high\": 0,\n            \"critical\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_total_0\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n",
  "            \"critical\": 0,\n            \"total\": \"0\"\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_total_-1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n         ",
  "   \"high\": 0,\n            \"critical\": 0,\n            \"total\": -1\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_total_0.5\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\"",
  ": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0.5\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"count_total_1\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n         ",
  "   \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 1\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"map_missing\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n    ",
  "        \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"map_null\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": null,\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\":",
  " 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"map_[]\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": [],\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"modera",
  "te\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"map_{\\\"example\\\":{\\\"severity\\\":\\\"low\\\"}}\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {\n          \"example\": {\n            \"severity\": \"low\"\n          }\n        },\n     ",
  "   \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"error_null\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {",
  "},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        },\n        \"error\": null\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"error_{\\\"code\\\":\\\"EAUDIT\\\"}\",\n      \"exit\": 0,\n      \"report\": {\n        \"audi",
  "tReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        },\n        \"error\": {\n          \"code\": \"EAUDIT\"\n        }\n      },\n      \"expected\": \"FAIL\"\n    },\n    {\n      \"id",
  "\": \"unknown_counter\",\n      \"exit\": 0,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0,\n            \"unknown\": 0\n          }\n        }\n      },\n      \"e",
  "xpected\": \"FAIL\"\n    },\n    {\n      \"id\": \"exit_1\",\n      \"exit\": 1,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n    ",
  "  \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"exit_2\",\n      \"exit\": 2,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }\n      },\n",
  "      \"expected\": \"FAIL\"\n    },\n    {\n      \"id\": \"exit_null\",\n      \"exit\": null,\n      \"report\": {\n        \"auditReportVersion\": 2,\n        \"vulnerabilities\": {},\n        \"metadata\": {\n          \"vulnerabilities\": {\n            \"info\": 0,\n            \"low\": 0,\n            \"moderate\": 0,\n            \"high\": 0,\n            \"critical\": 0,\n            \"total\": 0\n          }\n        }",
  "\n      },\n      \"expected\": \"FAIL\"\n    }\n  ]\n}",
].join("");

assert.equal(
  createHash("sha256").update(fixtureSource, "utf8").digest("hex"),
  "d702fe5b5646a464ef23658790c9ad8bc56a6ea343d73422529871af6ee52471",
  "Embedded fixture artifact must retain its reviewed identity",
);
const { cases } = JSON.parse(fixtureSource);
assert.equal(cases.length, 56);
assert.equal(new Set(cases.map(fixture => fixture.id)).size, 56);
let passes = 0;
let refusals = 0;
for (const fixture of cases) {
  assert.ok(fixture.expected === "PASS" || fixture.expected === "FAIL", fixture.id);
  const invoke = () => checkAuditReport(fixture.exit, JSON.stringify(fixture.report));
  if (fixture.expected === "PASS") {
    assert.doesNotThrow(invoke, fixture.id);
    passes++;
  } else {
    assert.throws(invoke, Error, fixture.id);
    refusals++;
  }
}
assert.equal(passes, 1);
assert.equal(refusals, 55);
const clean = cases.find(fixture => fixture.id === "clean_v2");
assert.ok(clean);
const cleanStdout = JSON.stringify(clean.report);
let extraRefusals = 0;
function reject(id, status, text) {
  assert.throws(() => checkAuditReport(status, text), Error, id);
  extraRefusals++;
}
for (const [id, text] of [
  ["invalid stdout", "not-json"], ["empty stdout", ""], ["whitespace stdout", " \n\t"],
  ["undefined stdout", undefined], ["null stdout", null], ["raw JSON null", "null"],
  ["raw JSON -0 root", "-0"], ["raw JSON false", "false"], ["raw JSON string", '"report"'],
]) reject(id, 0, text);
for (const [index, status] of [-0, null, undefined, 1, 2, -1, "0", NaN, Infinity, false, 0n].entries()) {
  reject("unclean status " + index, status, cleanStdout);
}
for (const severity of ["info", "low", "moderate", "high", "critical", "total"]) {
  // JSON.stringify(-0) erases its sign; preserve a raw JSON negative-zero token.
  const text = cleanStdout.replace('"' + severity + '":0', '"' + severity + '":-0');
  assert.notEqual(text, cleanStdout);
  assert.ok(Object.is(JSON.parse(text).metadata.vulnerabilities[severity], -0));
  reject("raw negative-zero " + severity, 0, text);
}
const ownProto = cleanStdout.replace('"vulnerabilities":{}', '"vulnerabilities":{"__proto__":{}}');
assert.notEqual(ownProto, cleanStdout);
assert.ok(Object.hasOwn(JSON.parse(ownProto).vulnerabilities, "__proto__"));
reject("own prototype-named advisory", 0, ownProto);
const unsafeCount = cleanStdout.replace('"info":0', '"info":9007199254740992');
assert.notEqual(unsafeCount, cleanStdout);
reject("unsafe integer counter", 0, unsafeCount);
assert.equal(extraRefusals, 28);
console.log(JSON.stringify({ fixtures: 56, passes, refusals, extraRefusals,
  loaderPathLookups: probe.loaderPathLookups, importInert: true, nonInertSelfCheck: true }));
