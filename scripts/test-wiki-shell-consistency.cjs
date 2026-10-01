#!/usr/bin/env node

// Guards the shared Wiki shell (T-158): every sidebar page uses the same brand
// wording, marks exactly one active menu link with aria-current="page" that
// points to the page itself, and styles the sidebar subtitle the same way.
// open-audit.html action links must use the shared skin buttons, not inline colors.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const wikiDir = path.join(root, "docs", "wiki");
const NAV_RE = /<ul class="sidebar-nav">([\s\S]*?)<\/ul>/;
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const pages = fs.readdirSync(wikiDir).filter((name) => name.endsWith(".html")).sort();
let sidebarPages = 0;
for (const page of pages) {
  const src = fs.readFileSync(path.join(wikiDir, page), "utf8");
  const nav = src.match(NAV_RE);
  if (!nav) continue;
  sidebarPages += 1;
  check(/class="sidebar-logo">IFR PROTOCOL<\/a>/.test(src), `${page}: sidebar brand must read "IFR PROTOCOL"`);
  check(/<div class="sidebar-subtitle">Documentation<\/div>/.test(src), `${page}: sidebar subtitle must read "Documentation"`);
  const active = [...nav[1].matchAll(/<a href="([^"]+)"([^>]*)>/g)].filter((m) => /class="active"/.test(m[2]));
  check(active.length === 1, `${page}: exactly one active sidebar link expected, found ${active.length}`);
  if (active.length === 1) {
    check(/aria-current="page"/.test(active[0][2]), `${page}: active sidebar link must carry aria-current="page"`);
    const target = active[0][1].replace(/^https:\/\/ifrunit\.tech\/wiki\//, "") || "index.html";
    check(target === page, `${page}: active sidebar link points to ${target}`);
  }
  const current = nav[1].match(/aria-current="page"/g) || [];
  check(current.length === 1, `${page}: exactly one aria-current="page" expected, found ${current.length}`);
  if (src.includes('id="wiki-wallet-bar"')) {
    check(src.includes('font-size:0.9rem;">&larr; Inferno</a>'), `${page}: wallet bar back link must read "← Inferno"`);
  }
}
check(sidebarPages >= 30, `expected the Wiki shell on at least 30 pages, found ${sidebarPages}`);

const index = fs.readFileSync(path.join(wikiDir, "index.html"), "utf8");
check(/\.sidebar-subtitle \{\s*font-size: 12px;/.test(index), "index.html: .sidebar-subtitle must use the canonical shell style");
check(!index.includes("&larr; IFR Protocol</a>"), "index.html: legacy back-link wording remains");

const audit = fs.readFileSync(path.join(wikiDir, "open-audit.html"), "utf8");
const groups = audit.match(/<div class="wiki-actions">[\s\S]*?<\/div>/g) || [];
check(groups.length === 3, `open-audit.html: expected 3 .wiki-actions groups, found ${groups.length}`);
for (const group of groups) {
  for (const link of group.match(/<a [^>]*>/g) || []) {
    check(/class="btn btn-(primary|secondary)"/.test(link), `open-audit.html: action link without shared button class: ${link}`);
    check(!/style=/.test(link), `open-audit.html: action link keeps inline colors: ${link}`);
  }
}

// Contrast of the shared button tokens (WCAG 2.x relative luminance).
const skin = fs.readFileSync(path.join(root, "docs", "assets", "redesign-skin.css"), "utf8");
const token = (name) => {
  const m = skin.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `redesign-skin.css: missing --${name}`);
  return m[1];
};
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
for (const [fg, bg, label] of [
  ["#FFFFFF", token("accent"), "primary button text"],
  ["#FFFFFF", token("accent-deep"), "primary button hover text"],
  [token("ink"), token("surface"), "secondary button text"],
  [token("ink"), token("bg-alt"), "secondary button hover text"],
]) {
  const ratio = contrast(fg, bg);
  check(ratio >= 4.5, `${label}: contrast ${ratio.toFixed(2)} < 4.5`);
}
// T-176a: legacy dark-theme inline colors rendered near-white on the light audit cards.
for (const [, styleAttr] of audit.matchAll(/style="([^"]*)"/g)) {
  check(!/color:\s*#(?:e8e8ed|fbbf24)\b/i.test(styleAttr), `open-audit.html: unreadable legacy inline text color: ${styleAttr}`);
}
// Badge contrast is computed from the page's own inline declarations: the text colour and the
// translucent tint composited over the white card surface (as the browser renders it).
function rgbaOf(value) {
  const hex = value.match(/#([0-9a-f]{6})\b/i);
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
  const fn = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  return fn ? { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] } : null;
}
function overWhite({ r, g, b, a }) {
  const mix = (c) => Math.round(c * a + 255 * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}
function hexOf({ r, g, b }) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}
const declared = (style, prop) => {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? rgbaOf(m[1]) : null;
};
const certifiedBadge = audit.match(/<span style="([^"]*)">Not Third-Party Certified<\/span>/);
const premiumBlock = audit.match(/<div id="lp-drop-lock" style="([^"]*)">\s*<span style="([^"]*)">&#x26A1; Premium<\/span>/);
check(certifiedBadge && premiumBlock, "open-audit.html: badge markup for the contrast check not found");
if (certifiedBadge && premiumBlock) {
  for (const [label, fg, tint] of [
    ["Not Third-Party Certified badge", declared(certifiedBadge[1], "color"), declared(certifiedBadge[1], "background")],
    ["Premium label", declared(premiumBlock[2], "color"), declared(premiumBlock[1], "background")],
  ]) {
    check(fg && tint, `open-audit.html: ${label} colour declarations not found`);
    if (!fg || !tint) continue;
    const ratio = contrast(hexOf(fg), overWhite(tint));
    check(ratio >= 4.5, `open-audit.html: ${label} contrast ${ratio.toFixed(2)} < 4.5`);
  }
}
// Muted text tokens are used for secondary copy on every light surface of the skin.
for (const muted of ["muted", "ink-muted", "text-muted"]) {
  for (const surface of ["surface", "bg", "bg-alt", "bg-card-hover"]) {
    const ratio = contrast(token(muted), token(surface));
    check(ratio >= 4.5, `redesign-skin.css: --${muted} on --${surface} contrast ${ratio.toFixed(2)} < 4.5`);
  }
}
check(/\.wiki-actions \.btn \{[^}]*min-height: 44px;/.test(skin), "redesign-skin.css: .wiki-actions .btn must keep a 44px minimum height");
check(/\.wiki-actions \.btn:focus-visible \{[^}]*outline: 3px solid/.test(skin), "redesign-skin.css: .wiki-actions .btn needs a visible focus outline");
// T-181c: inline legacy dark-theme accents render on light wiki surfaces at 1.4-3.8:1.
const legacyInlineAccent = /style="[^"]*(?<![-\w])color\s*:\s*#(c084fc|a855f7|60a5fa|3b82f6|22c55e|ff4500|f59e0b|eab308|fbbf24|ff8c00|f97316|ef4444|ffc800|38bdf8)\b/gi;
for (const page of pages) {
  if (page === "contracts.html") continue; // covered by the T-181 contracts.html check
  const src = fs.readFileSync(path.join(wikiDir, page), "utf8");
  for (const [, hex] of src.matchAll(legacyInlineAccent)) {
    check(false, `${page}: legacy low-contrast inline text colour #${hex} on a light surface`);
  }
}

if (failures.length) {
  console.error(`[wiki-shell] FAIL - ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[wiki-shell] PASS - ${sidebarPages} sidebar pages share brand, active-link semantics and button contrast`);
}
