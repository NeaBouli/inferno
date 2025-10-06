#!/usr/bin/env node
/**
 * Inferno Docs Checker
 * --------------------
 * Validates all Markdown files under /docs for encoding, emptiness and index sync.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DOCS_DIR = path.join(__dirname, "..", "docs");
const INDEX_FILE = path.join(DOCS_DIR, "_index.md");
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "docs-checker.log");

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

function listMarkdownFiles(dir, base = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    const rel = path.join(base, e.name);
    if (e.isDirectory()) files = files.concat(listMarkdownFiles(full, rel));
    else if (e.name.endsWith(".md")) files.push(rel);
  }
  return files.sort();
}

function validateDocs() {
  console.log("🔍 Checking Markdown files...");
  if (!fs.existsSync(DOCS_DIR)) throw new Error("Docs directory missing");
  const files = listMarkdownFiles(DOCS_DIR);

  let errors = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), "utf8");
    if (!content.trim()) {
      console.warn(`⚠️  Empty file: ${file}`);
      log(`Empty file: ${file}`);
      errors++;
    }
    if (content.includes("\u0000")) {
      console.error(`❌ Invalid control chars in: ${file}`);
      log(`Invalid chars in: ${file}`);
      errors++;
    }
  }

  console.log("🔁 Checking index sync...");
  try {
    execSync("node scripts/docs-indexer.js", { stdio: "ignore" });
  } catch {
    console.warn("⚠️  Could not regenerate docs index");
  }

  if (!fs.existsSync(INDEX_FILE)) {
    console.error("❌ No docs/_index.md found");
    log("Missing _index.md");
    errors++;
  }

  if (errors === 0) {
    console.log("✅ Docs validation passed");
    log("Docs OK");
  } else {
    console.log(`❌ ${errors} issues found`);
    log(`${errors} issues found`);
    process.exit(1);
  }
}

validateDocs();
