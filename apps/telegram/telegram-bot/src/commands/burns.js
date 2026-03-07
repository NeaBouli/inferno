// commands/burns.js — /burns
const { getBurnStats } = require('../services/onchain');
const logger = require('../services/logger');

function formatNum(n) {
  return Math.round(n).toLocaleString('de-DE');
}

async function burnsCommand(ctx) {
  const loadingMsg = await ctx.reply('🔥 Lade Burn-Daten...');

  try {
    const stats = await getBurnStats();
    const date = new Date().toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });

    const reply = `🔥 *IFR Burn-Report — ${date}*
━━━━━━━━━━━━━━━━━━━━━

📦 *Initialer Supply:* 1.000.000.000 IFR
📉 *Aktueller Supply:* ${formatNum(stats.totalSupply)} IFR
🔥 *Verbrannt gesamt:* ${formatNum(stats.burned)} IFR *(${stats.burnedPercent.toFixed(4)}%)*

📋 *Burn-Mechanismus:*
• 2% vom Sender (permanent verbrannt)
• 0.5% vom Empfänger (permanent verbrannt)
• 1% Pool Fee
• Gesamt: *3.5% pro Transfer*

💡 Jede Transaktion macht IFR dauerhaft seltener.

🌐 [Tokenomics Wiki](https://ifrunit.tech/wiki/tokenomics.html) | [Etherscan](https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B)`;

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      reply,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
  } catch (err) {
    logger.error({ err: err.message }, '/burns error');
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      '❌ Fehler beim Abrufen der Supply-Daten. Bitte erneut versuchen.\n\nManuelle Prüfung: https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B'
    );
  }
}

module.exports = burnsCommand;
