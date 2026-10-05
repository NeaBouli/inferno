// Copy-consistency guard for docs/wiki/commitment-vault.html (Codex review on PR #192, CV-01).
// Deployed CommitmentVault V1 cannot read a price: PRICE_ONLY and TIME_AND_PRICE tranches never unlock,
// TIME_OR_PRICE still unlocks by time, TIME_ONLY unlocks normally. The page must not claim that all
// price-conditioned tranches are stuck, that TIME_OR_PRICE is stuck, or that Auto-Unlock prevents
// permanently locked tokens, and must not present price tranches as an available benefit.
// It must state only the destination binding of unlock(), not absolute theft safety (Codex hold on PR #192).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "docs", "wiki", "commitment-vault.html"), "utf8");
const text = html.replace(/<script[\s\S]*?<\/script>/gi, (m) => (m.includes("application/ld+json") ? m : " "))
  .replace(/<[^>]+>/g, " ").replace(/&mdash;/g, "-").replace(/\s+/g, " ");

const forbidden = [
  [/price-conditioned (V1 )?(locks|tranches) (can never|cannot|never) unlock/i, "broad claim that all price-conditioned tranches are stuck"],
  [/all price[- ]conditioned/i, "\"all price-conditioned\" claim"],
  [/TIME_OR_PRICE[^.]{0,60}(can never|cannot|never) unlock/i, "claim that TIME_OR_PRICE is stuck"],
  [/prevents permanently locked/i, "claim that Auto-Unlock prevents permanently locked tokens"],
  [/aligned with project success/i, "price tranches presented as an available benefit"],
  [/As long as your wallet address exists, the tokens are safe/i, "lost-access reassurance"],
  [/impossible to steal/i, "absolute theft-safety claim"],
  [/Can someone steal my locked tokens\? No\./i, "unqualified \"No\" to the theft question"],
];
for (const [re, label] of forbidden) assert.ok(!re.test(text), `commitment-vault.html contains ${label}`);

for (const tag of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
  const m = html.match(new RegExp(`<meta ${tag} content="([^"]+)"`));
  assert.ok(m, `${tag} missing`);
  assert.match(m[1], /PRICE_ONLY and TIME_AND_PRICE/, `${tag} must name the stuck types`);
  assert.match(m[1], /TIME_OR_PRICE still unlocks by time/, `${tag} must say TIME_OR_PRICE unlocks by time`);
  assert.match(m[1], /V2, fee-exempt since Governance proposal #17/, `${tag} must state V2 is fee-exempt since #17`);
  assert.doesNotMatch(m[1], /after Governance proposal #17/, `${tag} must not describe #17 as pending`);
}
const ld = html.match(/"description":\s*"([^"]+)"/);
assert.ok(ld && /TIME_OR_PRICE still unlocks by time/.test(ld[1]), "JSON-LD description must say TIME_OR_PRICE unlocks by time");
assert.match(text, /PRICE_ONLY and TIME_AND_PRICE tranches can never unlock, while TIME_OR_PRICE tranches still unlock by their time condition/, "FAQ must be narrowed to the stuck types");
assert.match(text, /unlock\(\) cannot send them to the caller or any other address/, "Auto-Unlock must state the destination binding");
assert.match(text, /This does not protect a compromised wallet/, "Auto-Unlock must state the remaining wallet-compromise risk");
assert.match(text, /If that wallet itself is compromised, the attacker can unlock the tokens/, "FAQ must state the remaining wallet-compromise risk");

// Compensation page Repair list must describe the live Web3 app (releases 417e3478/3771e284), not the pre-release state (T-263).
const comp = fs.readFileSync(path.join(__dirname, "..", "docs", "wiki", "commitment-vault-compensation.html"), "utf8");
assert.doesNotMatch(comp, /still offers price-conditioned V1 locks/, "compensation page must not claim Web3 still offers V1 price locks");
assert.doesNotMatch(comp, /until that release is verified/, "compensation page must not describe the time-only Web3 release as pending");
assert.match(comp, /offers only time-based locks in CommitmentVault V2/, "compensation page must state Web3 offers only time-based V2 locks");
assert.match(comp, /existing V1 tranches stay listed and unlock through V1/, "compensation page must state V1 exits remain");

// Web3 protocol dialog titles use fixed sizes, not viewport-scaled fonts, so the close button stays inside the card (T-263).
const web3 = fs.readFileSync(path.join(__dirname, "..", "docs", "web3", "index.html"), "utf8");
const titleRules = [...web3.matchAll(/\.protocol-card(?: header)? h2\s*\{([^}]*)\}/g)].map((m) => m[1]);
assert.ok(titleRules.length >= 2, "protocol dialog title rules missing");
for (const rule of titleRules) assert.doesNotMatch(rule, /font-size:[^;]*(vw|clamp\()/, "protocol dialog title must not use a viewport-scaled font-size");
assert.match(web3, /@media \(max-width: 680px\) \{\s*\.protocol-card header h2 \{\s*font-size: 24px;/, "protocol dialog title must have a fixed 24px size at <=680px");
assert.match(web3, /\.protocol-close \{[^}]*width: 44px;[^}]*height: 44px;/, "protocol close button must keep a 44x44 tap target");
const bodyRule = web3.match(/\n    body \{([^}]*)\}/);
assert.ok(bodyRule, "web3 body rule missing");
assert.doesNotMatch(bodyRule[1], /min-width:\s*[1-9]\d*px/, "web3 body must not set a fixed pixel min-width (15px desktop scrollbar at 320px overflows, T-264)");
console.log("[commitment-vault-copy] PASS - stuck types named precisely, no Auto-Unlock safety or price-benefit claims, compensation page live state, fixed dialog title sizes");
