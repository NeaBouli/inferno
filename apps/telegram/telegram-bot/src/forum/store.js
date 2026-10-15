// Append-only collector receipts. Synchronous index/check/append is atomic within
// the single bot process; it must not be shared by multiple writer processes.
const fs = require('node:fs');
const path = require('node:path');
const { keccak256, toUtf8Bytes, Signature, TypedDataEncoder } = require('ethers');
const { canonicalJson, isBallotId, checksumWallet, voteTypedData } = require('./ballot');

const MAX_RECORDS = 100000;
const MAX_WALLET_VOTES = 20;
const APP_DIR = path.resolve(__dirname, '../..');

function storageError(message = 'Forum vote storage not configured') {
  const err = new Error(message);
  err.code = 'FORUM_STORAGE_UNSAFE';
  return err;
}

function outsideApp(dir) {
  const relative = path.relative(APP_DIR, dir);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function validateDataDir(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)
    || !outsideApp(path.resolve(dataDir))) throw storageError();
  // Resolve existing ancestors too, so a directory alias cannot bypass the guard.
  let ancestor = path.resolve(dataDir);
  const missing = [];
  for (;;) {
    try {
      const resolved = path.join(fs.realpathSync(ancestor), ...missing);
      if (!outsideApp(resolved)) throw storageError();
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      missing.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}

function createVoteStore({ dataDir, clock = () => Math.floor(Date.now() / 1000), logger = console }) {
  const indices = new Map();

  function checkDirectory(create = false) {
    validateDataDir(dataDir);
    if (create) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    let stat;
    try {
      stat = fs.statSync(dataDir);
    } catch (err) {
      if (!create && err.code === 'ENOENT') return;
      throw err;
    }
    if (!stat.isDirectory()) throw new Error('Invalid vote directory');
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      throw storageError();
    }
    if (create) fs.chmodSync(dataDir, 0o700);
  }

  function filename(ballot) {
    if (!isBallotId(ballot?.manifest?.ballotId)) throw new Error('Invalid ballot id');
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw storageError();
    return path.join(dataDir, `${ballot.manifest.ballotId}.jsonl`);
  }

  function open(file, flags) {
    let fd;
    try {
      fd = fs.openSync(file, flags | fs.constants.O_NOFOLLOW, 0o600);
      if (!fs.fstatSync(fd).isFile()) throw storageError();
      return fd;
    } catch (err) {
      if (fd !== undefined) fs.closeSync(fd);
      if (err.code === 'ELOOP') throw storageError();
      throw err;
    }
  }

  function digestFor(ballot, choice, issuedAt) {
    const { domain, types, value } = voteTypedData(ballot, choice, issuedAt);
    return TypedDataEncoder.hash(domain, types, value);
  }

  function add(index, record) {
    let wallets = index.digests.get(record.digest);
    if (!wallets) {
      wallets = new Map();
      index.digests.set(record.digest, wallets);
    }
    const wallet = record.wallet.toLowerCase();
    if (wallets.has(wallet)) throw new Error('Duplicate stored vote');
    wallets.set(wallet, record);
    index.records.push(record);
    index.count += 1;
    index.head = keccak256(toUtf8Bytes(canonicalJson(record)));
    index.walletCounts.set(wallet, (index.walletCounts.get(wallet) || 0) + 1);
  }

  function manifestChanged() {
    const err = new Error('Ballot manifest changed');
    err.code = 'FORUM_MANIFEST_CHANGED';
    return err;
  }

  function indexFor(ballot) {
    const file = filename(ballot);
    checkDirectory();
    const id = ballot.manifest.ballotId;
    let index = indices.get(id);
    if (index) {
      if (index.manifestHash !== ballot.manifestHash) index.error = manifestChanged();
      if (index.error) throw index.error;
      return index;
    }
    index = { manifestHash: ballot.manifestHash, head: ballot.manifestHash, records: [], digests: new Map(),
      count: 0, walletCounts: new Map() };
    indices.set(id, index);
    let fd;
    try {
      try {
        fd = open(file, fs.constants.O_RDWR);
      } catch (err) {
        if (err.code === 'ENOENT') return index;
        throw err;
      }
      const bytes = fs.readFileSync(fd);
      const completeLength = bytes.lastIndexOf(0x0a) + 1;
      const complete = bytes.subarray(0, completeLength);
      const text = complete.toString('utf8');
      if (!Buffer.from(text).equals(complete)) throw new Error('Invalid vote UTF-8');
      const lines = text ? text.slice(0, -1).split('\n') : [];
      if (lines.length > MAX_RECORDS) throw new Error('Invalid vote count');
      for (const line of lines) {
        const record = JSON.parse(line);
        if (!record || record.manifestHash !== ballot.manifestHash) throw manifestChanged();
        if (typeof record.prevHash !== 'string' || record.prevHash.toLowerCase() !== index.head.toLowerCase()) {
          throw new Error(`Invalid vote hash chain at receiptOrder ${index.count + 1}`);
        }
        const integer = (value) => Number.isSafeInteger(value) && value >= 0;
        const sameDigest = index.digests.get(record.digest)?.values().next().value;
        if (record.ballotId !== id || record.chainId !== ballot.manifest.chainId
          || record.receiptOrder !== index.count + 1 || !integer(record.receivedAt)
          || !integer(record.issuedAt) || !ballot.manifest.choices.includes(record.choice)
          || record.issuedAt < ballot.manifest.window.opensAt
          || record.issuedAt >= ballot.manifest.window.closesAt
          || checksumWallet(record.wallet) !== record.wallet
          || Signature.from(record.signature).serialized !== record.signature
          || (sameDigest ? sameDigest.choice !== record.choice || sameDigest.issuedAt !== record.issuedAt
            : record.digest !== digestFor(ballot, record.choice, record.issuedAt))) {
          throw new Error('Invalid vote record');
        }
        add(index, Object.freeze(record));
      }
      // Only the final, unterminated append can be discarded. Validate all complete
      // records first; any other corruption leaves the file untouched and unavailable.
      if (completeLength < bytes.length) {
        fs.ftruncateSync(fd, completeLength);
        fs.fsyncSync(fd);
        logger.warn(`Truncated incomplete forum vote bytes: ${bytes.length - completeLength}`);
      }
      return index;
    } catch (err) {
      index.error = err;
      throw err;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (err) {
          index.error = err;
          throw err;
        }
      }
    }
  }

  function read(ballot, { after = 0, limit = 1000 } = {}) {
    if (!Number.isSafeInteger(after) || after < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid pagination');
    }
    const index = indexFor(ballot);
    const records = index.records.slice(after, after + limit);
    return { records, next: records.at(-1)?.receiptOrder ?? null, head: index.head, count: index.count };
  }

  function append(ballot, { wallet, choice, issuedAt, signature }) {
    const file = filename(ballot);
    const index = indexFor(ballot);
    wallet = checksumWallet(wallet);
    signature = Signature.from(signature).serialized;
    const digest = digestFor(ballot, choice, issuedAt);
    const existing = index.digests.get(digest)?.get(wallet.toLowerCase());
    if (existing) return { record: existing, duplicate: true };
    if (index.count >= MAX_RECORDS) {
      const err = new Error('Ballot record limit reached');
      err.code = 'FORUM_RECORD_LIMIT';
      throw err;
    }
    if ((index.walletCounts.get(wallet.toLowerCase()) || 0) >= MAX_WALLET_VOTES) {
      const err = new Error('Wallet vote limit reached');
      err.code = 'FORUM_WALLET_LIMIT';
      throw err;
    }
    const receivedAt = clock();
    if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) throw new Error('Invalid clock');
    const record = Object.freeze({
      ballotId: ballot.manifest.ballotId, chainId: ballot.manifest.chainId,
      manifestHash: ballot.manifestHash, digest, prevHash: index.head,
      receiptOrder: index.count + 1, receivedAt, wallet, choice, issuedAt, signature,
    });
    checkDirectory(true);
    const fd = open(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT);
    try {
      try {
        fs.fchmodSync(fd, 0o600);
        fs.appendFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      index.error = err;
      throw err;
    }
    add(index, record);
    return { record, duplicate: false };
  }

  return { append, read, check: (ballot) => { indexFor(ballot); } };
}

module.exports = { createVoteStore, MAX_RECORDS, MAX_WALLET_VOTES, validateDataDir };
