// Advisory forum notices only. One bot process owns the private event journal.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isHexString } = require('ethers');
const { isBallotId, loadBallot } = require('./ballot');
const { createVoteStore, validateDataDir } = require('./store');
const topicRouter = require('../services/topicRouter');
const defaultLogger = require('../services/logger');

const POLL_MS = 60000;

function formatIfr(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('Invalid result weight');
  }
  const units = BigInt(value);
  return `${units / 1000000000n}.${(units % 1000000000n).toString().padStart(9, '0')}`;
}

function createForumAnnouncer({
  telegram,
  env = process.env,
  ballotsDir = path.resolve(__dirname, '../../forum-ballots'),
  resultsDir = path.resolve(__dirname, '../../forum-results'),
  dataDir = env.FORUM_DATA_DIR,
  clock = () => Math.floor(Date.now() / 1000),
  timer = { setInterval, clearInterval },
  logger = defaultLogger,
} = {}) {
  const enabled = env.FORUM_ENABLED === '1';
  const allowedChains = new Set((env.FORUM_ALLOWED_CHAIN_IDS ?? '11155111')
    .split(',').map((id) => id.trim()).filter((id) => /^[1-9][0-9]*$/.test(id)));
  const checkpointSeconds = Number(env.FORUM_CHECKPOINT_HOURS ?? '6') * 3600;
  let journal;
  let interval;
  let running;

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
    if (!stat.isDirectory() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error('Unsafe announcement directory');
    }
    if (create) fs.chmodSync(dataDir, 0o700);
  }

  function loadJournal() {
    checkDirectory();
    const file = path.join(dataDir, 'announcements.json');
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        throw new Error('Unsafe announcement journal');
      }
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (value?.schema !== 'forum-announcements-v1' || !value.events
        || typeof value.events !== 'object' || Array.isArray(value.events)
        || Object.values(value.events).some((status) => status !== 'pending' && status !== 'sent')) {
        throw new Error('Invalid announcement journal');
      }
      return value;
    } catch (err) {
      if (err.code === 'ENOENT') return { schema: 'forum-announcements-v1', events: {} };
      throw err;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  function saveJournal(value) {
    checkDirectory(true);
    const file = path.join(dataDir, 'announcements.json');
    const temporary = path.join(dataDir, `.announcements-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
      fd = fs.openSync(dataDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  async function announce(ballot, event, text) {
    const key = `${ballot.manifest.ballotId}:${ballot.manifestHash}:${event}`;
    if (Object.hasOwn(journal.events, key)) return;
    // Reserve durably before sending: ambiguous delivery or a crash must never
    // cause an automatic repeat. Pending events require manual reconciliation.
    journal = { ...journal, events: { ...journal.events, [key]: 'pending' } };
    saveJournal(journal);
    await topicRouter.sendToGroup(telegram, env.TELEGRAM_GROUP_ID, 'vote', text);
    const sent = { ...journal, events: { ...journal.events, [key]: 'sent' } };
    saveJournal(sent);
    journal = sent;
  }

  function resultText(ballot, head, label) {
    let result;
    try {
      result = JSON.parse(fs.readFileSync(path.join(resultsDir, `${ballot.manifest.ballotId}.json`), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    const sameHash = (left, right) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
    if (result?.schema !== 'forum-tally-v1' || result.ballotId !== ballot.manifest.ballotId
      || result.chainId !== ballot.manifest.chainId
      || !sameHash(result.manifestHash, ballot.manifestHash) || !sameHash(result.chainHead, head)) {
      logger.warn({ ballotId: ballot.manifest.ballotId }, 'Forum result does not match the collected ballot');
      return null;
    }
    if (!['passed', 'failed'].includes(result.outcome) || result.advisory !== true
      || typeof result.quorum?.passed !== 'boolean' || typeof result.threshold?.passed !== 'boolean'
      || result.outcome !== (result.quorum.passed && result.threshold.passed ? 'passed' : 'failed')
      || typeof result.voteSetHash !== 'string' || !isHexString(result.voteSetHash.toLowerCase(), 32)) {
      throw new Error('Invalid forum result');
    }
    return `Forum ballot result\n${label}\nOutcome: ${result.outcome}\n`
      + `Yes: ${formatIfr(result.totals?.yes)} IFR\nNo: ${formatIfr(result.totals?.no)} IFR\n`
      + `Abstain: ${formatIfr(result.totals?.abstain)} IFR\n`
      + `Quorum passed: ${result.quorum.passed}\nThreshold passed: ${result.threshold.passed}\n`
      + `voteSetHash: ${result.voteSetHash}\nadvisory`;
  }

  async function check() {
    if (!Number.isSafeInteger(checkpointSeconds) || checkpointSeconds <= 0) {
      throw new Error('Invalid FORUM_CHECKPOINT_HOURS');
    }
    if (!env.TELEGRAM_GROUP_ID) throw new Error('Missing TELEGRAM_GROUP_ID');
    journal = loadJournal();
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock');
    let files;
    try {
      files = fs.readdirSync(ballotsDir).sort();
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    // A fresh index on every poll observes receipts appended by the API store.
    const store = createVoteStore({ dataDir, clock, logger });
    for (const file of files) {
      if (!file.endsWith('.json') || !isBallotId(file.slice(0, -5))) continue;
      const id = file.slice(0, -5);
      try {
        const ballot = loadBallot(ballotsDir, id);
        const { manifest } = ballot;
        if (!allowedChains.has(String(manifest.chainId))) continue;
        const { opensAt, closesAt } = manifest.window;
        if (now < opensAt) continue;
        const { count, head } = store.read(ballot, { limit: 1 });
        const title = Array.from(manifest.proposal.title.replace(/[\r\n\u2028\u2029]/g, ' ')).slice(0, 120).join('');
        const label = `${title}\nBallot: ${id}`;
        if (now < closesAt) {
          const closeTime = new Date(closesAt * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
          await announce(ballot, 'open', `Forum ballot open\n${label}\n`
            + `https://ifrunit.tech/wiki/forum-ballot.html?ballot=${id}\n`
            + `Proposal hash: ${manifest.proposal.textHash}\nSnapshot height: ${manifest.snapshot.height}\n`
            + `Closes: ${closeTime}\nadvisory; the Council decides`);
          const checkpoint = Math.floor((now - opensAt) / checkpointSeconds);
          if (checkpoint > 0) {
            await announce(ballot, `checkpoint:${opensAt + checkpoint * checkpointSeconds}`,
              `Forum ballot checkpoint\n${label}\nCount: ${count}\nChain head: ${head}`);
          }
        } else {
          await announce(ballot, 'close', `Forum ballot closed\n${label}\nFinal count: ${count}\n`
            + `Final chain head: ${head}\ntally follows`);
          const text = resultText(ballot, head, label);
          if (text) await announce(ballot, 'result', text);
        }
      } catch {
        // Do not log transport errors: they can contain bot-token request URLs.
        logger.error({ ballotId: id }, 'Forum announcement failed; check the local journal and ballot');
      }
    }
  }

  function poll() {
    if (!enabled) return Promise.resolve();
    if (!running) {
      running = check().catch(() => {
        logger.error('Forum announcer poll failed; no automatic delivery retries');
      }).finally(() => { running = undefined; });
    }
    return running;
  }

  function start() {
    if (!enabled || interval !== undefined) return;
    interval = timer.setInterval(poll, POLL_MS);
    interval?.unref?.();
    return poll();
  }

  function stop() {
    if (interval !== undefined) timer.clearInterval(interval);
    interval = undefined;
  }

  return { poll, start, stop };
}

function startForumAnnouncer(bot, options = {}) {
  const announcer = createForumAnnouncer({ ...options, telegram: bot.telegram });
  announcer.start();
  return announcer;
}

module.exports = { createForumAnnouncer, startForumAnnouncer };
