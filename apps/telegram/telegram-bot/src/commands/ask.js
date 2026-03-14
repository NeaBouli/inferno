// commands/ask.js — /ask <question> via AI API
const { askSkywalker } = require('../services/skywalker');
const logger = require('../services/logger');

async function askCommand(ctx) {
  const text = ctx.message.text;
  const question = text.replace(/^\/ask\s*/i, '').trim();

  if (!question) {
    return ctx.reply(
      '💬 Usage: /ask <your question>\n\nExample:\n/ask How do I lock IFR?\n/ask What is the burn mechanism?'
    );
  }

  const loadingMsg = await ctx.reply('🤖 Copilot is thinking...');

  try {
    const userId = ctx.from.id;
    const answer = await askSkywalker(userId, question);

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
      '❌ Copilot unavailable. Please try again later.\n\nFAQ: https://ifrunit.tech/wiki/faq.html'
    );
  }
}

module.exports = askCommand;
