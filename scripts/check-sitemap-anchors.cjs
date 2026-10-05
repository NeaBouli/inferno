#!/usr/bin/env node
/**
 * Sitemap and AI-anchor consistency check (CWA-81, dependency-free).
 *
 *  1. Each host's sitemap lists only URLs of that host (apex docs/sitemap.xml,
 *     web3 infra/web3/sitemap.xml); each robots.txt points at its own sitemap.
 *  2. Every apex sitemap URL maps to a tracked page whose canonical URL equals
 *     the sitemap URL, and every tracked wiki page is listed.
 *  3. Every listed page carries at least one parseable schema.org JSON-LD block.
 *  4. Entries carry no <lastmod> (optional in the sitemap protocol). Per-PR lastmod
 *     edits caused merge conflicts on every merge (T-226); `--write` strips any lastmod.
 *  5. llms.txt keeps the fee-exemption qualifier on the burn statement.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const writeMode = process.argv.includes("--write");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, TZ: "UTC" } }).trim();

const hosts = [
  { origin: "https://ifrunit.tech", sitemap: "docs/sitemap.xml", robots: "docs/robots.txt", docroot: "docs" },
  { origin: "https://web3.ifrunit.tech", sitemap: "infra/web3/sitemap.xml", robots: "infra/web3/robots.txt", docroot: "docs/web3" },
];


function localFile(host, loc) {
  const relative = loc.slice(host.origin.length + 1);
  return path.posix.join(host.docroot, relative === "" || relative.endsWith("/") ? `${relative}index.html` : relative);
}

function canonicalOf(source) {
  return source.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
}

let refreshed = 0;
for (const host of hosts) {
  let sitemap = read(host.sitemap);
  if (writeMode && sitemap.includes("<lastmod>")) {
    refreshed += (sitemap.match(/<lastmod>/g) || []).length;
    sitemap = sitemap.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
  }
  assert.ok(!sitemap.includes("<lastmod>"), `${host.sitemap}: entries must not carry <lastmod> (run npm run build:sitemap)`);
  const entries = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc>/g)];
  assert.ok(entries.length > 0, `${host.sitemap} has no entries`);
  assert.equal(entries.length, (sitemap.match(/<url>/g) || []).length, `${host.sitemap}: every entry needs exactly one loc`);
  const urlBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  assert.equal(urlBlocks.length, entries.length, `${host.sitemap}: every <url> entry must be closed`);
  for (const [, url] of urlBlocks) {
    assert.equal((url.match(/<loc>/g) || []).length, 1, `${host.sitemap}: every entry needs exactly one loc`);
  }

  const robots = read(host.robots);
  assert.deepEqual(
    [...robots.matchAll(/^Sitemap:\s*(\S+)/gm)].map((match) => match[1]),
    [`${host.origin}/sitemap.xml`],
    `${host.robots} must reference only its own sitemap`
  );

  const listed = new Set();
  for (const [, loc] of entries) {
    assert.ok(loc === `${host.origin}/` || loc.startsWith(`${host.origin}/`), `${host.sitemap}: cross-host URL ${loc}`);
    const file = localFile(host, loc);
    listed.add(file);
    assert.ok(fs.existsSync(path.join(root, file)), `${host.sitemap}: ${loc} has no page (${file})`);
    const source = read(file);
    assert.equal(canonicalOf(source), loc, `${file}: canonical URL must equal sitemap URL ${loc}`);

    const blocks = [...source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(blocks.length > 0, `${file}: missing JSON-LD`);
    for (const [, body] of blocks) {
      const block = JSON.parse(body);
      assert.equal(block["@context"], "https://schema.org", `${file}: JSON-LD context`);
    }
  }

  if (host.docroot === "docs") {
    for (const page of git(["ls-files", "docs/wiki/*.html"]).split("\n").filter(Boolean)) {
      assert.ok(listed.has(page), `${host.sitemap} must list ${page}`);
    }
  }
  if (writeMode) fs.writeFileSync(path.join(root, host.sitemap), sitemap);
}

const llms = read("docs/llms.txt");
assert.ok(
  llms.includes("Every standard transfer between non-exempt addresses burns 2.5% permanently"),
  "docs/llms.txt must keep the fee-exemption qualifier on the burn statement"
);
assert.ok(!/Every transfer burns 2\.5%/.test(llms), "docs/llms.txt must not drop the fee-exemption qualifier");

console.log(`[sitemap-anchors] ${writeMode ? `WROTE (${refreshed} lastmod removed)` : "PASS"}`);
