// commands/lock.js — /lock <wallet>
const { getLockStatus } = require('../services/onchain');
const logger = require('../services/logger');

async function lockCommand(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const wallet = args[0];

  if (!wallet) {
    return ctx.reply(
      '🔒 Usage: /lock <wallet-address>\n\nExample:\n/lock 0x6b36687b0cd4386fb14cf565B67D7862110Fed67'
    );
  }

  const loadingMsg = await ctx.reply('🔍 Checking lock status...');

  try {
    const data = await getLockStatus(wallet);
    const short = `${wallet.substring(0, 6)}...${wallet.substring(38)}`;
    const amount = parseFloat(data.lockAmount).toLocaleString('en-US', { maximumFractionDigits: 2 });

    const statusLine = data.isLocked
      ? '✅ *ACTIVE* — Wallet has an active IFR lock'
      : '❌ *NO LOCK* — No IFR locked';

    const reply = `🔒 *Lock Status for* \`${short}\`

${statusLine}

📊 *Details:*
• Locked amount: *${amount} IFR*
• Min. for access: 1,000 IFR (depends on partner)

${data.isLocked
  ? '✅ This wallet has access to IFR partner apps.'
  : '💡 Lock IFR at [ifrunit.tech](https://ifrunit.tech) for partner access.'}`;

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      reply,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error({ err: err.message, wallet }, '/lock error');
    const errMsg = err.message.includes('invalid address')
      ? '❌ Invalid Ethereum address. Please check your input (0x...)'
      : '❌ Failed to fetch lock status. Please try again.';

    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, errMsg);
  }
}

module.exports = lockCommand;
