#!/usr/bin/env node
/**
 * 📘 Inferno Docs Autobuilder
 * Scannt alle Markdown-Dateien im Repository und generiert:
 *  - docs/_autogen/index.json
 *  - docs/_autogen/tree.md
 *
 * Run manually:
 *   node scripts/docs-autobuild.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DOCS_DIRS = ["docs", "arch", "patches"];
const OUT_DIR = path.join(ROOT, "docs", "_autogen");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function collectFiles(dir) {
  let res = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) res = res.concat(collectFiles(full));
    else if (f.endsWith(".md")) res.push(path.relative(ROOT, full));
  }
  return res;
}

let allDocs = [];
for (const d of DOCS_DIRS) {
  const dir = path.join(ROOT, d);
  if (fs.existsSync(dir)) allDocs = allDocs.concat(collectFiles(dir));
}

fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(allDocs, null, 2));

// Markdown tree output
const treeLines = ["# 📘 Inferno Docs Tree", ""];
for (const f of allDocs) treeLines.push(`- [${f}](${path.relative("docs/_autogen", f)})`);
fs.writeFileSync(path.join(OUT_DIR, "tree.md"), treeLines.join("\n"));

console.log(`✅ Docs Autobuilder finished. Indexed ${allDocs.length} Markdown files.`);
