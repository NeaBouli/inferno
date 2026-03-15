// handlers/bootstrapAnnouncement.js — Automatic Bootstrap start/end announcement + 7-day countdown
const logger = require('../services/logger');

const BOOTSTRAP_START = new Date('2026-04-17T00:00:00Z').getTime();
const BOOTSTRAP_END   = new Date('2026-06-05T00:00:00Z').getTime();
const CHECK_HOUR_UTC  = 8; // 09:00 CET = 08:00 UTC

// In-memory state — prevents duplicate announcements within a process lifetime
const announced = { start: false, end: false };

function getBootstrapPhase() {
  const now = Date.now();
  if (now < BOOTSTRAP_START) return 'before';
  if (now < BOOTSTRAP_END)   return 'active';
  return 'ended';
}

/**
 * Send bootstrap start/end announcement to channel + community.
 */
async function checkAndAnnounceBootstrap(bot) {
  const phase = getBootstrapPhase();

  const groupId = process.env.TELEGRAM_GROUP_ID;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const announceTopic = process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID
    ? parseInt(process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID, 10) : null;

  if (!groupId) {
    logger.warn('TELEGRAM_GROUP_ID not set — bootstrap announcements disabled');
    return;
  }

  // ── Bootstrap START ────────────────────────────────
  if (phase === 'active' && !announced.start) {
    announced.start = true;

    const msg =
      `🔥 *BOOTSTRAP EVENT IS NOW LIVE!*\n\n` +
      `The IFR Community Bootstrap Event has officially opened.\n\n` +
      `💰 *Contribute 0.01–2 ETH* and receive IFR pro-rata at launch price.\n\n` +
      `📋 *Details:*\n` +
      `├ Vault: \`0xf72565...e141\`\n` +
      `├ Allocation: 194.75M IFR\n` +
      `├ Duration: April 17 → June 5, 2026\n` +
      `├ 100% of ETH goes to Uniswap LP\n` +
      `└ No team ETH. Fully trustless.\n\n` +
      `🌐 *Participate:* [ifrunit.tech/wiki/bootstrap](https://ifrunit.tech/wiki/bootstrap.html)\n\n` +
      `$IFR — Lock. Use. Benefit.`;

    await sendToAll(bot, groupId, channelId, announceTopic, msg);
    logger.info('Bootstrap START announcement sent');
  }

  // ── Bootstrap END ──────────────────────────────────
  if (phase === 'ended' && !announced.end) {
    announced.end = true;

    const msg =
      `⏹ *BOOTSTRAP EVENT HAS CLOSED*\n\n` +
      `The IFR Bootstrap Event ended on June 5, 2026.\n\n` +
      `✅ *Next steps:*\n` +
      `├ Anyone can call \`finalise()\` permissionlessly\n` +
      `├ After finalization: claim your IFR\n` +
      `└ IFR/ETH LP will be created on Uniswap\n\n` +
      `🔔 We will announce when finalization is complete.`;

    await sendToAll(bot, groupId, channelId, announceTopic, msg);
    logger.info('Bootstrap END announcement sent');
  }
}

/**
 * Send 7-day countdown messages (community general topic only).
 */
async function sendBootstrapCountdown(bot) {
  const phase = getBootstrapPhase();
  const now = Date.now();

  const groupId = process.env.TELEGRAM_GROUP_ID;
  const generalTopic = process.env.TELEGRAM_GENERAL_TOPIC_ID
    ? parseInt(process.env.TELEGRAM_GENERAL_TOPIC_ID, 10) : null;

  if (!groupId) return;

  let msg = null;

  if (phase === 'before') {
    const days = Math.ceil((BOOTSTRAP_START - now) / 86400000);
    if (days <= 7 && days >= 1) {
      msg = `⏳ *Bootstrap Event starts in ${days} day${days === 1 ? '' : 's'}!*\n\nPrepare at [ifrunit.tech/wiki/bootstrap](https://ifrunit.tech/wiki/bootstrap.html)`;
    }
  } else if (phase === 'active') {
    const days = Math.ceil((BOOTSTRAP_END - now) / 86400000);
    if (days <= 7 && days >= 1) {
      msg = `⚠️ *Bootstrap Event closes in ${days} day${days === 1 ? '' : 's'}!*\n\nLast chance to contribute: [ifrunit.tech/wiki/bootstrap](https://ifrunit.tech/wiki/bootstrap.html)`;
    }
  }

  if (msg) {
    try {
      const opts = { parse_mode: 'Markdown' };
      if (generalTopic) opts.message_thread_id = generalTopic;
      await bot.telegram.sendMessage(groupId, msg, opts);
      logger.info('Bootstrap countdown sent');
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to send bootstrap countdown');
    }
  }
}

/**
 * Schedule daily bootstrap check at 09:00 CET (08:00 UTC).
 */
function scheduleBootstrapAnnouncements(bot) {
  // Stop scheduling if bootstrap is over and both announcements sent
  if (getBootstrapPhase() === 'ended' && announced.end) {
    logger.info('Bootstrap ended and announced — no further scheduling needed');
    return;
  }

  function msUntilNext() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(CHECK_HOUR_UTC, 5, 0, 0); // 08:05 UTC — 5 min after burn report
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }

  function scheduleNext() {
    const delay = msUntilNext();
    logger.info({ delayMinutes: Math.round(delay / 60000) }, 'Next bootstrap check scheduled');
    setTimeout(async () => {
      await checkAndAnnounceBootstrap(bot);
      await sendBootstrapCountdown(bot);
      // Stop if bootstrap ended and announced
      if (getBootstrapPhase() === 'ended' && announced.end) {
        logger.info('Bootstrap fully concluded — stopping scheduler');
        return;
      }
      scheduleNext();
    }, delay);
  }

  // Also check immediately on startup (in case bot restarted on the day)
  checkAndAnnounceBootstrap(bot).catch(() => {});

  scheduleNext();
}

async function sendToAll(bot, groupId, channelId, announceTopic, msg) {
  const opts = { parse_mode: 'Markdown', disable_web_page_preview: false };

  // Channel
  if (channelId) {
    try {
      await bot.telegram.sendMessage(channelId, msg, opts);
    } catch (err) {
      logger.error({ err: err.message }, 'Bootstrap announcement: channel send failed');
    }
  }

  // Community — Announcements topic
  try {
    const groupOpts = { ...opts };
    if (announceTopic) groupOpts.message_thread_id = announceTopic;
    await bot.telegram.sendMessage(groupId, msg, groupOpts);
  } catch (err) {
    logger.error({ err: err.message }, 'Bootstrap announcement: community send failed');
  }
}

module.exports = { scheduleBootstrapAnnouncements, checkAndAnnounceBootstrap, sendBootstrapCountdown, getBootstrapPhase };
