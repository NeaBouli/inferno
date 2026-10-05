#!/usr/bin/env node
// Renders the ballot section of docs/wiki/council-votes.html from docs/data/council-votes.json
// (static HTML, no JavaScript needed). `--check` fails when the page is out of date.
const fs = require("node:fs");
const path = require("node:path");
const { verify, ballotText } = require("./verify-council-votes.cjs");

const root = path.join(__dirname, "..");
const pagePath = path.join(root, "docs", "wiki", "council-votes.html");
const data = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "council-votes.json"), "utf8"));
const START = "<!-- council-votes:start -->";
const END = "<!-- council-votes:end -->";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function badge(status) {
  if (status.startsWith("approved")) return '<span class="phase-badge badge-yellow">Approved</span>';
  if (status === "executed") return '<span class="phase-badge badge-green">Executed</span>';
  if (status === "rejected") return '<span class="phase-badge badge-planned">Rejected</span>';
  return '<span class="phase-badge badge-red">Open</span>';
}

function render() {
  const { tallies, votes: checked } = verify(data);
  const signerAddress = new Map(data.eligibleSigners.map((s) => [s.initials, s.address]));
  const out = [START];
  for (const ballot of data.ballots) {
    const t = tallies[ballot.id];
    const votes = checked.filter((v) => v.ballot === ballot.id);
    const counts = Object.entries(t.counts).map(([o, n]) => `${esc(o)}: ${n}`).join(" · ");
    out.push(`      <div class="phase-card" id="${esc(ballot.id.toLowerCase())}">`);
    out.push(`        <h3>${esc(ballot.id)} — ${esc(ballot.title)} ${badge(t.status)}</h3>`);
    out.push(`        <p>${esc(ballot.question)}</p>`);
    if (ballot.proposal) out.push(`        <p>Proposal: <a href="${esc(ballot.proposal)}">${esc(ballot.proposal.replace("https://ifrunit.tech", ""))}</a></p>`);
    out.push(`        <p><strong>Rule:</strong> ${esc(ballot.rule)} Opened ${esc(ballot.openedAt)}. Deadline: ${esc(data.deadline)}</p>`);
    const unverifiedNote = t.unverified ? ` · unverified (not counted): ${t.unverified}` : "";
    out.push(`        <p><strong>Tally:</strong> ${counts} · abstentions: ${t.abstain}${unverifiedNote} · eligible: ${ballot.eligible.length}</p>`);
    const verified = votes.filter((v) => v.status === "verified");
    const voted = verified.filter((v) => v.choice !== "ABSTAIN").map((v) => `${esc(v.signer)} (${esc(v.choice)})`);
    const abstained = verified.filter((v) => v.choice === "ABSTAIN").map((v) => esc(v.signer));
    const unverified = votes.filter((v) => v.status !== "verified").map((v) => esc(v.signer));
    const missing = ballot.eligible.filter((i) => !votes.some((v) => v.signer === i)).map(esc);
    out.push(`        <p class="vote-summary"><strong>Voted:</strong> ${voted.join(", ") || "nobody yet"} · <strong>Abstained:</strong> ${abstained.join(", ") || "none"}${unverified.length ? ` · <strong>Unverified, not counted:</strong> ${unverified.join(", ")}` : ""} · <strong>Still missing:</strong> ${missing.join(", ") || "none"}</p>`);
    if (ballot.note) out.push(`        <p style="color:var(--muted);font-size:0.85rem;">${esc(ballot.note)}</p>`);
    out.push('        <div class="table-scroll" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">');
    out.push('        <table style="min-width:600px;">');
    out.push("          <thead><tr><th>Signer</th><th>Wallet</th><th>Vote</th><th>Proof</th></tr></thead>");
    out.push("          <tbody>");
    for (const initials of ballot.eligible) {
      const vote = votes.find((v) => v.signer === initials);
      const wallet = `<a href="https://etherscan.io/address/${esc(signerAddress.get(initials))}" rel="noopener"><code>${esc(short(signerAddress.get(initials)))}</code></a>`;
      if (!vote) {
        out.push(`            <tr><td>${esc(initials)}</td><td>${wallet}</td><td>not yet voted</td><td>—</td></tr>`);
        continue;
      }
      if (vote.status !== "verified") {
        out.push(`            <tr class="vote-unverified"><td>${esc(initials)}</td><td>${wallet}</td><td>${esc(vote.choice)} — unverified</td><td>not recorded: no published signature over the ${esc(ballot.id)} ${esc(vote.choice)} text; not counted</td></tr>`);
        continue;
      }
      const proof = `<a href="${esc(vote.etherscan)}" rel="noopener">${esc(vote.etherscan.replace("https://", ""))}</a><div class="sig">signed: ${esc(ballot.id)} ${esc(vote.choice)} text · hash ${esc(vote.messageHash)}</div>`;
      out.push(`            <tr><td>${esc(initials)}</td><td>${wallet}</td><td>${esc(vote.choice)}</td><td>${proof}</td></tr>`);
    }
    out.push("          </tbody>");
    out.push("        </table>");
    out.push("        </div>");
    out.push("        <details>");
    out.push("          <summary>Ballot texts (sign exactly one, unchanged)</summary>");
    const texts = Object.keys(ballot.options).map((option) => [option, ballotText(ballot, option)]);
    if (ballot.abstainText !== undefined) texts.push(["ABSTAIN", ballot.abstainText]);
    for (const [option, text] of texts) {
      out.push(`          <p><strong>${esc(option)}</strong></p>`);
      out.push(`          <pre class="vote-text">${esc(text)}</pre>`);
    }
    out.push("        </details>");
    out.push("      </div>");
  }
  out.push(`      ${END}`);
  return out.join("\n");
}

const page = fs.readFileSync(pagePath, "utf8");
const start = page.indexOf(START);
const end = page.indexOf(END);
if (start < 0 || end < start) throw new Error("council-votes markers missing");
const next = page.slice(0, start) + render() + page.slice(end + END.length);

if (process.argv.includes("--check")) {
  if (next !== page) {
    console.error("[council-votes-page] FAIL - docs/wiki/council-votes.html is out of date; run node scripts/build-council-votes-page.cjs");
    process.exit(1);
  }
  console.log("[council-votes-page] PASS - page matches docs/data/council-votes.json");
} else {
  fs.writeFileSync(pagePath, next);
  console.log("[council-votes-page] rendered docs/wiki/council-votes.html");
}
