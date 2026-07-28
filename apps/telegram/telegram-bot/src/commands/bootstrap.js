// commands/bootstrap.js — /bootstrap
const { Markup } = require('telegraf');

async function bootstrapCommand(ctx) {
  const reply = `🚀 *IFR Bootstrap — Community Liquidity*
━━━━━━━━━━━━━━━━━━━━━

*Status: FINALISIERT am 05.06.2026*
Der 90-Tage-Bootstrap ist beendet. Die Community-Liquidität für das IFR/ETH Uniswap-V2-Pair wurde erstellt.

*Fakten:*
• 📦 100.000.000 IFR + 0.030 ETH im LP
• 🎁 100.000.000 IFR für Contributor-Claims reserviert
• 🔒 Team.Finance war auf Mainnet deaktiviert
• 🏦 LP verbleibt im BootstrapVaultV3 ohne LP-Auszahlungsfunktion
• ⚙️ finalise() war permissionless

*Wie es funktioniert:*
1️⃣ Bootstrap wurde finalisiert
2️⃣ Uniswap-V2-LP wurde erstellt
3️⃣ LP-Custody ist on-chain im BootstrapVaultV3 prüfbar
4️⃣ Alle drei Contributor-Claims wurden ausgeführt

*Status:* Ethereum Mainnet ✅ | Trading live

📖 [Bootstrap Wiki](https://ifrunit.tech/wiki/bootstrap.html)`;

  await ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
    [Markup.button.url('📖 Bootstrap Wiki', 'https://ifrunit.tech/wiki/bootstrap.html')],
    [Markup.button.url('🌐 ifrunit.tech', 'https://ifrunit.tech')],
  ]));
}

module.exports = bootstrapCommand;
