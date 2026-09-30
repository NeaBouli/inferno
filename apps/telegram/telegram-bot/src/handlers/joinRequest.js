// handlers/joinRequest.js — auto-approve join requests for the community group
//
// When the group requires admin approval ("Approve new members"), Telegram
// holds each join as a chat_join_request and the user never reaches the
// new_chat_members verification gate. The bot approves requests for the
// configured community group so the existing gate (restrict + accept rules
// within 5 minutes, else removal) stays the single anti-spam control.
const logger = require('../services/logger');

function communityGroupId() {
  const raw = (process.env.TELEGRAM_GROUP_ID || '').trim();
  return /^-?\d+$/.test(raw) ? raw : null;
}

async function onJoinRequest(ctx) {
  const request = ctx.chatJoinRequest;
  if (!request) return;
  const chatId = String(request.chat.id);
  const user = request.from || {};
  const groupId = communityGroupId();

  // Fail closed: without a configured community group nothing is approved.
  if (!groupId || chatId !== groupId) {
    logger.warn({ chatId, userId: user.id }, 'Join request for an unconfigured chat left for admins');
    return;
  }
  try {
    if (user.is_bot) {
      await ctx.telegram.declineChatJoinRequest(chatId, user.id);
      logger.info({ chatId, userId: user.id }, 'Declined join request from a bot account');
      return;
    }
    await ctx.telegram.approveChatJoinRequest(chatId, user.id);
    logger.info({ chatId, userId: user.id }, 'Approved join request; verification gate follows');
  } catch (err) {
    // Typical causes: bot lacks "Add members/Invite users" admin right, or the
    // request was already handled by an admin.
    logger.warn({ err: err.message, chatId, userId: user.id }, 'Could not handle join request');
  }
}

// Update types the bot consumes. Passed explicitly to launch() so Telegram
// never falls back to a stale allowed_updates setting that omits join requests.
const ALLOWED_UPDATES = ['message', 'callback_query', 'channel_post', 'chat_join_request'];

module.exports = { onJoinRequest, ALLOWED_UPDATES };
