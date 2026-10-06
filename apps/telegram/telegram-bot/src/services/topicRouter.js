'use strict';

// services/topicRouter.js — Central forum-topic routing for community group posts (T-286, T-286b)
//
// Every bot-initiated post to the community group (TELEGRAM_GROUP_ID) goes
// through sendToGroup() with a message category. The category maps to a forum
// topic (message_thread_id).
//
// T-286b: the effective routing is fixed in code. The topic IDs below were
// confirmed by the owner on 2026-10-06 (links t.me/IFR_token/<id>). The
// production env is not readable, so env cannot change where a post lands:
// an env value is accepted only if it equals the category's own confirmed ID.
// Any other value (including another category's confirmed ID) is ignored, the
// constant is used, and a warning names the env variable — never the value.
//
// Main-thread policy: thread 1 is the forum's first thread (Main). Only the
// explicit `announcements` category may ever resolve to it, and today none
// does (Announcements is unconfirmed and routes to General). Every other
// category, including unknown, legacy and inherited Object property names,
// resolves to a thread > 1.
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

/** Date the owner confirmed the live topic IDs below. */
const TOPICS_CONFIRMED_ON = '2026-10-06';

// Live topic IDs confirmed by the owner on 2026-10-06 (t.me/IFR_token/<id>).
const CONFIRMED_TOPIC_IDS = frozenMap({
  general: 5,   // General
  dev: 11,      // Dev/Builder
  council: 21,  // Council
  vote: 23,     // Vote
  coredev: 58,  // CoreDev (admins are in the core team)
  roadmap: 13,  // Roadmap
  locks: 9,     // Locks & Assets
});

// Confirmed topics the bot has no posts for yet. They are documented here but
// are NOT routable: a post with one of these categories goes to General until
// a sender and a route are added deliberately.
const RESERVED_TOPICS = frozenMap({
  roadmap: CONFIRMED_TOPIC_IDS.roadmap,
  locks: CONFIRMED_TOPIC_IDS.locks,
});

// TODO(T-286b): Announcements (assumed 1) and Burns (assumed 7) are NOT
// confirmed by the owner. Until they are, both route to General. Once
// confirmed, set the confirmed ID here (and in CONFIRMED_TOPIC_IDS), update
// the tests in test/topic-routing.test.js, .env.example and the README.
const UNCONFIRMED_ANNOUNCEMENTS_TOPIC_ID = CONFIRMED_TOPIC_IDS.general;
const UNCONFIRMED_BURNS_TOPIC_ID = CONFIRMED_TOPIC_IDS.general;

// category → { env var, fixed message_thread_id }
const TOPIC_ROUTES = frozenMap({
  announcements: { env: 'TELEGRAM_ANNOUNCEMENTS_TOPIC_ID', id: UNCONFIRMED_ANNOUNCEMENTS_TOPIC_ID },
  general:       { env: 'TELEGRAM_GENERAL_TOPIC_ID',       id: CONFIRMED_TOPIC_IDS.general },
  burns:         { env: 'TELEGRAM_BURNS_TOPIC_ID',         id: UNCONFIRMED_BURNS_TOPIC_ID },
  dev:           { env: 'TELEGRAM_DEV_BUILDER_TOPIC_ID',   id: CONFIRMED_TOPIC_IDS.dev },
  release:       { env: 'TELEGRAM_DEV_BUILDER_TOPIC_ID',   id: CONFIRMED_TOPIC_IDS.dev },
  council:       { env: 'TELEGRAM_COUNCIL_TOPIC_ID',       id: CONFIRMED_TOPIC_IDS.council },
  governance:    { env: 'TELEGRAM_COUNCIL_TOPIC_ID',       id: CONFIRMED_TOPIC_IDS.council },
  vote:          { env: 'TELEGRAM_VOTE_TOPIC_ID',          id: CONFIRMED_TOPIC_IDS.vote },
  coredev:       { env: 'TELEGRAM_COREDEV_TOPIC_ID',       id: CONFIRMED_TOPIC_IDS.coredev },
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

/**
 * Check the category's env override against its own fixed ID. Unset or empty
 * is silent; anything else that differs (invalid, another category's ID, 1)
 * is ignored with a warning that names the variable, never the value.
 */
function checkEnvOverride(name, route, env) {
  const raw = String(env[route.env] ?? '').trim();
  if (raw === '' || raw === String(route.id)) return;
  logger.warn(
    { category: name, envVar: route.env },
    'Topic env override does not match the confirmed topic ID; ignored, using the fixed constant'
  );
}

/**
 * Resolve the forum thread id for a message category. The result is always
 * the fixed constant of the category (unknown categories: General). Env is
 * only checked for drift. Only `announcements` may ever resolve to thread 1.
 */
function resolveTopicId(category, env = process.env) {
  const name = canonicalCategory(category);
  const route = TOPIC_ROUTES[name];
  checkEnvOverride(name, route, env);
  if (route.id === MAIN_THREAD_ID && name !== MAIN_CATEGORY) {
    return TOPIC_ROUTES[DEFAULT_CATEGORY].id;
  }
  return route.id;
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
  TOPICS_CONFIRMED_ON,
  CONFIRMED_TOPIC_IDS,
  RESERVED_TOPICS,
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
