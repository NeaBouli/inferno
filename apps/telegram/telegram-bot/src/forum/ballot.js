// Frozen forum-ballot-v1 manifests and offline EIP-712 vote verification.
const fs = require('node:fs');
const path = require('node:path');
const { getAddress, isHexString, keccak256, toUtf8Bytes, verifyTypedData } = require('ethers');

const BALLOT_ID_PATTERN = /^FB-[A-Z0-9-]{1,32}$/;
const CHOICES = ['yes', 'no', 'abstain'];
const POLICY = {
  selection: 'last-valid',
  quorum: { numerator: 10, denominator: 100, basis: 'total-locked-at-snapshot', comparison: 'gte' },
  threshold: { numerator: 50, denominator: 100, basis: 'yes-of-yes-plus-no', comparison: 'gt' },
  abstain: { quorum: 'include', threshold: 'exclude' },
  delegation: 'disabled',
};
const VOTE_TYPES = {
  IFRForumVote: [
    { name: 'manifestHash', type: 'bytes32' },
    { name: 'ballotId', type: 'string' },
    { name: 'proposalHash', type: 'bytes32' },
    { name: 'snapshotHeight', type: 'uint256' },
    { name: 'choice', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
  ],
};

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function manifestHash(manifest) {
  return keccak256(toUtf8Bytes(canonicalJson(manifest)));
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isBallotId(value) {
  // JavaScript's $ anchor also matches before a final newline; IDs cannot have one.
  return typeof value === 'string' && value === value.trim() && BALLOT_ID_PATTERN.test(value);
}

function checksumWallet(wallet) {
  if (typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    throw new Error('Invalid wallet');
  }
  return getAddress(wallet);
}

function validateManifest(manifest) {
  function requireValid(condition, field) {
    if (!condition) throw new Error(`Invalid ballot ${field}`);
  }
  requireValid(exactKeys(manifest, [
    'schema', 'ballotId', 'chainId', 'proposal', 'choices', 'snapshot',
    'weightSource', 'window', 'policy',
  ]), 'keys');
  requireValid(manifest.schema === 'forum-ballot-v1', 'schema');
  requireValid(isBallotId(manifest.ballotId), 'id');
  requireValid(integer(manifest.chainId) && manifest.chainId > 0, 'chainId');
  requireValid(exactKeys(manifest.proposal, ['title', 'textFile', 'textHash']), 'proposal keys');
  requireValid(typeof manifest.proposal.title === 'string' && manifest.proposal.title.trim().length > 0, 'title');
  // A ballot's proposal is its sibling Markdown file, never an arbitrary path.
  requireValid(manifest.proposal.textFile === `${manifest.ballotId}.md`, 'textFile');
  requireValid(isHexString(manifest.proposal.textHash, 32), 'textHash');
  requireValid(Array.isArray(manifest.choices) && canonicalJson(manifest.choices) === canonicalJson(CHOICES), 'choices');
  requireValid(exactKeys(manifest.snapshot, ['height', 'blockHash']), 'snapshot keys');
  requireValid(integer(manifest.snapshot.height), 'snapshot height');
  requireValid(isHexString(manifest.snapshot.blockHash, 32), 'blockHash');
  requireValid(exactKeys(manifest.weightSource, ['contract', 'method']), 'weightSource keys');
  try {
    checksumWallet(manifest.weightSource.contract);
  } catch {
    throw new Error('Invalid ballot weightSource contract');
  }
  requireValid(manifest.weightSource.method === 'lockedBalance(address)', 'weightSource method');
  requireValid(exactKeys(manifest.window, ['opensAt', 'closesAt']), 'window keys');
  requireValid(integer(manifest.window.opensAt) && integer(manifest.window.closesAt)
    && manifest.window.opensAt < manifest.window.closesAt, 'window');
  requireValid(canonicalJson(manifest.policy) === canonicalJson(POLICY), 'policy');
  return manifest;
}

function loadBallot(dir, ballotId) {
  if (!isBallotId(ballotId)) {
    throw new Error('Invalid ballot id');
  }
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, `${ballotId}.json`), 'utf8')));
  if (manifest.ballotId !== ballotId) throw new Error('Ballot id mismatch');
  const bytes = fs.readFileSync(path.join(dir, manifest.proposal.textFile));
  const proposalText = bytes.toString('utf8');
  if (!Buffer.from(proposalText, 'utf8').equals(bytes)) throw new Error('Invalid proposal UTF-8');
  if (keccak256(bytes).toLowerCase() !== manifest.proposal.textHash.toLowerCase()) {
    throw new Error('Proposal text hash mismatch');
  }
  return { manifest, manifestHash: manifestHash(manifest), proposalText };
}

function voteTypedData(ballot, choice, issuedAt) {
  const { manifest } = ballot;
  return {
    domain: { name: 'IFR Forum', version: '1', chainId: manifest.chainId },
    types: VOTE_TYPES,
    value: {
      manifestHash: ballot.manifestHash,
      ballotId: manifest.ballotId,
      proposalHash: manifest.proposal.textHash,
      snapshotHeight: manifest.snapshot.height,
      choice,
      issuedAt,
    },
  };
}

// All times are integer Unix seconds. No clock, provider or environment access here.
function verifyVote({ ballot, wallet, choice, issuedAt, signature, now }) {
  const reject = (reason) => ({ ok: false, reason });
  if (!ballot.manifest.choices.includes(choice)) return reject('Unknown choice');
  if (!integer(now)) return reject('Invalid clock');
  const { opensAt, closesAt } = ballot.manifest.window;
  if (now < opensAt || now >= closesAt) return reject('Ballot not open');
  if (!integer(issuedAt)) return reject('Invalid issuedAt');
  if (issuedAt < opensAt || issuedAt >= closesAt) return reject('issuedAt outside window');
  if (issuedAt > now + 300) return reject('issuedAt too far in future');
  let expected;
  try {
    expected = checksumWallet(wallet);
  } catch {
    return reject('Invalid wallet');
  }
  if (typeof signature !== 'string' || !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)) {
    return reject('Invalid signature');
  }
  try {
    const { domain, types, value } = voteTypedData(ballot, choice, issuedAt);
    const signer = getAddress(verifyTypedData(domain, types, value, signature));
    if (signer.toLowerCase() !== expected.toLowerCase()) return reject('Signer mismatch');
  } catch {
    return reject('Invalid signature');
  }
  return { ok: true, reason: null };
}

module.exports = {
  isBallotId, canonicalJson, manifestHash, checksumWallet,
  validateManifest, loadBallot, voteTypedData, verifyVote,
};
