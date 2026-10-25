"use strict";

// Regression gate for the project-owned root Zod4 compatibility adapter
// (scripts/apply-hardhat-zod4-compat.cjs). Exercises the actual installed
// @nomicfoundation/hardhat-zod-utils helper, the actual installed Hardhat
// network validator, and the actual installed zod 4.6.7. These tests fail
// against the original unadapted helper: `result.error.errors` is undefined
// under Zod4 and own enumerable "__proto__" record entries are skipped.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const adapterPath = path.join(root, "scripts", "apply-hardhat-zod4-compat.cjs");
const adapter = require(adapterPath);
const helperDir = path.join(
  root,
  "node_modules",
  "@nomicfoundation",
  "hardhat-zod-utils"
);
const helperEntry = path.join(helperDir, "dist", "src", "index.js");
const helperTypings = path.join(helperDir, "dist", "src", "index.d.ts");
const networkValidationUrl = pathToFileURL(
  path.join(
    root,
    "node_modules",
    "hardhat",
    "dist",
    "src",
    "internal",
    "builtin-plugins",
    "network-manager",
    "type-validation.js"
  )
).href;
const zodEntryUrl = pathToFileURL(
  path.join(root, "node_modules", "zod", "index.js")
).href;

const ORIGINAL_TYPINGS_SHA256 =
  "009136505fca5ad76bac8f7ebbd1d3a6fc5f2ade7476216bbedcb3909e4f369b";

let installedPromise;
function loadInstalled() {
  if (installedPromise === undefined) {
    installedPromise = Promise.all([
      import(pathToFileURL(helperEntry).href),
      import(networkValidationUrl),
      import(zodEntryUrl),
    ]).then(([helper, validation, zod]) => ({
      helper,
      validateNetworkUserConfig: validation.validateNetworkUserConfig,
      z: zod.z,
    }));
  }
  return installedPromise;
}

const VALID_HTTP = { type: "http", url: "http://127.0.0.1:8545" };

function fileTree(dir) {
  const entries = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        entries.push([
          path.relative(dir, full),
          adapter.sha256(fs.readFileSync(full, "utf8")),
          stat.mtimeMs,
        ]);
      }
    }
  };
  walk(dir);
  return entries;
}

function makeFixture(t, { helperVersion, zodVersion, targetText }) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "zod4-compat-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const nm = path.join(fixture, "node_modules");
  const targetDir = path.join(
    nm,
    "@nomicfoundation",
    "hardhat-zod-utils",
    "dist",
    "src"
  );
  fs.mkdirSync(path.join(nm, "zod"), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(nm, "zod", "package.json"),
    JSON.stringify({ name: "zod", version: zodVersion })
  );
  fs.writeFileSync(
    path.join(nm, "@nomicfoundation", "hardhat-zod-utils", "package.json"),
    JSON.stringify({ name: "@nomicfoundation/hardhat-zod-utils", version: helperVersion })
  );
  fs.writeFileSync(path.join(targetDir, "index.js"), targetText);
  fs.writeFileSync(path.join(targetDir, "index.d.ts"), "typings witness\n");
  return { fixture, target: path.join(targetDir, "index.js") };
}

function runAdapter(fixture) {
  return spawnSync(process.execPath, [adapterPath, "--root", fixture], {
    encoding: "utf8",
  });
}

function invertPatched(patchedText) {
  let original = patchedText;
  for (const { name, from, to } of [...adapter.REPLACEMENTS].reverse()) {
    const occurrences = original.split(to).length - 1;
    assert.equal(
      occurrences,
      1,
      `inverse replacement "${name}" must match the installed helper exactly once`
    );
    original = original.replace(to, from);
  }
  return original;
}

test("installed toolchain matches the adapter pins and patched hash", () => {
  const zodVersion = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules", "zod", "package.json"), "utf8")
  ).version;
  const helperVersion = JSON.parse(
    fs.readFileSync(path.join(helperDir, "package.json"), "utf8")
  ).version;
  assert.equal(zodVersion, adapter.ZOD_VERSION);
  assert.equal(helperVersion, adapter.HELPER_VERSION);
  assert.equal(
    adapter.sha256(fs.readFileSync(helperEntry, "utf8")),
    adapter.PATCHED_SHA256,
    "installed helper must carry the applied adapter patch"
  );
});

test("network validator accepts a valid configuration", async () => {
  const { validateNetworkUserConfig } = await loadInstalled();
  const errors = await validateNetworkUserConfig({
    networks: { dev: { ...VALID_HTTP, chainId: 31337 } },
  });
  assert.deepEqual(errors, []);
});

test("network validator reports ordinary invalid values with path and message", async () => {
  const { validateNetworkUserConfig } = await loadInstalled();
  const errors = await validateNetworkUserConfig({
    networks: { dev: { type: "http", url: 123 } },
  });
  assert.deepEqual(errors, [
    {
      path: ["networks", "dev", "url"],
      message: "Expected a URL or a Configuration Variable",
    },
  ]);
});

test("network validator fails closed on an own enumerable __proto__ entry", async () => {
  const { validateNetworkUserConfig } = await loadInstalled();
  for (const payload of [
    '{"networks":{"__proto__":{"type":"http","url":123}}}',
    '{"networks":{"__proto__":{"type":"http","url":"http://127.0.0.1:8545","chainId":31337}}}',
  ]) {
    const errors = await validateNetworkUserConfig(JSON.parse(payload));
    assert.ok(errors.length > 0, "reserved __proto__ key must not be skipped");
    assert.deepEqual(errors[0].path, ["networks", "__proto__"]);
    assert.match(errors[0].message, /__proto__/);
  }
});

test("network validator fails closed on a nested own enumerable __proto__ key", async () => {
  const { validateNetworkUserConfig } = await loadInstalled();
  const input = {
    networks: {
      dev: {
        ...VALID_HTTP,
        chainId: 31337,
        meta: JSON.parse('{"__proto__":{"polluted":true}}'),
      },
    },
  };
  const errors = await validateNetworkUserConfig(input);
  assert.ok(errors.length > 0);
  assert.deepEqual(errors[0].path, ["networks", "dev", "meta", "__proto__"]);
});

test("proto guard uses numeric array index paths and survives cycles", async () => {
  const { helper, z } = await loadInstalled();
  const withArray = {
    networks: { list: [JSON.parse('{"__proto__":1}')] },
  };
  const errors = helper.validateUserConfigZodType(withArray, z.any());
  assert.deepEqual(errors.length, 1);
  assert.deepEqual(errors[0].path, ["networks", "list", 0, "__proto__"]);

  const cyclic = { networks: {} };
  cyclic.self = cyclic;
  assert.deepEqual(helper.validateUserConfigZodType(cyclic, z.any()), []);
  assert.deepEqual(
    helper.validateUserConfigZodType(
      { networks: { dev: VALID_HTTP } },
      z.any()
    ),
    []
  );
});

test("plain-data contract rejects accessors and inherited config without invoking getters", async () => {
  const { validateNetworkUserConfig } = await loadInstalled();
  let reads = 0;
  const record = {};
  Object.defineProperty(record, "__proto__", { enumerable: true, get() { reads++; return VALID_HTTP; } });
  const network = { ...VALID_HTTP };
  Object.defineProperty(network, "httpHeaders", { enumerable: true, get() { reads++; return JSON.parse('{"__proto__":123}'); } });
  for (const value of [{ networks: record }, { networks: { dev: network } }, Object.create({ networks: record })]) {
    assert.ok((await validateNetworkUserConfig(value)).length > 0);
  }
  assert.equal(reads, 0);
});

test("non-enumerable known fields are validated without invoking accessors", async () => {
  const { validateNetworkUserConfig } = await loadInstalled();
  let reads = 0;
  for (const descriptor of [
    { value: JSON.parse('{"__proto__":123}') },
    { get() { reads++; return JSON.parse('{"__proto__":123}'); } },
  ]) {
    const dev = { ...VALID_HTTP };
    Object.defineProperty(dev, "httpHeaders", descriptor);
    assert.ok((await validateNetworkUserConfig({ networks: { dev } })).length > 0);
  }
  const dev = { ...VALID_HTTP };
  Object.defineProperty(dev, "httpHeaders", { value: { "X-Fixture": "valid" } });
  assert.deepEqual(await validateNetworkUserConfig({ networks: { dev } }), []);
  assert.equal(reads, 0);
});

test("adapter rejects a symlinked node_modules without writes", (t) => {
  const original = invertPatched(fs.readFileSync(helperEntry, "utf8"));
  const { fixture } = makeFixture(t, { helperVersion: adapter.HELPER_VERSION, zodVersion: adapter.ZOD_VERSION, targetText: original });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zod4-link-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(path.join(fixture, "node_modules"), path.join(outside, "node_modules"));
  const before = fileTree(fixture);
  assert.notEqual(runAdapter(outside).status, 0);
  assert.deepEqual(fileTree(fixture), before);
});

test("adapter skips a production-only install with no Hardhat graph", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "zod4-prod-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture, "node_modules"));
  assert.deepEqual(adapter.applyAdapter(fixture), { changed: false, omitted: true });
  assert.deepEqual(fs.readdirSync(path.join(fixture, "node_modules")), []);
});

test("incompatibleFieldType keeps custom message and optional undefined", async () => {
  const { helper } = await loadInstalled();
  const schema = helper.incompatibleFieldType("fixture message");
  assert.equal(schema.safeParse(undefined).success, true);
  for (const value of [1, null]) {
    const parsed = schema.safeParse(value);
    assert.equal(parsed.success, false);
    assert.deepEqual(
      parsed.error.issues.map(({ path: p, message }) => ({ path: p, message })),
      [{ path: [], message: "fixture message" }]
    );
  }
});

test("chain id contract: safe integers accepted, 2**53 rejected", async () => {
  const { validateNetworkUserConfig } = await loadInstalled();
  for (const chainId of [1, 31337, 11155111, Number.MAX_SAFE_INTEGER]) {
    const errors = await validateNetworkUserConfig({
      networks: { dev: { ...VALID_HTTP, chainId } },
    });
    assert.deepEqual(errors, [], `chainId ${chainId} must be accepted`);
  }
  const errors = await validateNetworkUserConfig({
    networks: { dev: { ...VALID_HTTP, chainId: 2 ** 53 } },
  });
  assert.ok(errors.length > 0);
  assert.deepEqual(errors[0].path, ["networks", "dev", "chainId"]);
  assert.match(errors[0].message, /9007199254740991/);
});

test("adapter patches a pristine fixture and is idempotent", (t) => {
  const installedPatched = fs.readFileSync(helperEntry, "utf8");
  const originalText = invertPatched(installedPatched);
  assert.equal(
    adapter.sha256(originalText),
    adapter.ORIGINAL_SHA256,
    "inverted fixture must equal the official 3.0.5 compiled source"
  );

  const { fixture, target } = makeFixture(t, {
    helperVersion: adapter.HELPER_VERSION,
    zodVersion: adapter.ZOD_VERSION,
    targetText: originalText,
  });
  const before = fileTree(fixture);

  const first = runAdapter(fixture);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /patched/);
  assert.equal(
    adapter.sha256(fs.readFileSync(target, "utf8")),
    adapter.PATCHED_SHA256
  );
  const after = fileTree(fixture);
  assert.equal(after.length, before.length, "no files added or removed");
  const changed = after.filter(
    ([name, hash], i) => hash !== before[i][1] || name !== before[i][0]
  );
  assert.deepEqual(
    changed.map(([name]) => name),
    [path.join("node_modules", "@nomicfoundation", "hardhat-zod-utils", "dist", "src", "index.js")],
    "only the compiled helper entry may change"
  );

  const second = runAdapter(fixture);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already applied/);
  assert.deepEqual(fileTree(fixture), after, "idempotent run must not rewrite");
});

test("adapter rejects a changed helper version without writing", (t) => {
  const originalText = invertPatched(fs.readFileSync(helperEntry, "utf8"));
  const { fixture, target } = makeFixture(t, {
    helperVersion: "3.0.4",
    zodVersion: adapter.ZOD_VERSION,
    targetText: originalText,
  });
  const before = fileTree(fixture);
  const result = runAdapter(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hardhat-zod-utils.*3\.0\.5/);
  assert.deepEqual(fileTree(fixture), before, "rejection must not write");
  assert.equal(fs.readFileSync(target, "utf8"), originalText);
});

test("adapter rejects a changed zod version without writing", (t) => {
  const originalText = invertPatched(fs.readFileSync(helperEntry, "utf8"));
  const { fixture } = makeFixture(t, {
    helperVersion: adapter.HELPER_VERSION,
    zodVersion: "3.25.76",
    targetText: originalText,
  });
  const before = fileTree(fixture);
  const result = runAdapter(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /zod 4\.6\.7/);
  assert.deepEqual(fileTree(fixture), before, "rejection must not write");
});

test("adapter rejects unexpected compiled source without writing", (t) => {
  const { fixture, target } = makeFixture(t, {
    helperVersion: adapter.HELPER_VERSION,
    zodVersion: adapter.ZOD_VERSION,
    targetText: "// tampered compiled source\n",
  });
  const before = fileTree(fixture);
  const result = runAdapter(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected/);
  assert.deepEqual(fileTree(fixture), before, "rejection must not write");
  assert.equal(fs.readFileSync(target, "utf8"), "// tampered compiled source\n");
});

test("declared typings stay Zod3-only, untouched, and unclaimed", () => {
  assert.equal(
    adapter.sha256(fs.readFileSync(helperTypings, "utf8")),
    ORIGINAL_TYPINGS_SHA256,
    "vendor .d.ts must remain byte-identical to the original 3.0.5 typings"
  );
  assert.equal(adapter.TARGET_REL.endsWith(".js"), true);
  const docs = fs.readFileSync(
    path.join(root, "docs", "tooling", "root-zod4-compat.md"),
    "utf8"
  );
  assert.match(docs, /No TypeScript compatibility is claimed/);
  assert.doesNotMatch(docs, /supports TypeScript|TypeScript-compatible/i);
});
