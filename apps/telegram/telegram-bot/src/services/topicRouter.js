'use strict';

// services/topicRouter.js — Central forum-topic routing for community group posts (T-286)
//
// Every bot-initiated post to the community group (TELEGRAM_GROUP_ID) goes
// through sendToGroup() with a message category. The category maps to a forum
// topic (message_thread_id) that is configurable via env. The defaults are the
// IDs from the repo .env.example and the owner relay; only Council (21) and
// Vote (23) are also published as topic links in docs/wiki/dao-governance.html.
// They are NOT verified against the live group — the deployment env may
// override them.
//
// Main-thread policy: thread 1 is the forum's first thread (Main). Only the
// explicit `announcements` category may resolve to it. Every other category,
// including unknown, legacy and inherited Object property names, resolves to
// a thread > 1; a misconfigured ID 1 is rejected with a warning and replaced
// by General (or General's default when General itself is set to 1).
//
// Replies to user commands do NOT use this router: Telegraf's ctx.reply() keeps
// the thread the command was posted in.

const logger = require('./logger');

const MAIN_THREAD_ID = 1;
const MAIN_CATEGORY = 'announcements';
const DEFAULT_CATEGORY = 'general';

function frozenMap(entries) {
  return Object.freeze(Object.assign(Object.create(null), entries));
}

// category → { env var, default message_thread_id }
const TOPIC_ROUTES = frozenMap({
  announcements: { env: 'TELEGRAM_ANNOUNCEMENTS_TOPIC_ID', fallback: MAIN_THREAD_ID },
  general:       { env: 'TELEGRAM_GENERAL_TOPIC_ID',       fallback: 5 },
  burns:         { env: 'TELEGRAM_BURNS_TOPIC_ID',         fallback: 7 },
  dev:           { env: 'TELEGRAM_DEV_BUILDER_TOPIC_ID',   fallback: 11 },
  release:       { env: 'TELEGRAM_DEV_BUILDER_TOPIC_ID',   fallback: 11 },
  council:       { env: 'TELEGRAM_COUNCIL_TOPIC_ID',       fallback: 21 },
  governance:    { env: 'TELEGRAM_COUNCIL_TOPIC_ID',       fallback: 21 },
  vote:          { env: 'TELEGRAM_VOTE_TOPIC_ID',          fallback: 23 },
  coredev:       { env: 'TELEGRAM_COREDEV_TOPIC_ID',       fallback: 58 },
});

// Legacy/alternate names → canonical category. Exact match only. `main` is
// deliberately General: Main (thread 1) is reachable only via `announcements`.
const LEGACY_ALIASES = frozenMap({
  announce: 'announcements',
  announcement: 'announcements',
  main: 'general',
  burn: 'burns',
  devs: 'dev',
  builder: 'dev',
  dev_builder: 'dev',
  'dev-builder': 'dev',
  votes: 'vote',
  proposal: 'vote',
  core_dev: 'coredev',
  'core-dev': 'coredev',
});

/** Canonical category name; own keys only, anything else is General. */
function canonicalCategory(category) {
  if (typeof category !== 'string') return DEFAULT_CATEGORY;
  if (Object.hasOwn(TOPIC_ROUTES, category)) return category;
  if (Object.hasOwn(LEGACY_ALIASES, category)) return LEGACY_ALIASES[category];
  return DEFAULT_CATEGORY;
}

function configuredTopicId(route, env) {
  const raw = String(env[route.env] ?? '').trim();
  const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolve the forum thread id for a message category. A positive integer in
 * the category's env var wins; anything else uses the documented default.
 * Unknown categories resolve to General. Only `announcements` can resolve to
 * thread 1 (Main); a configured 1 elsewhere is rejected and logged.
 */
function resolveTopicId(category, env = process.env) {
  const name = canonicalCategory(category);
  const route = TOPIC_ROUTES[name];
  const configured = configuredTopicId(route, env);
  if (configured === MAIN_THREAD_ID && name !== MAIN_CATEGORY) {
    logger.warn(
      { category: name, envVar: route.env },
      'Topic ID 1 (Main) is not allowed for this category — using General'
    );
    return name === DEFAULT_CATEGORY ? route.fallback : resolveTopicId(DEFAULT_CATEGORY, env);
  }
  return configured ?? route.fallback;
}

/**
 * Thread id 1 is the forum's built-in first thread: Telegram rejects an
 * explicit message_thread_id=1, posts without a thread id land there.
 */
function threadOptions(threadId) {
  return Number.isInteger(threadId) && threadId > 1 ? { message_thread_id: threadId } : {};
}

// Only an explicit Telegram 400 topic rejection is retried. Rate limits,
// 5xx, timeouts/transport errors and other 400s are ambiguous (the post may
// have been delivered) and propagate without a second send.
const TOPIC_REJECTION = /^Bad Request: (message thread not found|TOPIC_CLOSED|TOPIC_DELETED|TOPIC_ID_INVALID)\b/i;

function isTopicError(err) {
  return err?.response?.error_code === 400
    && TOPIC_REJECTION.test(String(err.response.description ?? ''));
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
  LEGACY_ALIASES,
  DEFAULT_CATEGORY,
  MAIN_CATEGORY,
  canonicalCategory,
  resolveTopicId,
  threadOptions,
  isTopicError,
  sendToGroup,
};
