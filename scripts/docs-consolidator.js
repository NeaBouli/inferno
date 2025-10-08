#!/usr/bin/env node
/**
 * 🧩 Inferno Docs Consolidator
 * Fasst alle Logs und Reports zu einem monatlichen Sammelbericht zusammen.
 */

import fs from "fs";
import path from "path";

const root = process.cwd();
const logsDir = path.join(root, "logs");
const reportsDir = path.join(root, "reports");
const monthlyDir = path.join(reportsDir, "monthly");

fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(monthlyDir, { recursive: true });

const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const monthFile = path.join(monthlyDir, `docs-monthly-report-${year}-${month}.md`);

const timestamp = now.toISOString();
let content = `# 🧾 Inferno Docs Monthly Report (${year}-${month})\n\n`;
content += `🕓 Generated: ${timestamp}\n\n---\n\n`;

const collectFiles = (dir, label) => {
  content += `## 📂 ${label}\n\n`;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".log") || f.endsWith(".md"));
  if (files.length === 0) {
    content += "_No files found._\n\n";
    return;
  }
  for (const file of files) {
    const filePath = path.join(dir, file);
    const data = fs.readFileSync(filePath, "utf8");
    const status = data.includes("❌") ? "❌" : data.includes("⚠️") ? "⚠️" : "✅";
    content += `### ${status} ${file}\n\n`;
    content += "```\n" + data.slice(0, 2000) + "\n```\n\n";
  }
};

collectFiles(logsDir, "Logs");
collectFiles(reportsDir, "Reports");

fs.writeFileSync(monthFile, content);
console.log(`✅ Consolidated monthly report created: ${monthFile}`);

fs.appendFileSync(
  path.join(logsDir, "project.log"),
  `[${timestamp}] Docs Consolidator run complete → ${monthFile}\n`
);
