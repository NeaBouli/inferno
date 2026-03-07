// commands/ask.js — /ask <frage> via Claude API
const { askClaude } = require('../services/claude');
const logger = require('../services/logger');

async function askCommand(ctx) {
  const text = ctx.message.text;
  const question = text.replace(/^\/ask\s*/i, '').trim();

  if (!question) {
    return ctx.reply(
      '💬 Nutzung: /ask <deine Frage>\n\nBeispiel:\n/ask Wie locke ich IFR?\n/ask Was ist der Burn-Mechanismus?'
    );
  }

  const loadingMsg = await ctx.reply('🤖 Copilot denkt nach...');

  try {
    const userId = ctx.from.id;
    const answer = await askClaude(userId, question);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      `🤖 *IFR Copilot:*\n\n${answer}`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
  } catch (err) {
    logger.error({ err: err.message }, '/ask error');
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      '❌ Copilot nicht erreichbar. Bitte später erneut versuchen.\n\nFAQ: https://ifrunit.tech/wiki/faq.html'
    );
  }
}

module.exports = askCommand;
