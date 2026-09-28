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
for (let lane = 1; lane <= 7; lane += 1) {
  assert.ok(register.includes(`## Lane ${lane} — `), `Decision register must include lane ${lane}`);
}
for (const field of ["**Current truth:**", "**Decision needed:**", "**Production gate:**", "**Next evidence:**"]) {
  assert.equal(register.split(field).length - 1, 7, `Every register lane must include ${field}`);
}
assert.ok(!/0x[0-9a-fA-F]{40}/.test(register), "Decision register must not contain wallet addresses");
for (const relative of ["docs/ROADMAP.md", "docs/wiki/roadmap.html", "docs/wiki/governance.html"]) {
  assert.ok(read(relative).includes("GOVERNANCE_PRODUCT_DECISION_REGISTER.md"), `${relative} must link the decision register`);
}
assert.ok(roadmap.includes("(EX-01/EX-02):\n      undated Council discussion drafts, not approved policy"));
assert.ok(wiki.includes("(EX-01/EX-02) &mdash; undated Council discussion drafts, not approved policy"));
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
  assert.ok(todo.includes("8 transitive low findings"));
  assert.ok(!todo.includes("10 transitive low findings"));
}

for (const relative of ["reports/docs-status.md", "reports/docs-watchdog-report.md"]) {
  assert.ok(read(relative).includes("**Historical snapshot:**"));
}

console.log("[roadmap-status-sync] PASS");
