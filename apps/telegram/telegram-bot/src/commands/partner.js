// commands/partner.js — /partner
const { Markup } = require('telegraf');

async function partnerCommand(ctx) {
  const reply = `🤝 *IFR Partner Ecosystem*
━━━━━━━━━━━━━━━━━━━━━

Partner apps use the IFR Lock Mechanism as an access system:

*How it works:*
1️⃣ User buys IFR on Uniswap
2️⃣ User locks IFR in the IFRLock contract
3️⃣ Partner checks: \`isLocked(wallet, minAmount)\`
4️⃣ User gets lifetime access

*For developers — 5 lines of code:*
\`\`\`
const locked = await ifrLock.isLocked(
  userWallet, minAmount
);
if (locked) grantAccess(user);
\`\`\`

*Become a partner:*
• Registration via Governance
• Access to 40M IFR Partner Vault
• Open-source integration

📋 [Partner Wiki](https://ifrunit.tech/wiki/integration.html)`;

  await ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
    [Markup.button.url('📖 Integration Guide', 'https://ifrunit.tech/wiki/integration.html')],
    [Markup.button.url('⚙️ GitHub Repo', 'https://github.com/NeaBouli/inferno')],
  ]));
}

module.exports = partnerCommand;
