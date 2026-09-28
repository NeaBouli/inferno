// Reproducible bundling of @walletconnect/ethereum-provider@2.25.0 into a
// single-file browser ESM artifact served same-origin at
// docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js (CWA-47).
//
// Determinism: pinned npm lockfile inputs + pinned esbuild. Rebuild with
// `npm ci && npm run build` in this directory; the output SHA-256 must match
// the value recorded in README.md and scripts/check-web3-wallet-runtime.cjs.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(
  here,
  "../../../docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js",
);
const legalFile = `${outfile}.LEGAL.txt`;

await build({
  entryPoints: [resolve(here, "entry.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  outfile,
  inject: [resolve(here, "shims.mjs")],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  // Transpile template literals to concatenated string literals so upstream
  // sources that carry literal whitespace runs (e.g. the lit-html `[ \t\n\f\r]`
  // character class) cannot emit trailing whitespace into the artifact;
  // repository gates (`git diff --check`) apply to generated files too.
  supported: {
    "template-literal": false,
  },
  // Extract legal comments so the license banner can be re-inlined below
  // with trailing whitespace stripped (the upstream tslib license text
  // contains whitespace-only lines that would otherwise fail the gates).
  legalComments: "linked",
  logLevel: "info",
});

// Re-inline the extracted legal comments at the top of the artifact with
// trailing whitespace removed, then drop the sidecar and the pointer comment.
// esbuild's sidecar text is not valid JavaScript (per-module `path.js:` header
// lines sit between self-contained comment blocks), so each header line is
// emitted as a `//` line comment while the original comment blocks stay
// verbatim. Only insignificant line-end whitespace is normalized beyond that,
// keeping the transformation semantic-free and deterministic.
const banner = readFileSync(legalFile, "utf8")
  .split("\n")
  .map((line) => {
    const clean = line.replace(/[ \t]+$/u, "");
    return /^\S[^]*:$/u.test(clean) ? `// ${clean}` : clean;
  })
  .join("\n")
  .trim();
unlinkSync(legalFile);
const code = readFileSync(outfile, "utf8").replace(
  /\/\*! For license information please see [^*]*\*\/\n?/u,
  "",
);
const artifact = `/*! Bundled third-party license information: */\n${banner}\n${code}`;

// Fail the build rather than emit an artifact that violates the whitespace
// gate, lost its license banner, or no longer parses as an ES module.
if (/[ \t]+$/mu.test(artifact)) {
  throw new Error("post-build invariant failed: trailing whitespace in artifact");
}
if (!banner.includes("Permission to use, copy, modify")) {
  throw new Error("post-build invariant failed: license banner missing");
}
writeFileSync(outfile, artifact);
const syntaxProbe = resolve(
  tmpdir(),
  `walletconnect-provider-syntax-${process.pid}.mjs`,
);
try {
  writeFileSync(syntaxProbe, artifact);
  execFileSync(process.execPath, ["--check", syntaxProbe], { stdio: "pipe" });
} finally {
  rmSync(syntaxProbe, { force: true });
}

const sha256 = createHash("sha256").update(readFileSync(outfile)).digest("hex");
console.log(`artifact: ${outfile}`);
console.log(`sha256:   ${sha256}`);
