// handlers/dailyWelcome.js — Daily welcome message at 08:00 CET (07:00 UTC)
const { getBurnStats } = require('../services/onchain');
const logger = require('../services/logger');

const WELCOME_HOUR_UTC = 7; // 08:00 CET = 07:00 UTC

async function sendDailyWelcome(bot, chatId, topicId) {
  try {
    const stats = await getBurnStats();

    const supplyFmt = Number(stats.totalSupply).toLocaleString('en-US');
    const burnedFmt = Number(stats.burned).toLocaleString('en-US');

    const text =
      `☀️ *Good morning, IFR Community!*\n\n` +
      `Here's your daily snapshot:\n\n` +
      `📊 Current Supply: ${supplyFmt} IFR\n` +
      `🔥 Total Burned: ${burnedFmt} IFR\n` +
      `💎 Every transfer makes IFR scarcer.\n\n` +
      `Have questions? Use /ask or post in #support.\n` +
      `🌐 [ifrunit.tech](https://ifrunit.tech)`;

    const opts = { parse_mode: 'Markdown', disable_web_page_preview: true };
    if (topicId) opts.message_thread_id = topicId;

    await bot.telegram.sendMessage(chatId, text, opts);
    logger.info({ chatId, topicId }, 'Daily welcome sent');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to send daily welcome');
  }
}

function scheduleDailyWelcome(bot) {
  const chatId = process.env.TELEGRAM_GROUP_ID;
  const topicId = process.env.TELEGRAM_GENERAL_TOPIC_ID || null;

  if (!chatId) {
    logger.warn('TELEGRAM_GROUP_ID not set — daily welcome disabled');
    return;
  }

  function msUntilNext() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(WELCOME_HOUR_UTC, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }

  function scheduleNext() {
    const delay = msUntilNext();
    logger.info({ delayMinutes: Math.round(delay / 60000) }, 'Next daily welcome scheduled');
    setTimeout(async () => {
      await sendDailyWelcome(bot, chatId, topicId ? parseInt(topicId, 10) : null);
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

module.exports = { sendDailyWelcome, scheduleDailyWelcome };
