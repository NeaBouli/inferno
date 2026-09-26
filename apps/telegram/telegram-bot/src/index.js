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
const { handleVerify, handleMyStatus, handleUnverify } = require('./commands/verify');
const rulesCommand    = require('./commands/rules');

// Verification System
const express  = require('express');
const { ethers } = require('ethers');
const {
  setVerified, getWallet, isVerified: isUserVerified,
  tierHasTopicAccess, autoRestoreAll, reverifyFromMap
} = require('./services/verificationStore');
const { claimNonce } = require('./services/nonceStore');
const { determineTier } = require('./services/onChainReader');

// Handlers
const { onNewMember, onVerifyCallback } = require('./handlers/verification');
const { scheduleDailyReport } = require('./handlers/dailyReport');
const { scheduleDailyWelcome } = require('./handlers/dailyWelcome');
const { startGovernanceNotifier } = require('./handlers/governanceNotifier');
const { startVoteAnnouncements } = require('./services/voteAnnouncement');
const { scheduleBootstrapAnnouncements } = require('./handlers/bootstrapAnnouncement');
const { startBootstrapListener } = require('./services/bootstrapListener');

// Middleware
const rateLimit  = require('./middleware/rateLimit');
const apiRateLimit = require('./middleware/apiRateLimit');
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
  ctx.reply('❌ An unexpected error occurred. Please try again.').catch(() => {});
});

// ── Moderation middleware (group messages) ───────────────────────────────────
bot.use(moderationMiddleware());

// ── Verification gate ────────────────────────────────────────────────────────
bot.on('new_chat_members', onNewMember);
bot.action(/^verify_\d+$/, onVerifyCallback);

// ── Protected Topics — 3-Tier Wallet Verification ────────────────────────────
// Registered BEFORE the command handlers so a command posted in a protected
// thread passes this gate first and cannot leak protected output (CWA-40).
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

    // Live tier re-derivation at every protected access decision (CWA-44):
    // stored tier metadata is display data, never an authorization source.
    let wallet = isUserVerified(userId) ? getWallet(userId) : null;
    if (!wallet) {
      // Post-restart recovery from the persisted wallet map
      const restored = await reverifyFromMap(userId);
      if (restored) wallet = getWallet(userId);
    }

    let access = false;
    let tierUnavailable = false;
    if (wallet) {
      try {
        const tier = await determineTier(wallet);
        access = tierHasTopicAccess(tier, threadId);
      } catch (e) {
        // Fail closed when the current tier cannot be derived
        tierUnavailable = true;
        logger.warn({ err: e.message, userId }, 'Tier derivation failed — denying protected access');
      }
    }
    if (access) return next();

    await ctx.deleteMessage();
    const reason = !wallet
      ? 'Use /verify to link your wallet first.'
      : tierUnavailable
        ? 'Your wallet tier could not be checked right now. Please try again shortly.'
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
bot.command('unverify',   rateLimit('verify'),      handleUnverify);
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
    const sentMsg = await ctx.telegram.sendMessage(
      groupId,
      `📡 *Channel Update*\n\n${text}\n\n💬 [Join the community](https://t.me/IFR_token)`,
      {
        parse_mode: 'Markdown',
        message_thread_id: topicId ? parseInt(topicId) : undefined,
        disable_web_page_preview: true
      }
    );
    // Auto-pin synced announcement in community
    try {
      await ctx.telegram.pinChatMessage(groupId, sentMsg.message_id, { disable_notification: true });
    } catch (pinErr) {
      logger.warn({ err: pinErr.message }, 'Failed to pin synced channel post');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Channel sync error');
  }
});

// ── Admin test commands ──────────────────────────────────────────────────────
const { sendDailyWelcome } = require('./handlers/dailyWelcome');
const { sendDailyBurnReport } = require('./handlers/dailyReport');

bot.command('testwelcome', adminOnly, async (ctx) => {
  const chatId = process.env.TELEGRAM_GROUP_ID;
  const topicId = process.env.TELEGRAM_GENERAL_TOPIC_ID;
  if (!chatId) return ctx.reply('❌ TELEGRAM_GROUP_ID not set.');
  await sendDailyWelcome(bot, chatId, topicId ? parseInt(topicId, 10) : null);
  await ctx.reply('✅ Daily welcome sent.');
});

bot.command('testburn', adminOnly, async (ctx) => {
  const chatId = process.env.TELEGRAM_GROUP_ID;
  const topicId = process.env.TELEGRAM_BURNS_TOPIC_ID;
  if (!chatId) return ctx.reply('❌ TELEGRAM_GROUP_ID not set.');
  await sendDailyBurnReport(bot, chatId, topicId ? parseInt(topicId, 10) : null);
  await ctx.reply('✅ Burn report sent.');
});

// Unknown commands
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply(
      '❓ Unknown command. Type /help for all available commands.'
    );
  }
});

// ── Verify API (Express) ─────────────────────────────────────────────────────
const verifyApp = express();

// Trusted-proxy policy (CWA-31): production serves this API as
// verify-api.ifrunit.tech behind Traefik (TLS termination on the Hetzner host,
// one proxy hop over the shared Docker network — internal/operations/TODO.md,
// docs/POINTS_BACKEND_MIGRATION.md), so the client IP arrives via
// X-Forwarded-For. Trust only the proxy hop: VERIFY_TRUST_PROXY pins the
// trusted peers (comma-separated proxy-addr entries — IPs, CIDRs or names
// like 'loopback'; default is the Docker network pool the Traefik container
// speaks from). 'none' disables trust for direct exposure. A peer outside the
// trusted list always gets its X-Forwarded-For ignored, so a directly
// connecting attacker cannot spoof req.ip.
const trustProxyEnv = (process.env.VERIFY_TRUST_PROXY || '172.16.0.0/12').trim();
if (!/^(none|off|false)$/i.test(trustProxyEnv)) {
  verifyApp.set('trust proxy', trustProxyEnv.split(',').map((s) => s.trim()).filter(Boolean));
}

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

// Per-IP throttle for the signature endpoint, keyed on req.ip as resolved by
// the trusted-proxy policy above: the real client IP behind Traefik, the raw
// socket peer on direct connections (CWA-31).
const verifyApiLimiter = apiRateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

verifyApp.post('/api/verify', verifyApiLimiter, async (req, res) => {
  try {
    const { nonce, signature, wallet } = req.body;
    if (!nonce || !signature || !wallet)
      return res.status(400).json({ success: false, error: 'Missing fields' });

    // Atomic claim before any await: the nonce is validated and deleted in one
    // synchronous step, so a concurrent replay can never pass this check twice.
    // The nonce stays burned on any downstream failure (fail closed) — the user
    // requests a fresh code via /verify.
    const nonceData = claimNonce(nonce);
    if (!nonceData)
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });

    let recovered;
    try {
      recovered = ethers.verifyMessage(nonce, signature);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    if (recovered.toLowerCase() !== wallet.toLowerCase())
      return res.status(401).json({ success: false, error: 'Signature mismatch' });

    const tier = await determineTier(recovered);
    try {
      // Enforces one-wallet-per-account; throws WALLET_CONFLICT otherwise (CWA-33)
      setVerified(nonceData.userId, recovered, tier);
    } catch (e) {
      if (e.code === 'WALLET_CONFLICT') {
        return res.status(409).json({
          success: false,
          error: 'Wallet already linked to another Telegram account. Run /unverify there first.'
        });
      }
      throw e;
    }

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

const VERIFY_PORT = process.env.VERIFY_PORT || 3006;
verifyApp.listen(VERIFY_PORT, () => logger.info({ port: VERIFY_PORT }, 'Verify API started'));

// ── Launch ──────────────────────────────────────────────────────────────────

// Delayed launch to prevent 409 conflict on restart.
// Telegraf v4 startPolling() runs an infinite loop — bot.launch() NEVER resolves
// while polling. Do NOT use .then() for post-start init; it only fires on shutdown.
setTimeout(() => {
  // Fire-and-forget: polling loop runs indefinitely
  bot.launch().catch((err) => {
    logger.fatal({ err: err.message }, 'Fatal polling error');
    process.exit(1);
  });

  // Allow ~3s for an immediate 409 to surface before initialising services
  setTimeout(() => {
    logger.info({ env: process.env.NODE_ENV }, '🔥 IFR Telegram Bot polling started');
    scheduleDailyReport(bot);
    scheduleDailyWelcome(bot);
    startGovernanceNotifier(bot);
    startVoteAnnouncements(bot);
    scheduleBootstrapAnnouncements(bot);
    startBootstrapListener(bot);
    autoRestoreAll().catch(err => logger.error({ err: err.message }, 'Auto-restore failed'));
  }, 3000);
}, 8000);

// Graceful shutdown
process.once('SIGINT',  () => { logger.info('SIGINT received — stopping bot'); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { logger.info('SIGTERM received — stopping bot'); bot.stop('SIGTERM'); });
