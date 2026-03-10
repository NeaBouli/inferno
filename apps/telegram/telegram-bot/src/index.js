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
const rulesCommand    = require('./commands/rules');

// Handlers
const { onNewMember, onVerifyCallback } = require('./handlers/verification');
const { scheduleDailyReport } = require('./handlers/dailyReport');

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

// Admin — Whitelist only (silent ignore für Nicht-Admins)
bot.command('admin', adminOnly, adminCommand);

// Unbekannte Nachrichten / Commands
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply(
      '❓ Unbekannter Befehl. Tippe /help für alle verfügbaren Commands.'
    );
  }
});

// ── Launch ──────────────────────────────────────────────────────────────────

bot.launch()
  .then(() => {
    logger.info('🔥 IFR Telegram Bot started successfully');
    logger.info({ env: process.env.NODE_ENV }, 'Environment');
    scheduleDailyReport(bot);
  })
  .catch((err) => {
    logger.fatal({ err: err.message }, 'Failed to start bot');
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT',  () => { logger.info('SIGINT received — stopping bot'); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { logger.info('SIGTERM received — stopping bot'); bot.stop('SIGTERM'); });
