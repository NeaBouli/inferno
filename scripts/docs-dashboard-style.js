#!/usr/bin/env node
/**
 * 🧩 Inferno Docs Dashboard Theme & Style Injector
 *
 * Fügt Dark/Light Theme, Logo und responsive Styles ins Dashboard ein.
 * Enthält Fallback-Suchlogik für macOS-Temp-Verzeichnisse.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

console.log("🎨  Applying Docs Dashboard Theme...");

// Dashboard suchen + Fallback für macOS TMP-Pfade
let dashboardPath = path.join(root, "reports", "docs-dashboard.html");
if (!fs.existsSync(dashboardPath)) {
  const tmpBase = "/var/folders/mp";
  let found = null;
  try {
    const subfolders = fs.readdirSync(tmpBase).filter(f => !f.startsWith('.'));
    for (const sub of subfolders) {
      const subPath = path.join(tmpBase, sub, 'T');
      if (fs.existsSync(subPath)) {
        const tmpDirs = fs.readdirSync(subPath).filter(d => d.includes('inferno-site'));
        for (const dir of tmpDirs) {
          const candidate = path.join(subPath, dir, '_site', 'reports', 'docs-dashboard.html');
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
    console.error("❌  Dashboard not found anywhere.");
    process.exit(1);
  }
}

let html = fs.readFileSync(dashboardPath, "utf8");

// CSS-Styles hinzufügen
const styleBlock = `
<style>
  body {
    font-family: Inter, Arial, sans-serif;
    margin: 0; padding: 0;
    background: #0d1117;
    color: #c9d1d9;
  }
  h1 {
    text-align: center;
    color: #f97316;
    margin-top: 40px;
  }
  .inferno-logo {
    display: block;
    margin: 20px auto 10px;
    width: 100px;
    opacity: 0.9;
  }
  table {
    border-collapse: collapse;
    width: 90%;
    margin: 30px auto;
    background: #161b22;
    border-radius: 12px;
    overflow: hidden;
  }
  th, td {
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid #30363d;
  }
  th {
    background: #21262d;
    color: #f0f6fc;
  }
  tr:hover {
    background: #1e2329;
  }
  @media (prefers-color-scheme: light) {
    body { background: #fff; color: #111; }
    table { background: #f9f9f9; }
    th { background: #efefef; color: #000; }
    tr:hover { background: #f0f0f0; }
  }
</style>
`;

// Styles & Logo einfügen
html = html.replace("</head>", `${styleBlock}</head>`);

const logoTag = `<img src="https://raw.githubusercontent.com/NeaBouli/inferno/main/assets/logo.png" alt="Inferno Logo" class="inferno-logo"/>`;
if (html.includes("<h1")) {
  html = html.replace(/<h1[^>]*>/, `${logoTag}\n$&`);
}

fs.writeFileSync(dashboardPath, html, "utf8");
console.log("✅  Dashboard theme & style applied →", dashboardPath);
