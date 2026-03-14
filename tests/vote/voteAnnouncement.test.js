// tests/vote/voteAnnouncement.test.js — IFR Vote Announcement Service Tests (T01–T12)
const { expect } = require('chai');
const { ethers } = require('ethers');

// Stub logger before requiring module
const logMessages = [];
const logStub = { info: (...a) => logMessages.push(a), warn: (...a) => {}, error: (...a) => {} };
const loggerKey = require.resolve('../../apps/telegram/telegram-bot/src/services/logger');
require.cache[loggerKey] = { id: loggerKey, filename: loggerKey, loaded: true, exports: logStub };

const {
  hasAnnounced,
  markAnnounced,
  checkAndAnnounceProposals,
  announceNewProposal,
  announceExecutable,
  announceExecuted,
  announceCancelled,
  decodeAction,
  _resetAnnounced
} = require('../../apps/telegram/telegram-bot/src/services/voteAnnouncement');

// Mock bot
function createMockBot() {
  const sent = [];
  return {
    sent,
    telegram: {
      sendMessage: async (chatId, text, opts) => {
        sent.push({ chatId, text, opts });
      }
    }
  };
}

// Mock proposal
function mockProposal(overrides = {}) {
  return {
    target: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
    data: '0xb3ab15fb000000000000000000000000f72565c4cdb9575c9d3aee6b9ae3fdbd7f56e141',
    eta: ethers.BigNumber.from(overrides.eta || Math.floor(Date.now() / 1000) + 3600),
    executed: overrides.executed || false,
    cancelled: overrides.cancelled || false,
    ...overrides,
    // Ensure eta is always BigNumber
    ...(overrides.eta ? { eta: ethers.BigNumber.from(overrides.eta) } : {})
  };
}

// Mock provider + contract
function createMockProvider(proposals) {
  const count = proposals.length;
  return {
    _isProvider: true,
    getNetwork: async () => ({ chainId: 1 }),
    // ethers.Contract will call through the provider
    call: async (tx) => {
      const iface = new ethers.utils.Interface([
        'function proposalCount() view returns (uint256)',
        'function getProposal(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)'
      ]);
      const selector = tx.data.slice(0, 10);

      if (selector === iface.getSighash('proposalCount')) {
        return iface.encodeFunctionResult('proposalCount', [count]);
      }
      if (selector === iface.getSighash('getProposal')) {
        const [id] = iface.decodeFunctionData('getProposal', tx.data);
        const p = proposals[id.toNumber()];
        if (!p) throw new Error('Proposal not found');
        return iface.encodeFunctionResult('getProposal', [
          p.target, p.data, p.eta, p.executed, p.cancelled
        ]);
      }
      throw new Error('Unknown call: ' + selector);
    }
  };
}

describe('IFR Vote Announcement Service', function () {
  const GOV_ADDR = '0xc43d48E7FDA576C5022d0670B652A622E8caD041';

  beforeEach(() => {
    _resetAnnounced();
    logMessages.length = 0;
  });

  // ── T01: decodeAction — known selector ──────────
  it('T01 — decodeAction returns known function name', function () {
    expect(decodeAction('0xb3ab15fb0000')).to.equal('setFeeExempt');
    expect(decodeAction('0x2ab4d0520000')).to.equal('setFeeRates');
    expect(decodeAction('0x13af40350000')).to.equal('setOwner');
  });

  // ── T02: decodeAction — unknown selector ──────────
  it('T02 — decodeAction returns call(selector) for unknown', function () {
    expect(decodeAction('0xdeadbeef0000')).to.equal('call(0xdeadbeef)');
    expect(decodeAction('')).to.equal('Unknown action');
    expect(decodeAction(null)).to.equal('Unknown action');
  });

  // ── T03: hasAnnounced — false for new entry ──────────
  it('T03 — hasAnnounced returns false for untracked proposal', function () {
    expect(hasAnnounced(99, 'new')).to.be.false;
  });

  // ── T04: markAnnounced — true after marking ──────────
  it('T04 — markAnnounced sets dedup flag correctly', function () {
    markAnnounced(1, 'new');
    expect(hasAnnounced(1, 'new')).to.be.true;
    expect(hasAnnounced(1, 'executed')).to.be.false;
  });

  // ── T05: Dedup — announceNewProposal only sends once ──────────
  it('T05 — announceNewProposal deduplicates (sends only once)', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    const p = mockProposal();

    await announceNewProposal(bot, 0, p, GOV_ADDR);
    await announceNewProposal(bot, 0, p, GOV_ADDR);

    // Only 1 send (to group only — no CHANNEL_ID set)
    expect(bot.sent.length).to.equal(1);
    delete process.env.TELEGRAM_GROUP_ID;
  });

  // ── T06: New proposal message contains verify.html link ──────────
  it('T06 — new proposal message includes verify.html link', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    await announceNewProposal(bot, 5, mockProposal(), GOV_ADDR);

    const text = bot.sent[0].text;
    expect(text).to.include('Proposal #5');
    expect(text).to.include('verify.html');
    expect(text).to.include('governance.html');
    expect(text).to.include('setFeeExempt');
    delete process.env.TELEGRAM_GROUP_ID;
  });

  // ── T07: Executable announcement ──────────
  it('T07 — announceExecutable sends correct message', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    await announceExecutable(bot, 3, GOV_ADDR);

    expect(bot.sent.length).to.equal(1);
    expect(bot.sent[0].text).to.include('Ready for Execution');
    expect(bot.sent[0].text).to.include('#3');
    delete process.env.TELEGRAM_GROUP_ID;
  });

  // ── T08: Executed announcement ──────────
  it('T08 — announceExecuted sends correct message', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    await announceExecuted(bot, 4, GOV_ADDR);

    expect(bot.sent.length).to.equal(1);
    expect(bot.sent[0].text).to.include('Executed On-Chain');
    expect(bot.sent[0].text).to.include('#4');
    delete process.env.TELEGRAM_GROUP_ID;
  });

  // ── T09: Cancelled announcement ──────────
  it('T09 — announceCancelled sends correct message', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    await announceCancelled(bot, 2, GOV_ADDR);

    expect(bot.sent.length).to.equal(1);
    expect(bot.sent[0].text).to.include('Cancelled');
    expect(bot.sent[0].text).to.include('#2');
    delete process.env.TELEGRAM_GROUP_ID;
  });

  // ── T10: checkAndAnnounceProposals — new pending proposal ──────────
  it('T10 — checkAndAnnounce detects new pending proposal', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    const proposals = [mockProposal({ eta: Math.floor(Date.now() / 1000) + 7200 })];
    const provider = createMockProvider(proposals);

    await checkAndAnnounceProposals(bot, provider, GOV_ADDR);

    expect(bot.sent.length).to.equal(1);
    expect(bot.sent[0].text).to.include('New Governance Proposal #0');
    delete process.env.TELEGRAM_GROUP_ID;
  });

  // ── T11: checkAndAnnounceProposals — executed proposal ──────────
  it('T11 — checkAndAnnounce detects executed proposal', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    const proposals = [mockProposal({ eta: Math.floor(Date.now() / 1000) - 3600, executed: true })];
    const provider = createMockProvider(proposals);

    await checkAndAnnounceProposals(bot, provider, GOV_ADDR);

    // Should announce both "new" and "executed"
    const texts = bot.sent.map(s => s.text);
    expect(texts.some(t => t.includes('Executed On-Chain'))).to.be.true;
    delete process.env.TELEGRAM_GROUP_ID;
  });

  // ── T12: checkAndAnnounceProposals — multiple proposals, correct states ──────────
  it('T12 — checkAndAnnounce handles multiple proposals with different states', async function () {
    process.env.TELEGRAM_GROUP_ID = '-100123';
    const bot = createMockBot();
    const now = Math.floor(Date.now() / 1000);
    const proposals = [
      mockProposal({ eta: now - 3600, executed: true }),   // #0: executed
      mockProposal({ eta: now - 1800, cancelled: true }),  // #1: cancelled
      mockProposal({ eta: now + 7200 })                    // #2: pending
    ];
    const provider = createMockProvider(proposals);

    await checkAndAnnounceProposals(bot, provider, GOV_ADDR);

    const texts = bot.sent.map(s => s.text);
    // #0: new + executable + executed
    expect(texts.some(t => t.includes('#0') && t.includes('Executed'))).to.be.true;
    // #1: new + cancelled
    expect(texts.some(t => t.includes('#1') && t.includes('Cancelled'))).to.be.true;
    // #2: new only (pending, eta in future)
    expect(texts.some(t => t.includes('#2') && t.includes('New Governance'))).to.be.true;

    // Second run — no duplicates
    bot.sent.length = 0;
    await checkAndAnnounceProposals(bot, provider, GOV_ADDR);
    expect(bot.sent.length).to.equal(0);

    delete process.env.TELEGRAM_GROUP_ID;
  });
});
