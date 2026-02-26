/**
 * Dead Link Checker — scans docs/ for broken internal links.
 *
 * Usage: node scripts/check-links.js
 *
 * Checks:
 * - HTML files in docs/ and docs/wiki/ for href/src references
 * - Internal links (relative paths) resolve to existing files
 * - Markdown files in docs/ for [text](path) links to local files
 *
 * Does NOT check external URLs (https://...).
 */

const fs = require("fs");
const path = require("path");

const DOCS_DIR = path.join(__dirname, "..", "docs");
const ROOT_DIR = path.join(__dirname, "..");

let brokenCount = 0;
let checkedCount = 0;

function scanHtmlFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const dir = path.dirname(filePath);

  // Match href="..." and src="..."
  const linkRegex = /(?:href|src)=["']([^"'#]+?)["']/g;
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const link = match[1];

    // Skip external URLs, data URIs, mailto, javascript
    if (
      link.startsWith("http://") ||
      link.startsWith("https://") ||
      link.startsWith("data:") ||
      link.startsWith("mailto:") ||
      link.startsWith("javascript:") ||
      link.startsWith("//")
    ) {
      continue;
    }

    const resolved = path.resolve(dir, link);
    checkedCount++;

    if (!fs.existsSync(resolved)) {
      console.log(`  BROKEN: ${path.relative(ROOT_DIR, filePath)} -> ${link}`);
      brokenCount++;
    }
  }
}

function scanMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const dir = path.dirname(filePath);

  // Match [text](path) but not external URLs
  const mdLinkRegex = /\[(?:[^\]]+)\]\(([^)#]+?)\)/g;
  let match;

  while ((match = mdLinkRegex.exec(content)) !== null) {
    const link = match[1];

    // Skip external URLs
    if (link.startsWith("http://") || link.startsWith("https://")) {
      continue;
    }

    const resolved = path.resolve(dir, link);
    checkedCount++;

    if (!fs.existsSync(resolved)) {
      console.log(`  BROKEN: ${path.relative(ROOT_DIR, filePath)} -> ${link}`);
      brokenCount++;
    }
  }
}

function scanDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories (wiki/, assets/, etc.)
      scanDirectory(fullPath);
    } else if (entry.name.endsWith(".html")) {
      scanHtmlFile(fullPath);
    } else if (entry.name.endsWith(".md")) {
      scanMarkdownFile(fullPath);
    }
  }
}

console.log("Dead Link Check — scanning docs/\n");
scanDirectory(DOCS_DIR);

console.log(`\nChecked: ${checkedCount} links`);
console.log(`Broken:  ${brokenCount}`);

if (brokenCount > 0) {
  console.log("\nFix the broken links above.");
  process.exit(1);
} else {
  console.log("\nAll links OK.");
}
