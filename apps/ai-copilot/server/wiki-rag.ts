import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __wikiFilename = fileURLToPath(import.meta.url);
const __wikiDirname = dirname(__wikiFilename);

export interface WikiDoc {
  title: string;
  slug: string;
  content: string;
}

/**
 * Load wiki docs from the pre-built JSON file (embedded at build time).
 * Falls back to filesystem scan for local development.
 */
export function loadWikiDocs(wikiDir: string): WikiDoc[] {
  // 1. Try pre-built JSON (works on Railway and after prebuild)
  const jsonPath = resolve(
    __wikiDirname,
    "../src/context/wiki-content.json"
  );
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, "utf-8");
      const docs: WikiDoc[] = JSON.parse(raw);
      console.log(`Wiki RAG: loaded ${docs.length} docs from wiki-content.json`);
      return docs;
    } catch (err) {
      console.warn("Wiki RAG: failed to parse wiki-content.json:", err);
    }
  }

  // 2. Fallback: read HTML files from filesystem (local dev without prebuild)
  if (!existsSync(wikiDir)) {
    console.warn(`Wiki RAG: neither JSON nor wiki dir found — no RAG context`);
    return [];
  }

  console.log(`Wiki RAG: falling back to filesystem scan (${wikiDir})`);
  const files = readdirSync(wikiDir).filter((f) => f.endsWith(".html"));
  const docs: WikiDoc[] = [];

  for (const file of files) {
    const slug = file.replace(".html", "");
    const html = readFileSync(join(wikiDir, file), "utf-8");

    // Extract <title> content
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s*[—–-]\s*Inferno.*$/i, "").trim() || slug;

    // Extract main content (inside <main> or <article>, fallback to <body>)
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
    const text = body
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
      .replace(/\s+/g, " ")
      .trim();

    // Skip empty or very short pages
    if (text.length < 50) continue;

    // Truncate to ~2000 chars per doc to stay within token limits
    const truncated = text.length > 2000 ? text.slice(0, 2000) + "..." : text;

    docs.push({ title, slug, content: truncated });
  }

  return docs;
}

/**
 * Build an enhanced system prompt that includes RAG context from wiki docs.
 */
export function buildSystemPrompt(
  basePrompt: string,
  mode: string,
  docs: WikiDoc[]
): string {
  // Select relevant docs based on mode
  const relevantDocs = selectDocsForMode(mode, docs);

  if (relevantDocs.length === 0) return basePrompt;

  const wikiContext = relevantDocs
    .map((d) => `### ${d.title} (wiki/${d.slug})\n${d.content}`)
    .join("\n\n");

  return `${basePrompt}

--- WIKI KNOWLEDGE BASE ---
The following is extracted from the official IFR Wiki. Use this as your primary source of truth.
When answering, cite the specific wiki page: "Source: wiki/${relevantDocs[0]?.slug}"

${wikiContext}
--- END WIKI ---`;
}

function selectDocsForMode(mode: string, docs: WikiDoc[]): WikiDoc[] {
  // Priority pages per mode
  const priorities: Record<string, string[]> = {
    explorer: ["tokenomics", "faq", "fair-launch", "fee-design", "bootstrap"],
    user: ["lock-mechanism", "tokenomics", "faq", "integration", "fair-launch"],
    dev: ["contracts", "integration", "deployment", "security", "governance"],
    // Backwards compatibility
    customer: ["tokenomics", "faq", "fair-launch", "fee-design", "bootstrap"],
    partner: ["lock-mechanism", "tokenomics", "faq", "integration", "fair-launch"],
    developer: ["contracts", "integration", "deployment", "security", "governance"],
  };

  const priorityList = priorities[mode] || priorities.customer;
  const selected: WikiDoc[] = [];

  // Add priority docs first
  for (const slug of priorityList) {
    const doc = docs.find((d) => d.slug === slug);
    if (doc) selected.push(doc);
  }

  // Add remaining docs (up to 8 total to manage token count)
  for (const doc of docs) {
    if (selected.length >= 8) break;
    if (!selected.includes(doc)) selected.push(doc);
  }

  return selected;
}
