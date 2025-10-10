#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const root = process.cwd();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-site-"));
const siteDir = path.join(tmpDir, "_site");
const docsDirs = ["docs", "reports", "logs"];

let prevBranch = "main";
try {
  prevBranch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
} catch {
  prevBranch = "main";
}

const logDir = path.join(root, "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const projectLog = path.join(logDir, "project.log");
const publisherLog = path.join(logDir, "docs-publisher.log");
const ts = () => new Date().toISOString();
fs.writeFileSync(publisherLog, `[${ts()}] 🪵 Publisher init created log file\n`);

function logLine(line) {
  const entry = line + "\n";
  try { fs.appendFileSync(projectLog, entry); } catch {}
  try { fs.appendFileSync(publisherLog, entry); } catch {}
  console.log(line);
}

try {
  const tmpCreated = `[${ts()}] 📁 Created temporary site directory: ${siteDir}`;
  logLine(tmpCreated);
  fs.mkdirSync(siteDir, { recursive: true });

  for (const d of docsDirs) {
    const src = path.join(root, d);
    if (!fs.existsSync(src)) {
      logLine(`⚠️ Missing folder: ${src}`);
      continue;
    }
    const dest = path.join(siteDir, d);
    fs.cpSync(src, dest, { recursive: true });
    logLine(`✅ Copied: ${d}`);
  }

  const indexFile = path.join(siteDir, "index.html");
  fs.writeFileSync(
    indexFile,
    `<html><head><meta charset="utf-8"><title>Inferno Docs Portal</title></head><body><h1>🔥 Inferno Docs</h1><p>Generated ${ts()}</p></body></html>`
  );
  logLine(`🧾 Created index: ${indexFile}`);

  let commitHash = "unknown";
  try { commitHash = execSync("git rev-parse --short HEAD").toString().trim(); } catch {}
  execSync("git checkout gh-pages || git checkout -b gh-pages", { stdio: "inherit" });
  execSync("rm -rf *", { stdio: "inherit" });
  execSync(`cp -r ${siteDir}/* .`, { stdio: "inherit" });
  execSync("git add .", { stdio: "inherit" });
  execSync('git commit -m "docs: publish to gh-pages [auto]" || true', { stdio: "inherit" });
  execSync("git push origin gh-pages --force", { stdio: "inherit" });
  execSync(`git checkout ${prevBranch}`, { stdio: "inherit" });

  logLine(`[${ts()}] ✅ gh-pages deployed (commit ${commitHash}) TMP=${tmpDir}`);
  execSync("node scripts/docs-footer-generator.js", { stdio: "inherit" });
  logLine(`🧩 Docs footer generator executed.`);
  execSync("node scripts/docs-sitemap-meta-generator.js", { stdio: "inherit" });
  logLine(`🧭 Docs sitemap & meta generator executed.`);
  execSync("node scripts/docs-badge-generator.js", { stdio: "inherit" });
  logLine(`🏷️ Docs integrity badges generated.`);
  execSync("node scripts/docs-badge-embedder.js", { stdio: "inherit" });
  logLine(`🧩 README badge embedder executed.`);
} catch (err) {
  logLine(`[${ts()}] ❌ Error: ${err.message}`);
}
