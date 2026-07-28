// commands/tokenomics.js — /tokenomics (statisch)
const { Markup } = require('telegraf');

async function tokenomicsCommand(ctx) {
  const reply = `📊 *Inferno (\$IFR) — Tokenomics*
━━━━━━━━━━━━━━━━━━━━━

💎 *Supply:* 1.000.000.000 IFR (fix, kein Mint)
🔥 *Burn:* 2.5% pro Transfer (permanent)
🏦 *Pool-Fee:* 1.0% pro Transfer
📊 *Gesamtgebühr:* 3.5% (Hard Cap 5%)

📋 *Token-Verteilung:*
• 40% — DEX Liquidity / LP Reserve (400M)
• 20% — Liquidity Reserve (200M)
• 15% — Team, 12 Mon. Cliff + 36 Mon. linear (150M)
• 15% — Treasury (150M)
• 6% — Community & Grants (60M)
• 4% — Partner Ecosystem (40M)

🔒 *Sicherheit:*
• Kein Presale, kein VC-Kapital
• Team-Tokens vested (kein Dump)
• Alle Contracts auf Etherscan verifiziert
• Vollständige interne Audits und öffentliche Testnachweise
• Professionelles unabhängiges Dritt-Audit noch ausstehend

🌐 Contract: \`0x77e99917Eca8539c62F509ED1193ac36580A6e7B\``;

  await ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
    [Markup.button.url('📖 Tokenomics Wiki', 'https://ifrunit.tech/wiki/tokenomics.html')],
    [Markup.button.url('🔍 Etherscan', 'https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B')],
  ]));
}

module.exports = tokenomicsCommand;
