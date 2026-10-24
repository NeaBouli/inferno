#!/usr/bin/env node

// CWA-47 contract gate: the WalletConnect provider in the signing/wallet path
// is a pinned, repository-owned artifact served same-origin. This gate fails if
//   - the artifact is missing or its SHA-256 drifts from the recorded value,
//   - any browser-executable docs file loads remote code at runtime
//     (script src, static import or dynamic import from an http(s) URL),
//   - the wallet runtime stops referencing the pinned artifact,
//   - the service-worker precache drops the artifact,
//   - the reproducible build inputs under infra/web3/walletconnect-provider
//     are incomplete or the lockfile unpins the source package.
// Artifact provenance and update steps: infra/web3/walletconnect-provider/README.md.

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const DOCS = path.join(root, "docs");
const VENDOR_DIR = path.join(root, "infra", "web3", "walletconnect-provider");
const ARTIFACT_REL = "docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js";
const ARTIFACT = path.join(root, ARTIFACT_REL);
const HISTORICAL_ARTIFACT = path.join(root, "docs/assets/vendor/walletconnect-ethereum-provider-2.17.3.esm.js");
const ARTIFACT_SRC = "/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js";
const CORE_VERSION = "20261024-pulse-guard";
const GUARD_SRC = `/assets/wallet-telemetry-guard.js?v=${CORE_VERSION}`;
const EXPECTED_SHA256 = "77843c24c6c5aa5b4f743af3f2dd3a9d94e16b15bb8c5ff1bba58db2b14cd63e";
const HISTORICAL_SHA256 = "30273eb8eb78e88e29ecdb73606fa3e41e66a646a2b33f5c864014a065c709fc";

// ── Artifact presence and integrity ──────────────────────────────────
assert.ok(fs.existsSync(ARTIFACT), `missing self-hosted WalletConnect artifact: ${ARTIFACT_REL}`);
const artifact = fs.readFileSync(ARTIFACT);
const sha = createHash("sha256").update(artifact).digest("hex");
assert.equal(sha, EXPECTED_SHA256,
  `WalletConnect artifact SHA-256 drifted (${sha}); rebuild via infra/web3/walletconnect-provider and re-record`);
assert.equal(createHash("sha256").update(fs.readFileSync(HISTORICAL_ARTIFACT)).digest("hex"), HISTORICAL_SHA256,
  "historical WalletConnect artifact drifted; retain it byte-for-byte or remove it in an authorized cleanup");

const artifactText = artifact.toString("utf8");
assert.ok(!/import\s*\(\s*["']https?:\/\//.test(artifactText), "artifact must not dynamically import remote code");
assert.ok(!/from\s*["']https?:\/\//.test(artifactText), "artifact must not statically import remote code");
assert.ok(!/sourceMappingURL=https?:\/\//.test(artifactText), "artifact must not reference a remote sourcemap");
assert.ok(artifactText.length > 100000, "artifact looks truncated");

// ── No remote executable imports in any browser-executable docs file ──
function filesBelow(directory) {
  return fs.readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    return fs.statSync(file).isDirectory() ? filesBelow(file) : [file];
  });
}

const REMOTE_PATTERNS = [
  { re: /<script[^>]+\bsrc=["']https?:\/\//i, label: "remote <script src>" },
  { re: /\bimport\s*\(\s*["']https?:\/\//, label: "remote dynamic import()" },
  { re: /\bimport\s+(?:[^"']+\s+from\s+)?["']https?:\/\//, label: "remote static import" },
  { re: /\bfrom\s*["']https?:\/\//, label: "remote re-export" },
  { re: /\besm\.sh\b/, label: "esm.sh reference" },
];

for (const file of filesBelow(DOCS)) {
  if (!/\.(?:html|js|mjs)$/.test(file)) continue;
  if (file === ARTIFACT) continue;
  const name = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");
  for (const { re, label } of REMOTE_PATTERNS) {
    assert.ok(!re.test(source), `${name} contains ${label} — the signing/wallet path must not execute third-party code (CWA-47)`);
  }
}

// ── Wallet runtime references the pinned artifact ────────────────────
for (const rel of ["docs/web3-wallet-core.js", "docs/assets/wallet-core.js"]) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  assert.ok(source.includes(ARTIFACT_SRC), `${rel} must load ${ARTIFACT_SRC}`);
  assert.ok(source.includes("await import(WC_PROVIDER_URL)"), `${rel} must keep the lazy same-origin import()`);
  assert.ok(source.includes(`var WC_TELEMETRY_GUARD_URL = "${GUARD_SRC}";`), `${rel} must use the shared versioned guard`);
  const guardImport = source.indexOf("await import(WC_TELEMETRY_GUARD_URL)");
  const install = source.indexOf("guard.installWalletConnectTelemetryGuard();");
  const providerImport = source.indexOf("await import(WC_PROVIDER_URL)");
  assert.ok(guardImport > 0 && install > guardImport && providerImport > install, `${rel} must install the guard before evaluating the SDK`);
  assert.ok(source.includes("telemetryEnabled: false"), `${rel} must retain the Core telemetry opt-out`);
}
assert.ok(fs.existsSync(path.join(DOCS, GUARD_SRC.split("?")[0])), "shared telemetry guard must be published");

// Every real HTML consumer must expire its old core, including unversioned wiki URLs.
const consumers = [];
for (const file of filesBelow(DOCS).filter(file => file.endsWith(".html"))) {
  const source = fs.readFileSync(file, "utf8");
  for (const [, url] of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (!/(?:^|\/)(?:web3-)?wallet-core\.js(?:[?#]|$)/.test(url)) continue;
    const rel = path.relative(DOCS, file);
    const expected = rel === "web3/index.html" ? `/web3-wallet-core.js?v=${CORE_VERSION}` :
      (rel === "index.html" ? "assets/" : "../assets/") + `wallet-core.js?v=${CORE_VERSION}`;
    assert.equal(url, expected, `${rel} must use the current wallet core`);
    consumers.push(rel);
  }
}
assert.equal(consumers.length, 40, "expected landing, Web3 and all 38 wiki core consumers");
assert.equal(new Set(consumers).size, 40, "wallet core must be loaded exactly once per consumer");
assert.equal(consumers.filter(file => file.startsWith("wiki/")).length, 38);
assert.ok(consumers.includes("index.html") && consumers.includes("web3/index.html"));

// ── Service worker precaches the artifact ────────────────────────────
const serviceWorker = fs.readFileSync(path.join(DOCS, "web3-sw.js"), "utf8");
assert.ok(serviceWorker.includes(`"${ARTIFACT_SRC}"`), "web3-sw.js precache must include the WalletConnect artifact");
assert.ok(serviceWorker.includes('const CACHE_NAME = "ifr-web3-v24"'), "guard release must bump the service-worker cache to v24");
assert.ok(serviceWorker.includes(`"/web3-wallet-core.js?v=${CORE_VERSION}"`), "precache must use the HTML's core URL");
assert.ok(serviceWorker.includes(`"${GUARD_SRC}"`), "precache must use the loaders' guard URL");
const { REQUIRED_FILES } = require("./web3-release.cjs");
assert.ok(REQUIRED_FILES.includes("assets/wallet-telemetry-guard.js"), "release manifest must hash the shared guard");

// ── Reproducible build inputs ────────────────────────────────────────
for (const rel of ["package.json", "package-lock.json", "build.mjs", "entry.mjs", "shims.mjs", "README.md"]) {
  assert.ok(fs.existsSync(path.join(VENDOR_DIR, rel)), `missing vendor build input infra/web3/walletconnect-provider/${rel}`);
}
const lock = JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, "package-lock.json"), "utf8"));
const wcEntry = lock.packages && lock.packages["node_modules/@walletconnect/ethereum-provider"];
assert.ok(wcEntry, "vendor lockfile must contain @walletconnect/ethereum-provider");
assert.equal(wcEntry.version, "2.25.0", "vendor lockfile must pin @walletconnect/ethereum-provider to 2.25.0");
assert.ok(/^sha512-/.test(wcEntry.integrity || ""), "vendor lockfile must record the source package integrity hash");
for (const dependency of ["decode-uri-component", "lodash", "@stablelib/ed25519", "elliptic"]) {
  assert.ok(
    !lock.packages[`node_modules/${dependency}`],
    `vendor lockfile must not restore removed vulnerable dependency ${dependency}`,
  );
}
const esbuildEntry = lock.packages && lock.packages["node_modules/esbuild"];
assert.ok(esbuildEntry && esbuildEntry.version, "vendor lockfile must pin esbuild");

console.log("[web3-wallet-runtime-test] PASS (artifact integrity, no remote imports, pre-import guard, 40 core consumers, precache/manifest, build inputs)");
