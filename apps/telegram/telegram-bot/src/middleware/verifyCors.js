'use strict';

// middleware/verifyCors.js — Exact-origin CORS policy for the verify API (CWA-39)
//
// The only browser caller is https://ifrunit.tech/wiki/verify.html (and its
// www alias), so the allowlist is a constant set of exact serialized HTTPS
// origins — never substring or suffix matching.
//
// Documented policy for requests WITHOUT an Origin header: they are treated as
// non-browser API clients (curl, server-to-server, health checks). CORS is a
// browser enforcement mechanism and does not apply to them; they are processed
// normally but receive no Access-Control-* headers.

// Exact serialized origins (scheme://host, default port only).
const ALLOWED_ORIGINS = ['https://ifrunit.tech', 'https://www.ifrunit.tech'];

/**
 * Resolve an Origin header value to an allowlisted canonical origin.
 * Returns the canonical origin string or null when the value is not an exact
 * allowlisted HTTPS origin (credentialed URLs, alternate schemes/ports,
 * prefix/suffix lookalikes, `null` and malformed values all fail closed).
 */
function resolveAllowedOrigin(origin) {
  if (typeof origin !== 'string') return null;
  // A browser Origin header is a single serialized origin without surrounding
  // whitespace; padded or comma-joined values are malformed.
  if (origin.length === 0 || origin !== origin.trim() || origin.includes(',')) return null;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return null; // 'null', empty, malformed
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.port) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;

  // url.origin is the normalized serialization: lowercase scheme/host,
  // default port elided, credentials stripped (already rejected above).
  return ALLOWED_ORIGINS.includes(url.origin) ? url.origin : null;
}

/**
 * Express middleware applying the exact-origin allowlist. Preflight requests
 * are always answered; CORS headers are only emitted for allowlisted origins.
 */
function verifyCors() {
  return function verifyCorsMiddleware(req, res, next) {
    res.header('Vary', 'Origin');
    const originHeader = req.headers.origin;
    if (originHeader !== undefined) {
      const allowed = resolveAllowedOrigin(originHeader);
      if (allowed) {
        res.header('Access-Control-Allow-Origin', allowed);
        res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
      }
      // Disallowed or malformed origin: no CORS headers — the browser blocks.
    }
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  };
}

module.exports = { ALLOWED_ORIGINS, resolveAllowedOrigin, verifyCors };
