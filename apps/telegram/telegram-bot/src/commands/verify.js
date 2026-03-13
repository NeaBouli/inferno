// commands/verify.js — /verify (wallet verification) + /mystatus
const { createNonce, isVerified, getUser, hasTopicAccess } = require('../services/verificationStore');

const VERIFY_URL = 'https://ifrunit.tech/wiki/verify.html';

const TIER_LABELS = {
  signer:    '🔑 Signer / Core Team',
  voter:     '🗳️ IFR Holder / Voter',
  builder:   '🔨 Builder',
  community: '👤 Community Member'
};

async function handleVerify(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;

  if (isVerified(userId)) {
    const user = getUser(userId);
    return ctx.reply(
      `✅ *Already verified*\n\n` +
      `Wallet: \`${user.wallet.slice(0, 6)}...${user.wallet.slice(-4)}\`\n` +
      `Tier: ${TIER_LABELS[user.tier] || 'Unknown'}\n\n` +
      `Use /mystatus to see your topic access.`,
      { parse_mode: 'Markdown' }
    );
  }

  const nonce = createNonce(userId, username);

  await ctx.reply(
    `🔐 *IFR Wallet Verification*\n\n` +
    `Prove wallet ownership to unlock Telegram topic access.\n\n` +
    `*Your verification code:*\n\`${nonce}\`\n\n` +
    `*Step 1:* Open: ${VERIFY_URL}\n` +
    `*Step 2:* Connect MetaMask\n` +
    `*Step 3:* Enter code + sign\n\n` +
    `⏱ Expires in *10 minutes*\n` +
    `🔒 Cryptographic proof — no address spoofing possible\n\n` +
    `_Access levels:_\n` +
    `🔑 Signer wallet → Core Dev + Council\n` +
    `🗳️ Any locked IFR → Vote topic\n` +
    `🔨 Registered Builder → Dev & Builder topic`,
    { parse_mode: 'Markdown', disable_web_page_preview: true }
  );
}

async function handleMyStatus(ctx) {
  const userId = ctx.from.id;

  if (!isVerified(userId)) {
    return ctx.reply(
      `❌ *Not verified yet*\n\nUse /verify to link your wallet.`,
      { parse_mode: 'Markdown' }
    );
  }

  const user = getUser(userId);
  const topics = [
    { name: 'Core Dev', id: 58 },
    { name: 'Council', id: 21 },
    { name: 'Vote', id: 23 },
    { name: 'Dev & Builder', id: 11 },
  ];

  const accessList = topics.map(t =>
    `${hasTopicAccess(userId, t.id) ? '✅' : '❌'} ${t.name}`
  ).join('\n');

  await ctx.reply(
    `📊 *Your Status*\n\n` +
    `Wallet: \`${user.wallet.slice(0, 6)}...${user.wallet.slice(-4)}\`\n` +
    `Tier: ${TIER_LABELS[user.tier] || 'Unknown'}\n\n` +
    `*Topic Access:*\n${accessList}`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleVerify, handleMyStatus };
