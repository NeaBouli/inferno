#!/usr/bin/env node
/**
 * Regression fixtures for scripts/check-sitemap-anchors.cjs (T-252).
 * Runs the real checker against a throwaway fixture repo: each <url> entry needs
 * exactly one <loc>, and `--write` strips <lastmod> without touching any <loc>.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const checker = path.join(__dirname, "check-sitemap-anchors.cjs");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ifr-sitemap-anchors-"));
const write = (relative, content) => {
  fs.mkdirSync(path.dirname(path.join(fixtureRoot, relative)), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, relative), content);
};
const page = (canonical) =>
  `<link rel="canonical" href="${canonical}"><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>`;
const sitemapOf = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  ${entry}\n`).join("")}</urlset>\n`;

const apexEntries = [
  "<url><loc>https://ifrunit.tech/</loc><changefreq>weekly</changefreq></url>",
  "<url><loc>https://ifrunit.tech/builder.html</loc><changefreq>weekly</changefreq></url>",
];

write("scripts/check-sitemap-anchors.cjs", fs.readFileSync(checker, "utf8"));
write("docs/index.html", page("https://ifrunit.tech/"));
write("docs/builder.html", page("https://ifrunit.tech/builder.html"));
write("docs/web3/index.html", page("https://web3.ifrunit.tech/"));
write("docs/robots.txt", "User-agent: *\nSitemap: https://ifrunit.tech/sitemap.xml\n");
write("infra/web3/robots.txt", "User-agent: *\nSitemap: https://web3.ifrunit.tech/sitemap.xml\n");
write("infra/web3/sitemap.xml", sitemapOf(["<url><loc>https://web3.ifrunit.tech/</loc></url>"]));
write("docs/llms.txt", "Every standard transfer between non-exempt addresses burns 2.5% permanently.\n");
execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });

function run(entries, ...args) {
  write("docs/sitemap.xml", sitemapOf(entries));
  const result = spawnSync(process.execPath, [path.join(fixtureRoot, "scripts/check-sitemap-anchors.cjs"), ...args], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}
const locsOf = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);

try {
  const normal = run(apexEntries);
  assert.equal(normal.status, 0, normal.output);
  assert.match(normal.output, /\[sitemap-anchors\] PASS/);

  const missing = run([...apexEntries, "<url><changefreq>weekly</changefreq></url>"]);
  assert.notEqual(missing.status, 0, "entry without loc must fail");
  assert.match(missing.output, /every entry needs exactly one loc/);

  const duplicate = run([
    apexEntries[0],
    "<url><loc>https://ifrunit.tech/builder.html</loc><loc>https://evil.example/</loc></url>",
  ]);
  assert.notEqual(duplicate.status, 0, "entry with a second loc must fail");
  assert.match(duplicate.output, /every entry needs exactly one loc/);

  const unclosed = run([apexEntries[0], "<url><loc>https://ifrunit.tech/builder.html</loc>"]);
  assert.notEqual(unclosed.status, 0, "unclosed entry must fail");

  const stamped = apexEntries.map((entry) => entry.replace("</loc>", "</loc><lastmod>2026-10-05</lastmod>"));
  const injected = run(stamped);
  assert.notEqual(injected.status, 0, "lastmod must be rejected in check mode");
  assert.match(injected.output, /must not carry <lastmod>/);

  const rewritten = run(stamped, "--write");
  assert.equal(rewritten.status, 0, rewritten.output);
  assert.match(rewritten.output, /WROTE \(2 lastmod removed\)/);
  const written = fs.readFileSync(path.join(fixtureRoot, "docs/sitemap.xml"), "utf8");
  assert.ok(!written.includes("<lastmod>"), "write mode must strip lastmod");
  assert.deepEqual(locsOf(written), locsOf(sitemapOf(apexEntries)), "write mode must keep every loc");
  assert.equal(written, sitemapOf(apexEntries));
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("[sitemap-anchors-fixtures] PASS");
