// commands/ask.js — /ask <question> via AI API
const { askSkywalker } = require('../services/skywalker');
const { toPlainText, TELEGRAM_MAX_MESSAGE_LENGTH } = require('../services/telegramText');
const logger = require('../services/logger');

const REPLY_HEADER = '🤖 IFR Copilot:\n\n';

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

    // The AI answer is untrusted content (CWA-45): send it as plain text
    // (no parse_mode — no Markdown/HTML interpolation into deceptive links,
    // mentions or formatting) and within Telegram's length limit.
    const body = toPlainText(answer, TELEGRAM_MAX_MESSAGE_LENGTH - REPLY_HEADER.length);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      `${REPLY_HEADER}${body}`,
      { disable_web_page_preview: true }
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
