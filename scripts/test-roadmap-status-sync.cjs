#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const roadmap = read("docs/ROADMAP.md");
assert.ok(roadmap.includes("Phase 2: Mainnet Launch (Q1 2026) — DONE"));
assert.ok(roadmap.includes("**Phase 3 execution** — Phase 2 is complete"));
assert.ok(roadmap.includes("Proposal #0 executed for BootstrapVault V1; V1 was later deprecated"));
assert.ok(
  read("docs/MAINNET_CHECKLIST.md").includes(
    "executed 07.03.2026; V1 later deprecated"
  )
);
assert.ok(roadmap.includes("Post-Launch Follow-Ups (do not reopen Phase 2)"));

const wiki = read("docs/wiki/roadmap.html");
for (const marker of [
  "Mainnet launch is complete and canonical Phase 3 ecosystem growth is active",
  "Milestone 4: Mainnet Launch",
  "withdrawal-less BootstrapVaultV3; the external lock/burn path was retired",
  "Post-launch follow-ups below do not reopen the completed launch milestone",
  "independent professional third-party audit remains an open assurance milestone",
]) {
  assert.ok(wiki.includes(marker), `Wiki roadmap must include: ${marker}`);
}
for (const stale of [
  "Phase 4 (Mainnet Launch)",
  "Phase 4 active",
  "Security audit completion is a hard prerequisite for mainnet",
  '<li class="pending-item">LP Token Lock/Burn</li>',
]) {
  assert.ok(!wiki.includes(stale), `Wiki roadmap must not include stale marker: ${stale}`);
}

// T-152: proposed governance/product items must not read as approved or scheduled.
const register = read("docs/GOVERNANCE_PRODUCT_DECISION_REGISTER.md");
for (let lane = 1; lane <= 8; lane += 1) {
  assert.ok(register.includes(`## Lane ${lane} — `), `Decision register must include lane ${lane}`);
}
for (const field of ["**Current truth:**", "**Decision needed:**", "**Production gate:**", "**Next evidence:**"]) {
  assert.equal(register.split(field).length - 1, 8, `Every register lane must include ${field}`);
}
assert.ok(!/0x[0-9a-fA-F]{40}/.test(register), "Decision register must not contain wallet addresses");
for (const relative of ["docs/ROADMAP.md", "docs/wiki/roadmap.html", "docs/wiki/governance.html"]) {
  assert.ok(read(relative).includes("GOVERNANCE_PRODUCT_DECISION_REGISTER.md"), `${relative} must link the decision register`);
}
function assertExchangePolicy(copy, format) {
  const prose = text => text.replace(/<[^>]*>/g, " ").replace(/&mdash;/g, "-").replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  assert.ok(!/\(EX-01\/EX-02\)\s*(?::|-)\s*undated Council discussion drafts, not approved policy/i.test(prose(copy)), `${format}: stale combined exchange claim`);
  const pattern = format === "Markdown"
    ? /^- \[([ x])\] (EX-0[12]\b[^\n]*(?:\n {6}[^\n]+)*)/gm
    : /<li class="(check-item|pending-item)">\s*(EX-0[12]\b[\s\S]*?)<\/li>/g;
  const items = [...copy.matchAll(pattern)].map((match) => ({ state: match[1], text: prose(match[2]) }));
  assert.equal(items.length, 2, `${format}: exactly two separate exchange policy items`);
  const approved = items.find(item => item.text.startsWith("EX-01 "));
  const pending = items.find(item => item.text.startsWith("EX-02 "));
  assert.ok(approved && pending, `${format}: EX-01 and EX-02 must be separate`);
  assert.ok(approved.state === (format === "Markdown" ? "x" : "check-item"), `${format}: EX-01 approved state`);
  assert.ok(pending.state === (format === "Markdown" ? " " : "pending-item"), `${format}: EX-02 open state`);
  for (const marker of ["EX-01 approved on 4 October 2026", "no IFR incentives from any project pool", "policy grants no address, liquidity or governance activation authority"]) {
    assert.ok(approved.text.includes(marker), `${format}: EX-01 must retain ${marker}`);
  }
  for (const marker of ["EX-02 exchange governance role remains open", "no Safe permissions are granted", "Individual address and liquidity actions still require separate governance decisions"]) {
    assert.ok(pending.text.includes(marker), `${format}: EX-02 must retain ${marker}`);
  }
}
let exchangeNegatives = 0;
for (const [format, copy] of [["Markdown", roadmap], ["HTML", wiki]]) {
  assertExchangePolicy(copy, format);
  const stale = format === "Markdown"
    ? "(EX-01/EX-02):\n      undated Council discussion drafts, not approved policy"
    : "(EX-01/EX-02) &mdash; undated Council discussion drafts, not approved policy";
  const wrongApproved = format === "Markdown"
    ? copy.replace("- [x] EX-01", "- [ ] EX-01")
    : copy.replace('<li class="check-item">EX-01', '<li class="pending-item">EX-01');
  const wrongPending = format === "Markdown"
    ? copy.replace("- [ ] EX-02", "- [x] EX-02")
    : copy.replace('<li class="pending-item">EX-02', '<li class="check-item">EX-02');
  for (const [fixture, message] of [
    [`${copy}\n${stale}`, `${format}: stale combined exchange claim`],
    [wrongApproved, `${format}: EX-01 approved state`],
    [wrongPending, `${format}: EX-02 open state`],
    [copy.replace("EX-01 approved on 4 October 2026", "EX-01 proposed policy"), `${format}: EX-01 must retain EX-01 approved on 4 October 2026`],
    [copy.replace("no IFR incentives from any project pool", "IFR incentives from any project pool"), `${format}: EX-01 must retain no IFR incentives from any project pool`],
    [copy.replace(/no Safe permissions are\s+granted/, "Safe permissions are granted"), `${format}: EX-02 must retain no Safe permissions are granted`],
  ]) {
    assert.notEqual(fixture, copy, `${format}: negative fixture must change source`);
    assert.throws(() => assertExchangePolicy(fixture, format), { name: "AssertionError", message });
    exchangeNegatives++;
  }
}
console.log(`[exchange-policy] PASS both surfaces / ${exchangeNegatives} negative fixtures`);
assert.ok(!wiki.includes("Creator Rewards live (automated)"));
const daoWiki = read("docs/wiki/dao-governance.html");
for (const stale of [
  "Three new contracts will be deployed",
  "Sole private key holder for TXs",
  "Only the Executor component holds private keys",
  "1 IFR locked = 1 vote",
  "Voting is completely free.",
]) {
  assert.ok(!daoWiki.includes(stale), `DAO governance page must not include: ${stale}`);
}
for (const relative of ["internal/operations/TODO.md", "internal/operations/TODO.html"]) {
  const todo = read(relative);
  assert.ok(todo.includes("Residual dependency audit findings") && todo.includes("resolved 2026-10-01"), `${relative} residual audit status`);
  assert.ok(!todo.includes("10 transitive low findings"));
}

for (const relative of ["reports/docs-status.md", "reports/docs-watchdog-report.md"]) {
  assert.ok(read(relative).includes("**Historical snapshot:**"));
}

console.log("[roadmap-status-sync] PASS");
