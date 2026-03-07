// commands/admin.js — /admin (Whitelist only)
const cache = require('../services/cache');
const logger = require('../services/logger');

const startTime = Date.now();

function uptime() {
  const ms = Date.now() - startTime;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

async function adminCommand(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const sub = args[0] || 'status';

  if (sub === 'status') {
    const cacheStats = cache.getStats();
    const reply = `🔧 *Admin Status*
━━━━━━━━━━━━━━━━━━━━━

⏱ Uptime: ${uptime()}
💾 Cache Keys: ${cacheStats.keys}
✅ Cache Hits: ${cacheStats.hits}
❌ Cache Misses: ${cacheStats.misses}

🌐 Railway: https://ifr-ai-copilot-production.up.railway.app/health
📊 Token: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B

_Node ${process.version} | ${process.env.NODE_ENV}_`;

    await ctx.replyWithMarkdown(reply);
  } else if (sub === 'clearcache') {
    cache.flushAll();
    logger.info({ adminId: ctx.from.id }, 'Cache cleared by admin');
    await ctx.reply('✅ Cache geleert.');
  } else {
    await ctx.reply('Subcommands: /admin status | /admin clearcache');
  }
}

module.exports = adminCommand;
