const express = require('express');
const path = require('node:path');
const { checksumWallet, loadBallot, verifyVote } = require('./ballot');
const { createVoteStore, validateDataDir } = require('./store');

const MAX_RATE_LIMIT_KEYS = 50000;

// Fixed windows, req.ip and Retry-After follow middleware/apiRateLimit.js.
// The injected clock uses integer Unix seconds throughout the collector.
function rateLimit({ clock, max, key, reason }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = clock();
    const id = key(req);
    let entry = hits.get(id);
    if (!entry || now >= entry.resetAt) {
      if (!entry && hits.size >= MAX_RATE_LIMIT_KEYS) {
        for (const [storedId, stored] of hits) {
          if (now >= stored.resetAt) hits.delete(storedId);
        }
        if (hits.size >= MAX_RATE_LIMIT_KEYS) {
          res.set('Retry-After', '60');
          return res.status(429).json({ error: reason });
        }
      }
      entry = { count: 0, resetAt: now + 60 };
      hits.set(id, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(entry.resetAt - now));
      return res.status(429).json({ error: reason });
    }
    return next();
  };
}

function createForumRouter({
  env = process.env,
  ballotsDir = path.resolve(__dirname, '../../forum-ballots'),
  dataDir = env.FORUM_DATA_DIR,
  clock = () => Math.floor(Date.now() / 1000),
} = {}) {
  const router = express.Router();
  if (env.FORUM_ENABLED !== '1') return router;
  // Votes must survive releases: without an explicit volume path the collector refuses to run
  // instead of writing into the image filesystem.
  try {
    validateDataDir(dataDir);
  } catch {
    router.use((req, res) => res.status(503).json({ error: 'Forum vote storage not configured' }));
    return router;
  }

  const allowedChains = new Set((env.FORUM_ALLOWED_CHAIN_IDS ?? '11155111')
    .split(',').map((id) => id.trim()).filter((id) => /^[1-9][0-9]*$/.test(id)));
  const store = createVoteStore({ dataDir, clock });
  function storeFailure(err, res) {
    if (err.code === 'FORUM_MANIFEST_CHANGED') return res.status(503).json({ error: err.message });
    if (err.code === 'FORUM_STORAGE_UNSAFE') {
      return res.status(503).json({ error: 'Forum vote storage not configured' });
    }
    if (err.code === 'FORUM_WALLET_LIMIT') return res.status(429).json({ error: err.message });
    if (err.code === 'FORUM_RECORD_LIMIT') return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: 'Vote store unavailable' });
  }
  router.use(rateLimit({
    clock, max: 20,
    key: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
    reason: 'IP rate limit exceeded',
  }));
  const walletLimit = rateLimit({
    clock, max: 10, key: (req) => checksumWallet(req.body.wallet).toLowerCase(),
    reason: 'Wallet rate limit exceeded',
  });

  router.param('id', (req, res, next, id) => {
    try {
      req.forumBallot = loadBallot(ballotsDir, id);
    } catch {
      return res.status(400).json({ error: 'Invalid ballot' });
    }
    if (!allowedChains.has(String(req.forumBallot.manifest.chainId))) {
      return res.status(400).json({ error: 'Chain not allowed' });
    }
    try {
      store.check(req.forumBallot);
    } catch (err) {
      return storeFailure(err, res);
    }
    return next();
  });

  router.get('/ballots/:id', (req, res) => res.json(req.forumBallot));

  router.post('/ballots/:id/votes', express.json({ limit: 2048, inflate: false }), (req, res, next) => {
    const body = req.body;
    const keys = ['wallet', 'choice', 'issuedAt', 'signature'];
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== keys.length || !keys.every((key) => Object.hasOwn(body, key))) {
      return res.status(400).json({ error: 'Invalid vote body' });
    }
    const result = verifyVote({ ballot: req.forumBallot, ...body, now: clock() });
    if (!result.ok) return res.status(400).json({ error: result.reason });
    return walletLimit(req, res, next);
  }, (req, res) => {
    try {
      const { record, duplicate } = store.append(req.forumBallot, req.body);
      return res.status(duplicate ? 200 : 201).json(record);
    } catch (err) {
      return storeFailure(err, res);
    }
  });

  router.get('/ballots/:id/votes', (req, res) => {
    const { after = '0', limit = '1000' } = req.query;
    const integer = (value) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
      && Number.isSafeInteger(Number(value));
    if (!integer(after) || !integer(limit) || Number(limit) < 1 || Number(limit) > 1000) {
      return res.status(400).json({ error: 'Invalid pagination' });
    }
    try {
      // The store includes the full chain head/count, independent of this page's cursor.
      return res.json(store.read(req.forumBallot, { after: Number(after), limit: Number(limit) }));
    } catch (err) {
      return storeFailure(err, res);
    }
  });

  router.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(400).json({ error: 'Body too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.status >= 400 && err.status < 500) return res.status(400).json({ error: 'Invalid vote body' });
    return next(err);
  });
  return router;
}

module.exports = { createForumRouter, rateLimit, MAX_RATE_LIMIT_KEYS };
