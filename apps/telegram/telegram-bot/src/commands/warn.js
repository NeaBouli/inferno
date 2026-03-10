// commands/warn.js — /warn (reply to user, admin only)
const logger = require('../services/logger');

// userId -> warning count
const warnings = new Map();
const BAN_AT = 3;

async function warnCommand(ctx) {
  const reply = ctx.message?.reply_to_message;
  if (!reply || !reply.from) {
    await ctx.reply('Usage: Reply to a message with /warn to warn that user.');
    return;
  }

  const targetId = reply.from.id;
  const targetName = reply.from.first_name || String(targetId);
  const count = (warnings.get(targetId) || 0) + 1;
  warnings.set(targetId, count);

  logger.info({ adminId: ctx.from.id, targetId, targetName, count }, 'User warned');

  if (count >= BAN_AT) {
    try {
      await ctx.banChatMember(targetId);
      warnings.delete(targetId);
      logger.info({ targetId, targetName }, 'User auto-banned after 3 warnings');
      await ctx.reply(`🚫 ${targetName} has been banned after ${BAN_AT} warnings.`);
    } catch (err) {
      logger.error({ err: err.message, targetId }, 'Failed to auto-ban user');
      await ctx.reply(`⚠️ ${targetName} has ${count}/${BAN_AT} warnings. Auto-ban failed: ${err.message}`);
    }
    return;
  }

  await ctx.reply(`⚠️ ${targetName} has been warned. (${count}/${BAN_AT} — auto-ban at ${BAN_AT})`);
}

module.exports = warnCommand;
