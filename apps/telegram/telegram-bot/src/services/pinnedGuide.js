'use strict';

// One-time pinned guides in the community group. A guide is posted and pinned in
// General once; a marker file in the persistent data dir records it, so restarts
// and releases never repost. Without a writable marker dir nothing is posted, so a
// missing volume can never turn into a repost on every restart.

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { sendToGroup } = require('./topicRouter');

const DEFAULT_MARKER_PATH = '/data/verify/pinned-guides.json';

const VERIFY_GUIDE_ID = 'verify-guide-v1';
const VERIFY_GUIDE_TEXT = [
  '🔐 Unlock Core Dev / Council access: wallet verification',
  '',
  'One-time, about 3 minutes, free. Treasury Safe signers and Council members unlock the Core Dev and Council topics by proving wallet ownership once. This is not a vote and not a transaction: you only sign a short code, nothing goes on-chain, no gas.',
  '',
  'Steps',
  '1. Tap the IFR bot in this group, then "Send message". Use the private chat only.',
  '2. Send /verify. The bot replies with a code (IFR-...), valid for 10 minutes, usable once.',
  '3. On a computer, open in Chrome with MetaMask: https://ifrunit.tech/wiki/verify.html',
  '4. Click "Connect Wallet" (top right) and choose your signer or Council wallet.',
  '5. Tap "Signer", paste the code, click "Continue", then "Sign & Verify".',
  '6. In MetaMask, sign the message. It must contain only your IFR-... code.',
  '7. Check with /mystatus in the bot chat: it should show Core Dev + Council.',
  '',
  'Troubleshooting',
  '- "Invalid or expired code": send /verify again and use the new code.',
  '- "Already verified": you are done.',
  '- Connect button does nothing: unlock MetaMask, approve any pending request in the MetaMask icon, reload with Cmd/Ctrl + Shift + R.',
  '',
  '⚠️ Security rules',
  '- Only sign a code you requested yourself with /verify in your own Telegram. Signing someone else\'s code gives their account your access.',
  '- Never sign a code that someone sends you, even if it seems to come from the team or support.',
  '- If your wallet shows an amount, a gas fee or "Approve", reject it.',
  '- Nobody from the project will ever ask for your seed phrase or private key.',
  '- Every new Signer/Council link is announced automatically in Core Dev.',
].join('\n');

function readMarker(markerPath) {
  try {
    const data = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * Post and pin a guide once. Returns 'posted', 'already-posted' or 'skipped'.
 * Never throws: failures are logged and leave the marker unchanged.
 */
async function ensurePinnedGuide(telegram, {
  chatId = process.env.TELEGRAM_GROUP_ID,
  markerPath = process.env.PINNED_GUIDES_PATH || DEFAULT_MARKER_PATH,
  id = VERIFY_GUIDE_ID,
  text = VERIFY_GUIDE_TEXT,
  send = sendToGroup,
} = {}) {
  try {
    if (!chatId) {
      logger.warn({ guide: id }, 'Pinned guide skipped; TELEGRAM_GROUP_ID not set');
      return 'skipped';
    }
    const dir = path.dirname(markerPath);
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      logger.warn({ guide: id }, 'Pinned guide skipped; marker directory not writable');
      return 'skipped';
    }
    const marker = readMarker(markerPath);
    if (marker[id]) return 'already-posted';

    // Plain text (no parse_mode): the guide is sent verbatim.
    const sent = await send(telegram, chatId, 'general', text, { disable_web_page_preview: true });
    let pinned = false;
    try {
      await telegram.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
      pinned = true;
    } catch (e) {
      logger.warn({ guide: id, code: e?.response?.error_code ?? null }, 'Pinned guide posted but pin failed');
    }
    marker[id] = { messageId: sent.message_id, pinned, postedAt: new Date().toISOString() };
    fs.writeFileSync(markerPath, JSON.stringify(marker), { encoding: 'utf8', mode: 0o600 });
    logger.info({ guide: id, pinned }, 'Pinned guide posted');
    return 'posted';
  } catch (e) {
    logger.warn({ guide: id, code: e?.response?.error_code ?? e?.code ?? null }, 'Pinned guide failed');
    return 'skipped';
  }
}

module.exports = { ensurePinnedGuide, VERIFY_GUIDE_ID, VERIFY_GUIDE_TEXT, DEFAULT_MARKER_PATH };
