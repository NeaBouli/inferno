// commands/rules.js — /rules command
module.exports = async function rulesCommand(ctx) {
  const text =
    '🔥 *IFR Community Rules*\n\n' +
    '1\\. No spam, advertising or scam links\n' +
    '2\\. Respect all community members\n' +
    '3\\. No price manipulation or FUD\n' +
    '4\\. Only share verified contract addresses\n' +
    '5\\. No unsolicited DMs to other members\n' +
    '6\\. English only in main topics\n' +
    '7\\. Admins have final say\n\n' +
    '⚠️ Violations result in immediate ban\\.\n' +
    '🌐 ifrunit\\.tech \\| 📊 @IFRtoken \\| 🤖 @IFR\\_Assistant\\_bot';

  await ctx.replyWithMarkdownV2(text);
};
