// commands/announce.js — /announce <message> (Admin only)
const logger = require('../services/logger');

const GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const TOPIC_ID = process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID;

async function announceCommand(ctx) {
  const text = ctx.message.text.replace(/^\/announce\s*/, '').trim();

  if (!text) {
    await ctx.reply('Usage: /announce <message>');
    return;
  }

  if (!GROUP_ID || !TOPIC_ID) {
    logger.error('TELEGRAM_GROUP_ID or TELEGRAM_ANNOUNCEMENTS_TOPIC_ID not set');
    await ctx.reply('❌ Announcement channel not configured.');
    return;
  }

  const formatted = `📢 *Announcement*\n\n${text}\n\n🌐 ifrunit.tech`;

  try {
    await ctx.telegram.sendMessage(GROUP_ID, formatted, {
      parse_mode: 'Markdown',
      message_thread_id: Number(TOPIC_ID) || undefined,
    });
    logger.info({ adminId: ctx.from.id, length: text.length }, 'Announcement posted');
    await ctx.reply('✅ Announcement gesendet.');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to post announcement');
    await ctx.reply(`❌ Fehler: ${err.message}`);
  }
}

module.exports = announceCommand;
