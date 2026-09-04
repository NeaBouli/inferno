const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  checkDocumentationLinks,
  normalizeLocalLink,
  resolveLocalTarget,
  isPathWithin,
  targetExists,
} = require("./check-links.js");

assert.equal(normalizeLocalLink("assets/app.js?v=7#ready"), "assets/app.js");
assert.equal(normalizeLocalLink("/wiki/#intro"), "/wiki/");
assert.equal(normalizeLocalLink("https://example.com/a"), null);
assert.equal(normalizeLocalLink("mailto:dev@example.com"), null);
assert.equal(normalizeLocalLink("${action.href}"), null);
assert.equal(normalizeLocalLink("#local"), null);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ifr-link-check-"));
const docsDir = path.join(fixtureRoot, "docs");
const wikiDir = path.join(docsDir, "wiki");
fs.mkdirSync(path.join(docsDir, "assets"), { recursive: true });
fs.mkdirSync(wikiDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, "assets", "app.js"), "");
fs.writeFileSync(path.join(wikiDir, "index.html"), "");
fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# Fixture\n");
fs.writeFileSync(
  path.join(docsDir, "index.html"),
  '<script src="/assets/app.js?v=7"></script><a href="/wiki/#intro">Wiki</a><a href="/../README.md">Escape</a><a href="${action.href}">Dynamic</a>'
);
fs.writeFileSync(
  path.join(docsDir, "guide.md"),
  "[Repository](../README.md)\n[Missing](missing.md)\n"
);

assert.equal(
  resolveLocalTarget(path.join(wikiDir, "index.html"), "/assets/app.js", docsDir),
  path.join(docsDir, "assets", "app.js")
);
assert.equal(targetExists(wikiDir), true);
assert.equal(isPathWithin(docsDir, path.join(docsDir, "assets", "app.js")), true);
assert.equal(isPathWithin(docsDir, path.join(fixtureRoot, "README.md")), false);

const fixtureResult = checkDocumentationLinks({ rootDir: fixtureRoot, docsDir });
assert.equal(fixtureResult.checkedCount, 5);
assert.deepEqual(fixtureResult.broken, [
  { file: "docs/guide.md", link: "missing.md" },
  { file: "docs/index.html", link: "/../README.md" },
]);

fs.rmSync(fixtureRoot, { recursive: true, force: true });
console.log("[internal-link-check-test] PASS");
