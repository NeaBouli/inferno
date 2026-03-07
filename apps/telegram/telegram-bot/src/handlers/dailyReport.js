// handlers/dailyReport.js — Daily burn report at 09:00 CET
const { getBurnStats } = require('../services/onchain');
const logger = require('../services/logger');

const REPORT_HOUR_UTC = 8; // 09:00 CET = 08:00 UTC

/**
 * Format and send the daily burn report.
 */
async function sendDailyBurnReport(bot, chatId, topicId) {
  try {
    const stats = await getBurnStats();

    const supplyFmt = Number(stats.totalSupply).toLocaleString('en-US');
    const burnedFmt = Number(stats.burned).toLocaleString('en-US');
    const pctFmt = stats.burnedPercent.toFixed(4);
    const remainPct = (100 - stats.burnedPercent).toFixed(4);
    const source = stats.source === 'railway' ? 'Railway Proxy' : 'RPC Fallback';

    const text =
      `🔥 *Daily IFR Burn Report*\n\n` +
      `📊 *Supply*\n` +
      `├ Initial: 1,000,000,000 IFR\n` +
      `├ Current: ${supplyFmt} IFR\n` +
      `└ Remaining: ${remainPct}%\n\n` +
      `🔥 *Burns*\n` +
      `├ Total Burned: ${burnedFmt} IFR\n` +
      `└ Burned: ${pctFmt}%\n\n` +
      `⏱ Every transfer burns 2.5% automatically.\n` +
      `📡 Source: ${source}`;

    const opts = { parse_mode: 'Markdown' };
    if (topicId) opts.message_thread_id = topicId;

    await bot.telegram.sendMessage(chatId, text, opts);
    logger.info({ chatId, topicId }, 'Daily burn report sent');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to send daily burn report');
  }
}

/**
 * Schedule the daily report. Call once at startup.
 */
function scheduleDailyReport(bot) {
  const chatId = process.env.TELEGRAM_GROUP_ID;
  const topicId = process.env.TELEGRAM_BURNS_TOPIC_ID || null;

  if (!chatId) {
    logger.warn('TELEGRAM_GROUP_ID not set — daily burn report disabled');
    return;
  }

  function msUntilNext() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(REPORT_HOUR_UTC, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }

  function scheduleNext() {
    const delay = msUntilNext();
    logger.info({ delayMinutes: Math.round(delay / 60000) }, 'Next daily burn report scheduled');
    setTimeout(async () => {
      await sendDailyBurnReport(bot, chatId, topicId ? parseInt(topicId, 10) : null);
      // Schedule next day (use setInterval-like recursion to avoid drift)
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

module.exports = { sendDailyBurnReport, scheduleDailyReport };
