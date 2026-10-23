// Shared by the offline generator and the browser so the no-JS list stays identical.
const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function link(url, label) {
  if (typeof url !== "string" || !/^(?:\/wiki\/[a-z0-9-]+\.html(?:#[a-z0-9%-]+)?|https:\/\/github\.com\/NeaBouli\/inferno\/(?:blob|tree)\/main\/[a-zA-Z0-9/_.-]+)$/.test(url)) {
    throw new Error("Invalid vote evidence/archive URL");
  }
  return `<a class="btn btn-secondary" href="${escape(url)}">${escape(label)}</a>`;
}
function list(rows, chamber) {
  if (!Array.isArray(rows) || rows.length > 5) throw new Error("Invalid recent vote rows");
  if (!rows.length) return `<p>${chamber === "forum" ? "No public forum ballot has closed yet" : "No Council ballots published yet"}</p>`;
  return '<ul class="recent-votes-list">\n' + rows.map((row) => {
    if (["id", "title", "result", "date"].some((key) => typeof row[key] !== "string" || !row[key])) {
      throw new Error("Incomplete recent vote row");
    }
    const date = chamber === "council" ? row.date : row.date.replace("T", " ").replace(".000Z", " UTC");
    return `  <li class="phase-card recent-vote" data-vote-id="${escape(row.id)}">\n`
      + `    <p><strong>${escape(row.id)} — ${escape(row.title)}</strong></p>\n`
      + `    <p>${escape(row.result)}</p>\n`
      + `    <p>${chamber === "council" ? "Opened" : "Closed"}: <time datetime="${escape(row.date)}">${escape(date)}</time></p>\n`
      + `    <div class="wiki-actions">${link(row.evidenceUrl, `Evidence for ${row.id}`)}</div>\n  </li>`;
  }).join("\n") + "\n</ul>";
}
function renderRecentVotes(data) {
  return '<section aria-labelledby="recent-council-heading">\n<h3 id="recent-council-heading">Council</h3>\n'
    + list(data.council, "council")
    + `\n<div class="wiki-actions">${link(data.olderCouncilUrl, "All council votes")}</div>\n</section>\n`
    + '<section aria-labelledby="recent-forum-heading">\n<h3 id="recent-forum-heading">Forum</h3>\n'
    + '<p>Forum tallies are advisory; the Council decides. Test ballots are excluded.</p>\n'
    + list(data.forum, "forum")
    + `\n<div class="wiki-actions">${link("/wiki/dao-governance.html#forum-vote-steps", "Forum voting guide")}\n`
    + `${link(data.olderForumUrl, "All Forum tally files (including tests)")}</div>\n</section>`;
}

export { renderRecentVotes };

(function () {
  if (typeof document === "undefined") return;
  const target = document.getElementById("recent-votes-content");
  if (!target) return;
  fetch("../data/recent-votes.json", { cache: "no-store", credentials: "omit" })
    .then((response) => {
      if (!response.ok) throw new Error("Recent votes unavailable");
      return response.json();
    })
    .then((data) => {
      // Render fully before replacing the generated list. Failed loads or bad
      // data keep the static evidence links and counts available.
      target.innerHTML = renderRecentVotes(data);
      target.dataset.state = "updated";
    })
    .catch(() => { target.dataset.state = "fallback"; });
})();
