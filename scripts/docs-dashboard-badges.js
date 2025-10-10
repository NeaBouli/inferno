#!/usr/bin/env node
/**
 * 🧩 Inferno Docs Dashboard Badges Injector
 * Fügt Build-, Validator- und CI-Badges oben in reports/docs-dashboard.html ein.
 */

import fs from "fs";
import path from "path";

const root = process.cwd();
const dashboard = path.join(root, "reports", "docs-dashboard.html");

if (!fs.existsSync(dashboard)) {
  console.error("❌ Dashboard not found:", dashboard);
  process.exit(1);
}

const badges = [
  { file: "build-status.svg", label: "Build" },
  { file: "validator-status.svg", label: "Validator" },
  { file: "ci-status.svg", label: "CI" },
];

let html = fs.readFileSync(dashboard, "utf8");

// Alte Badge-Leiste entfernen
html = html.replace(/<!-- BADGE-START -->[\\s\\S]*<!-- BADGE-END -->/, "");

// Neue Badge-Leiste erzeugen
let bar = "<!-- BADGE-START -->\\n<div style='display:flex;gap:10px;align-items:center;margin-bottom:15px;'>";
for (const b of badges) {
  const p = path.join("reports", b.file);
  if (fs.existsSync(p)) {
    bar += `<img src='${p}' alt='${b.label} Status' height='22'/>`;
  } else {
    bar += `<span style='color:gray;'>${b.label}: N/A</span>`;
  }
}
bar += "</div>\\n<!-- BADGE-END -->";

// Nach dem ersten <h1> oder <body> einfügen
if (html.includes("<h1")) {
  html = html.replace(/<h1[^>]*>[^<]*<\\/h1>/, m => m + "\\n" + bar);
} else if (html.includes("<body")) {
  html = html.replace(/<body[^>]*>/, "$&\\n" + bar);
} else {
  html = bar + "\\n" + html;
}

fs.writeFileSync(dashboard, html, "utf8");
console.log("✅ Badges injected into docs-dashboard.html");
