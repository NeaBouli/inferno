'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DRAFT = path.resolve(
  __dirname,
  '../../../../docs/social/telegram-council-exchange-agenda.md'
);

const FORBIDDEN_ATTRIBUTIONS = [
  /proposed by/i,
  /submitted by/i,
  /author\s*:/i,
  /gio mario/i,
  /georgios/i,
  /codex/i,
  /kimi/i,
  /claude/i
];

function validateText(text) {
  if (!text.trim()) throw new Error('Council agenda draft is empty');
  if (text.length > 4096) throw new Error('Council agenda exceeds Telegram 4096-character limit');
  for (const pattern of FORBIDDEN_ATTRIBUTIONS) {
    if (pattern.test(text)) throw new Error(`Council agenda contains proposer attribution: ${pattern}`);
  }
}

function confirmationCode(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

async function publish({ text, env = process.env, fetchImpl = global.fetch }) {
  validateText(text);
  const confirmation = confirmationCode(text);
  const live = env.TELEGRAM_ALLOW_LIVE === 'true';

  if (!live) {
    return { live: false, confirmation, length: text.length };
  }

  const token = env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_GROUP_ID;
  const topicId = Number(env.TELEGRAM_COUNCIL_TOPIC_ID);
  if (!token || !chatId || !Number.isInteger(topicId) || topicId <= 1) {
    throw new Error('BOT_TOKEN, TELEGRAM_GROUP_ID and TELEGRAM_COUNCIL_TOPIC_ID are required');
  }
  if (env.TELEGRAM_POST_CONFIRM !== confirmation) {
    throw new Error(`Exact text confirmation required: TELEGRAM_POST_CONFIRM=${confirmation}`);
  }

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_thread_id: topicId,
      text,
      disable_web_page_preview: true
    })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram rejected Council agenda: ${result.description || response.status}`);
  }
  return {
    live: true,
    confirmation,
    messageId: result.result.message_id,
    topicId
  };
}

async function main() {
  const draftPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DRAFT;
  const text = fs.readFileSync(draftPath, 'utf8').trim();
  const result = await publish({ text });
  if (!result.live) {
    console.log(`DRY RUN: ${result.length} characters; confirmation ${result.confirmation}`);
    return;
  }
  console.log(`Council agenda sent: message ${result.messageId}, topic ${result.topicId}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { confirmationCode, publish, validateText };
