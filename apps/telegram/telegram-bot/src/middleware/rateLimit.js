// middleware/rateLimit.js — Anti-Spam pro User und Command
const cache = require('../services/cache');

const LIMITS = {
  lock:       { max: 10, windowSec: 60 },
  burns:      { max: 5,  windowSec: 60 },
  tokenomics: { max: 10, windowSec: 60 },
  bootstrap:  { max: 10, windowSec: 60 },
  partner:    { max: 10, windowSec: 60 },
  roadmap:    { max: 10, windowSec: 60 },
  default:    { max: parseInt(process.env.RATE_LIMIT_PER_MIN || '5'), windowSec: 60 },
};

/**
 * Middleware-Factory: gibt Telegraf-Middleware zurück die pro User+Command begrenzt.
 * @param {string} command - Name des Commands (ohne /)
 */
function rateLimit(command) {
  const { max, windowSec } = LIMITS[command] || LIMITS.default;

  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const key = `rl_${command}_${userId}`;
    const current = cache.get(key) || 0;

    if (current >= max) {
      return ctx.reply(
        `⏳ Too many requests. Please wait ${windowSec} seconds.\n\nMore info: https://ifrunit.tech`
      );
    }

    cache.set(key, current + 1, windowSec);
    return next();
  };
}

module.exports = rateLimit;
