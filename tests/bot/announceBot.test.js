// tests/bot/announceBot.test.js — Telegram Bot Announcement & Language Tests (T01–T10)
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

const BOT_SRC = path.join(__dirname, '../../apps/telegram/telegram-bot/src');

// Helper: read file content
function readSrc(relPath) {
  return fs.readFileSync(path.join(BOT_SRC, relPath), 'utf8');
}

describe('Telegram Bot — Announcements, Sync & Language', function () {

  // ── T01: /announce appends Community link ──────────
  it('T01 — /announce includes community link (t.me/IFR_token)', function () {
    const src = readSrc('commands/announce.js');
    expect(src).to.include('t.me/IFR_token');
    expect(src).to.include('Join the community');
  });

  // ── T02: Community link uses correct URL ──────────
  it('T02 — community link URL is correct', function () {
    const src = readSrc('commands/announce.js');
    expect(src).to.include('https://t.me/IFR_token');
  });

  // ── T03: channel_post triggers Community sync ──────────
  it('T03 — channel_post handler exists in index.js', function () {
    const src = readSrc('index.js');
    expect(src).to.include("channel_post");
    expect(src).to.include('Channel Update');
    expect(src).to.include('sendMessage');
  });

  // ── T04: pinChatMessage called after announce ──────────
  it('T04 — /announce pins message in group', function () {
    const src = readSrc('commands/announce.js');
    expect(src).to.include('pinChatMessage');
    expect(src).to.include('disable_notification');
  });

  // ── T05: pinChatMessage called after channel sync ──────────
  it('T05 — channel sync pins message in community', function () {
    const src = readSrc('index.js');
    // Find channel_post section and verify pin
    const channelSection = src.substring(src.indexOf('channel_post'));
    expect(channelSection).to.include('pinChatMessage');
  });

  // ── T06: Daily welcome uses TELEGRAM_GENERAL_TOPIC_ID ──────────
  it('T06 — daily welcome reads TELEGRAM_GENERAL_TOPIC_ID', function () {
    const src = readSrc('handlers/dailyWelcome.js');
    expect(src).to.include('TELEGRAM_GENERAL_TOPIC_ID');
  });

  // ── T07: Daily burn report uses TELEGRAM_BURNS_TOPIC_ID ──────────
  it('T07 — daily burn report reads TELEGRAM_BURNS_TOPIC_ID', function () {
    const src = readSrc('handlers/dailyReport.js');
    expect(src).to.include('TELEGRAM_BURNS_TOPIC_ID');
  });

  // ── T08: /testwelcome exists and is admin-only ──────────
  it('T08 — /testwelcome command exists with admin guard', function () {
    const src = readSrc('index.js');
    expect(src).to.include("'testwelcome'");
    // Must be registered with adminOnly middleware
    expect(src).to.match(/command\s*\(\s*'testwelcome'\s*,\s*adminOnly/);
  });

  // ── T09: /testburn exists and is admin-only ──────────
  it('T09 — /testburn command exists with admin guard', function () {
    const src = readSrc('index.js');
    expect(src).to.include("'testburn'");
    expect(src).to.match(/command\s*\(\s*'testburn'\s*,\s*adminOnly/);
  });

  // ── T10: No German strings in bot responses ──────────
  it('T10 — no German user-facing strings in bot source files', function () {
    const filesToCheck = [
      'commands/start.js',
      'commands/burns.js',
      'commands/lock.js',
      'commands/ask.js',
      'commands/partner.js',
      'middleware/rateLimit.js',
      'services/skywalker.js',
      'index.js',
    ];

    const germanPatterns = [
      /Willkommen/,
      /Hallo/,
      /Guten Morgen/,
      /Bitte/,
      /Danke/,
      /Fehler beim/,
      /erneut versuchen/,
      /Unbekannter Befehl/,
      /Zu viele Anfragen/,
      /Nutzung:/,
      /Lade Burn/,
      /Prüfe Lock/,
      /denkt nach/,
      /Aktueller Supply/,
      /Verbrannt gesamt/,
      /So funktioniert es/,
      /Partner werden/,
      /offizielle.*Assistent/,
    ];

    for (const file of filesToCheck) {
      const src = readSrc(file);
      for (const pattern of germanPatterns) {
        const match = src.match(pattern);
        expect(match, `German text "${pattern}" found in ${file}`).to.be.null;
      }
    }
  });
});
