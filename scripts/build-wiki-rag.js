#!/usr/bin/env node

/**
 * INFERNO — Build Wiki RAG Content
 *
 * Reads all docs/wiki/*.html files, strips HTML tags, and writes
 * a structured JSON file for the AI Copilot to use at runtime.
 *
 * This solves the Railway deployment issue where /docs/wiki/ is not
 * available in the container filesystem.
 *
 * Usage:
 *   node scripts/build-wiki-rag.js
 *
 * Output:
 *   apps/ai-copilot/src/context/wiki-content.json
 */

const fs = require("fs");
const path = require("path");

const WIKI_DIR = path.resolve(__dirname, "../docs/wiki");
const OUTPUT_FILE = path.resolve(
  __dirname,
  "../apps/ai-copilot/src/context/wiki-content.json"
);

function stripHtml(html) {
  // Extract main content (inside <main>, fallback to <body>)
  let body = html;
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (mainMatch) {
    body = mainMatch[1];
  } else if (articleMatch) {
    body = articleMatch[1];
  } else {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) body = bodyMatch[1];
  }

  // Strip sidebar/nav
  body = body.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  body = body.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

  // Strip HTML tags
  return body
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rarr;/g, "→")
    .replace(/&larr;/g, "←")
    .replace(/&check;/g, "✓")
    .replace(/&times;/g, "×")
    .replace(/&#x[\da-fA-F]+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  if (!fs.existsSync(WIKI_DIR)) {
    console.error(`ERROR: Wiki directory not found: ${WIKI_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(WIKI_DIR)
    .filter((f) => f.endsWith(".html"))
    .sort();

  const docs = [];

  for (const file of files) {
    const slug = file.replace(".html", "");
    const html = fs.readFileSync(path.join(WIKI_DIR, file), "utf-8");

    // Extract <title> content
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const rawTitle = titleMatch?.[1] || slug;
    const title = rawTitle
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/&amp;/g, "&")
      .replace(/\s*[—–-]\s*Inferno.*$/i, "")
      .replace(/\s*[—–-]\s*\$IFR.*$/i, "")
      .trim();

    const content = stripHtml(html);

    // Skip empty or very short pages
    if (content.length < 50) {
      console.log(`  SKIP: ${file} (${content.length} chars — too short)`);
      continue;
    }

    // Truncate to ~2000 chars per doc to stay within token limits
    const truncated =
      content.length > 2000 ? content.slice(0, 2000) + "..." : content;

    docs.push({ slug, title, content: truncated });
  }

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(docs, null, 2), "utf-8");

  console.log("=".repeat(50));
  console.log("  INFERNO — Wiki RAG Build");
  console.log("=".repeat(50));
  console.log(`  Source:  ${WIKI_DIR}`);
  console.log(`  Output:  ${OUTPUT_FILE}`);
  console.log(`  Pages:   ${docs.length}`);
  console.log(
    `  Size:    ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`
  );
  console.log("=".repeat(50));
  docs.forEach((d) =>
    console.log(`  ${d.slug.padEnd(20)} ${d.title} (${d.content.length} chars)`)
  );
}

main();
