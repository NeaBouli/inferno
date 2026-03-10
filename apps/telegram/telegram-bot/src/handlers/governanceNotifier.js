// handlers/governanceNotifier.js — Poll for new governance proposals every 30 min
const { ethers } = require('ethers');
const logger = require('../services/logger');

const GOV_ABI = [
  'function proposalCount() view returns (uint256)',
  'function proposals(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)',
];

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let lastSeenProposalId = -1;

function startGovernanceNotifier(bot) {
  const chatId = process.env.TELEGRAM_GROUP_ID;
  const topicId = process.env.TELEGRAM_ANNOUNCEMENTS_TOPIC_ID || null;
  const govAddress = process.env.GOVERNANCE_ADDRESS;
  const rpcUrl = process.env.ALCHEMY_RPC_URL;

  if (!chatId || !govAddress || !rpcUrl) {
    logger.warn('Governance notifier disabled — missing TELEGRAM_GROUP_ID, GOVERNANCE_ADDRESS, or ALCHEMY_RPC_URL');
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const governance = new ethers.Contract(govAddress, GOV_ABI, provider);

  async function poll() {
    try {
      const count = (await governance.proposalCount()).toNumber();

      // First run — just record current count
      if (lastSeenProposalId === -1) {
        lastSeenProposalId = count - 1;
        logger.info({ proposalCount: count }, 'Governance notifier initialized');
        return;
      }

      // Check for new proposals
      for (let i = lastSeenProposalId + 1; i < count; i++) {
        const prop = await governance.proposals(i);
        const eta = new Date(prop.eta.toNumber() * 1000).toISOString().replace('T', ' ').slice(0, 16);

        const text =
          `📜 *New Governance Proposal #${i}*\n\n` +
          `🎯 Target: \`${prop.target}\`\n` +
          `⏱ ETA: ${eta} UTC\n\n` +
          `🔗 [Governance Dashboard](https://ifrunit.tech/wiki/governance.html)`;

        const opts = { parse_mode: 'Markdown', disable_web_page_preview: true };
        if (topicId && Number(topicId) > 1) opts.message_thread_id = Number(topicId);

        await bot.telegram.sendMessage(chatId, text, opts);
        logger.info({ proposalId: i, target: prop.target }, 'New proposal notification sent');
      }

      if (count - 1 > lastSeenProposalId) {
        lastSeenProposalId = count - 1;
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Governance poll error');
    }
  }

  // Initial poll, then repeat
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
  logger.info({ intervalMin: POLL_INTERVAL_MS / 60000 }, 'Governance notifier started');
}

module.exports = { startGovernanceNotifier };
