// Unit test for docs/widget/ifr-benefits-widget.js: rule evaluation mirrors the IFR Benefits backend
// (ifrLockService.checkBenefitEligibility) for the IFRLock path, never claims more, and the widget's
// constants match the repository sources of truth.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { id } = require("ethers");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
require(path.join(root, "docs/widget/ifr-benefits-widget.js")); // root package is ESM: the widget registers globalThis.IFRBenefitsWidget
const W = globalThis.IFRBenefitsWidget;
const U = 10n ** 9n;
const ifr = (n) => BigInt(n) * U;

// Tier presets equal the shop's WalletStatus presets.
const walletStatus = read("apps/benefits-network/frontend/src/components/WalletStatus.tsx");
const shopTiers = [...walletStatus.matchAll(/\{\s*label:\s*'(\w+)',\s*amount:\s*(\d+)\s*\}/g)].map((m) => ({ label: m[1], amount: Number(m[2]) }));
assert.ok(shopTiers.length >= 4, "shop tier presets found");
assert.deepEqual(W.TIER_PRESETS, shopTiers, "widget tiers must equal the shop presets");

// Selectors and addresses equal the contracts and the deployment manifest.
const src = read("docs/widget/ifr-benefits-widget.js");
assert.ok(src.includes(id("lockedBalance(address)").slice(0, 10)));
assert.ok(src.includes(id("balanceOf(address)").slice(0, 10)));
assert.ok(read("contracts/lock/IFRLock.sol").includes("function lockedBalance(address user) external view returns (uint256)"));
const manifest = JSON.parse(read("deployments/mainnet.json"));
assert.ok(src.includes(manifest.IFRLock.address), "IFRLock address matches deployments/mainnet.json");
assert.ok(src.includes(manifest.InfernoToken.address), "token address matches deployments/mainnet.json");

const rule = (o) => ({ id: "r", label: "Bronze", discountPercent: 10, requiredLockIFR: 1000, minIFRHeld: 0, lockSource: "ifrlock", productId: null, active: true, ...o });
const ev = (rules, locked, held = 0n) => W.evaluateRules(rules, { locked, held });

// IFRLock path: exact threshold semantics (>=) like the backend.
assert.equal(ev([rule()], ifr(1000)).results[0].status, "met");
assert.equal(ev([rule()], ifr(1000) - 1n).results[0].status, "not_met");
// Held threshold must also be met.
assert.equal(ev([rule({ minIFRHeld: 50 })], ifr(1000), ifr(49)).results[0].status, "not_met");
assert.equal(ev([rule({ minIFRHeld: 50 })], ifr(1000), ifr(50)).results[0].status, "met");
// "either": met via IFRLock, otherwise only the shop can decide (CommitmentVault TIME_ONLY).
assert.equal(ev([rule({ lockSource: "either" })], ifr(1000)).results[0].status, "met");
assert.equal(ev([rule({ lockSource: "either" })], 0n).results[0].status, "checkout");
// CommitmentVault-only, unknown sources and malformed rules are never shown as met.
for (const bad of [{ lockSource: "commitment_time_only" }, { lockSource: "price" }, { requiredLockIFR: 0 }, { requiredLockIFR: -1 },
  { requiredLockIFR: 1.5 }, { discountPercent: 101 }, { discountPercent: null }, { minIFRHeld: -5 }, { active: false }]) {
  assert.equal(ev([rule(bad)], ifr(10 ** 9), ifr(10 ** 9)).results[0].status, "checkout", JSON.stringify(bad));
}
// Best store-wide benefit: highest met discount, product rules excluded.
const best = ev([rule({ id: "a", discountPercent: 5 }), rule({ id: "b", discountPercent: 15, requiredLockIFR: 2500 }),
  rule({ id: "c", discountPercent: 50, productId: "p1" }), rule({ id: "d", discountPercent: 30, requiredLockIFR: 9999999 })], ifr(3000)).best;
assert.equal(best.id, "b");
assert.equal(ev([], ifr(5)).best, null);
// A redemption limit (possibly exhausted) is visible only as `limited`; the browser never treats a threshold
// match as a granted benefit, and checkout-ineligible data never becomes "met".
const limited = ev([rule({ dailyRedemptionLimit: 1 })], ifr(1000)).results[0];
assert.equal(limited.status, "met");
assert.equal(limited.limited, true);
assert.equal(ev([rule()], ifr(1000)).results[0].limited, false);
assert.equal(ev([rule({ active: false })], ifr(10 ** 9)).results[0].status, "checkout");
const widgetSrc = fs.readFileSync(path.join(__dirname, "..", "docs", "widget", "ifr-benefits-widget.js"), "utf8");
assert.ok(!/You qualify/.test(widgetSrc), "widget copy must not promise a benefit");
assert.ok(/Checkout confirms the benefit/.test(widgetSrc), "widget copy must defer the benefit to checkout");
assert.equal(W.evaluateRules(null, { locked: 0n, held: 0n }).results.length, 0);

// Tier ladder.
assert.equal(W.tierFor(ifr(999)), null);
assert.equal(W.tierFor(ifr(1000)).label, "Bronze");
assert.equal(W.tierFor(ifr(5000)).label, "Gold");
assert.equal(W.tierFor(ifr(10 ** 6)).label, "Platinum");
assert.equal(W.formatIFR(ifr(1234) + 500000000n), "1,234.5");

// The published SRI hash on the wiki page matches the file.
const sri = "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(path.join(root, "docs/widget/ifr-benefits-widget.js"))).digest("base64");
assert.ok(read("docs/wiki/integrate-benefits.html").includes(sri), `wiki page must publish ${sri}`);
console.log("[ifr-benefits-widget] PASS", sri);
