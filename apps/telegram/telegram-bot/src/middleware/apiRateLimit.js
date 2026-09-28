// middleware/apiRateLimit.js — Fixed-window per-IP rate limit for Express endpoints
//
// Keyed on req.ip. The verify API configures an explicit `trust proxy` policy
// in src/index.js (production: one Traefik hop), so req.ip is the real client
// IP when the immediate peer is the trusted proxy, and the raw socket peer
// otherwise — an attacker-controlled X-Forwarded-For header is never trusted
// from an untrusted peer (CWA-31).

function apiRateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, resetAt }

  function sweep(now) {
    for (const [key, entry] of hits.entries()) {
      if (now >= entry.resetAt) hits.delete(key);
    }
  }

  return function limiter(req, res, next) {
    const now = Date.now();
    if (hits.size > 10000) sweep(now);

    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, error: 'Too many requests' });
    }
    return next();
  };
}

module.exports = apiRateLimit;
