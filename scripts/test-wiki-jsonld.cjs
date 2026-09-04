#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const wikiDirectory = path.join(root, "docs", "wiki");
const primaryTypes = new Set(["CollectionPage", "FAQPage", "TechArticle", "WebPage"]);

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])(.*?)\2/g)]
    .map((match) => [match[1].toLowerCase(), match[3]]));
}

function canonicalUrl(source, fileName) {
  const head = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((match) => attributes(match[0]));
  const canonicals = links.filter((entry) => entry.rel === "canonical");
  assert.equal(canonicals.length, 1, `${fileName}: expected exactly one canonical URL`);
  return canonicals[0].href;
}

function jsonLdBlocks(source, fileName) {
  const blocks = [...source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(blocks.length > 0, `${fileName}: missing JSON-LD`);
  return blocks.map((match, index) => {
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      assert.fail(`${fileName}: JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  });
}

function validateBreadcrumb(block, canonical, fileName) {
  const items = block.itemListElement;
  assert.ok(Array.isArray(items) && items.length >= 2, `${fileName}: invalid BreadcrumbList`);
  items.forEach((item, index) => {
    assert.equal(item["@type"], "ListItem", `${fileName}: breadcrumb ${index + 1} type`);
    assert.equal(item.position, index + 1, `${fileName}: breadcrumb positions must be sequential`);
    assert.ok(typeof item.name === "string" && item.name.trim(), `${fileName}: breadcrumb ${index + 1} name`);
    assert.ok(/^https:\/\/ifrunit\.tech\//.test(item.item), `${fileName}: breadcrumb ${index + 1} URL`);
  });
  assert.equal(items.at(-1).item, canonical, `${fileName}: final breadcrumb must match canonical URL`);
}

function validateFaq(block, fileName) {
  assert.ok(Array.isArray(block.mainEntity) && block.mainEntity.length > 0, `${fileName}: FAQPage needs questions`);
  for (const [index, question] of block.mainEntity.entries()) {
    assert.equal(question["@type"], "Question", `${fileName}: FAQ item ${index + 1} type`);
    assert.ok(typeof question.name === "string" && question.name.trim(), `${fileName}: FAQ item ${index + 1} name`);
    assert.equal(question.acceptedAnswer?.["@type"], "Answer", `${fileName}: FAQ item ${index + 1} answer type`);
    assert.ok(typeof question.acceptedAnswer?.text === "string" && question.acceptedAnswer.text.trim(), `${fileName}: FAQ item ${index + 1} answer text`);
  }
}

const files = execFileSync("git", ["ls-files", "docs/wiki/*.html"], { cwd: root, encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort();
assert.ok(files.length >= 35, "Wiki JSON-LD inventory unexpectedly shrank below 35 tracked pages");

for (const relativePath of files) {
  const fileName = path.basename(relativePath);
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const canonical = canonicalUrl(source, fileName);
  const blocks = jsonLdBlocks(source, fileName);

  for (const [index, block] of blocks.entries()) {
    assert.ok(block && !Array.isArray(block) && typeof block === "object", `${fileName}: JSON-LD block ${index + 1} must be an object`);
    assert.equal(block["@context"], "https://schema.org", `${fileName}: JSON-LD block ${index + 1} context`);
    assert.ok(typeof block["@type"] === "string" && block["@type"], `${fileName}: JSON-LD block ${index + 1} type`);
  }

  const primary = blocks.filter((block) => primaryTypes.has(block["@type"]));
  assert.equal(primary.length, 1, `${fileName}: expected exactly one primary page schema`);
  assert.equal(primary[0].url, canonical, `${fileName}: primary schema URL must match canonical URL`);
  const title = primary[0].headline || primary[0].name;
  assert.ok(typeof title === "string" && title.trim(), `${fileName}: primary schema headline or name`);
  assert.ok(typeof primary[0].description === "string" && primary[0].description.trim(), `${fileName}: primary schema description`);

  const breadcrumbs = blocks.filter((block) => block["@type"] === "BreadcrumbList");
  assert.ok(breadcrumbs.length <= 1, `${fileName}: duplicate BreadcrumbList`);
  if (breadcrumbs.length) validateBreadcrumb(breadcrumbs[0], canonical, fileName);
  if (primary[0]["@type"] === "FAQPage") validateFaq(primary[0], fileName);
}

console.log(`[wiki-jsonld] PASS (${files.length} tracked pages)`);
