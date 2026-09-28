#!/usr/bin/env node
/**
 * Sitemap and AI-anchor consistency check (CWA-81, dependency-free).
 *
 *  1. Each host's sitemap lists only URLs of that host (apex docs/sitemap.xml,
 *     web3 infra/web3/sitemap.xml); each robots.txt points at its own sitemap.
 *  2. Every apex sitemap URL maps to a tracked page whose canonical URL equals
 *     the sitemap URL, and every tracked wiki page is listed.
 *  3. Every listed page carries at least one parseable schema.org JSON-LD block.
 *  4. lastmod is a valid, non-future date. With full git history, lastmod must
 *     not be older than the page's last commit (`--write` refreshes it).
 *  5. llms.txt keeps the fee-exemption qualifier on the burn statement.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const writeMode = process.argv.includes("--write");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const hosts = [
  { origin: "https://ifrunit.tech", sitemap: "docs/sitemap.xml", robots: "docs/robots.txt", docroot: "docs" },
  { origin: "https://web3.ifrunit.tech", sitemap: "infra/web3/sitemap.xml", robots: "infra/web3/robots.txt", docroot: "docs/web3" },
];

const shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
const dirty = new Set(git(["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean));
const today = new Date().toISOString().slice(0, 10);

function localFile(host, loc) {
  const relative = loc.slice(host.origin.length + 1);
  return path.posix.join(host.docroot, relative === "" || relative.endsWith("/") ? `${relative}index.html` : relative);
}

function lastCommitDate(file) {
  if (dirty.has(file)) return today;
  return git(["log", "-1", "--format=%cs", "--", file]);
}

function canonicalOf(source) {
  return source.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
}

let refreshed = 0;
for (const host of hosts) {
  let sitemap = read(host.sitemap);
  const entries = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)];
  assert.ok(entries.length > 0, `${host.sitemap} has no entries`);
  assert.equal(entries.length, (sitemap.match(/<url>/g) || []).length, `${host.sitemap}: every entry needs loc + lastmod`);

  const robots = read(host.robots);
  assert.deepEqual(
    [...robots.matchAll(/^Sitemap:\s*(\S+)/gm)].map((match) => match[1]),
    [`${host.origin}/sitemap.xml`],
    `${host.robots} must reference only its own sitemap`
  );

  const listed = new Set();
  for (const [, loc, lastmod] of entries) {
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

    assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/, `${host.sitemap}: invalid lastmod for ${loc}`);
    assert.ok(lastmod <= today, `${host.sitemap}: future lastmod for ${loc}`);
    if (!shallow) {
      const committed = lastCommitDate(file);
      if (writeMode && committed !== lastmod) {
        sitemap = sitemap.replace(`<loc>${loc}</loc><lastmod>${lastmod}</lastmod>`, `<loc>${loc}</loc><lastmod>${committed}</lastmod>`);
        refreshed += 1;
      } else if (!writeMode) {
        assert.ok(lastmod >= committed, `${host.sitemap}: lastmod ${lastmod} for ${loc} is older than its last change ${committed}; run npm run build:sitemap`);
      }
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

console.log(
  `[sitemap-anchors] ${writeMode ? `WROTE (${refreshed} lastmod refreshed)` : "PASS"}` +
    (shallow ? " - lastmod freshness skipped in shallow clone" : "")
);
