// services/voteAnnouncement.js — IFR Governance Proposal Announcement Service
//
// Monitors Governance contract for proposal lifecycle changes and announces them
// to Telegram Channel + Community Announcements topic.
//
// Features:
// - Polls Governance contract every 30 minutes for new proposals
// - Announces new proposals with verify.html link
// - Sends reminder when proposal becomes executable (ETA reached)
// - Announces proposal execution and cancellation
// - Deduplication: never announces same proposal+state twice

const { ethers } = require('ethers');
const logger = require('./logger');

const GOV_ABI = [
  'function proposalCount() view returns (uint256)',
  'function getProposal(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)'
];

// In-memory dedup: proposalId → Set of announced states
const announced = new Map();

function hasAnnounced(id, state) {
  if (!announced.has(id)) return false;
  return announced.get(id).has(state);
}

function markAnnounced(id, state) {
  if (!announced.has(id)) announced.set(id, new Set());
  announced.get(id).add(state);
}

// Derive human-readable action from calldata selector
function decodeAction(data) {
  if (!data || data.length < 10) return 'Unknown action';
  const sel = data.slice(0, 10);
  const KNOWN = {
    '0xb3ab15fb': 'setFeeExempt',
    '0x2ab4d052': 'setFeeRates',
    '0x13af4035': 'setOwner',
    '0x4fc07395': 'setGuardian',
    '0xdaea85c5': 'approve',
    '0xa9059cbb': 'transfer'
  };
  return KNOWN[sel] || `call(${sel})`;
}

async function sendToChannelAndCommunity(bot, msg, govAddress) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const groupId = process.env.TELEGRAM_GROUP_ID;
  const topicId = process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID;

  const opts = {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  };

  if (channelId) {
    try {
      await bot.telegram.sendMessage(channelId, msg, opts);
    } catch (e) {
      logger.error({ err: e.message }, 'VoteAnnounce: channel send failed');
    }
  }

  if (groupId) {
    try {
      const groupOpts = { ...opts };
      if (topicId && Number(topicId) > 1) groupOpts.message_thread_id = Number(topicId);
      await bot.telegram.sendMessage(groupId, msg, groupOpts);
    } catch (e) {
      logger.error({ err: e.message }, 'VoteAnnounce: community send failed');
    }
  }
}

function announceNewProposal(bot, id, proposal, govAddress) {
  if (hasAnnounced(id, 'new')) return Promise.resolve();
  markAnnounced(id, 'new');

  const eta = new Date(proposal.eta.toNumber() * 1000);
  const etaStr = eta.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const action = decodeAction(proposal.data);
  const target = typeof proposal.target === 'string'
    ? proposal.target.slice(0, 6) + '...' + proposal.target.slice(-4)
    : 'unknown';

  const msg =
    `📜 *New Governance Proposal #${id}*\n\n` +
    `🎯 *Action:* ${action}\n` +
    `📍 *Target:* \`${target}\`\n` +
    `⏱ *Executable after:* ${etaStr}\n\n` +
    `🗳️ *How to participate:*\n` +
    `1. Verify your wallet: [ifrunit.tech/wiki/verify.html](https://ifrunit.tech/wiki/verify.html)\n` +
    `2. Join the Vote topic in the community\n` +
    `3. Lock IFR to earn voting weight\n\n` +
    `📖 [Governance Docs](https://ifrunit.tech/wiki/governance.html)`;

  logger.info({ proposalId: id, action, target: proposal.target }, 'Announcing new proposal');
  return sendToChannelAndCommunity(bot, msg, govAddress);
}

function announceExecutable(bot, id, govAddress) {
  if (hasAnnounced(id, 'executable')) return Promise.resolve();
  markAnnounced(id, 'executable');

  const msg =
    `⏰ *Proposal #${id} — Ready for Execution*\n\n` +
    `The timelock delay has passed. This proposal can now be executed on-chain.\n\n` +
    `📖 [Governance Docs](https://ifrunit.tech/wiki/governance.html)`;

  logger.info({ proposalId: id }, 'Announcing proposal executable');
  return sendToChannelAndCommunity(bot, msg, govAddress);
}

function announceExecuted(bot, id, govAddress) {
  if (hasAnnounced(id, 'executed')) return Promise.resolve();
  markAnnounced(id, 'executed');

  const msg =
    `✅ *Proposal #${id} — Executed On-Chain*\n\n` +
    `The governance proposal has been successfully executed.\n` +
    `Changes are now live on the Inferno protocol.\n\n` +
    `📖 [Governance Docs](https://ifrunit.tech/wiki/governance.html)`;

  logger.info({ proposalId: id }, 'Announcing proposal executed');
  return sendToChannelAndCommunity(bot, msg, govAddress);
}

function announceCancelled(bot, id, govAddress) {
  if (hasAnnounced(id, 'cancelled')) return Promise.resolve();
  markAnnounced(id, 'cancelled');

  const msg =
    `❌ *Proposal #${id} — Cancelled*\n\n` +
    `This governance proposal has been cancelled by the owner or guardian.`;

  logger.info({ proposalId: id }, 'Announcing proposal cancelled');
  return sendToChannelAndCommunity(bot, msg, govAddress);
}

// Main check function — called by scheduler
async function checkAndAnnounceProposals(bot, provider, govAddress) {
  try {
    const governance = new ethers.Contract(govAddress, GOV_ABI, provider);
    const count = (await governance.proposalCount()).toNumber();
    if (count === 0) return;

    const now = Math.floor(Date.now() / 1000);

    for (let id = 0; id < count; id++) {
      const p = await governance.getProposal(id);
      const eta = p.eta.toNumber();

      // New proposal (not yet announced)
      if (!p.executed && !p.cancelled && !hasAnnounced(id, 'new')) {
        await announceNewProposal(bot, id, p, govAddress);
      }

      // Executable reminder (ETA passed, not executed/cancelled)
      if (!p.executed && !p.cancelled && now >= eta && !hasAnnounced(id, 'executable')) {
        await announceExecutable(bot, id, govAddress);
      }

      // Executed
      if (p.executed && !hasAnnounced(id, 'executed')) {
        await announceExecuted(bot, id, govAddress);
      }

      // Cancelled
      if (p.cancelled && !hasAnnounced(id, 'cancelled')) {
        await announceCancelled(bot, id, govAddress);
      }
    }
  } catch (e) {
    logger.error({ err: e.message }, 'VoteAnnounce: check failed');
  }
}

// Start the scheduler — replaces governanceNotifier
function startVoteAnnouncements(bot) {
  const govAddress = process.env.GOVERNANCE_ADDRESS;
  const rpcUrl = process.env.ALCHEMY_RPC_URL || process.env.RPC_URL;
  const groupId = process.env.TELEGRAM_GROUP_ID;

  if (!groupId || !govAddress || !rpcUrl) {
    logger.warn('Vote announcements disabled — missing TELEGRAM_GROUP_ID, GOVERNANCE_ADDRESS, or RPC_URL');
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const POLL_MS = 30 * 60 * 1000; // 30 minutes

  // Mark existing proposals as already announced on first run
  let initialized = false;

  async function poll() {
    if (!initialized) {
      try {
        const governance = new ethers.Contract(govAddress, GOV_ABI, provider);
        const count = (await governance.proposalCount()).toNumber();
        // Mark all existing proposals so we don't spam on restart
        for (let id = 0; id < count; id++) {
          const p = await governance.getProposal(id);
          markAnnounced(id, 'new');
          if (p.executed) markAnnounced(id, 'executed');
          if (p.cancelled) markAnnounced(id, 'cancelled');
          if (!p.executed && !p.cancelled && Math.floor(Date.now() / 1000) >= p.eta.toNumber()) {
            markAnnounced(id, 'executable');
          }
        }
        initialized = true;
        logger.info({ proposalCount: count }, 'Vote announcements initialized');
      } catch (e) {
        logger.error({ err: e.message }, 'VoteAnnounce: init failed');
        return;
      }
    }

    await checkAndAnnounceProposals(bot, provider, govAddress);
  }

  poll();
  setInterval(poll, POLL_MS);
  logger.info({ intervalMin: POLL_MS / 60000 }, 'Vote announcement scheduler started');
}

// Exported for testing
module.exports = {
  startVoteAnnouncements,
  checkAndAnnounceProposals,
  hasAnnounced,
  markAnnounced,
  announceNewProposal,
  announceExecutable,
  announceExecuted,
  announceCancelled,
  decodeAction,
  GOV_ABI,
  // Reset for testing
  _resetAnnounced: () => announced.clear()
};
