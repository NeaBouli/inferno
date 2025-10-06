#!/usr/bin/env node
/**
 * Inferno Docs Auto-Indexer
 * --------------------------
 * Scans all Markdown files in /docs and generates an index file (/docs/_index.md)
 * listing their relative paths. Used for navigation or documentation validation.
 */

const fs = require("fs");
const path = require("path");

const DOCS_DIR = path.join(__dirname, "..", "docs");
const INDEX_FILE = path.join(DOCS_DIR, "_index.md");

function collectMarkdownFiles(dir, base = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(base, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectMarkdownFiles(fullPath, relPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(relPath);
    }
  }
  return files.sort();
}

function main() {
  console.log("🔍 Scanning docs directory...");
  if (!fs.existsSync(DOCS_DIR)) {
    console.error("❌ Docs directory not found:", DOCS_DIR);
    process.exit(1);
  }

  const files = collectMarkdownFiles(DOCS_DIR);
  if (files.length === 0) {
    console.warn("⚠️  No markdown files found in /docs");
    process.exit(0);
  }

  const content =
    `# 📚 Inferno Documentation Index\n\n` +
    files.map((f) => `- [${f}](${f})`).join("\n") +
    "\n";

  fs.writeFileSync(INDEX_FILE, content);
  console.log(`✅ Index created: ${INDEX_FILE} (${files.length} files)`);
}

main();
