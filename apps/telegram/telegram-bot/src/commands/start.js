// commands/start.js — /start und /help
const { Markup } = require('telegraf');

const WELCOME = `🔥 *Willkommen bei Inferno (\$IFR)!*

Ich bin der offizielle Community-Assistent des Inferno-Protokolls — 24/7 für dich da.

*Was ich kann:*
🔒 \`/lock <wallet>\` — Lock-Status prüfen
🔥 \`/burns\` — Burns & aktueller Supply
📊 \`/tokenomics\` — Token-Verteilung
🚀 \`/bootstrap\` — Bootstrap-Info
🤝 \`/partner\` — Partner-Ökosystem
🗺 \`/roadmap\` — Projekt-Roadmap
💬 \`/ask <frage>\` — KI-Frage stellen
❓ \`/help\` — Alle Befehle

🌐 [ifrunit.tech](https://ifrunit.tech) | 🐦 [@IFRtoken](https://x.com/IFRtoken)`;

const KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.url('🌐 Website', 'https://ifrunit.tech'),
    Markup.button.url('📖 Wiki', 'https://ifrunit.tech/wiki/index.html'),
  ],
  [
    Markup.button.url('🔥 Tokenomics', 'https://ifrunit.tech/wiki/tokenomics.html'),
    Markup.button.url('🔒 Lock-Guide', 'https://ifrunit.tech/wiki/lock-mechanism.html'),
  ],
]);

async function startCommand(ctx) {
  await ctx.replyWithMarkdown(WELCOME, KEYBOARD);
}

module.exports = startCommand;
