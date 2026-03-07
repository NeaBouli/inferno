// handlers/verification.js — New member verification gate
const { Markup } = require('telegraf');
const logger = require('../services/logger');

// pending userId -> { chatId, timeout, messageId }
const pendingVerifications = new Map();
const VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const RULES_TEXT =
  '🔥 *IFR Community Rules*\n\n' +
  '1\\. No spam, advertising or scam links\n' +
  '2\\. Respect all community members\n' +
  '3\\. No price manipulation or FUD\n' +
  '4\\. Only share verified contract addresses\n' +
  '5\\. No unsolicited DMs to other members\n' +
  '6\\. English only in main topics\n' +
  '7\\. Admins have final say\n\n' +
  '⚠️ Violations result in immediate ban\\.\n\n' +
  'Press the button below to verify yourself and gain access to the group\\.';

/**
 * Handle new chat member join.
 * Restricts the user and sends verification prompt.
 */
async function onNewMember(ctx) {
  const newMembers = ctx.message?.new_chat_members;
  if (!newMembers || newMembers.length === 0) return;

  for (const member of newMembers) {
    if (member.is_bot) continue;

    const userId = member.id;
    const chatId = ctx.chat.id;

    // Restrict: cannot send messages until verified
    try {
      await ctx.restrictChatMember(userId, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
      });
    } catch (e) {
      logger.warn({ err: e.message, userId }, 'Could not restrict new member');
    }

    // Send verification message in group with inline button
    try {
      const displayName = member.first_name || 'New member';
      const msg = await ctx.reply(
        `👋 Welcome, ${escapeMarkdownV2(displayName)}\\! Please verify yourself by clicking the button below\\. You have 5 minutes\\.`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            Markup.button.callback('✅ I Accept the Rules', `verify_${userId}`),
          ]),
        }
      );

      // Set timeout for auto-kick
      const timeout = setTimeout(async () => {
        const pending = pendingVerifications.get(userId);
        if (!pending) return;
        pendingVerifications.delete(userId);

        try {
          await ctx.telegram.banChatMember(chatId, userId);
          // Immediately unban so they can rejoin later
          await ctx.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
          logger.info({ userId, chatId }, 'Auto-kicked unverified user after timeout');
        } catch (e) {
          logger.warn({ err: e.message, userId }, 'Could not auto-kick unverified user');
        }

        // Delete the verification prompt
        try {
          await ctx.telegram.deleteMessage(chatId, msg.message_id);
        } catch (e) { /* message may already be deleted */ }
      }, VERIFICATION_TIMEOUT_MS);

      pendingVerifications.set(userId, { chatId, timeout, messageId: msg.message_id });
    } catch (e) {
      logger.warn({ err: e.message, userId }, 'Could not send verification message');
    }
  }
}

/**
 * Handle verification button callback.
 */
async function onVerifyCallback(ctx) {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith('verify_')) return;

  const targetUserId = parseInt(data.replace('verify_', ''), 10);
  const clickerId = ctx.from.id;

  // Only the target user can verify themselves
  if (clickerId !== targetUserId) {
    await ctx.answerCbQuery('⛔ This button is not for you.', { show_alert: true });
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const pending = pendingVerifications.get(targetUserId);

  // Clear timeout
  if (pending) {
    clearTimeout(pending.timeout);
    pendingVerifications.delete(targetUserId);
  }

  // Unrestrict user
  try {
    await ctx.telegram.restrictChatMember(chatId, targetUserId, {
      permissions: {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_send_polls: true,
        can_invite_users: true,
        can_change_info: false,
        can_pin_messages: false,
      },
    });
  } catch (e) {
    logger.warn({ err: e.message, userId: targetUserId }, 'Could not unrestrict user');
  }

  // Delete verification prompt
  try {
    if (pending?.messageId) {
      await ctx.telegram.deleteMessage(chatId, pending.messageId);
    }
  } catch (e) { /* ignore */ }

  await ctx.answerCbQuery('✅ Verified! Welcome to the IFR Community.');

  // Post welcome message in group
  const displayName = ctx.from.first_name || 'Member';
  const welcomeText =
    `🔥 Welcome to the IFR Community, ${escapeMarkdownV2(displayName)}\\!\n\n` +
    `You're now verified\\. Here's what you can do:\n` +
    `🔒 /lock \\<wallet\\> — Check your lock status\n` +
    `🔥 /burns — Current burn stats\n` +
    `💬 /ask \\<question\\> — Ask the AI assistant\n` +
    `📊 /tokenomics — Token distribution\n\n` +
    `Need help? Post in \\#support\n` +
    `Website: https://ifrunit\\.tech`;

  try {
    await ctx.telegram.sendMessage(chatId, welcomeText, { parse_mode: 'MarkdownV2' });
  } catch (e) {
    logger.warn({ err: e.message }, 'Could not send welcome message');
  }
}

function escapeMarkdownV2(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

module.exports = { onNewMember, onVerifyCallback };
