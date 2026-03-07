// commands/lock.js — /lock <wallet>
const { getLockStatus } = require('../services/onchain');
const logger = require('../services/logger');

async function lockCommand(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const wallet = args[0];

  if (!wallet) {
    return ctx.reply(
      '🔒 Nutzung: /lock <wallet-adresse>\n\nBeispiel:\n/lock 0x6b36687b0cd4386fb14cf565B67D7862110Fed67'
    );
  }

  const loadingMsg = await ctx.reply('🔍 Prüfe Lock-Status...');

  try {
    const data = await getLockStatus(wallet);
    const short = `${wallet.substring(0, 6)}...${wallet.substring(38)}`;
    const amount = parseFloat(data.lockAmount).toLocaleString('de-DE', { maximumFractionDigits: 2 });

    const statusLine = data.isLocked
      ? '✅ *AKTIV* — Wallet hat aktiven IFR-Lock'
      : '❌ *KEIN LOCK* — Keine IFR gelockt';

    const reply = `🔒 *Lock-Status für* \`${short}\`

${statusLine}

📊 *Details:*
• Gelockte Menge: *${amount} IFR*
• Min. für Zugang: 1.000 IFR (je nach Partner)

${data.isLocked
  ? '✅ Dieser Wallet hat Zugang zu IFR-Partner-Apps.'
  : '💡 IFR locken auf [ifrunit.tech](https://ifrunit.tech) für Partner-Zugang.'}`;

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      reply,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error({ err: err.message, wallet }, '/lock error');
    const errMsg = err.message.includes('Ungültige')
      ? '❌ Ungültige Ethereum-Adresse. Bitte prüfe die Eingabe (0x...)'
      : '❌ Fehler beim Abrufen des Lock-Status. Bitte erneut versuchen.';

    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, errMsg);
  }
}

module.exports = lockCommand;
