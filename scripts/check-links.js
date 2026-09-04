/**
 * Internal documentation link checker.
 *
 * Site-root paths resolve from docs/, while relative Markdown paths may still
 * reach repository files through ../. External and runtime-generated URLs are
 * intentionally outside this checker's scope.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.join(__dirname, "..");
const DOCS_DIR = path.join(ROOT_DIR, "docs");

function normalizeLocalLink(rawLink) {
  let link = String(rawLink || "").trim();
  if (!link || link.startsWith("#") || link.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(link)) return null;
  if (/\$\{|{{|}}|<%|%>/.test(link)) return null;

  if (link.startsWith("<") && link.endsWith(">")) {
    link = link.slice(1, -1).trim();
  }

  link = link.replaceAll("&amp;", "&");
  link = link.split("#", 1)[0].split("?", 1)[0].trim();
  if (!link) return null;

  try {
    return decodeURIComponent(link);
  } catch {
    return link;
  }
}

function resolveLocalTarget(filePath, link, docsDir = DOCS_DIR) {
  return link.startsWith("/")
    ? path.resolve(docsDir, `.${link}`)
    : path.resolve(path.dirname(filePath), link);
}

function targetExists(targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return true;
  return stat.isDirectory() && fs.existsSync(path.join(targetPath, "index.html"));
}

function isPathWithin(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createState() {
  return { broken: [], checkedCount: 0 };
}

function checkLink(filePath, rawLink, state, rootDir, docsDir) {
  const link = normalizeLocalLink(rawLink);
  if (!link) return;

  const target = resolveLocalTarget(filePath, link, docsDir);
  state.checkedCount += 1;
  const allowedBase = link.startsWith("/") ? docsDir : rootDir;
  if (!isPathWithin(allowedBase, target) || !targetExists(target)) {
    state.broken.push({
      file: path.relative(rootDir, filePath),
      link: rawLink,
    });
  }
}

function scanHtmlFile(filePath, state, rootDir, docsDir) {
  const content = fs.readFileSync(filePath, "utf8");
  const tagRegex = /<[a-z][^>]*>/gi;
  const linkRegex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(content)) !== null) {
    let linkMatch;
    linkRegex.lastIndex = 0;
    while ((linkMatch = linkRegex.exec(tagMatch[0])) !== null) {
      checkLink(filePath, linkMatch[1], state, rootDir, docsDir);
    }
  }
}

function scanMarkdownFile(filePath, state, rootDir, docsDir) {
  const content = fs.readFileSync(filePath, "utf8");
  const linkRegex = /\[(?:[^\]]+)]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    checkLink(filePath, match[1], state, rootDir, docsDir);
  }
}

function scanDirectory(dirPath, state, rootDir, docsDir) {
  if (!fs.existsSync(dirPath)) return;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, state, rootDir, docsDir);
    } else if (entry.name.endsWith(".html")) {
      scanHtmlFile(fullPath, state, rootDir, docsDir);
    } else if (entry.name.endsWith(".md")) {
      scanMarkdownFile(fullPath, state, rootDir, docsDir);
    }
  }
}

function checkDocumentationLinks({ rootDir = ROOT_DIR, docsDir = DOCS_DIR } = {}) {
  const state = createState();
  scanDirectory(docsDir, state, rootDir, docsDir);
  return state;
}

function main() {
  console.log("Internal Link Check - scanning docs/\n");
  const result = checkDocumentationLinks();
  for (const broken of result.broken) {
    console.log(`  BROKEN: ${broken.file} -> ${broken.link}`);
  }
  console.log(`\nChecked: ${result.checkedCount} links`);
  console.log(`Broken:  ${result.broken.length}`);

  if (result.broken.length > 0) {
    console.log("\nFix the broken links above.");
    process.exitCode = 1;
  } else {
    console.log("\nAll links OK.");
  }
}

if (require.main === module) main();

module.exports = {
  checkDocumentationLinks,
  normalizeLocalLink,
  resolveLocalTarget,
  isPathWithin,
  targetExists,
};
