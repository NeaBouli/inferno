#!/usr/bin/env node
/**
 * 🛠️ Inferno Audit Automation Script
 * Aggregates all audit markdown files into audit/summary.md
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "audit");
const output = path.join(root, "summary.md");

function collectFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(collectFiles(fullPath));
    } else if (file.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function generateSummary() {
  const files = collectFiles(root);
  if (files.length === 0) {
    console.log("⚠️  No audit markdown files found under /audit");
    return;
  }

  let outputContent = "# 🧾 Inferno Audit Summary\n\n";
  outputContent += `Generated: ${new Date().toISOString()}\n\n`;

  for (const f of files) {
    const rel = path.relative(root, f);
    const content = fs.readFileSync(f, "utf8");
    const lines = content.split("\n").slice(0, 5).join("\n");
    outputContent += `## 📄 ${rel}\n\n`;
    outputContent += "```\n" + lines + "\n```\n\n";
  }

  fs.writeFileSync(output, outputContent);
  console.log(`✅ Audit summary generated: ${output}`);
}

generateSummary();
