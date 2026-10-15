// Deterministic advisory tally; all snapshot reads are supplied by the caller.
const { keccak256, toUtf8Bytes } = require('ethers');
const { canonicalJson, checksumWallet, verifyVote } = require('./ballot');

async function tallyBallot({ ballot, votes, reader }) {
  if (!Array.isArray(votes)) throw new Error('Votes must be a JSON array');
  // The published store is ordered, append-only and starts at receipt 1.
  for (let index = 0; index < votes.length; index += 1) {
    if (votes[index]?.receiptOrder !== index + 1) {
      throw new Error(`Invalid receiptOrder: expected contiguous receipt ${index + 1}`);
    }
  }

  const { manifest } = ballot;
  // Published records are bound to the manifest they were collected for (collector slice 1b).
  for (const vote of votes) {
    if (vote.manifestHash !== ballot.manifestHash || vote.ballotId !== manifest.ballotId
      || vote.chainId !== manifest.chainId) {
      throw new Error(`Vote ${vote.receiptOrder} belongs to a different ballot manifest`);
    }
  }
  const chainId = await reader.chainId();
  if (BigInt(chainId) !== BigInt(manifest.chainId)) {
    throw new Error(`Chain ID mismatch: expected ${manifest.chainId}, got ${chainId}`);
  }
  const { height, blockHash } = manifest.snapshot;
  const actualHash = await reader.blockHash(height);
  if (typeof actualHash !== 'string' || actualHash.toLowerCase() !== blockHash.toLowerCase()) {
    throw new Error(`Snapshot block hash mismatch at height ${height}`);
  }

  const voteSetHash = keccak256(toUtf8Bytes(canonicalJson(votes)));
  const selected = new Map();
  const rejected = [];
  for (const vote of votes) {
    const verification = verifyVote({
      ballot, wallet: vote.wallet, choice: vote.choice, issuedAt: vote.issuedAt,
      signature: vote.signature, now: vote.receivedAt,
    });
    if (!verification.ok) {
      rejected.push({ receiptOrder: vote.receiptOrder, reason: verification.reason });
      continue;
    }
    const wallet = vote.wallet.toLowerCase();
    const previous = selected.get(wallet);
    if (!previous || vote.issuedAt > previous.issuedAt
      || (vote.issuedAt === previous.issuedAt && vote.receiptOrder > previous.receiptOrder)) {
      selected.set(wallet, vote);
    }
  }

  // Never coerce token weights through Number or accept a lossy reader result.
  function requireWeight(value, source) {
    if (typeof value !== 'bigint' || value < 0n) {
      throw new Error(`Invalid ${source}: expected a non-negative bigint`);
    }
    return value;
  }
  const contract = manifest.weightSource.contract;
  const totalLocked = requireWeight(await reader.totalLocked(contract, height), 'totalLocked');
  const weights = { yes: 0n, no: 0n, abstain: 0n };
  const counted = [];
  const zeroWeight = [];
  // Sort by lowercase address; output addresses use the store's checksum format.
  for (const key of [...selected.keys()].sort()) {
    const vote = selected.get(key);
    const wallet = checksumWallet(key);
    const weight = requireWeight(await reader.lockedBalance(contract, wallet, height), `lockedBalance for ${wallet}`);
    if (weight === 0n) {
      zeroWeight.push(wallet);
      continue;
    }
    weights[vote.choice] += weight;
    counted.push({ wallet, choice: vote.choice, weight: weight.toString(), receiptOrder: vote.receiptOrder });
  }

  const participating = weights.yes + weights.no + weights.abstain;
  const decisive = weights.yes + weights.no;
  const { quorum, threshold } = manifest.policy;
  const quorumPassed = participating * BigInt(quorum.denominator) >= totalLocked * BigInt(quorum.numerator);
  const thresholdPassed = decisive > 0n
    && weights.yes * BigInt(threshold.denominator) > decisive * BigInt(threshold.numerator);
  return {
    schema: 'forum-tally-v1',
    ballotId: manifest.ballotId,
    chainId: manifest.chainId,
    snapshot: { height, blockHash },
    manifestHash: ballot.manifestHash,
    proposalHash: manifest.proposal.textHash,
    voteSetHash,
    totals: {
      yes: weights.yes.toString(), no: weights.no.toString(), abstain: weights.abstain.toString(),
      participating: participating.toString(), totalLocked: totalLocked.toString(),
    },
    quorum: { ...quorum, passed: quorumPassed },
    threshold: { ...threshold, passed: thresholdPassed },
    counted,
    rejected,
    zeroWeight,
    outcome: quorumPassed && thresholdPassed ? 'passed' : 'failed',
    advisory: true,
  };
}

module.exports = { tallyBallot };
