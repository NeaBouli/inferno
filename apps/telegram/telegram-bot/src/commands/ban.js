// commands/ban.js — /ban (reply to user, admin only)
const logger = require('../services/logger');

async function banCommand(ctx) {
  const reply = ctx.message?.reply_to_message;
  if (!reply || !reply.from) {
    await ctx.reply('Usage: Reply to a message with /ban to ban that user.');
    return;
  }

  const targetId = reply.from.id;
  const targetName = reply.from.first_name || String(targetId);

  try {
    await ctx.banChatMember(targetId);
    logger.info({ adminId: ctx.from.id, targetId, targetName }, 'User banned by admin');
    await ctx.reply(`🚫 ${targetName} has been banned.`);
  } catch (err) {
    logger.error({ err: err.message, targetId }, 'Failed to ban user');
    await ctx.reply(`❌ Could not ban user: ${err.message}`);
  }
}

module.exports = banCommand;
