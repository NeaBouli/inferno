#!/usr/bin/env node
/**
 * 📊 Inferno Docs Dashboard Generator
 * Erstellt eine HTML-Übersicht aller Dokumentationsberichte.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const reportsDir = path.join(root, "reports");
const output = path.join(reportsDir, "docs-dashboard.html");

const ts = () => new Date().toISOString();
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD").toString().trim(); } catch {}

const reportFiles = fs.readdirSync(reportsDir)
  .filter(f => f.endsWith(".md"))
  .map(f => `<li><a href="./${f}">${f}</a></li>`)
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Inferno Documentation Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; color: #222; }
    h1 { color: #e64a19; }
    ul { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>📊 Inferno Documentation Dashboard</h1>
  <p>Generated on ${ts()} (commit ${commit})</p>
  <ul>${reportFiles}</ul>
  <hr>
  <p style="font-size:0.8em;color:#777;">Inferno Docs System — Dashboard Build ${commit} — ${ts()}</p>
</body>
</html>`;

fs.writeFileSync(output, html, "utf8");
console.log(`✅ Docs Dashboard generated → ${output}`);
