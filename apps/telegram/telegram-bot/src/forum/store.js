// Append-only collector receipts. Synchronous read/check/append is atomic within
// the single bot process; it must not be shared by multiple writer processes.
const fs = require('node:fs');
const path = require('node:path');
const { isBallotId, checksumWallet } = require('./ballot');

const MAX_RECORDS = 100000;

function createVoteStore({ dataDir, clock = () => Math.floor(Date.now() / 1000) }) {
  function filename(ballotId) {
    if (!isBallotId(ballotId)) {
      throw new Error('Invalid ballot id');
    }
    return path.join(dataDir, `${ballotId}.jsonl`);
  }

  function read(ballotId) {
    let text;
    try {
      text = fs.readFileSync(filename(ballotId), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    if (!text) return [];
    // Fail closed on a torn append rather than silently losing a published vote.
    if (!text.endsWith('\n')) throw new Error('Incomplete vote store');
    return text.slice(0, -1).split('\n').map((line, index) => {
      const record = JSON.parse(line);
      if (record.receiptOrder !== index + 1) throw new Error('Invalid receipt order');
      return record;
    });
  }

  function append(ballotId, { wallet, choice, issuedAt, signature }) {
    const file = filename(ballotId);
    const records = read(ballotId);
    const existing = records.find((record) => record.signature.toLowerCase() === signature.toLowerCase());
    if (existing) return { record: existing, duplicate: true };
    if (records.length >= MAX_RECORDS) {
      const err = new Error('Ballot record limit reached');
      err.code = 'FORUM_RECORD_LIMIT';
      throw err;
    }
    const receivedAt = clock();
    if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) throw new Error('Invalid clock');
    const record = {
      receiptOrder: records.length + 1,
      receivedAt,
      wallet: checksumWallet(wallet),
      choice,
      issuedAt,
      signature,
    };
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dataDir, 0o700);
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.appendFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    return { record, duplicate: false };
  }

  return { append, read };
}

module.exports = { createVoteStore, MAX_RECORDS };
