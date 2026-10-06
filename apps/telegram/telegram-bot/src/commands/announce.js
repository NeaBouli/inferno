// commands/announce.js — /announce <message> (Admin only)
const logger = require('../services/logger');
const { sendToGroup } = require('../services/topicRouter');

const GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

async function announceCommand(ctx) {
  const text = ctx.message.text.replace(/^\/announce\s*/, '').trim();

  if (!text) {
    await ctx.reply('Usage: /announce <message>');
    return;
  }

  if (!GROUP_ID) {
    await ctx.reply('❌ Announcement channel not configured.');
    return;
  }

  const formatted =
    `📢 *Announcement*\n\n${text}\n\n` +
    `🌐 ifrunit.tech\n` +
    `💬 *Join the community:* [t.me/IFR\\_token](https://t.me/IFR_token)`;
  const opts = { parse_mode: 'Markdown' };

  let posted = 0;
  try {
    const sentMsg = await sendToGroup(ctx.telegram, GROUP_ID, 'announcements', formatted, opts);
    posted++;
    // Auto-pin announcement in group
    try {
      await ctx.telegram.pinChatMessage(GROUP_ID, sentMsg.message_id, { disable_notification: true });
    } catch (pinErr) {
      logger.warn({ err: pinErr.message }, 'Failed to pin announcement in group');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to post to group');
  }

  if (CHANNEL_ID) {
    try {
      await ctx.telegram.sendMessage(CHANNEL_ID, formatted, { parse_mode: 'Markdown' });
      posted++;
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to post to channel');
    }
  }

  logger.info({ adminId: ctx.from.id, posted }, 'Announcement posted');
  await ctx.reply(`✅ Announcement posted to ${posted} destination(s).`);

  // Delete the original /announce command message
  try {
    await ctx.deleteMessage();
  } catch (e) {
    // ignore — Bot may lack delete permissions
  }
}

module.exports = announceCommand;
