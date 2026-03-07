// commands/bootstrap.js — /bootstrap
const { Markup } = require('telegraf');

async function bootstrapCommand(ctx) {
  const reply = `🚀 *IFR Bootstrap — Community Liquidity*
━━━━━━━━━━━━━━━━━━━━━

*Was ist der Bootstrap?*
Ein trustloser 90-Tage-Zeitraum in dem die Community gemeinsam Liquidität für das IFR/ETH Uniswap V2 Pair aufbaut.

*Fakten:*
• 📦 100.000.000 IFR bereitgestellt (10% des Supplies)
• 💰 0.01 – 2 ETH pro Wallet
• 🔒 LP-Token 12 Monate locked via Team.Finance
• ⚙️ Vollständig permissionless (kein Admin-Zugriff)
• 📅 90 Tage Laufzeit nach Start

*Wie es funktioniert:*
1️⃣ ETH einzahlen (\`contribute()\`)
2️⃣ Nach 90 Tagen: automatisch LP erstellt
3️⃣ LP-Token 12 Mon. locked
4️⃣ Community claimt LP-Anteile (\`claim()\`)

*Status:* Sepolia Testnet ✅ | Mainnet ⏳ (nach Proposal #0)

📖 [Bootstrap Wiki](https://ifrunit.tech/wiki/bootstrap.html)`;

  await ctx.replyWithMarkdown(reply, Markup.inlineKeyboard([
    [Markup.button.url('📖 Bootstrap Wiki', 'https://ifrunit.tech/wiki/bootstrap.html')],
    [Markup.button.url('🌐 ifrunit.tech', 'https://ifrunit.tech')],
  ]));
}

module.exports = bootstrapCommand;
