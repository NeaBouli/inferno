#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const distRoot = path.resolve(__dirname, "../apps/benefits-wallet-prototype/dist");
assert.ok(fs.existsSync(distRoot), "Build the Benefits wallet prototype before checking its bundle");

function collectJavaScript(directory) {
  return fs.readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    return fs.statSync(file).isDirectory()
      ? collectJavaScript(file)
      : /\.[cm]?js$/.test(name)
        ? [file]
        : [];
  });
}

const forbiddenServerParserMarkers = ["stream-json", "jayson", "StreamValues"];
const bundle = collectJavaScript(distRoot)
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

for (const marker of forbiddenServerParserMarkers) {
  assert.ok(
    !bundle.includes(marker),
    `Browser bundle unexpectedly contains server-only parser marker: ${marker}`,
  );
}

console.log("Benefits wallet browser bundle excludes Jayson and stream-json.");
