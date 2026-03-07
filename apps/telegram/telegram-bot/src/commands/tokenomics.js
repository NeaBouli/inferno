// commands/tokenomics.js — /tokenomics (statisch)
const { Markup } = require('telegraf');

async function tokenomicsCommand(ctx) {
  const reply = `📊 *Inferno (\$IFR) — Tokenomics*
━━━━━━━━━━━━━━━━━━━━━

💎 *Supply:* 1.000.000.000 IFR (fix, kein Mint)
🔥 *Burn:* 3.5% pro Transfer (permanent)

📋 *Token-Verteilung:*
• 40% — DEX Liquidity (400M)
• 20% — Liquidity Reserve (200M)
• 15% — Team, 48 Mon. Vesting, 12 Mon. Cliff (150M)
• 10% — Bootstrap (100M)
• 8% — Buyback Vault (80M)
• 6% — Community & Grants (60M)
• 4% — Partner Ecosystem (40M)
• 3% — Burn Reserve (30M)

🔒 *Sicherheit:*
• Kein Presale, kein VC-Kapital
• Team-Tokens vested (kein Dump)
• Alle Contracts auf Etherscan verifiziert
• 444 Tests, 91% Branch Coverage

🌐 Contract: \`0x77e99917Eca8539c62F509ED1193ac36580A6e7B\``;

  await ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
    [Markup.button.url('📖 Tokenomics Wiki', 'https://ifrunit.tech/wiki/tokenomics.html')],
    [Markup.button.url('🔍 Etherscan', 'https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B')],
  ]));
}

module.exports = tokenomicsCommand;
