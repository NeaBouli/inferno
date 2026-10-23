#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { renderRecentVotes } = require("../docs/assets/recent-votes.js");
const {
  buildRecentVotes, readSources, isRealForumBallot, newest, formatIFR,
  updatePage, generatedFiles, checkGenerated,
} = require("./build-recent-votes.cjs");

const root = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);
const sources = readSources();
const build = (overrides = {}) => buildRecentVotes({ ...clone(sources), ...overrides });

// In-memory mainnet-shaped publication fixtures, never written as real results.
function forumFixture(id = "FB-0001", closesAt = 1792404000) {
  const pair = clone(sources.forum[0]);
  Object.assign(pair.manifest, { ballotId: id, chainId: 1 });
  Object.assign(pair.manifest.proposal, { title: "Community proposal", textFile: `${id}.md` });
  pair.manifest.window = { opensAt: closesAt - 86400, closesAt };
  // The summary consumes an opaque published manifest digest, without hashing
  // or signing these fixtures through the dependency-bearing Forum tooling.
  Object.assign(pair.tally, { ballotId: id, chainId: 1 });
  return pair;
}

test("committed JSON and no-JS HTML are regenerated in memory without writes", () => {
  const before = fs.readFileSync(path.join(root, "docs/data/recent-votes.json"), "utf8");
  checkGenerated();
  const files = generatedFiles();
  assert.equal(files["docs/data/recent-votes.json"], before);
  const data = JSON.parse(before);
  assert.deepEqual(data, build());
  assert.ok(files["docs/wiki/governance.html"].includes(renderRecentVotes(data)));
  assert.equal(before, fs.readFileSync(path.join(root, "docs/data/recent-votes.json"), "utf8"));
});

test("stale JSON and stale fallback HTML each fail the freshness gate", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-recent-votes-"));
  try {
    for (const file of [...sources.generatedFrom, "docs/wiki/governance.html", "docs/data/recent-votes.json"]) {
      fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(temporary, file));
    }
    checkGenerated(temporary);
    const jsonPath = path.join(temporary, "docs/data/recent-votes.json");
    const original = fs.readFileSync(jsonPath, "utf8");
    fs.writeFileSync(jsonPath, "{}\n");
    assert.throws(() => checkGenerated(temporary), /recent-votes.json is stale/);
    assert.equal(fs.readFileSync(jsonPath, "utf8"), "{}\n", "checker must not repair stale output");
    fs.writeFileSync(jsonPath, original);
    const htmlPath = path.join(temporary, "docs/wiki/governance.html");
    fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, "utf8").replace("No public forum ballot has closed yet", "Stale"));
    assert.throws(() => checkGenerated(temporary), /governance.html is stale/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("Council result text uses only the verified tallies, including open votes and uncounted records", () => {
  const data = build();
  assert.equal(data.council.find((row) => row.id === "CV-01").result,
    "Open — YES: 2 · NO: 0 · verified abstentions: 0 · unverified (not counted): 1");
  assert.equal(data.council.find((row) => row.id === "EX-01").result,
    "Approved: YES — YES: 3 · NO: 0 · verified abstentions: 0");
  assert.equal(data.council.find((row) => row.id === "EX-02").result,
    "Open — OPTION A: 0 · OPTION B: 0 · verified abstentions: 3");
});

test("unverified Council records never count toward approval, rejection or verified abstentions", () => {
  for (const choice of ["YES", "NO", "ABSTAIN"]) {
    const council = clone(sources.council);
    council.ballots = council.ballots.filter((ballot) => ballot.id === "EX-01");
    // Three records would decide this ballot if unverified choices were counted.
    council.votes = council.eligibleSigners.slice(0, 3).map(({ initials, address }) => ({
      ballot: "EX-01", signer: initials, address, choice,
    }));
    assert.equal(build({ council }).council[0].result,
      "Open — YES: 0 · NO: 0 · verified abstentions: 0 · unverified (not counted): 3", choice);
  }
  const council = clone(sources.council);
  council.votes.find((vote) => vote.ballot === "CV-01" && vote.signature === undefined).choice = "YES";
  assert.equal(build({ council }).council.find((row) => row.id === "CV-01").result,
    "Open — YES: 2 · NO: 0 · verified abstentions: 0 · unverified (not counted): 1");
});

test("Council summary trusts the separate verification job instead of recovering signatures", () => {
  const council = clone(sources.council);
  for (const vote of council.votes) {
    if (vote.signature !== undefined) vote.signature = "opaque prechecked signature";
  }
  assert.deepEqual(build({ council }), build());
});

test("recent-votes scripts load only repository modules and Node built-ins", () => {
  const seen = new Set();
  const pending = [module];
  while (pending.length) {
    const entry = pending.pop();
    if (seen.has(entry)) continue;
    seen.add(entry);
    const relative = path.relative(root, entry.filename);
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)
      && !relative.split(path.sep).includes("node_modules"), `package dependency loaded: ${entry.filename}`);
    pending.push(...entry.children);
  }
});

test("explicit Forum rule excludes Sepolia, other chains, test IDs/titles/flags and synthetic profiles", () => {
  assert.equal(isRealForumBallot(sources.forum[0].tally, sources.forum[0].manifest), false);
  assert.deepEqual(build().forum, []);
  for (const mutate of [
    (p) => { p.tally.chainId = p.manifest.chainId = 11155111; },
    (p) => { p.tally.chainId = p.manifest.chainId = 31337; },
    (p) => { delete p.tally.chainId; },
    (p) => { p.manifest.chainId = 11155111; },
    (p) => { p.tally.ballotId = p.manifest.ballotId = "FB-SEP-0001"; },
    (p) => { p.tally.ballotId = p.manifest.ballotId = "FB-TEST-0001"; },
    (p) => { p.manifest.proposal.title = "Synthetic community ballot"; },
    (p) => { p.manifest.proposal.title = "Sepolia test ballot"; },
    (p) => { p.manifest.proposal.title = "Mainnet test: collector check"; },
    (p) => { p.tally.profile = "synthetic-only"; },
    (p) => { p.manifest.profile = "fixture-only"; },
    (p) => { p.tally.environment = "testnet"; },
    (p) => { p.tally.isTest = true; },
    (p) => { p.manifest.synthetic = true; },
    (p) => { p.tally.schema = "forum-fixture-v1"; },
    (p) => { p.manifest.ballotId = "FB-OTHER"; },
  ]) {
    const pair = forumFixture();
    mutate(pair);
    assert.equal(isRealForumBallot(pair.tally, pair.manifest), false, JSON.stringify(pair));
    assert.deepEqual(build({ forum: [pair] }).forum, []);
  }
  const real = forumFixture();
  assert.equal(isRealForumBallot(real.tally, real.manifest), true);
  assert.equal(isRealForumBallot(real.tally, undefined), false);
});

test("Forum results preserve published advisory outcomes, manifest dates and exact IFR amounts", () => {
  const pair = forumFixture();
  pair.tally.totals.yes = "9007199254740993";
  const row = build({ forum: [pair] }).forum[0];
  assert.equal(row.date, new Date(pair.manifest.window.closesAt * 1000).toISOString());
  assert.equal(row.title, pair.manifest.proposal.title);
  assert.match(row.evidenceUrl, /forum-results\/FB-0001.json$/);
  assert.equal(row.result, "Advisory tally passed — YES: 9007199.254740993 IFR · NO: 500 IFR · ABSTAIN: 250 IFR");
  pair.tally.outcome = "failed";
  pair.tally.quorum.passed = false;
  assert.match(build({ forum: [pair] }).forum[0].result, /^Advisory tally failed/);
  assert.equal(formatIFR("1"), "0.000000001");
  assert.equal(formatIFR("0"), "0");
  assert.throws(() => formatIFR(9007199254740993), /string/);
  assert.throws(() => formatIFR("0.1"), /integer base-unit/);
});

test("inconsistent Forum evidence or unfinished tally cannot be published", () => {
  for (const mutate of [
    (p) => { p.tally.manifestHash = "0x00"; },
    (p) => { p.tally.proposalHash = "0x00"; },
    (p) => { p.tally.snapshot.height += 1; },
    (p) => { p.tally.outcome = "pending"; },
    (p) => { p.tally.outcome = "failed"; },
    (p) => { p.tally.advisory = false; },
    (p) => { delete p.tally.threshold.passed; },
  ]) {
    const pair = forumFixture();
    mutate(pair);
    assert.throws(() => build({ forum: [pair] }));
  }
});

test("newest five sort by date descending, then ID ascending, for both chambers", () => {
  const rows = [
    { id: "B", date: "2026-10-22" }, { id: "G", date: "2026-10-23" },
    { id: "C", date: "2026-10-20" }, { id: "F", date: "2026-10-23" },
    { id: "D", date: "2026-10-22" }, { id: "A", date: "2026-10-22" },
    { id: "E", date: "2026-10-21" },
  ];
  const original = clone(rows);
  assert.deepEqual(newest(rows).map((row) => row.id), ["F", "G", "A", "B", "D"]);
  assert.deepEqual(newest([...rows].reverse()), newest(rows));
  assert.deepEqual(rows, original, "sorting must not mutate sources");
  assert.throws(() => newest([rows[0], rows[0]]), /duplicate/);

  const council = clone(sources.council);
  council.votes = [];
  council.ballots = rows.map(({ id, date }) => ({
    ...clone(council.ballots[0]), id, title: id, openedAt: date,
    options: { YES: `IFR Council vote ${id}\nVote: YES\nApprove ${id}.` },
  }));
  const forum = rows.map(({ id, date }) => forumFixture(`FB-${id}`, Date.parse(date) / 1000));
  assert.deepEqual(build({ council, forum }).council.map((row) => row.id), ["F", "G", "A", "B", "D"]);
  assert.deepEqual(build({ council, forum }).forum.map((row) => row.id), ["FB-F", "FB-G", "FB-A", "FB-B", "FB-D"]);
  assert.deepEqual(build({ council, forum }), build({ council: { ...council, ballots: council.ballots.reverse() }, forum: forum.reverse() }));
});

test("output is independent of build time and preserves unrelated HTML outside unique markers", () => {
  const before = build();
  const now = Date.now;
  try {
    Date.now = () => 0;
    assert.deepEqual(build(), before);
    Date.now = () => 9999999999999;
    assert.deepEqual(build(), before);
  } finally { Date.now = now; }
  const page = "prefix<!-- recent-votes:start -->stale<!-- recent-votes:end -->suffix";
  const updated = updatePage(page, before);
  assert.ok(updated.startsWith("prefix<!-- recent-votes:start -->"));
  assert.ok(updated.endsWith("<!-- recent-votes:end -->suffix"));
  assert.equal(updatePage(updated, before), updated);
  assert.throws(() => updatePage("missing", before), /markers/);
  assert.throws(() => updatePage(page + page, before), /unique/);
});

test("shared renderer escapes source text and rejects unsafe evidence URLs", () => {
  const data = build();
  data.council[0].title = '<img src=x onerror="bad()"> & title';
  const html = renderRecentVotes(data);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; &amp; title/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /No public forum ballot has closed yet/);
  assert.match(html, /All council votes/);
  assert.match(html, /All Forum tally files \(including tests\)/);
  data.council[0].evidenceUrl = "javascript:alert(1)";
  assert.throws(() => renderRecentVotes(data), /URL/);
});

test("workflow runs the freshness test next to the audit gate and watches inputs on push and PR", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/docs-validator.yml"), "utf8");
  for (const file of ["scripts/build-recent-votes.cjs", "scripts/test-recent-votes.cjs", "docs/data/recent-votes.json",
    "apps/telegram/telegram-bot/forum-results/*.json", "apps/telegram/telegram-bot/forum-ballots/*.json",
    "apps/telegram/telegram-bot/src/forum/ballot.js"]) {
    assert.equal(workflow.split(`- '${file}'`).length - 1, 2, `watch ${file} on push and PR`);
  }
  assert.match(workflow, /run: npm run test:july-audit-register\s+- name: [^\n]+\s+run: npm run test:recent-votes/);
});
