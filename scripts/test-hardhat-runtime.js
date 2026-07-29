"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { connectHardhat } = require("./lib/hardhat-runtime");

function assertNoLegacyHardhatRequires() {
  const scriptsDir = __dirname;
  const pending = [scriptsDir];
  const legacyRequires = [];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (
        entry.isFile() &&
        entryPath !== __filename &&
        entry.name.endsWith(".js") &&
        /require\(\s*["']hardhat["']\s*\)/.test(
          fs.readFileSync(entryPath, "utf8"),
        )
      ) {
        legacyRequires.push(path.relative(scriptsDir, entryPath));
      }
    }
  }

  assert.deepEqual(
    legacyRequires,
    [],
    `legacy synchronous Hardhat imports found in: ${legacyRequires.join(", ")}`,
  );
}

async function main() {
  assertNoLegacyHardhatRequires();
  const runtime = await connectHardhat();
  const signers = await runtime.ethers.getSigners();
  const network = await runtime.ethers.provider.getNetwork();

  assert.ok(runtime.connection, "network connection is missing");
  assert.ok(runtime.ethers, "ethers extension is missing");
  assert.ok(runtime.network.name, "network name is missing");
  assert.ok(signers.length > 0, "no local signer is available");
  assert.equal(typeof network.chainId, "bigint");

  await runtime.connection.close();
  console.log(
    `Hardhat runtime PASS (${runtime.network.name}, chainId ${network.chainId})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
