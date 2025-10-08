#!/usr/bin/env node
/**
 * ⏰ Inferno Docs Scheduler
 * Führt regelmäßig den Docs Watchdog aus und schreibt Reports.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const logDir = path.join(root, "logs");
const reportDir = path.join(root, "reports");
const reportFile = path.join(reportDir, "docs-watchdog-report.md");

fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

const ts = new Date().toISOString();
const logPath = path.join(logDir, "docs-scheduler.log");

console.log(`[Scheduler] 🕓 Running Docs Watchdog @ ${ts}`);
fs.appendFileSync(logPath, `[${ts}] 🕓 Scheduler run initiated\n`);

try {
  execSync("node scripts/docs-watchdog.js", { stdio: "inherit" });
  fs.appendFileSync(logPath, `[${ts}] ✅ Watchdog executed successfully\n`);
} catch (err) {
  fs.appendFileSync(logPath, `[${ts}] ❌ Watchdog error: ${err.message}\n`);
}

// Append summary report
const summary = `[${ts}] Docs Watchdog executed via Scheduler ✅\n`;
fs.appendFileSync(reportFile, summary);

console.log(`[Scheduler] 🧾 Report updated: ${reportFile}`);
