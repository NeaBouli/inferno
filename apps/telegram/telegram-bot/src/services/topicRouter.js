'use strict';

// services/topicRouter.js — Central forum-topic routing for community group posts (T-286)
//
// Every bot-initiated post to the community group (TELEGRAM_GROUP_ID) goes
// through sendToGroup() with a message category. The category maps to a forum
// topic (message_thread_id) that is configurable via env, with defaults that
// match the live community group. Unknown categories fall back to General.
//
// Replies to user commands do NOT use this router: Telegraf's ctx.reply() keeps
// the thread the command was posted in.

const logger = require('./logger');

// category → { env var, default message_thread_id }
const TOPIC_ROUTES = Object.freeze({
  announcements: { env: 'TELEGRAM_ANNOUNCEMENTS_TOPIC_ID', fallback: 1 },
  general:       { env: 'TELEGRAM_GENERAL_TOPIC_ID',       fallback: 5 },
  burns:         { env: 'TELEGRAM_BURNS_TOPIC_ID',         fallback: 7 },
  dev:           { env: 'TELEGRAM_DEV_BUILDER_TOPIC_ID',   fallback: 11 },
  release:       { env: 'TELEGRAM_DEV_BUILDER_TOPIC_ID',   fallback: 11 },
  council:       { env: 'TELEGRAM_COUNCIL_TOPIC_ID',       fallback: 21 },
  governance:    { env: 'TELEGRAM_COUNCIL_TOPIC_ID',       fallback: 21 },
  vote:          { env: 'TELEGRAM_VOTE_TOPIC_ID',          fallback: 23 },
  coredev:       { env: 'TELEGRAM_COREDEV_TOPIC_ID',       fallback: 58 },
});

const DEFAULT_CATEGORY = 'general';

/**
 * Resolve the forum thread id for a message category. A positive integer in
 * the category's env var wins; anything else uses the documented default.
 * Unknown categories resolve to General.
 */
function resolveTopicId(category, env = process.env) {
  const route = TOPIC_ROUTES[category] || TOPIC_ROUTES[DEFAULT_CATEGORY];
  const raw = String(env[route.env] ?? '').trim();
  const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : route.fallback;
}

/**
 * Thread id 1 is the forum's built-in first thread: Telegram rejects an
 * explicit message_thread_id=1, posts without a thread id land there.
 */
function threadOptions(threadId) {
  return Number.isInteger(threadId) && threadId > 1 ? { message_thread_id: threadId } : {};
}

// Telegram reports a deleted/closed/unknown forum topic as a 400 whose
// description mentions the thread or topic (e.g. "message thread not found",
// "TOPIC_CLOSED", "TOPIC_DELETED").
function isTopicError(err) {
  const description = String(err?.response?.description ?? err?.description ?? err?.message ?? '');
  return /thread|topic/i.test(description);
}

// Log-safe error summary: only the Telegram error code/description, never the
// raw error message (transport errors can embed the request URL).
function safeError(err) {
  return {
    code: err?.response?.error_code ?? err?.code ?? null,
    description: err?.response?.description ?? null,
  };
}

/**
 * Send a bot-initiated message to the community group, routed by category.
 * If the target topic rejects the post (deleted/closed), retry once in
 * General and log it. There is no further fallback into the forum's first
 * thread (Main): if General also fails, the error propagates to the caller.
 * Other errors propagate unchanged, so nothing is posted twice.
 */
async function sendToGroup(telegram, chatId, category, text, extra = {}, env = process.env) {
  const targetThread = resolveTopicId(category, env);
  const attempts = [targetThread];
  const generalThread = resolveTopicId(DEFAULT_CATEGORY, env);
  if (generalThread !== targetThread) attempts.push(generalThread);

  for (let i = 0; ; i++) {
    const thread = attempts[i];
    try {
      const opts = { ...extra };
      delete opts.message_thread_id;
      Object.assign(opts, threadOptions(thread));
      return await telegram.sendMessage(chatId, text, opts);
    } catch (err) {
      if (!isTopicError(err) || i === attempts.length - 1) throw err;
      logger.warn(
        { category, threadId: thread, fallbackThreadId: attempts[i + 1], err: safeError(err) },
        'Topic send failed — falling back to General'
      );
    }
  }
}

module.exports = {
  TOPIC_ROUTES,
  DEFAULT_CATEGORY,
  resolveTopicId,
  threadOptions,
  isTopicError,
  sendToGroup,
};
