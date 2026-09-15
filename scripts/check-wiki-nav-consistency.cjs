#!/usr/bin/env node

// Guards wiki sidebar-nav consistency: every page under docs/wiki/ that uses
// the sidebar layout must render the identical menu (same items, same order).
// Active-state attributes (class="active", aria-current="page") and the
// canonical Home URL on index.html are normalized before comparison.

const fs = require("node:fs");
const path = require("node:path");

const wikiDir = path.join(__dirname, "..", "docs", "wiki");
const NAV_RE = /<ul class="sidebar-nav">([\s\S]*?)<\/ul>/;

function extractNav(file) {
  const src = fs.readFileSync(file, "utf8");
  const match = src.match(NAV_RE);
  if (!match) return null;
  return match[1]
    .replace(/\s*class="active"/g, "")
    .replace(/\s*aria-current="page"/g, "")
    .replace(/https:\/\/ifrunit\.tech\/wiki\/(?=")/, "https://ifrunit.tech/wiki/index.html");
}

const pages = fs.readdirSync(wikiDir).filter((name) => name.endsWith(".html")).sort();
const variants = new Map();
const withoutSidebar = [];

for (const page of pages) {
  const nav = extractNav(path.join(wikiDir, page));
  if (nav === null) {
    withoutSidebar.push(page);
    continue;
  }
  if (!variants.has(nav)) variants.set(nav, []);
  variants.get(nav).push(page);
}

console.log(`[wiki-nav] ${pages.length} pages scanned, ${variants.size} nav variant(s), ${withoutSidebar.length} page(s) without sidebar`);

if (withoutSidebar.length) {
  console.log(`[wiki-nav] pages without sidebar layout (by design list must stay explicit): ${withoutSidebar.join(", ")}`);
  const allowed = new Set(["reputation.html"]);
  const unexpected = withoutSidebar.filter((page) => !allowed.has(page));
  if (unexpected.length) {
    console.error(`[wiki-nav] FAIL - unexpected pages without sidebar-nav: ${unexpected.join(", ")}`);
    process.exitCode = 1;
    return;
  }
}

if (variants.size > 1) {
  console.error("[wiki-nav] FAIL - sidebar nav is inconsistent:");
  for (const pagesInVariant of variants.values()) {
    console.error(`  variant with ${pagesInVariant.length} page(s): ${pagesInVariant.join(", ")}`);
  }
  process.exitCode = 1;
  return;
}

console.log(`[wiki-nav] PASS - all ${pages.length - withoutSidebar.length} sidebar pages share one menu`);
