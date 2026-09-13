'use strict';
const logger = require('./logger');
const { isAllowedCommunityLink } = require('./communityLinks');

function checkLinks(text = '', entities = []) {
  const urls = (text.match(/https?:\/\/[^\s]+|t\.me\/[^\s]+/gi) || [])
    .map(url => url.replace(/[.,!;:)\]}]+$/, ''));
  for (const entity of entities) {
    if (entity.type === 'text_link') urls.push(entity.url || 'invalid');
    if (entity.type === 'url') {
      const value = text.slice(entity.offset, entity.offset + entity.length);
      urls.push(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    }
  }
  for (const url of urls) {
    if (!isAllowedCommunityLink(url)) return { hasUnallowed: true, url };
  }
  return { hasUnallowed: false, url: null };
}

function checkMessage(text = '') {
  // Match solicitations, not mentions in questions or safety warnings.
  const patterns = [
    /(?:^|[,;:!?])\s*(?:please\s+)?(?:send|share|enter|submit)\s+(?:me\s+)?(?:your\s+)?(?:seed\s*phrase|private\s*key|mnemonic)\b/im,
    /(?:^|[,;:!?])\s*(?:we\s+(?:offer|promise)\s+)?guaranteed\s+(?:profit|returns?|roi)\b/im,
    /(?:^|[,;:!?])\s*(?:claim|get)\s+(?:your\s+)?free\s+(?:airdrop|eth|btc|tokens?)\b/im,
  ];
  const isSpam = patterns.some(p => p.test(text));
  return { isSpam, reason: isSpam ? 'solicitation' : null };
}

function checkImpersonation(user) {
  const name = `${user?.first_name || ''} ${user?.last_name || ''} ${user?.username || ''}`;
  const normalized = name.replace(/[_-]+/g, ' ');
  return (/\b(ifr|inferno)\b/i.test(normalized) && /\b(admin|support|official)\b/i.test(normalized))
    || /\b(?:(?:ifr|inferno)(?:admin|support|official)|(?:admin|support|official)(?:ifr|inferno))\b/i.test(normalized);
}

function moderationMiddleware({ now = Date.now } = {}) {
  const activity = new Map();
  return async (ctx, next) => {
    const message = ctx.message || ctx.editedMessage;
    if (!message || !['group', 'supergroup'].includes(ctx.chat?.type)) return next();
    if (message.new_chat_members || message.left_chat_member) return next();
    if (message.sender_chat?.id === ctx.chat.id) return next();
    const actor = message.sender_chat ? `channel:${message.sender_chat.id}` : ctx.from?.id;
    if (!actor) return next();
    const key = `${ctx.chat.id}:${actor}`;
    const time = now();
    const recent = (activity.get(key) || []).filter(t => time - t < 10_000);
    recent.push(time);
    // Bounded tracking; no message text, wallet or name is persisted.
    activity.delete(key);
    activity.set(key, recent.slice(-6));
    if (activity.size > 10_000) activity.delete(activity.keys().next().value);
    const text = message.text || message.caption || '';
    const links = checkLinks(text, message.entities || message.caption_entities || []);
    const solicitation = checkMessage(text).isSpam;
    const impersonation = checkImpersonation(ctx.from) && /\b(?:dm|message|contact)\s+me\b/i.test(text);
    const reason = recent.length > 5 ? 'flood' : links.hasUnallowed ? 'unapproved_link' : solicitation ? 'solicitation' : impersonation ? 'staff_impersonation' : null;
    if (!reason) return next();

    // Resolve Telegram roles, never trust display names for admin rights.
    if (!message.sender_chat) {
      try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        if (['creator', 'administrator'].includes(member.status)) return next();
      } catch {
        logger.warn({ reason: 'role_lookup_failed' }, 'Moderation held for role lookup failure');
        return;
      }
    }
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, message.message_id);
      logger.info({ reason }, 'Moderation removed message');
    } catch {
      logger.warn({ reason }, 'Moderation could not remove message');
    }
    // No permanent bans or permission overrides based on heuristic text.
  };
}

module.exports = { checkLinks, checkMessage, checkImpersonation, moderationMiddleware };
