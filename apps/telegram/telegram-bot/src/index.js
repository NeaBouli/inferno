// src/index.js — IFR Telegram Bot Entry Point
require('dotenv').config();
const { Telegraf } = require('telegraf');
const logger = require('./services/logger');

// Commands
const startCommand    = require('./commands/start');
const lockCommand     = require('./commands/lock');
const burnsCommand    = require('./commands/burns');
const tokenomicsCommand = require('./commands/tokenomics');
const askCommand      = require('./commands/ask');
const partnerCommand  = require('./commands/partner');
const bootstrapCommand = require('./commands/bootstrap');
const roadmapCommand  = require('./commands/roadmap');
const adminCommand    = require('./commands/admin');
const announceCommand = require('./commands/announce');
const banCommand      = require('./commands/ban');
const warnCommand     = require('./commands/warn');
const pinCommand      = require('./commands/pin');
const priceCommand    = require('./commands/price');
const { handleVerify, handleMyStatus } = require('./commands/verify');
const rulesCommand    = require('./commands/rules');

// Verification System
const express  = require('express');
const { ethers } = require('ethers');
const {
  getNonce, consumeNonce, setVerified, getUser, isVerified: isUserVerified,
  hasTopicAccess
} = require('./services/verificationStore');
const { determineTier } = require('./services/onChainReader');

// Handlers
const { onNewMember, onVerifyCallback } = require('./handlers/verification');
const { scheduleDailyReport } = require('./handlers/dailyReport');
const { scheduleDailyWelcome } = require('./handlers/dailyWelcome');
const { startGovernanceNotifier } = require('./handlers/governanceNotifier');
const { scheduleBootstrapAnnouncements } = require('./handlers/bootstrapAnnouncement');

// Middleware
const rateLimit  = require('./middleware/rateLimit');
const adminOnly  = require('./middleware/adminCheck');
const { moderationMiddleware } = require('./services/moderation');

// Validation
if (!process.env.BOT_TOKEN) {
  logger.fatal('BOT_TOKEN is not set. Exiting.');
  process.exit(1);
}
if (!process.env.CLAUDE_API_KEY) {
  logger.warn('AI_API_KEY not set — /ask will not work');
}
if (!process.env.IFR_LOCK_ADDRESS) {
  logger.warn('IFR_LOCK_ADDRESS not set — /lock will not work');
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Global error handler
bot.catch((err, ctx) => {
  logger.error({ err: err.message, update: ctx.updateType }, 'Unhandled bot error');
  ctx.reply('❌ Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.').catch(() => {});
});

// ── Moderation middleware (group messages) ───────────────────────────────────
bot.use(moderationMiddleware());

// ── Verification gate ────────────────────────────────────────────────────────
bot.on('new_chat_members', onNewMember);
bot.action(/^verify_\d+$/, onVerifyCallback);

// ── Commands ────────────────────────────────────────────────────────────────

bot.command('start', startCommand);
bot.command('help',  startCommand); // /help = gleiche Ausgabe wie /start
bot.command('rules', rulesCommand);

bot.command('lock',       rateLimit('lock'),       lockCommand);
bot.command('burns',      rateLimit('burns'),       burnsCommand);
bot.command('tokenomics', rateLimit('tokenomics'),  tokenomicsCommand);
bot.command('bootstrap',  rateLimit('bootstrap'),   bootstrapCommand);
bot.command('partner',    rateLimit('partner'),     partnerCommand);
bot.command('roadmap',    rateLimit('roadmap'),     roadmapCommand);
bot.command('ask',        rateLimit('ask'),         askCommand);
bot.command('price',      rateLimit('price'),       priceCommand);
bot.command('verify',     rateLimit('verify'),      handleVerify);
bot.command('mystatus',   rateLimit('verify'),      handleMyStatus);

// Admin — Whitelist only (silent ignore für Nicht-Admins)
bot.command('admin',    adminOnly, adminCommand);
bot.command('announce', adminOnly, announceCommand);
bot.command('ban',      adminOnly, banCommand);
bot.command('warn',     adminOnly, warnCommand);
bot.command('pin',      adminOnly, pinCommand);

// ── Channel → Community auto-sync ────────────────────────────────────────────
bot.on('channel_post', async (ctx) => {
  // Ignore posts made by the bot itself to prevent loop
  if (ctx.channelPost.sender_chat) return;
  try {
    const groupId = process.env.TELEGRAM_GROUP_ID;
    const topicId = process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID;
    if (!groupId) return;
    const text = ctx.channelPost.text || ctx.channelPost.caption;
    if (!text) return;
    await ctx.telegram.sendMessage(
      groupId,
      `📡 *Channel Update*\n\n${text}\n\n💬 [Join the community](https://t.me/IFR_token)`,
      {
        parse_mode: 'Markdown',
        message_thread_id: topicId ? parseInt(topicId) : undefined,
        disable_web_page_preview: true
      }
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Channel sync error');
  }
});

// ── Protected Topics — 3-Tier Wallet Verification ────────────────────────────
const PROTECTED_TOPICS = [58, 21, 23, 11]; // Core Dev, Council, Vote, Dev&Builder
const PROTECTED_ADMIN_IDS = process.env.ADMIN_USER_IDS
  ? process.env.ADMIN_USER_IDS.split(',').map(id => parseInt(id.trim()))
  : [579949616];

bot.on('message', async (ctx, next) => {
  try {
    const threadId = ctx.message?.message_thread_id;
    if (!threadId || !PROTECTED_TOPICS.includes(threadId)) return next();
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (PROTECTED_ADMIN_IDS.includes(userId)) return next();
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    if (['creator', 'administrator'].includes(member.status)) return next();

    // 3-Tier check: verified wallet with topic access?
    if (hasTopicAccess(userId, threadId)) return next();

    await ctx.deleteMessage();
    const reason = !isUserVerified(userId)
      ? 'Use /verify to link your wallet first.'
      : 'Your wallet tier does not grant access to this topic.\n\nUse /mystatus to check your access level.';
    try {
      await ctx.telegram.sendMessage(
        userId,
        `🚫 *Access denied*\n\n${reason}\n\n🔐 Verify: https://ifrunit.tech/wiki/verify.html`,
        { parse_mode: 'Markdown', disable_web_page_preview: true }
      );
    } catch (e) { /* user may have blocked DMs */ }
  } catch (err) {
    logger.error({ err: err.message }, 'Protected topic error');
  }
});

// Unbekannte Nachrichten / Commands
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply(
      '❓ Unbekannter Befehl. Tippe /help für alle verfügbaren Commands.'
    );
  }
});

// ── Verify API (Express) ─────────────────────────────────────────────────────
const verifyApp = express();
verifyApp.use(express.json());
verifyApp.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (origin.includes('ifrunit.tech') || origin === '') {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

verifyApp.post('/api/verify', async (req, res) => {
  try {
    const { nonce, signature, wallet } = req.body;
    if (!nonce || !signature || !wallet)
      return res.status(400).json({ success: false, error: 'Missing fields' });

    const nonceData = getNonce(nonce);
    if (!nonceData)
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });

    let recovered;
    try {
      recovered = ethers.utils.verifyMessage(nonce, signature);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    if (recovered.toLowerCase() !== wallet.toLowerCase())
      return res.status(401).json({ success: false, error: 'Signature mismatch' });

    consumeNonce(nonce);

    const tier = await determineTier(recovered);
    setVerified(nonceData.userId, recovered, tier);

    const tierLabel = {
      signer: '🔑 Signer / Core Team', voter: '🗳️ IFR Holder / Voter',
      builder: '🔨 Builder', community: '👤 Community Member'
    }[tier];

    const topicAccess = {
      signer: ['Core Dev', 'Council', 'Vote', 'Dev & Builder'],
      voter: ['Vote'],
      builder: ['Vote', 'Dev & Builder'],
      community: []
    }[tier];

    try {
      await bot.telegram.sendMessage(
        nonceData.userId,
        `✅ *Verification successful!*\n\n` +
        `Wallet: \`${recovered.slice(0, 6)}...${recovered.slice(-4)}\`\n` +
        `Tier: ${tierLabel}\n\n` +
        (topicAccess.length > 0
          ? `*Access granted to:*\n${topicAccess.map(t => '• ' + t).join('\n')}`
          : '_No restricted topic access for this wallet._\n\nLock IFR to gain Vote access.'),
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      logger.warn({ err: e.message }, 'Verify: Telegram DM failed');
    }

    res.json({ success: true, wallet: recovered, tier, access: topicAccess });
  } catch (e) {
    logger.error({ err: e.message }, 'Verify API error');
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

verifyApp.get('/api/verify/status/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.json({ verified: false });
  res.json({ verified: true, wallet: user.wallet, tier: user.tier });
});

const VERIFY_PORT = process.env.VERIFY_PORT || 3006;
verifyApp.listen(VERIFY_PORT, () => logger.info({ port: VERIFY_PORT }, 'Verify API started'));

// ── Launch ──────────────────────────────────────────────────────────────────

// Delayed launch to prevent 409 conflict on Railway restart
setTimeout(() => {
  bot.launch({ dropPendingUpdates: true })
    .then(() => {
      logger.info('🔥 IFR Telegram Bot started successfully');
      logger.info({ env: process.env.NODE_ENV }, 'Environment');
      scheduleDailyReport(bot);
      scheduleDailyWelcome(bot);
      startGovernanceNotifier(bot);
      scheduleBootstrapAnnouncements(bot);
    })
    .catch((err) => {
      logger.fatal({ err: err.message }, 'Failed to start bot');
      process.exit(1);
    });
}, 8000);

// Graceful shutdown
process.once('SIGINT',  () => { logger.info('SIGINT received — stopping bot'); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { logger.info('SIGTERM received — stopping bot'); bot.stop('SIGTERM'); });
