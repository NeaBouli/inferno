#!/usr/bin/env node
// Cast test votes for a Sepolia Forum ballot with the throwaway voter keys from
// sepolia-forum-testenv.js. Testnet only: refuses any ballot whose chainId is not 11155111.
// Usage: node scripts/sepolia-forum-vote.js <ballotId> <choice1,choice2,choice3> [apiBase]
//   e.g. node scripts/sepolia-forum-vote.js FB-SEP-0001 yes,no,abstain
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ethers } = require("ethers");
const { isBallotId, manifestHash, validateManifest, voteTypedData, verifyVote } =
  require("../apps/telegram/telegram-bot/src/forum/ballot");

const KEYS_FILE = path.join(os.homedir(), ".ifr-sepolia-testenv", "keys.json");
const DEFAULT_API = "https://verify-api.ifrunit.tech/api/forum";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function castVotes({ ballotId, choices, apiBase = DEFAULT_API, keys, fetchImpl = fetch,
  now = () => Math.floor(Date.now() / 1000), log = console.log }) {
  if (!isBallotId(ballotId)) throw new Error("Invalid ballot id");
  const response = await fetchImpl(`${apiBase}/ballots/${ballotId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Ballot fetch failed: HTTP ${response.status}`);
  const body = await response.json();
  const manifest = validateManifest(body.manifest);
  if (manifest.chainId !== 11155111) throw new Error(`Refusing chainId ${manifest.chainId}; Sepolia only`);
  // Never sign over a hash the server merely asserts; recompute it from the manifest.
  const hash = manifestHash(manifest);
  if (hash !== body.manifestHash) throw new Error("Server manifestHash does not match the manifest");
  if (ethers.keccak256(ethers.toUtf8Bytes(body.proposalText)) !== manifest.proposal.textHash) {
    throw new Error("Proposal text does not match its hash");
  }
  const ballot = { manifest, manifestHash: hash };
  if (choices.length !== keys.voters.length) throw new Error(`Need ${keys.voters.length} choices`);

  const results = [];
  for (const [index, voter] of keys.voters.entries()) {
    const wallet = new ethers.Wallet(voter.privateKey);
    if (wallet.address !== voter.address) throw new Error("keys.json address mismatch");
    const issuedAt = now();
    const { domain, types, value } = voteTypedData(ballot, choices[index], issuedAt);
    const signature = await wallet.signTypedData(domain, types, value);
    const local = verifyVote({ ballot, wallet: wallet.address, choice: choices[index], issuedAt, signature, now: issuedAt });
    if (!local.ok) throw new Error(`Voter ${index + 1}: ${local.reason}`);
    const posted = await fetchImpl(`${apiBase}/ballots/${ballotId}/votes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: wallet.address, choice: choices[index], issuedAt, signature }),
    });
    const reply = await posted.json().catch(() => ({}));
    if (posted.status !== 201 && posted.status !== 200) {
      throw new Error(`Voter ${index + 1} rejected: HTTP ${posted.status} ${reply.error || ""}`.trim());
    }
    log(`Voter ${index + 1} ${wallet.address}: ${choices[index]} -> receipt ${reply.receiptOrder}`);
    results.push(reply);
  }
  return results;
}

if (require.main === module) {
  const [ballotId, choiceList, apiBase] = process.argv.slice(2);
  if (!ballotId || !choiceList) fail("Usage: node scripts/sepolia-forum-vote.js <ballotId> <c1,c2,c3> [apiBase]");
  let keys;
  try {
    keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  } catch {
    fail(`Cannot read ${KEYS_FILE}; run sepolia-forum-testenv.js prepare/deploy first.`);
  }
  castVotes({ ballotId, choices: choiceList.split(","), apiBase, keys })
    .catch((error) => fail(`Vote failed: ${error.message}`));
}

module.exports = { castVotes };
