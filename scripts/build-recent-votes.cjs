#!/usr/bin/env node
// Offline, deterministic summaries. Council dates are opening dates; Forum dates
// are scheduled closes from the frozen manifests accompanying published tallies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderRecentVotes } = require("../docs/assets/recent-votes.js");

const ROOT = path.resolve(__dirname, "..");
const COUNCIL = "docs/data/council-votes.json";
const RESULTS = "apps/telegram/telegram-bot/forum-results";
const MANIFESTS = "apps/telegram/telegram-bot/forum-ballots";
const DATA = "docs/data/recent-votes.json";
const PAGE = "docs/wiki/governance.html";
const START = "<!-- recent-votes:start -->";
const END = "<!-- recent-votes:end -->";
const REPO = "https://github.com/NeaBouli/inferno";
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Fail closed: only matching mainnet v1 tally/manifest pairs are candidates.
// Even on mainnet, explicitly marked tests/fixtures must never become decisions.
function isRealForumBallot(tally, manifest) {
  const testMarker = /(?:^|[^a-z0-9])(?:sep(?:olia)?|test(?:net)?|synthetic|fixture|mock|demo|devnet|rehearsal)(?:$|[^a-z0-9])/i;
  const marked = (record) => ["test", "isTest", "synthetic", "isSynthetic"].some((key) =>
    record?.[key] !== undefined && record[key] !== false)
    || ["ballotId", "title", "profile", "environment", "network", "kind"].some((key) =>
      typeof record?.[key] === "string" && testMarker.test(record[key]));
  return tally?.schema === "forum-tally-v1" && manifest?.schema === "forum-ballot-v1"
    && tally.chainId === 1 && manifest.chainId === 1
    && /^FB-[A-Z0-9-]{1,32}$/.test(tally.ballotId) && tally.ballotId === tally.ballotId.trim()
    && tally.ballotId === manifest.ballotId
    && ![tally, manifest, manifest.proposal].some(marked);
}

// Date descending, then ID ascending (ASCII, independent of locale/input order).
function newest(rows) {
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, "duplicate ballot IDs");
  return [...rows].sort((a, b) => compareText(b.date, a.date) || compareText(a.id, b.id)).slice(0, 5);
}

function councilDate(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, "Council opening date required");
  assert.equal(new Date(value).toISOString().slice(0, 10), value, "invalid Council date");
  return value;
}

function formatIFR(value) {
  assert.match(value, /^(?:0|[1-9]\d*)$/, "Forum weights must be integer base-unit strings");
  const units = BigInt(value);
  const fraction = (units % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${units / 1000000000n}${fraction ? `.${fraction}` : ""}`;
}

// The separate Council verification job checks every recorded signature. The
// source JSON has no persisted status field: checkVote marks a record without a
// signature as unverified and a successfully checked signature as verified.
// On that prechecked input, mirror tally() without recovering signatures here.
function councilTally(ballot, votes) {
  const counts = Object.fromEntries(Object.keys(ballot.options).map((option) => [option, 0]));
  let abstain = 0;
  let unverified = 0;
  for (const vote of votes) {
    if (vote.signature === undefined) unverified += 1;
    else if (vote.choice === "ABSTAIN") abstain += 1;
    else counts[vote.choice] += 1;
  }
  const passed = Object.entries(counts).find(([option, n]) => n >= ballot.passThreshold && option !== "NO");
  const rejected = counts.NO !== undefined && counts.NO > ballot.eligible.length - ballot.passThreshold;
  return { counts, abstain, unverified, status: passed ? `approved: ${passed[0]}` : rejected ? "rejected" : "open" };
}

function forumRow({ tally, manifest }) {
  const id = tally.ballotId;
  // Consume the published digest as evidence; hashing/signature verification
  // belongs to the Forum tooling, which requires its own installed dependencies.
  assert.match(tally.manifestHash, /^0x[0-9a-fA-F]{64}$/, `${id}: manifest hash required`);
  assert.equal(tally.proposalHash, manifest.proposal.textHash, `${id}: proposal hash mismatch`);
  assert.deepEqual(tally.snapshot, manifest.snapshot, `${id}: snapshot mismatch`);
  assert.ok(typeof manifest.proposal.title === "string" && manifest.proposal.title.trim(), `${id}: title required`);
  assert.ok(Number.isSafeInteger(manifest.window?.opensAt) && manifest.window.opensAt >= 0
    && Number.isSafeInteger(manifest.window.closesAt) && manifest.window.closesAt > manifest.window.opensAt,
    `${id}: valid voting window required`);
  assert.equal(tally.advisory, true, `${id}: Forum outcomes must remain advisory`);
  assert.ok(["passed", "failed"].includes(tally.outcome), `${id}: published outcome required`);
  assert.equal(typeof tally.quorum?.passed, "boolean", `${id}: quorum result required`);
  assert.equal(typeof tally.threshold?.passed, "boolean", `${id}: threshold result required`);
  assert.equal(tally.outcome, tally.quorum.passed && tally.threshold.passed ? "passed" : "failed",
    `${id}: inconsistent published outcome`);
  const counts = ["yes", "no", "abstain"].map((choice) => `${choice.toUpperCase()}: ${formatIFR(tally.totals[choice])} IFR`);
  return {
    id, title: manifest.proposal.title,
    result: `Advisory tally ${tally.outcome} — ${counts.join(" · ")}`,
    date: new Date(manifest.window.closesAt * 1000).toISOString(),
    evidenceUrl: `${REPO}/blob/main/${RESULTS}/${id}.json`,
  };
}

function buildRecentVotes({ council, forum, generatedFrom }) {
  return {
    generatedFrom: [...generatedFrom].sort(compareText),
    council: newest(council.ballots.map((ballot) => {
      const tally = councilTally(ballot, council.votes.filter((vote) => vote.ballot === ballot.id));
      const status = tally.status === "open" ? "Open" : tally.status === "rejected" ? "Rejected"
        : `Approved: ${tally.status.slice("approved: ".length)}`;
      const counts = Object.entries(tally.counts).map(([choice, count]) => `${choice}: ${count}`);
      return {
        id: ballot.id, title: ballot.title,
        result: `${status} — ${counts.join(" · ")} · verified abstentions: ${tally.abstain}`
          + (tally.unverified ? ` · unverified (not counted): ${tally.unverified}` : ""),
        date: councilDate(ballot.openedAt),
        evidenceUrl: `/wiki/council-votes.html#${encodeURIComponent(ballot.id.toLowerCase())}`,
      };
    })),
    // A published final tally is the completion evidence. Never filter by the
    // build clock: identical source files must always produce identical output.
    forum: newest(forum.filter(({ tally, manifest }) => isRealForumBallot(tally, manifest)).map(forumRow)),
    olderCouncilUrl: "/wiki/council-votes.html",
    olderForumUrl: `${REPO}/tree/main/${RESULTS}`,
  };
}

function readSources(root = ROOT) {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const generatedFrom = [COUNCIL];
  const forum = fs.readdirSync(path.join(root, RESULTS)).filter((file) => file.endsWith(".json")).sort(compareText)
    .map((file) => {
      const resultPath = `${RESULTS}/${file}`;
      const manifestPath = `${MANIFESTS}/${file}`;
      generatedFrom.push(resultPath);
      const tally = read(resultPath);
      // A new unpaired real tally is an input error, not an empty public result.
      const manifest = fs.existsSync(path.join(root, manifestPath)) ? read(manifestPath) : undefined;
      if (manifest) generatedFrom.push(manifestPath);
      assert.ok(tally.chainId !== 1 || manifest, `${file}: mainnet tally needs its frozen manifest`);
      assert.equal(file, `${tally.ballotId}.json`, `${file}: tally filename/ID mismatch`);
      return { tally, manifest };
    });
  return { council: read(COUNCIL), forum, generatedFrom };
}

function updatePage(page, data) {
  const start = page.indexOf(START);
  const end = page.indexOf(END);
  assert.ok(start >= 0 && end > start && page.indexOf(START, start + START.length) < 0
    && page.indexOf(END, end + END.length) < 0, "unique recent-votes markers required");
  return page.slice(0, start + START.length) + `\n${renderRecentVotes(data)}\n      ` + page.slice(end);
}

function generatedFiles(root = ROOT) {
  const data = buildRecentVotes(readSources(root));
  return {
    [DATA]: `${JSON.stringify(data, null, 2)}\n`,
    [PAGE]: updatePage(fs.readFileSync(path.join(root, PAGE), "utf8"), data),
  };
}

function checkGenerated(root = ROOT) {
  for (const [file, content] of Object.entries(generatedFiles(root))) {
    assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content,
      `${file} is stale; run npm run build:recent-votes`);
  }
}

module.exports = { buildRecentVotes, readSources, isRealForumBallot, newest, formatIFR, updatePage, generatedFiles, checkGenerated };

if (require.main === module) {
  if (process.argv.includes("--check")) {
    checkGenerated();
    console.log("[recent-votes] PASS - JSON and no-JS HTML match their sources");
  } else {
    for (const [file, content] of Object.entries(generatedFiles())) {
      fs.writeFileSync(path.join(ROOT, file), content);
      console.log(`[recent-votes] rendered ${file}`);
    }
  }
}
