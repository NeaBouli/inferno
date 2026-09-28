'use strict';

// handlers/channelSync.js — Channel → Community auto-sync (CWA-45)
//
// Only posts from the explicitly configured official channel are reposted and
// auto-pinned in the community group. Unknown, forwarded/relayed or
// metadata-less sources fail closed: nothing is sent and nothing is pinned.

const logger = require('../services/logger');
const { toPlainText, TELEGRAM_MAX_MESSAGE_LENGTH } = require('../services/telegramText');

/**
 * Decide whether a channel_post update comes from the configured trusted
 * source chat. channelRef is TELEGRAM_CHANNEL_ID: either the numeric chat id
 * or the public @username of the official channel. Forwarded/relayed posts and
 * posts sent on behalf of a foreign chat are never trusted.
 */
function isTrustedChannelPost(post, channelRef) {
  const ref = String(channelRef ?? '').trim();
  if (!ref || !post || !post.chat || post.chat.id === undefined) return false;

  // Forwarded or relayed content is never the trusted source path.
  if (post.is_automatic_forward) return false;
  if (post.forward_origin || post.forward_from || post.forward_from_chat) return false;

  // Posts signed by the channel itself carry sender_chat == chat; anything
  // posted on behalf of a different chat is not the trusted source.
  if (post.sender_chat && String(post.sender_chat.id) !== String(post.chat.id)) return false;

  if (ref.startsWith('@')) {
    const username = (post.chat.username || '').toLowerCase();
    return username !== '' && username === ref.slice(1).toLowerCase();
  }
  return String(post.chat.id) === ref;
}

const HEADER = '📡 Channel Update\n\n';
const FOOTER = '\n\n💬 Join the community: https://t.me/IFR_token';

async function handleChannelPost(ctx) {
  try {
    const channelRef = process.env.TELEGRAM_CHANNEL_ID;
    const groupId = process.env.TELEGRAM_GROUP_ID;
    const topicId = process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID;
    // Fail closed: without an explicitly configured trusted source and target
    // group the sync (and with it the auto-pin) stays disabled.
    if (!channelRef || !groupId) return;

    const post = ctx.channelPost;
    if (!isTrustedChannelPost(post, channelRef)) return;

    const text = post.text || post.caption;
    if (!text) return;

    // Channel content is untrusted: repost as plain text (no parse_mode) with
    // Telegram's length limit enforced.
    const body = toPlainText(text, TELEGRAM_MAX_MESSAGE_LENGTH - HEADER.length - FOOTER.length);
    const sentMsg = await ctx.telegram.sendMessage(
      groupId,
      `${HEADER}${body}${FOOTER}`,
      {
        message_thread_id: topicId ? parseInt(topicId, 10) : undefined,
        disable_web_page_preview: true
      }
    );

    // Auto-pin only after the trusted repost above succeeded.
    try {
      await ctx.telegram.pinChatMessage(groupId, sentMsg.message_id, { disable_notification: true });
    } catch (pinErr) {
      logger.warn({ err: pinErr.message }, 'Failed to pin synced channel post');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Channel sync error');
  }
}

module.exports = { handleChannelPost, isTrustedChannelPost };
