#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const publicFiles = [
  "README.md",
  "docs/index.html",
  "docs/ROADMAP.md",
  "docs/FAIR_LAUNCH.md",
  "docs/WHITEPAPER.md",
  "docs/WHITEPAPER_EN.md",
  "docs/PRESS_KIT.md",
  "docs/BOOTSTRAP_ANNOUNCEMENT.md",
  "docs/MIRROR_ARTICLE.md",
  "docs/ETHERSCAN_SUBMISSION.md",
  "docs/FARCASTER_POSTS.md",
  "docs/AUDIT_BRIEF.md",
  "docs/ONE-PAGER.md",
  "docs/STATUS-REPORT.md",
  "docs/llms.txt",
  ...fs.readdirSync(path.join(root, "docs/wiki"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => `docs/wiki/${file}`),
  ...fs.readdirSync(path.join(root, "docs/wizard"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => `docs/wizard/${file}`),
];

const forbidden = [
  [/locked\s+12m\s+via\s+Team\.?Finance/i, "obsolete Team.Finance LP claim"],
  [/LP\s+(?:tokens?\s+)?locked\s+(?:for\s+)?12\s+months/i, "obsolete 12-month LP claim"],
  [/\b3\.5%\s+burn\b/i, "incorrect burn claim"],
  [/\bt\.me\/inferno_ifr\b/i, "obsolete Telegram destination"],
  [/200M\s+IFR\s*\+\s*0\.030\s+ETH\s+paired/i, "incorrect paired IFR amount"],
  [/\b(?:4-year|4\s+years|48-month)\s+linear\b/i, "incorrect vesting duration"],
  [/\b(?:lifetime|permanent)\s+(?:premium\s+)?access\b/i, "unqualified permanent-access claim"],
  [/\baccess\s+lifetime\s+premium\b/i, "unqualified lifetime-access claim"],
  [/\bIndependent AI Security Analysis\b/i, "model-based audit claim"],
  [/\b(?:Claude|ChatGPT|Grok)\s+(?:Security\s+)?Audit\b/i, "model-branded current audit claim"],
];

const failures = [];
for (const relative of publicFiles) {
  const file = path.join(root, relative);
  const content = fs.readFileSync(file, "utf8");
  for (const [pattern, label] of forbidden) {
    if (pattern.test(content)) failures.push(`${relative}: ${label}`);
  }
}

const required = [
  ["docs/wiki/security.html", "Full Internal Token Security Review"],
  ["docs/wiki/security.html", "professional third-party audit remains pending"],
  ["docs/wiki/open-audit.html", "OKComputer Community Submission"],
  ["docs/community-audits/README.md", "preserved unchanged as submitted"],
  ["docs/wiki/bootstrap.html", "LP tokens created by <code>finalise()</code> therefore remained in BootstrapVaultV3"],
  ["docs/wiki/fair-launch.html", "12-month cliff + 36-month linear release"],
  ["docs/wiki/faq.html", "37.5M IFR during the first 9 months"],
];

for (const [relative, phrase] of required) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  if (!content.includes(phrase)) failures.push(`${relative}: missing canonical phrase "${phrase}"`);
}

for (const relative of ["docs/TODO.md", "docs/TODO.html"]) {
  if (fs.existsSync(path.join(root, relative))) {
    failures.push(`${relative}: internal TODO must not be published under docs/`);
  }
}

const communityAudit = "docs/community-audits/IFR_Protocol_Audit_2026-07-27.md";
const communityAuditHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(root, communityAudit)))
  .digest("hex");
const expectedCommunityAuditHash =
  "ec7f99b0b74c51e04091727a0b69f49f67c36409a52c9ea7b55ba545b6b3e375";
if (communityAuditHash !== expectedCommunityAuditHash) {
  failures.push(`${communityAudit}: original community submission hash changed`);
}

if (failures.length) {
  console.error("Content trust checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Content trust checks passed across ${publicFiles.length} public files.`);
