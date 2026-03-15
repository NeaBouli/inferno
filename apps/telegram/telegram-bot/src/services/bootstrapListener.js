// services/bootstrapListener.js — On-chain Bootstrap contribution alerts
// Polls BootstrapVaultV3 every 60s for new contributions → posts to Telegram
'use strict';

const { ethers } = require('ethers');
const logger = require('./logger');

const BOOTSTRAP_VAULT = '0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141';
const BOOTSTRAP_START = new Date('2026-03-07T00:00:00Z').getTime();
const BOOTSTRAP_END   = new Date('2026-06-05T00:00:00Z').getTime();

const ABI = [
  'function totalETHRaised() view returns (uint256)',
  'function contributorCount() view returns (uint256)',
  'function ifrAllocation() view returns (uint256)',
  'event Contributed(address indexed contributor, uint256 ethAmount, uint256 totalETH)'
];

// State
let lastTotalETH = null;
let lastContributors = 0;
let pollTimer = null;

// Cooldown: max 1 notification per 5 minutes
let lastNotifyTs = 0;
const COOLDOWN_MS = 5 * 60 * 1000;

function getRpcUrl() {
  return process.env.ALCHEMY_RPC_URL || process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com';
}

function fmtETH(bn) {
  return parseFloat(ethers.utils.formatEther(bn)).toFixed(4);
}

function fmtIFR(bn) {
  var n = parseFloat(ethers.utils.formatUnits(bn, 9));
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

async function sendAlert(bot, diffETH, totalETH, contributors, ifrAlloc) {
  var now = Date.now();
  if (now - lastNotifyTs < COOLDOWN_MS) {
    logger.debug('Bootstrap alert cooldown active — skipping');
    return;
  }
  lastNotifyTs = now;

  var ethStr = fmtETH(diffETH);
  var totalStr = fmtETH(totalETH);

  // Price calculation
  var priceInfo = '';
  if (totalETH.gt(0) && ifrAlloc.gt(0)) {
    var price = parseFloat(ethers.utils.formatEther(totalETH)) /
      parseFloat(ethers.utils.formatUnits(ifrAlloc, 9));
    priceInfo = '\n\u{1F4B1} Current IFR Price: ' + price.toFixed(10) + ' ETH';
  }

  var msg =
    '\u{1F4B0} *New Bootstrap Contribution!*\n\n' +
    '\u{1F4CE} Amount: *' + ethStr + ' ETH*\n' +
    '\u{1F4CA} Total Raised: *' + totalStr + ' ETH*\n' +
    '\u{1F465} Contributors: *' + contributors + '*' +
    priceInfo + '\n\n' +
    '\u{1F310} [Participate](https://ifrunit.tech/wiki/bootstrap.html)';

  var channelId = process.env.TELEGRAM_CHANNEL_ID;
  var groupId = process.env.TELEGRAM_GROUP_ID;
  var announceTopic = process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID
    ? parseInt(process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID, 10) : null;
  var opts = { parse_mode: 'Markdown', disable_web_page_preview: true };

  // Channel
  if (channelId) {
    try {
      await bot.telegram.sendMessage(channelId, msg, opts);
    } catch (e) {
      logger.error({ err: e.message }, 'Bootstrap alert: channel send failed');
    }
  }

  // Community — Announcements topic
  if (groupId) {
    try {
      var groupOpts = Object.assign({}, opts);
      if (announceTopic) groupOpts.message_thread_id = announceTopic;
      await bot.telegram.sendMessage(groupId, msg, groupOpts);
    } catch (e) {
      logger.error({ err: e.message }, 'Bootstrap alert: group send failed');
    }
  }

  logger.info({ eth: ethStr, total: totalStr, contributors: contributors },
    'Bootstrap contribution alert sent');
}

async function poll(bot) {
  try {
    var provider = new ethers.providers.JsonRpcProvider(getRpcUrl());
    var vault = new ethers.Contract(BOOTSTRAP_VAULT, ABI, provider);

    var totalETH = await vault.totalETHRaised();
    var contributors = await vault.contributorCount();
    var ifrAlloc = await vault.ifrAllocation();

    // First poll — set baseline, no alert
    if (lastTotalETH === null) {
      lastTotalETH = totalETH;
      lastContributors = contributors.toNumber();
      logger.info({ totalETH: fmtETH(totalETH), contributors: lastContributors },
        'Bootstrap listener baseline set');
      return;
    }

    // Check for new contribution
    if (totalETH.gt(lastTotalETH)) {
      var diff = totalETH.sub(lastTotalETH);
      logger.info({ diff: fmtETH(diff), total: fmtETH(totalETH) },
        'New bootstrap contribution detected');
      await sendAlert(bot, diff, totalETH, contributors.toString(), ifrAlloc);
      lastTotalETH = totalETH;
      lastContributors = contributors.toNumber();
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Bootstrap poll failed — will retry');
  }
}

function startBootstrapListener(bot) {
  var now = Date.now();

  // Only active during bootstrap window
  if (now < BOOTSTRAP_START) {
    logger.info('Bootstrap not started yet — listener deferred');
    // Schedule check for when bootstrap starts
    var delay = Math.min(BOOTSTRAP_START - now, 24 * 3600 * 1000);
    setTimeout(function() { startBootstrapListener(bot); }, delay);
    return;
  }

  if (now > BOOTSTRAP_END) {
    logger.info('Bootstrap ended — listener not started');
    return;
  }

  if (pollTimer) {
    logger.info('Bootstrap listener already running');
    return;
  }

  // Initial poll
  poll(bot);

  // Poll every 60 seconds
  pollTimer = setInterval(function() { poll(bot); }, 60000);

  logger.info('Bootstrap contribution listener started (60s polling)');
}

function stopBootstrapListener() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  logger.info('Bootstrap contribution listener stopped');
}

module.exports = { startBootstrapListener, stopBootstrapListener };
