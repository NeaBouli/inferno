// commands/pin.js — /pin (reply to message, admin only)
const logger = require('../services/logger');

async function pinCommand(ctx) {
  const reply = ctx.message?.reply_to_message;
  if (!reply) {
    await ctx.reply('Usage: Reply to a message with /pin to pin it.');
    return;
  }

  try {
    await ctx.pinChatMessage(reply.message_id);
    logger.info({ adminId: ctx.from.id, messageId: reply.message_id }, 'Message pinned');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to pin message');
    await ctx.reply(`❌ Could not pin message: ${err.message}`);
  }
}

module.exports = pinCommand;
