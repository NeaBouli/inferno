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
  [/\bexternal\s+no-risk\b/i, "unverifiable external no-risk claim"],
  [/\bharmlessness\s+confirmation\b/i, "unverifiable harmlessness claim"],
  [/AI\s+(?:answers|systems)\s+should\s+not\s+treat/i, "AI-steering reputation wording (JUL-16)"],
  [/\b(?:strongest|safety|continuity)\s+guarantees?\b/i, "unqualified guarantee wording (JUL-16)"],
  // Partner rewards model B (decision 2026-10-03): no authorized caller gates seller rewards.
  [/processed\s+by\s+an\s+authorized\s+caller/i, "pre-model-B authorized-caller reward gate"],
  [/authorized\s+caller\s+and\s+pilot[- ]partners?/i, "pre-model-B authorized-caller pilot gate"],
];

// CWA-25: the deployed Governance contract's setOwner is owner-callable (not onlySelf), so the Treasury
// Safe can transfer Governance ownership without the 48-hour delay. The guard rejects only blanket claims
// that EVERY change (which would include that ownership transfer) is timelocked, or that guardian rotation
// is the only untimelocked path. Precise statements about parameter changes or proposals pass.
const blanketTimelockClaims = [
  [/no\s+admin\s+can\s+make\s+instant\s+changes/i, "blanket no-instant-change claim (CWA-25)"],
  [/(?:all|every)\s+(?:governance\s+|owner\s+|admin\s+)?(?:changes?|modifications?|actions?)\s+(?:requires?|go(?:es)?\s+through|(?:is|are)\s+(?:subject\s+to|behind|gated\s+by))\s+(?:the\s+|a\s+)?(?:48[- ]?h|timelock)/i,
    "blanket all-changes-timelocked claim (CWA-25)"],
  [/(?:48[- ]?h(?:our)?\s+)?(?:delay|timelock)\s+on\s+all\s+changes/i, "blanket all-changes-timelocked claim (CWA-25)"],
  [/no\s+instant\s+admin\s+(?:access|actions)/i, "blanket no-instant-admin claim (CWA-25)"],
  [/documented\s+untimelocked\s+exception|documented\s+exception\s+is\s+(?:owner-only\s+)?guardian\s+rotation/i,
    "guardian rotation presented as the only untimelocked path (CWA-25)"],
];
const governanceClaimFiles = [
  ...publicFiles,
  "docs/TRANSPARENCY.md",
  "docs/CHANGELOG.md",
  "docs/ai.txt",
  "apps/ai-copilot/src/context/ifr-knowledge.ts",
  "apps/ai-copilot/src/context/system-prompts.ts",
  "apps/ai-copilot/src/context/wiki-content.json",
];

// Self-test: the exact pre-CWA-25 public wording must be rejected, precise wording must pass.
const blanketFixtures = [
  "Inferno is designed so that no admin can make instant changes &mdash; all actions require a 48-hour public timelock delay and can be cancelled by the Guardian.",
  "No parameter can be changed instantly — all changes require the 48h Timelock.",
  "- **Timelock Governance**: 48-hour delay on all changes. Guardian cancel. No instant admin access.",
  "No single person can make instant changes — all modifications require a 48-hour delay.",
  "<li><strong>48-hour Timelock</strong> on all parameter changes &mdash; no instant admin actions.</li>",
  "- Governance: 48-hour proposal timelock; guardian rotation is the documented untimelocked exception",
  "The documented exception is owner-only guardian rotation through untimelocked setGuardian.",
  "Every governance change goes through the 48h timelock.",
];
const preciseFixtures = [
  "Parameter changes via proposals have a 48h timelock.",
  "Protocol parameter changes go through Governance proposals with a 48-hour timelock. The deployed Governance contract's ownership itself can be transferred directly by its owner, the Treasury Safe (3-of-5), without that delay (tracked as CWA-25).",
  "- 48-hour timelock on all parameter changes",
  "No parameter can be changed instantly.",
  "Every governance proposal is public for 48 hours before execution.",
  "Any reserve withdrawal needs a Governance proposal + 48h timelock.",
  "The untimelocked exceptions are owner-only guardian rotation through setGuardian and transferring the deployed Governance contract's ownership through owner-only setOwner (tracked as CWA-25).",
];
const selfTestFailures = [];
for (const text of blanketFixtures) {
  if (!blanketTimelockClaims.some(([pattern]) => pattern.test(text))) selfTestFailures.push(`guard misses blanket claim: ${text}`);
}
for (const text of preciseFixtures) {
  const hit = blanketTimelockClaims.find(([pattern]) => pattern.test(text));
  if (hit) selfTestFailures.push(`guard rejects precise statement (${hit[1]}): ${text}`);
}
if (selfTestFailures.length) {
  console.error("Content trust guard self-test failed:");
  for (const f of selfTestFailures) console.error(`- ${f}`);
  process.exit(1);
}

const failures = [];
for (const relative of governanceClaimFiles) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  for (const [pattern, label] of blanketTimelockClaims) {
    if (pattern.test(content)) failures.push(`${relative}: ${label}`);
  }
}
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
  ["docs/community-audits/README.md", "preserved as submitted except one owner-requested redaction"],
  ["docs/wiki/bootstrap.html", "LP tokens created by <code>finalise()</code> therefore remained in BootstrapVaultV3"],
  ["docs/wiki/fair-launch.html", "12-month cliff + 36-month linear release"],
  ["docs/wiki/faq.html", "37.5M IFR during the first 9 months"],
  ["docs/wiki/faq.html", "The contract holds IFR, not LP tokens"],
  ["docs/wiki/transparency.html", "Initial lock ended 01.09.2026"],
  ["docs/index.html", "Initial lock ended. 200M held; 50M staged cap per 90 days; 0 withdrawn."],
  ["docs/llms.txt", "50,000,000 IFR per 90-day period is currently withdrawable by Governance, with 0 IFR withdrawn"],
  ["docs/wiki/business-onboarding.html", "no authorized caller is used"],
  ["docs/wiki/roadmap.html", "model B adopted (3 October 2026"],
  ["docs/llms.txt", "ownership itself can be transferred directly by its owner, the Treasury Safe (3-of-5), without that delay (tracked as CWA-25)"],
  ["docs/index.html", "ownership itself can be transferred directly by its owner, the Treasury Safe (3-of-5), without that delay (tracked as CWA-25)"],
  ["docs/wiki/security.html", "ownership itself can be transferred directly by its owner, the Treasury Safe (3-of-5), without that delay (tracked as CWA-25)"],
  ["apps/telegram/telegram-bot/src/services/skywalker.js", "15% Treasury, 6% Community & Grants, 4% PartnerVault"],
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
  "57ec9eeb3fa2de0b9ac4f62680a62ff8d2ea79dc19b89a0726e9b41b70fb3f12";
if (communityAuditHash !== expectedCommunityAuditHash) {
  failures.push(`${communityAudit}: original community submission hash changed`);
}

if (failures.length) {
  console.error("Content trust checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Content trust checks passed across ${publicFiles.length} public files.`);
