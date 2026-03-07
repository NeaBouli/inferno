// services/claude.js — Claude API Wrapper für /ask
require('dotenv').config();
const axios = require('axios');
const cache = require('./cache');
const logger = require('./logger');

const SYSTEM_PROMPT = `Du bist der offizielle Assistent des Inferno ($IFR) Protokolls auf Ethereum.
Beantworte AUSSCHLIESSLICH Fragen zu IFR und dem Inferno-Protokoll. Lehne alle anderen Anfragen höflich ab.

WISSEN ÜBER IFR:
- Token: Inferno ($IFR), deflationary ERC-20 auf Ethereum Mainnet
- Supply: 1.000.000.000 IFR (1 Milliarde), kein Mint möglich — fixiert
- Burn: 3.5% pro Transfer (2% vom Sender verbrannt, 0.5% vom Empfänger verbrannt, 1% Pool Fee)
- Decimals: 9
- Contract: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- Lock-Mechanismus: IFR in IFRLock Contract sperren = Zugang zu Partner-Apps. Tokens bleiben Eigentum des Nutzers. Jederzeit entsperrbar.
- Fair Launch: Kein Presale, kein VC-Kapital, kein Team-Kapital. Community-driven.
- Team-Tokens: 4 Jahre vesting, 12 Monate Cliff
- Verteilung: 40% LP, 20% LiqRes, 15% Team, 10% Bootstrap, 8% Buyback, 6% Community, 4% Partner
- Website: https://ifrunit.tech
- Repo: github.com/NeaBouli/inferno
- X/Twitter: @IFRtoken

WICHTIG:
- Kein Finanzrat, keine Preisprognosen
- Antworte auf Deutsch oder Englisch (je nach Sprache der Frage)
- Max. 3 präzise Sätze
- Wenn du etwas nicht weißt, verweise auf https://ifrunit.tech oder /help`;

// Rate limit tracking (in-memory pro User)
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

async function askClaude(userId, question) {
  // Rate limit check
  const limit = checkRateLimit(userId);
  if (!limit.allowed) {
    if (limit.reason === 'user') {
      return `⏳ Du hast dein stündliches Limit für /ask erreicht.\nNoch ${limit.waitMin} Minuten warten.\n\nDu kannst auch direkt auf https://ifrunit.tech/wiki/faq.html nachschauen.`;
    }
    return `⏳ Bot-Limit erreicht. Bitte in ${limit.waitMin} Minuten erneut versuchen.`;
  }

  // Input sanitation
  const sanitized = question.trim().substring(0, 500);
  if (!sanitized) return '❓ Bitte stelle eine Frage nach /ask.';

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
    logger.error({ err: err.message }, 'Claude API error');
    return '❌ Copilot gerade nicht erreichbar. Bitte versuche es später erneut oder schau in die FAQ:\nhttps://ifrunit.tech/wiki/faq.html';
  }
}

module.exports = { askClaude };
