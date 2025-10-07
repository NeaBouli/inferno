#!/usr/bin/env node
/**
 * 📘 Inferno Docs Reporter
 * Scans markdown files and generates a status report under reports/docs-status.md
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const logDir = path.join(root, "logs");
const reportDir = path.join(root, "reports");
const reportFile = path.join(reportDir, "docs-status.md");
const logFile = path.join(logDir, "docs-reporter.log");

// Ensure dirs exist
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

const scanDirs = ["docs", "reports", "logs"];
const entries = [];

for (const dir of scanDirs) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full)) {
    if (!f.endsWith(".md")) continue;
    const file = path.join(full, f);
    const stats = fs.statSync(file);
    const size = stats.size;
    const status = size === 0 ? "⚠️ leer" : "✅ ok";
    entries.push(`| ${dir}/${f} | ${size} Bytes | ${status} |`);
  }
}

let content = "# 📊 Docs Status Report\n\n";
content += "| Datei | Größe | Status |\n|--------|--------|--------|\n";
content += entries.join("\n") + "\n";

fs.writeFileSync(reportFile, content);
fs.appendFileSync(logFile, `[${new Date().toISOString()}] Docs Reporter run – ${entries.length} files\n`);
console.log("✅ Docs Reporter completed →", reportFile);
