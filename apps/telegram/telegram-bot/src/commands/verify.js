// commands/verify.js — /verify <wallet> (public lock verification)
const { ethers } = require('ethers');
const { getLockStatus } = require('../services/onchain');
const logger = require('../services/logger');

async function verifyCommand(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const wallet = args[0];

  if (!wallet || !ethers.utils.isAddress(wallet)) {
    await ctx.reply('Usage: /verify <wallet-address>\n\nExample:\n/verify 0x6b36687b0cd4386fb14cf565B67D7862110Fed67');
    return;
  }

  const loadingMsg = await ctx.reply('🔍 Verifying lock status...');
  const short = `${wallet.substring(0, 6)}...${wallet.substring(38)}`;

  try {
    const data = await getLockStatus(wallet);
    const amount = parseFloat(data.lockAmount).toLocaleString('en-US', { maximumFractionDigits: 2 });

    let reply;
    if (data.isLocked && parseFloat(data.lockAmount) > 0) {
      reply = `✅ Wallet \`${short}\` has a verified IFR lock of *${amount} IFR*`;
    } else {
      reply = `❌ Wallet \`${short}\` has no active IFR lock.`;
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      reply,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error({ err: err.message, wallet }, '/verify error');
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      '❌ Could not verify lock status. Please try again.'
    );
  }
}

module.exports = verifyCommand;
