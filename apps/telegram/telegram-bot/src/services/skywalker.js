// services/skywalker.js — AI API Wrapper for /ask
require('dotenv').config();
const axios = require('axios');
const cache = require('./cache');
const logger = require('./logger');

const SYSTEM_PROMPT = `You are the official assistant for the Inferno ($IFR) Protocol on Ethereum.
Answer ONLY questions about IFR and the Inferno Protocol. Politely decline all other requests.

DISCLAIMER (add to every first response to a new user):
⚠️ AI assistant — responses may not be 100% accurate. Never share wallet addresses or private keys.
💛 Ali runs on donated infrastructure. Support via ETH/IFR: 0xA0860f872a9cAB34817D9a764e71ab43B942b275

IFR KNOWLEDGE:
- Token: Inferno ($IFR), deflationary ERC-20 on Ethereum Mainnet
- Supply: 1,000,000,000 IFR (1 billion), no mint function — fixed forever
- Burn: 3.5% per transfer (2% sender burn, 0.5% recipient burn, 1% pool fee)
- Decimals: 9
- Contract: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- Lock Mechanism: Lock IFR in the IFRLock contract = access to partner apps. Tokens remain your property. Unlockable at any time.
- Fair Launch: No presale, no VC funding, no team allocation at launch. Community-driven.
- Team Tokens: 4-year vesting, 12-month cliff
- Distribution: 40% LP, 20% LiqRes, 15% Team, 10% Bootstrap, 8% Buyback, 6% Community, 4% Partner
- Website: https://ifrunit.tech
- Repo: github.com/NeaBouli/inferno
- X/Twitter: @IFRtoken

IMPORTANT:
- No financial advice, no price predictions
- Answer in the same language as the question (English or German)
- Max 3 concise sentences
- If unsure, refer to https://ifrunit.tech or /help`;

// Rate limit tracking (in-memory per user)
const userAskCounts = new Map(); // userId -> { count, resetAt }
let globalAskCount = 0;
let globalResetAt = Date.now() + 3600000;

function checkRateLimit(userId) {
  const now = Date.now();
  const hourlyLimit = parseInt(process.env.ASK_LIMIT_PER_HOUR || '3');
  const globalLimit = parseInt(process.env.ASK_GLOBAL_PER_HOUR || '50');

  // Global reset
  if (now > globalResetAt) {
    globalAskCount = 0;
    globalResetAt = now + 3600000;
  }

  if (globalAskCount >= globalLimit) {
    return { allowed: false, reason: 'global', waitMin: Math.ceil((globalResetAt - now) / 60000) };
  }

  // Per-user reset
  const userData = userAskCounts.get(userId) || { count: 0, resetAt: now + 3600000 };
  if (now > userData.resetAt) {
    userData.count = 0;
    userData.resetAt = now + 3600000;
  }

  if (userData.count >= hourlyLimit) {
    return { allowed: false, reason: 'user', waitMin: Math.ceil((userData.resetAt - now) / 60000) };
  }

  // Allow — increment
  userData.count++;
  userAskCounts.set(userId, userData);
  globalAskCount++;

  return { allowed: true };
}

async function askSkywalker(userId, question) {
  // Rate limit check
  const limit = checkRateLimit(userId);
  if (!limit.allowed) {
    if (limit.reason === 'user') {
      return `⏳ You've reached your hourly limit for /ask.\nPlease wait ${limit.waitMin} minutes.\n\nYou can also check https://ifrunit.tech/wiki/faq.html directly.`;
    }
    return `⏳ Bot limit reached. Please try again in ${limit.waitMin} minutes.`;
  }

  // Input sanitation
  const sanitized = question.trim().substring(0, 500);
  if (!sanitized) return '❓ Please ask a question after /ask.';

  try {
    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: sanitized }],
      },
      {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return data.content[0].text;
  } catch (err) {
    logger.error({ err: err.message }, 'AI API error');
    return '❌ Copilot unavailable. Please try again later or check the FAQ:\nhttps://ifrunit.tech/wiki/faq.html';
  }
}

module.exports = { askSkywalker };
