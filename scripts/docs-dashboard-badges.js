#!/usr/bin/env node
/**
 * 🧩 Inferno Docs Dashboard Badges Injector
 *
 * Fügt Status-Badges in das generierte Dashboard (docs-dashboard.html) ein.
 * Enthält robusten Fallback, falls der Dashboard-Pfad in macOS-Tempverzeichnissen liegt.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

console.log("🏗️  Starting Docs Dashboard Badges Injector...");

// 🔁 Dashboard-Suchlogik (lokal + Fallback)
let dashboardPath = path.join(root, "reports", "docs-dashboard.html");
if (!fs.existsSync(dashboardPath)) {
  const tmpBase = "/var/folders/mp";
  let found = null;
  try {
    // macOS Temp-Unterstruktur erkennen (z. B. /var/folders/mp/vsm4q.../T/)
    const subfolders = fs.readdirSync(tmpBase).filter(f => !f.startsWith("."));
    for (const sub of subfolders) {
      const subPath = path.join(tmpBase, sub, "T");
      if (fs.existsSync(subPath)) {
        const tmpDirs = fs
          .readdirSync(subPath)
          .filter(d => d.includes("inferno-site"));
        for (const dir of tmpDirs) {
          const candidate = path.join(
            subPath,
            dir,
            "_site",
            "reports",
            "docs-dashboard.html"
          );
          if (fs.existsSync(candidate)) {
            found = candidate;
            break;
          }
        }
      }
      if (found) break;
    }
  } catch (err) {
    console.error("⚠️  Temp search failed:", err.message);
  }

  if (found) {
    console.log(`⚙️  Using fallback dashboard path: ${found}`);
    dashboardPath = found;
  } else {
    console.error(`❌ Dashboard not found in reports or temp directories.`);
    process.exit(1);
  }
}

if (!fs.existsSync(dashboardPath)) {
  console.error(`❌ Dashboard file still not found: ${dashboardPath}`);
  process.exit(1);
}

let html = fs.readFileSync(dashboardPath, "utf8");

// 🧱 Badge-Leiste erstellen
const bar = `
<div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
  <img src="https://img.shields.io/badge/Inferno%20Docs-Passing-brightgreen?style=for-the-badge" alt="Docs Status"/>
  <img src="https://img.shields.io/badge/Last%20Update-${new Date().toISOString().split("T")[0]}-blue?style=for-the-badge" alt="Last Update"/>
  <img src="https://img.shields.io/badge/Deployed%20to-gh--pages-orange?style=for-the-badge" alt="Deployment"/>
</div>`;

// Nach dem ersten <h1> oder <body> einfügen
if (html.includes("<h1")) {
  html = html.replace(/<h1[^>]*>[^<]*<\/h1>/, m => m + "\n" + bar);
} else if (html.includes("<body")) {
  html = html.replace(/<body[^>]*>/, "$&\n" + bar);
} else {
  html = bar + html;
}

// 🔧 Datei speichern
fs.writeFileSync(dashboardPath, html, "utf8");
console.log(`✅ Badges injected into ${dashboardPath}`);
