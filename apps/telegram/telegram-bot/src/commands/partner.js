// commands/partner.js — /partner
const { Markup } = require('telegraf');

async function partnerCommand(ctx) {
  const reply = `🤝 *IFR Partner-Ökosystem*
━━━━━━━━━━━━━━━━━━━━━

Partner-Apps nutzen den IFR Lock-Mechanismus als Zugangssystem:

*So funktioniert es:*
1️⃣ User kauft IFR auf Uniswap
2️⃣ User lockt IFR im IFRLock Contract
3️⃣ Partner prüft: \`isLocked(wallet, minAmount)\`
4️⃣ User erhält dauerhaften Zugang

*Für Entwickler — 5 Zeilen Code:*
\`\`\`
const locked = await ifrLock.isLocked(
  userWallet, minAmount
);
if (locked) grantAccess(user);
\`\`\`

*Partner werden:*
• Registrierung via Governance
• Zugang zu 40M IFR Partner-Vault
• Open-Source Integration

📋 [Partner Wiki](https://ifrunit.tech/wiki/integration.html)`;

  await ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
    [Markup.button.url('📖 Integration Guide', 'https://ifrunit.tech/wiki/integration.html')],
    [Markup.button.url('⚙️ GitHub Repo', 'https://github.com/NeaBouli/inferno')],
  ]));
}

module.exports = partnerCommand;
