// commands/burns.js — /burns
const { getBurnStats } = require('../services/onchain');
const logger = require('../services/logger');

function formatNum(n) {
  return Math.round(n).toLocaleString('en-US');
}

async function burnsCommand(ctx) {
  const loadingMsg = await ctx.reply('🔥 Loading burn data...');

  try {
    const stats = await getBurnStats();
    const date = new Date().toLocaleDateString('en-US', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });

    const reply = `🔥 *IFR Burn Report — ${date}*
━━━━━━━━━━━━━━━━━━━━━

📦 *Initial Supply:* 1,000,000,000 IFR
📉 *Current Supply:* ${formatNum(stats.totalSupply)} IFR
🔥 *Total Burned:* ${formatNum(stats.burned)} IFR *(${stats.burnedPercent.toFixed(4)}%)*

📋 *Burn Mechanism:*
• 2% from sender (permanently burned)
• 0.5% from recipient (permanently burned)
• 1% pool fee
• Total: *3.5% per transfer*

💡 Every transaction makes IFR permanently scarcer.

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
      '❌ Failed to fetch supply data. Please try again.\n\nManual check: https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B'
    );
  }
}

module.exports = burnsCommand;
