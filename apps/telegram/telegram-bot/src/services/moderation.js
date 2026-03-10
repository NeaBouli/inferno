// services/moderation.js — Spam detection, flood protection, auto-ban
const logger = require('./logger');

// ── Flood tracking ──────────────────────────────────────────────────────────
// userId -> { timestamps: number[], violations: number }
const floodMap = new Map();
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX_MESSAGES = 5;
const BAN_THRESHOLD = 3;

// Clean up stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [uid, entry] of floodMap) {
    if (entry.timestamps.every((t) => t < cutoff)) floodMap.delete(uid);
  }
}, 300_000);

// ── Scam patterns ───────────────────────────────────────────────────────────
const SCAM_PATTERNS = [
  /free\s+(airdrop|giveaway|eth|btc|token)/i,
  /connect\s+your\s+wallet/i,
  /claim\s+your\s+(reward|token|nft)/i,
  /validate\s+your\s+wallet/i,
  /dextools\.io|poocoin\.app|honeypot/i,
  /t\.me\/(?!IFR)\S{15,}/i, // suspicious long telegram links (not our group)
  /bit\.ly|tinyurl|is\.gd|shorturl/i,
  /seed\s*phrase|private\s*key|mnemonic/i,
  /send\s+\d+\s*eth/i,
  /guaranteed\s+(profit|return|roi)/i,
];

const LINK_REGEX = /https?:\/\/\S+|t\.me\/\S+|@\w{5,}/i;

// ── Anti-impersonation ──────────────────────────────────────────────────────
const IMPERSONATION_PATTERNS = [
  /\bifr\b/i,
  /\binferno\b/i,
  /\badmin\b/i,
  /\bofficial\b/i,
];

// ── Link whitelist ──────────────────────────────────────────────────────────
const ALLOWED_DOMAINS = [
  'ifrunit.tech',
  'etherscan.io',
  'github.com/NeaBouli',
  't.me/IFRtoken',
  't.me/IFR_token',
];

const URL_EXTRACT_REGEX = /https?:\/\/[^\s]+|t\.me\/[^\s]+/gi;

// ── Wallet scanner ──────────────────────────────────────────────────────────
const ETH_ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;
const KNOWN_ADDRESSES = [
  (process.env.IFR_TOKEN_ADDRESS || '').toLowerCase(),
  (process.env.IFR_LOCK_ADDRESS || '').toLowerCase(),
  (process.env.GOVERNANCE_ADDRESS || '').toLowerCase(),
].filter(Boolean);

/**
 * Check if a display name impersonates IFR staff.
 */
function checkImpersonation(user) {
  if (!user) return false;
  const name = `${user.first_name || ''} ${user.last_name || ''} ${user.username || ''}`;
  return IMPERSONATION_PATTERNS.some((p) => p.test(name));
}

/**
 * Check if message contains only whitelisted links.
 * Returns { hasUnallowed: boolean, url: string | null }
 */
function checkLinks(text) {
  if (!text) return { hasUnallowed: false, url: null };
  const urls = text.match(URL_EXTRACT_REGEX);
  if (!urls) return { hasUnallowed: false, url: null };

  for (const url of urls) {
    const allowed = ALLOWED_DOMAINS.some((d) => url.includes(d));
    if (!allowed) return { hasUnallowed: true, url };
  }
  return { hasUnallowed: false, url: null };
}

/**
 * Check if message contains fake contract addresses.
 * Returns { hasFake: boolean, address: string | null }
 */
function checkFakeAddresses(text) {
  if (!text) return { hasFake: false, address: null };
  const addresses = text.match(ETH_ADDRESS_REGEX);
  if (!addresses) return { hasFake: false, address: null };

  for (const addr of addresses) {
    const lower = addr.toLowerCase();
    if (!KNOWN_ADDRESSES.includes(lower)) {
      return { hasFake: true, address: addr };
    }
  }
  return { hasFake: false, address: null };
}

/**
 * Check if a message is spam/scam.
 * Returns { isSpam: boolean, reason: string | null }
 */
function checkMessage(text) {
  if (!text) return { isSpam: false, reason: null };

  for (const pattern of SCAM_PATTERNS) {
    if (pattern.test(text)) {
      return { isSpam: true, reason: 'scam pattern' };
    }
  }

  return { isSpam: false, reason: null };
}

/**
 * Check flood rate for a user.
 * Returns { isFlooding: boolean }
 */
function checkFlood(userId) {
  const now = Date.now();
  let entry = floodMap.get(userId);
  if (!entry) {
    entry = { timestamps: [], violations: 0 };
    floodMap.set(userId, entry);
  }

  // Remove timestamps outside window
  entry.timestamps = entry.timestamps.filter((t) => now - t < FLOOD_WINDOW_MS);
  entry.timestamps.push(now);

  if (entry.timestamps.length > FLOOD_MAX_MESSAGES) {
    entry.violations++;
    return { isFlooding: true, violations: entry.violations };
  }

  return { isFlooding: false, violations: entry.violations };
}

/**
 * Check if a message contains links (for non-verified users).
 */
function hasLinks(text) {
  return text ? LINK_REGEX.test(text) : false;
}

/**
 * Should the user be banned? (3+ violations)
 */
function shouldBan(userId) {
  const entry = floodMap.get(userId);
  return entry && entry.violations >= BAN_THRESHOLD;
}

/**
 * Reset violations for a user (e.g. after manual unban).
 */
function resetViolations(userId) {
  floodMap.delete(userId);
}

/**
 * Telegraf middleware: auto-delete spam + ban repeat offenders.
 * Only runs on group text messages.
 */
function moderationMiddleware() {
  return async (ctx, next) => {
    // Only moderate group messages with text
    if (!ctx.message || !ctx.message.text) return next();
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return next();

    const userId = ctx.from.id;
    const text = ctx.message.text;

    // Skip commands
    if (text.startsWith('/')) return next();

    // 0a. Anti-impersonation (check display name)
    if (checkImpersonation(ctx.from)) {
      logger.warn({ userId, name: ctx.from.first_name }, 'Impersonation detected');
      try {
        await ctx.restrictChatMember(userId, {
          permissions: { can_send_messages: false },
        });
        const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);
        for (const aid of adminIds) {
          await ctx.telegram.sendMessage(
            parseInt(aid),
            `⚠️ Impersonation detected: user ${userId} (${ctx.from.first_name}) restricted in ${ctx.chat.title}`
          ).catch(() => {});
        }
      } catch (e) {
        logger.debug({ err: e.message }, 'Could not restrict impersonator');
      }
      return;
    }

    // 0b. Link whitelist
    const linkCheck = checkLinks(text);
    if (linkCheck.hasUnallowed) {
      logger.warn({ userId, url: linkCheck.url }, 'Unallowed link deleted');
      await safeDelete(ctx);
      return;
    }

    // 0c. Fake address scanner
    const addrCheck = checkFakeAddresses(text);
    if (addrCheck.hasFake) {
      logger.warn({ userId, address: addrCheck.address }, 'Fake address deleted');
      await safeDelete(ctx);
      await ctx.reply('⚠️ Unknown contract address detected. Only share verified IFR addresses.').catch(() => {});
      return;
    }

    // 1. Scam check
    const spam = checkMessage(text);
    if (spam.isSpam) {
      logger.warn({ userId, reason: spam.reason, text: text.slice(0, 100) }, 'Spam detected');
      await safeDelete(ctx);
      const flood = checkFlood(userId); // count as violation
      flood.violations++; // extra penalty for scam
      if (shouldBan(userId)) {
        await safeBan(ctx, userId);
      }
      return;
    }

    // 2. Flood check
    const flood = checkFlood(userId);
    if (flood.isFlooding) {
      logger.warn({ userId, violations: flood.violations }, 'Flood detected');
      await safeDelete(ctx);
      if (shouldBan(userId)) {
        await safeBan(ctx, userId);
      }
      return;
    }

    return next();
  };
}

async function safeDelete(ctx) {
  try {
    await ctx.deleteMessage();
  } catch (e) {
    logger.debug({ err: e.message }, 'Could not delete message');
  }
}

async function safeBan(ctx, userId) {
  try {
    await ctx.banChatMember(userId);
    logger.info({ userId, chatId: ctx.chat.id }, 'User banned for repeated violations');
  } catch (e) {
    logger.warn({ err: e.message, userId }, 'Could not ban user');
  }
}

module.exports = {
  checkMessage,
  checkFlood,
  hasLinks,
  shouldBan,
  resetViolations,
  checkImpersonation,
  checkLinks,
  checkFakeAddresses,
  moderationMiddleware,
};
