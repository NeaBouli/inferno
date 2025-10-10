#!/usr/bin/env node
/**
 * 🔖 Inferno Docs Footer Injector
 * Fügt allen generierten HTML/Markdown-Seiten Build-Informationen hinzu.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const ts = () => new Date().toISOString();
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD").toString().trim(); } catch {}

const meta = `\n<hr>\n<p style="font-size:0.8em;color:#888;">Inferno Build ${commit} — ${ts()}</p>\n`;

const targets = [
  "docs/index.html",
  "reports/docs-dashboard.html"
];

for (const file of targets) {
  if (fs.existsSync(file)) {
    let data = fs.readFileSync(file, "utf8");
    if (!data.includes("Inferno Build")) {
      data = data.replace(/<\/body>/i, meta + "</body>");
      fs.writeFileSync(file, data, "utf8");
      console.log(`✅ Footer injected → ${file}`);
    }
  }
}

// Markdown footer
const mdFile = path.join(root, "reports/docs-ci-status.md");
if (fs.existsSync(mdFile)) {
  fs.appendFileSync(mdFile, `\n---\n*Build ${commit} at ${ts()}*`);
  console.log(`✅ Footer appended → ${mdFile}`);
}
