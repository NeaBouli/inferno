'use strict';

// services/telegramText.js — Outbound text guard for untrusted content (CWA-45)
//
// Generated or external text (AI answers, channel posts) is untrusted: it must
// reach Telegram as plain text — never through Markdown/HTML parsing — and
// within Telegram's message length limit.

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// C0 control characters except \n and \t, plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

/**
 * Coerce untrusted content to a plain-text-safe Telegram body: strip control
 * characters (keeping newlines and tabs) and truncate within maxLength,
 * marking truncation with an ellipsis. Callers must send the result WITHOUT a
 * parse_mode so no markup is interpreted.
 */
function toPlainText(value, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH) {
  const limit = Number.isInteger(maxLength) && maxLength > 0
    ? maxLength
    : TELEGRAM_MAX_MESSAGE_LENGTH;
  const text = String(value ?? '').replace(CONTROL_CHARS, '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

module.exports = { TELEGRAM_MAX_MESSAGE_LENGTH, toPlainText };
