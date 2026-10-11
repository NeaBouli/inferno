"use strict";

// Disabled pure fixture API: no chain truth, ballot intake, or execution authority.
const UINT256_MAX = (1n << 256n) - 1n;

function markers() {
  return {
    profile: "synthetic-only", authority: "ADVISORY",
    productionReady: false, chainEvidenceVerified: false,
  };
}

function requireValid(condition) {
  if (!condition) throw new Error("FIXTURE_REJECTED");
}

// Copy inert data without invoking getters; reject aliases as well as cycles.
function inertCopy(value) {
  const seen = new WeakSet();
  let nodes = 0;
  let characters = 0;
  function copy(item, depth) {
    requireValid(++nodes <= 24000 && depth <= 12);
    if (typeof item === "string") {
      characters += item.length;
      requireValid(item.length <= 65536 && characters <= 4000000);
      return item;
    }
    if (typeof item === "boolean") return item;
    requireValid(item !== null && typeof item === "object" && !seen.has(item));
    seen.add(item);
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    requireValid(array ? prototype === Array.prototype
      : prototype === Object.prototype || prototype === null);
    const keys = Reflect.ownKeys(item);
    requireValid(keys.every((key) => typeof key === "string" && key.length <= 64));
    if (array) {
      const length = Object.getOwnPropertyDescriptor(item, "length").value;
      requireValid(length <= 512 && keys.length === length + 1);
      const result = [];
      for (let i = 0; i < length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        requireValid(descriptor && "value" in descriptor && descriptor.enumerable);
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    requireValid(keys.length <= 32);
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      requireValid("value" in descriptor && descriptor.enumerable);
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  return copy(value, 0);
}

function record(value, fields) {
  requireValid(value && typeof value === "object" && !Array.isArray(value));
  const keys = Object.keys(value);
  requireValid(keys.length === fields.length && fields.every((key) => keys.includes(key)));
  return value;
}

function list(value, minimum, maximum) {
  requireValid(Array.isArray(value) && value.length >= minimum && value.length <= maximum);
  return value;
}

function oneOf(value, choices) {
  requireValid(choices.includes(value));
  return value;
}

function uint(value) {
  requireValid(typeof value === "string" && value.length <= 78
    && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= UINT256_MAX);
  return value;
}

function id(value) {
  requireValid(typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value));
  return value;
}

function text(value, limit, multiline = false) {
  requireValid(typeof value === "string" && value.length > 0 && value.length <= limit
    && (multiline ? /^[\x20-\x7e\n]+$/ : /^[\x20-\x7e]+$/).test(value));
  return value;
}

function hash(value) {
  requireValid(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value));
  return value;
}

function address(value, ethers) {
  requireValid(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value));
  const result = ethers.getAddress(value).toLowerCase();
  requireValid(result !== "0x0000000000000000000000000000000000000000");
  return result;
}

function signature(value) {
  requireValid(typeof value === "string" && value.length <= 8194
    && /^0x(?:[0-9a-f]{2})+$/.test(value));
  return value;
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function compareUint(a, b) { return compareText(BigInt(a), BigInt(b)); }

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshot(value) {
  record(value, ["chainId", "height", "blockHash"]);
  const result = { chainId: uint(value.chainId), height: uint(value.height), blockHash: hash(value.blockHash) };
  requireValid(BigInt(result.chainId) > 0n);
  return result;
}

function domain(value, ethers) {
  record(value, ["name", "version", "chainId", "verifyingContract", "salt"]);
  return {
    name: oneOf(value.name, ["IFR Forum Synthetic Fixture"]),
    version: oneOf(value.version, ["1"]), chainId: uint(value.chainId),
    verifyingContract: address(value.verifyingContract, ethers), salt: hash(value.salt),
  };
}

function proposal(value) {
  record(value, ["id", "version", "title", "text"]);
  return { id: id(value.id), version: id(value.version), title: text(value.title, 256), text: text(value.text, 32768, true) };
}

function fraction(value, quorum) {
  record(value, quorum ? ["basis", "weight", "numerator", "denominator", "comparison"]
    : ["basis", "numerator", "denominator", "comparison"]);
  const result = {
    basis: oneOf(value.basis, quorum ? ["eligible-weight", "explicit-weight"] : ["cast-weight"]),
    numerator: uint(value.numerator), denominator: uint(value.denominator),
    comparison: oneOf(value.comparison, ["gt", "gte"]),
  };
  requireValid(BigInt(result.denominator) > 0n && BigInt(result.numerator) <= BigInt(result.denominator));
  if (quorum) {
    result.weight = uint(value.weight);
    requireValid(BigInt(result.weight) > 0n);
  }
  return result;
}

function policy(value) {
  record(value, ["selection", "order", "start", "cutoff", "delegation", "tie", "quorum", "threshold", "abstain"]);
  record(value.abstain, ["choice", "quorum", "threshold"]);
  const result = {
    selection: oneOf(value.selection, ["first-only", "last-valid"]),
    order: oneOf(value.order, ["contiguous-receipt-v1"]),
    start: uint(value.start), cutoff: uint(value.cutoff),
    delegation: oneOf(value.delegation, ["disabled"]), tie: oneOf(value.tie, ["no-winner"]),
    quorum: fraction(value.quorum, true), threshold: fraction(value.threshold, false),
    abstain: { choice: id(value.abstain.choice),
      quorum: oneOf(value.abstain.quorum, ["include", "exclude"]),
      threshold: oneOf(value.abstain.threshold, ["include", "exclude"]) },
  };
  requireValid(BigInt(result.cutoff) >= BigInt(result.start)
    && BigInt(result.cutoff) - BigInt(result.start) <= 256n);
  return result;
}

function unique(values) { requireValid(new Set(values).size === values.length); }

function manifest(value, ethers) {
  record(value, ["schema", "domain", "ballotId", "proposal", "choices", "snapshot", "approvedContracts", "voters", "lockEvidenceHash", "policy"]);
  const result = {
    schema: oneOf(value.schema, ["forum-fixture-v1"]), domain: domain(value.domain, ethers),
    ballotId: id(value.ballotId), proposal: proposal(value.proposal),
    choices: list(value.choices, 2, 16).map((choice) => {
      record(choice, ["id", "label"]);
      return { id: id(choice.id), label: text(choice.label, 256) };
    }).sort((a, b) => compareText(a.id, b.id)),
    snapshot: snapshot(value.snapshot),
    approvedContracts: list(value.approvedContracts, 1, 32).map((item) => address(item, ethers)).sort(),
    voters: list(value.voters, 1, 128).map((voter) => {
      record(voter, ["wallet", "kind"]);
      return { wallet: address(voter.wallet, ethers), kind: oneOf(voter.kind, ["EOA", "EIP1271"]) };
    }).sort((a, b) => compareText(a.wallet, b.wallet)),
    lockEvidenceHash: hash(value.lockEvidenceHash), policy: policy(value.policy),
  };
  unique(result.choices.map((choice) => choice.id));
  unique(result.approvedContracts);
  unique(result.voters.map((voter) => voter.wallet));
  requireValid(result.domain.chainId === result.snapshot.chainId
    && result.choices.some((choice) => choice.id === result.policy.abstain.choice));
  return result;
}

function evidence(value, ethers) {
  record(value, ["profile", "manifestHash", "snapshot", "locks", "receipts", "cutoff", "contractAttestations"]);
  record(value.cutoff, ["kind", "complete", "start", "end", "count"]);
  return {
    profile: oneOf(value.profile, ["synthetic-only"]), manifestHash: hash(value.manifestHash),
    snapshot: snapshot(value.snapshot),
    locks: list(value.locks, 1, 512).map((lock) => {
      record(lock, ["claimId", "contract", "owner", "weight"]);
      const result = { claimId: hash(lock.claimId), contract: address(lock.contract, ethers),
        owner: address(lock.owner, ethers), weight: uint(lock.weight) };
      requireValid(BigInt(result.weight) > 0n);
      return result;
    }).sort((a, b) => compareText(a.claimId, b.claimId)),
    receipts: list(value.receipts, 0, 256).map((receipt) => {
      record(receipt, ["order", "messageId", "digest"]);
      return { order: uint(receipt.order), messageId: hash(receipt.messageId), digest: hash(receipt.digest) };
    }).sort((a, b) => compareUint(a.order, b.order)),
    cutoff: {
      kind: oneOf(value.cutoff.kind, ["synthetic-complete-order-attestation-v1"]),
      complete: oneOf(value.cutoff.complete, [true]), start: uint(value.cutoff.start),
      end: uint(value.cutoff.end), count: uint(value.cutoff.count),
    },
    contractAttestations: list(value.contractAttestations, 0, 256).map((attestation) => {
      record(attestation, ["kind", "wallet", "chainId", "height", "blockHash", "digest", "signatureHash", "magicValue"]);
      return {
        kind: oneOf(attestation.kind, ["synthetic-eip1271-attestation-v1"]),
        wallet: address(attestation.wallet, ethers), chainId: uint(attestation.chainId),
        height: uint(attestation.height), blockHash: hash(attestation.blockHash),
        digest: hash(attestation.digest), signatureHash: hash(attestation.signatureHash),
        magicValue: oneOf(attestation.magicValue, ["0x1626ba7e"]),
      };
    }).sort((a, b) => compareText(a.digest, b.digest)),
  };
}

function vote(value, ethers) {
  record(value, ["domain", "manifestHash", "ballotId", "proposalHash", "chainId", "snapshotHeight", "snapshotHash", "wallet", "kind", "choice", "messageId", "nonce", "order", "signature"]);
  return {
    domain: domain(value.domain, ethers), manifestHash: hash(value.manifestHash),
    ballotId: id(value.ballotId), proposalHash: hash(value.proposalHash),
    chainId: uint(value.chainId), snapshotHeight: uint(value.snapshotHeight),
    snapshotHash: hash(value.snapshotHash), wallet: address(value.wallet, ethers),
    kind: oneOf(value.kind, ["EOA", "EIP1271"]), choice: id(value.choice),
    messageId: hash(value.messageId), nonce: uint(value.nonce), order: uint(value.order),
    signature: signature(value.signature),
  };
}

function types() {
  return { SyntheticForumVote: [
    { name: "manifestHash", type: "bytes32" }, { name: "ballotId", type: "string" },
    { name: "proposalHash", type: "bytes32" }, { name: "chainId", type: "uint256" },
    { name: "snapshotHeight", type: "uint256" }, { name: "snapshotHash", type: "bytes32" },
    { name: "wallet", type: "address" }, { name: "kind", type: "string" },
    { name: "choice", type: "string" }, { name: "messageId", type: "bytes32" },
    { name: "nonce", type: "uint256" }, { name: "order", type: "uint256" },
  ] };
}

function meets(actual, basis, rule) {
  if (basis === 0n) return false;
  const left = actual * BigInt(rule.denominator);
  const right = basis * BigInt(rule.numerator);
  return rule.comparison === "gte" ? left >= right : left > right;
}

function verifyFixture(fixture, trustedEvidence) {
  try {
    const copied = inertCopy({ fixture, trustedEvidence });
    record(copied.fixture, ["profile", "manifest", "votes"]);
    oneOf(copied.fixture.profile, ["synthetic-only"]);
    const ethers = require("ethers");
    requireValid(ethers.version === "6.17.0");
    const hashJSON = (value) => ethers.keccak256(ethers.toUtf8Bytes(canonical(value)));
    const m = manifest(copied.fixture.manifest, ethers);
    const e = evidence(copied.trustedEvidence, ethers);
    const votes = list(copied.fixture.votes, 0, 256).map((item) => vote(item, ethers))
      .sort((a, b) => compareUint(a.order, b.order));
    const manifestHash = hashJSON(m);
    const proposalHash = hashJSON(m.proposal);
    requireValid(e.manifestHash === manifestHash && canonical(e.snapshot) === canonical(m.snapshot));
    requireValid(m.lockEvidenceHash === hashJSON({ profile: "synthetic-only", snapshot: e.snapshot, locks: e.locks }));
    unique(e.locks.map((lock) => lock.claimId));
    unique(e.receipts.map((receipt) => receipt.order));
    unique(e.receipts.map((receipt) => receipt.messageId));
    unique(e.receipts.map((receipt) => receipt.digest));
    unique(e.contractAttestations.map((attestation) => attestation.digest));
    unique(votes.map((item) => item.order));
    unique(votes.map((item) => item.messageId));

    const registry = new Map(m.voters.map((voter) => [voter.wallet, voter.kind]));
    const weights = new Map(m.voters.map((voter) => [voter.wallet, 0n]));
    let eligibleWeight = 0n;
    for (const lock of e.locks) {
      requireValid(m.approvedContracts.includes(lock.contract) && registry.has(lock.owner));
      const weight = BigInt(lock.weight);
      weights.set(lock.owner, weights.get(lock.owner) + weight);
      eligibleWeight += weight;
    }
    const p = m.policy;
    if (p.quorum.basis === "eligible-weight") requireValid(BigInt(p.quorum.weight) === eligibleWeight);
    const count = BigInt(votes.length);
    requireValid(BigInt(p.cutoff) - BigInt(p.start) === count && e.receipts.length === votes.length
      && e.cutoff.start === p.start && e.cutoff.end === p.cutoff && BigInt(e.cutoff.count) === count);

    const attestations = new Map(e.contractAttestations.map((item) => [item.digest, item]));
    const usedAttestations = new Set();
    const digests = new Set();
    const nonces = new Map();
    const selected = new Map();
    for (let i = 0; i < votes.length; i += 1) {
      const v = votes[i];
      requireValid(v.order === (BigInt(p.start) + BigInt(i)).toString()
        && canonical(v.domain) === canonical(m.domain) && v.manifestHash === manifestHash
        && v.ballotId === m.ballotId && v.proposalHash === proposalHash
        && v.chainId === m.snapshot.chainId && v.snapshotHeight === m.snapshot.height
        && v.snapshotHash === m.snapshot.blockHash && registry.get(v.wallet) === v.kind
        && weights.get(v.wallet) > 0n && m.choices.some((choice) => choice.id === v.choice));
      const expectedNonce = nonces.has(v.wallet) ? nonces.get(v.wallet) : 0n;
      requireValid(BigInt(v.nonce) === expectedNonce);
      nonces.set(v.wallet, expectedNonce + 1n);
      const { domain: voteDomain, signature: voteSignature, ...payload } = v;
      const digest = ethers.TypedDataEncoder.hash(voteDomain, types(), payload);
      requireValid(!digests.has(digest));
      digests.add(digest);
      const receipt = e.receipts[i];
      requireValid(receipt.order === v.order && receipt.messageId === v.messageId && receipt.digest === digest);
      let signatureEvidence;
      if (v.kind === "EOA") {
        requireValid(ethers.verifyTypedData(voteDomain, types(), payload, voteSignature).toLowerCase() === v.wallet);
        signatureEvidence = "synthetic-eoa-recovery";
      } else {
        const attestation = attestations.get(digest);
        requireValid(attestation && attestation.wallet === v.wallet
          && attestation.chainId === m.snapshot.chainId && attestation.height === m.snapshot.height
          && attestation.blockHash === m.snapshot.blockHash
          && attestation.signatureHash === ethers.keccak256(voteSignature));
        usedAttestations.add(digest);
        signatureEvidence = "synthetic-eip1271-attestation-only";
      }
      if (p.selection === "last-valid" || !selected.has(v.wallet)) {
        selected.set(v.wallet, { wallet: v.wallet, kind: v.kind, choice: v.choice,
          messageId: v.messageId, nonce: v.nonce, order: v.order, digest,
          signature: voteSignature, weight: weights.get(v.wallet).toString(), signatureEvidence });
      }
    }
    requireValid(usedAttestations.size === attestations.size);
    const finalVotes = [...selected.values()].sort((a, b) => compareText(a.wallet, b.wallet));
    const totals = new Map(m.choices.map((choice) => [choice.id, 0n]));
    let castWeight = 0n;
    for (const selectedVote of finalVotes) {
      const weight = BigInt(selectedVote.weight);
      totals.set(selectedVote.choice, totals.get(selectedVote.choice) + weight);
      castWeight += weight;
    }
    const abstainWeight = totals.get(p.abstain.choice);
    const quorumWeight = castWeight - (p.abstain.quorum === "exclude" ? abstainWeight : 0n);
    const thresholdWeight = castWeight - (p.abstain.threshold === "exclude" ? abstainWeight : 0n);
    const quorumMet = meets(quorumWeight, BigInt(p.quorum.weight), p.quorum);
    const candidates = m.choices.filter((choice) => choice.id !== p.abstain.choice);
    let maximum = 0n;
    for (const choice of candidates) if (totals.get(choice.id) > maximum) maximum = totals.get(choice.id);
    const leaders = candidates.filter((choice) => totals.get(choice.id) === maximum);
    const thresholdMet = maximum > 0n && meets(maximum, thresholdWeight, p.threshold);
    return {
      ...markers(), status: "verified-synthetic-fixture", manifestHash, proposalHash,
      evidenceHash: hashJSON(e), trust: "injected-synthetic-assertions-only",
      finalVotes, locks: e.locks,
      tallies: m.choices.map((choice) => ({ choice: choice.id, weight: totals.get(choice.id).toString() })),
      eligibleWeight: eligibleWeight.toString(), castWeight: castWeight.toString(),
      abstainWeight: abstainWeight.toString(), quorumWeight: quorumWeight.toString(),
      quorumBasisWeight: p.quorum.weight, thresholdBasisWeight: thresholdWeight.toString(),
      quorumMet, thresholdMet,
      fixtureWinner: quorumMet && thresholdMet && leaders.length === 1 ? leaders[0].id : null,
    };
  } catch {
    return { ...markers(), status: "rejected", error: "FIXTURE_REJECTED" };
  }
}

module.exports = { verifyFixture };

if (require.main === module) {
  process.stdout.write(`${JSON.stringify({ ...markers(), status: "refused", error: "OFFLINE_API_ONLY" })}\n`);
  process.exitCode = 1;
}
