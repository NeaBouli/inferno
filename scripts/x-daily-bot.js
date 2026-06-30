#!/usr/bin/env node
'use strict';

/**
 * Generate the scheduled daily X posts for IFR and hand them to post-x.js.
 *
 * Slots:
 *   promo  — 03:00 Europe/Athens, rotating project promotion
 *   status — 10:00 Europe/Athens, live protocol status summary
 *
 * Automatic posts intentionally contain no links.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ATHENS_TZ = 'Europe/Athens';
const COPILOT_API = process.env.IFR_COPILOT_API || 'https://copilot-api.ifrunit.tech';
const MAX_POST_CHARS = 280;

const promoPosts = [
  'Inferno IFR is built around lock-to-access utility: buy once, lock once, use benefits across integrated products. No subscription loop. On-chain access, user-owned commitment.',
  'Inferno IFR is deflationary by design. Standard transfers burn 2.5% permanently and route 1% to the protocol pool. Supply can only go down; there is no mint function.',
  'Inferno IFR launched without presale, VC round, private sale or IDO. The protocol is built around open documentation, verified Mainnet contracts and public transparency.',
  'IFRLock is the simple utility layer: lock IFR, prove access on-chain, unlock premium features across builder products. Wallet-native access without passwords or accounts.',
  'CommitmentVault lets holders make verifiable long-term commitments. Tranches can use time, price, time OR price, or time AND price conditions. The lock is enforced by code.',
  'LendingVault opens a P2P IFR lending market: lenders offer free IFR, borrowers post ETH collateral, and repayments route value back through the protocol.',
  'Inferno IFR gives builders a utility primitive: users lock tokens for access, creators can earn rewards, and integrations can verify status directly on-chain.',
  'The IFR protocol is designed for transparency: live supply, burns, locks, lending offers, safes, governance and contract references are publicly trackable.',
  'Inferno IFR is not a generic ticker story. It is a Mainnet utility protocol with live lock, commitment and lending flows built around long-term use.',
  'Every IFR integration follows the same principle: less recurring friction, more on-chain commitment. Users keep custody, products verify access, the protocol stays transparent.',
];

function athensDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATHENS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    iso: `${values.year}-${values.month}-${values.day}`,
  };
}

function dayOfYearAthens() {
  const { year, month, day } = athensDateParts();
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, month - 1, day);
  return Math.floor((now - start) / 86400000) + 1;
}

function charCount(text) {
  return Array.from(text).length;
}

function shortMillions(value, decimals = 1) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0M';
  return `${(num / 1_000_000).toFixed(decimals)}M`;
}

function shortNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  if (Math.abs(num) >= 1_000_000) return shortMillions(num);
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(Math.round(num));
}

async function fetchJson(endpoint) {
  const res = await fetch(`${COPILOT_API}${endpoint}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${endpoint} failed: ${res.status}`);
  return res.json();
}

async function buildStatusPost() {
  const [supply, lending, commitment] = await Promise.all([
    fetchJson('/api/ifr/supply'),
    fetchJson('/api/lending/stats'),
    fetchJson('/api/commitment/leaderboard'),
  ]);

  const date = athensDateParts().iso;
  const locked = Number(commitment.totalLockedProtocol || 0);
  const lines = [
    `IFR protocol status — ${date}`,
    `Supply: ${shortMillions(supply.totalSupply)} IFR`,
    `Burned: ${shortMillions(supply.burned)} IFR forever`,
    `CommitmentVault: ${shortMillions(locked)} IFR locked`,
    `LendingVault: ${shortMillions(lending.totalAvailable)} IFR available, ${shortNumber(lending.activeLoans)} active loans`,
    'Mainnet contracts live. No mint function.',
  ];
  return lines.join('\n');
}

function buildPromoPost() {
  const index = (dayOfYearAthens() - 1) % promoPosts.length;
  return promoPosts[index];
}

function validatePost(text) {
  const count = charCount(text);
  if (count > MAX_POST_CHARS) {
    throw new Error(`Generated post is ${count} chars; X limit is ${MAX_POST_CHARS}.`);
  }
  if (/https?:\/\//i.test(text)) {
    throw new Error('Generated post contains a link; scheduled posts must be link-free.');
  }
}

function writeTempPost(slot, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ifr-x-${slot}-`));
  const file = path.join(dir, `${slot}.md`);
  fs.writeFileSync(file, text);
  return file;
}

function runPostX(file) {
  const script = path.resolve(__dirname, 'post-x.js');
  const result = spawnSync(process.execPath, [script, file], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

async function main() {
  const slot = process.argv[2] || 'promo';
  if (!['promo', 'status'].includes(slot)) {
    throw new Error('Usage: node scripts/x-daily-bot.js <promo|status>');
  }

  const text = slot === 'status' ? await buildStatusPost() : buildPromoPost();
  validatePost(text);

  console.log(`Generated ${slot} post (${charCount(text)} chars):`);
  console.log(text);

  const file = writeTempPost(slot, text);
  runPostX(file);
}

main().catch(err => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
