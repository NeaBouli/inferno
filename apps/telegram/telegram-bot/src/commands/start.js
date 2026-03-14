// commands/start.js — /start and /help
const { Markup } = require('telegraf');

const WELCOME = `🔥 *Welcome to Inferno ($IFR)!*

I'm the official community assistant for the Inferno Protocol — available 24/7.

*What I can do:*
🔒 \`/lock <wallet>\` — Check lock status
🔥 \`/burns\` — Burns & current supply
📊 \`/tokenomics\` — Token distribution
🚀 \`/bootstrap\` — Bootstrap event info
🤝 \`/partner\` — Partner ecosystem
🗺 \`/roadmap\` — Project roadmap
💬 \`/ask <question>\` — Ask the AI copilot
🔐 \`/verify\` — Verify your wallet
❓ \`/help\` — All commands

🌐 [ifrunit.tech](https://ifrunit.tech) | 🐦 [@IFRtoken](https://x.com/IFRtoken)`;

const KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.url('🌐 Website', 'https://ifrunit.tech'),
    Markup.button.url('📖 Wiki', 'https://ifrunit.tech/wiki/index.html'),
  ],
  [
    Markup.button.url('🔥 Tokenomics', 'https://ifrunit.tech/wiki/tokenomics.html'),
    Markup.button.url('🔒 Lock Guide', 'https://ifrunit.tech/wiki/lock-mechanism.html'),
  ],
]);

async function startCommand(ctx) {
  await ctx.replyWithMarkdown(WELCOME, KEYBOARD);
}

module.exports = startCommand;
