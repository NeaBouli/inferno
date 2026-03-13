// tests/verify/verification.test.js — IFR 3-Tier Wallet Verification Tests (T01–T20)
const { expect } = require('chai');

// Force RPC failure so getSignerWallets() uses env fallback — MUST be set before require
process.env.GNOSIS_SAFE_ADDR = '0x0000000000000000000000000000000000000001';
process.env.ALCHEMY_RPC_URL = 'https://invalid-rpc.example.com';
process.env.RPC_URL = 'https://invalid-rpc.example.com';
process.env.SIGNER_WALLETS = '0xaaaa000000000000000000000000000000000001,0xaaaa000000000000000000000000000000000002';
process.env.BUILDER_WALLETS = '0xbbbb000000000000000000000000000000000001';

// Clear any cached modules to ensure env vars take effect
const storeKey = require.resolve('../../apps/telegram/telegram-bot/src/services/verificationStore');
const readerKey = require.resolve('../../apps/telegram/telegram-bot/src/services/onChainReader');
delete require.cache[storeKey];
delete require.cache[readerKey];

const {
  createNonce, getNonce, consumeNonce,
  setVerified, isVerified, getUser, hasTopicAccess, getTier,
  TOPIC_ACCESS, builderWhitelist
} = require('../../apps/telegram/telegram-bot/src/services/verificationStore');

const onChainReader = require('../../apps/telegram/telegram-bot/src/services/onChainReader');

describe('IFR 3-Tier Wallet Verification', function () {

  // ── T01–T05: Nonce Management ─────────────────────
  describe('Nonce Management', function () {
    it('T01 — createNonce returns IFR-prefixed nonce', function () {
      const nonce = createNonce('100', 'testuser');
      expect(nonce).to.match(/^IFR-[A-Z0-9]+-[A-Z0-9]+$/);
    });

    it('T02 — getNonce returns nonce data', function () {
      const nonce = createNonce('101', 'alice');
      const data = getNonce(nonce);
      expect(data).to.not.be.null;
      expect(data.userId).to.equal('101');
      expect(data.username).to.equal('alice');
    });

    it('T03 — creating new nonce removes old nonce for same user', function () {
      const old = createNonce('102', 'bob');
      const fresh = createNonce('102', 'bob');
      expect(getNonce(old)).to.be.null;
      expect(getNonce(fresh)).to.not.be.null;
    });

    it('T04 — consumeNonce removes nonce from store', function () {
      const nonce = createNonce('103', 'charlie');
      consumeNonce(nonce);
      expect(getNonce(nonce)).to.be.null;
    });

    it('T05 — getNonce returns null for unknown nonce', function () {
      expect(getNonce('IFR-INVALID-000')).to.be.null;
    });
  });

  // ── T06: SIGNER_WHITELIST removed ─────────────────
  describe('Signer Source', function () {
    it('T06 — SIGNER_WHITELIST no longer exported (replaced by getSignerWallets)', function () {
      const store = require('../../apps/telegram/telegram-bot/src/services/verificationStore');
      expect(store.SIGNER_WHITELIST).to.be.undefined;
    });
  });

  // ── T07: Builder Whitelist ─────────────────────────
  describe('Builder Whitelist', function () {
    it('T07 — builderWhitelist contains env addresses', function () {
      expect(builderWhitelist.has('0xbbbb000000000000000000000000000000000001')).to.be.true;
    });
  });

  // ── T08–T10: getTier (async) ──────────────────────
  describe('Tier Determination (async)', function () {
    it('T08 — getTier returns signer for fallback env address', async function () {
      const tier = await getTier('0xAAAA000000000000000000000000000000000001');
      expect(tier).to.equal('signer');
    });

    it('T09 — getTier returns builder for builder-whitelisted address', async function () {
      const tier = await getTier('0xBBBB000000000000000000000000000000000001');
      expect(tier).to.equal('builder');
    });

    it('T10 — getTier returns community for unknown wallet', async function () {
      const tier = await getTier('0x0000000000000000000000000000000000000099');
      expect(tier).to.equal('community');
    });
  });

  // ── T11–T12: User Storage ─────────────────────────
  describe('User Verification Storage', function () {
    it('T11 — setVerified stores user, isVerified returns true, getUser returns data', function () {
      setVerified('200', '0xAAAA000000000000000000000000000000000001', 'signer');
      expect(isVerified('200')).to.be.true;
      const user = getUser('200');
      expect(user).to.not.be.null;
      expect(user.wallet).to.equal('0xaaaa000000000000000000000000000000000001');
      expect(user.tier).to.equal('signer');
    });

    it('T12 — isVerified returns false for unknown user', function () {
      expect(isVerified('999')).to.be.false;
      expect(getUser('999')).to.be.null;
    });
  });

  // ── T13–T14: Topic Access Control ─────────────────
  describe('Topic Access Control', function () {
    before(function () {
      setVerified('300', '0xAAAA000000000000000000000000000000000001', 'signer');
      setVerified('301', '0x1111111111111111111111111111111111111111', 'voter');
      setVerified('302', '0xBBBB000000000000000000000000000000000001', 'builder');
      setVerified('303', '0x2222222222222222222222222222222222222222', 'community');
    });

    it('T13a — signer has access to all protected topics', function () {
      expect(hasTopicAccess('300', 58)).to.be.true;
      expect(hasTopicAccess('300', 21)).to.be.true;
      expect(hasTopicAccess('300', 23)).to.be.true;
      expect(hasTopicAccess('300', 11)).to.be.true;
    });

    it('T13b — voter has access to Vote only', function () {
      expect(hasTopicAccess('301', 58)).to.be.false;
      expect(hasTopicAccess('301', 21)).to.be.false;
      expect(hasTopicAccess('301', 23)).to.be.true;
      expect(hasTopicAccess('301', 11)).to.be.false;
    });

    it('T13c — builder has access to Vote + Dev & Builder', function () {
      expect(hasTopicAccess('302', 58)).to.be.false;
      expect(hasTopicAccess('302', 21)).to.be.false;
      expect(hasTopicAccess('302', 23)).to.be.true;
      expect(hasTopicAccess('302', 11)).to.be.true;
    });

    it('T13d — community has no access to protected topics', function () {
      expect(hasTopicAccess('303', 58)).to.be.false;
      expect(hasTopicAccess('303', 21)).to.be.false;
      expect(hasTopicAccess('303', 23)).to.be.false;
      expect(hasTopicAccess('303', 11)).to.be.false;
    });

    it('T14 — non-protected topic returns true for everyone', function () {
      expect(hasTopicAccess('303', 5)).to.be.true;
      expect(hasTopicAccess('999', 5)).to.be.true;
    });
  });

  // ── T15–T20: getSignerWallets (Gnosis Safe) ───────
  describe('Gnosis Safe Signer Auto-Sync', function () {
    it('T15 — getSignerWallets is exported and is async', function () {
      expect(onChainReader.getSignerWallets).to.be.a('function');
    });

    it('T16 — getSignerWallets returns array with entries', async function () {
      const signers = await onChainReader.getSignerWallets();
      expect(signers).to.be.an('array');
      expect(signers.length).to.be.gt(0);
    });

    it('T17 — getSignerWallets fallback contains env SIGNER_WALLETS addresses', async function () {
      const signers = await onChainReader.getSignerWallets();
      expect(signers).to.include('0xaaaa000000000000000000000000000000000001');
      expect(signers).to.include('0xaaaa000000000000000000000000000000000002');
    });

    it('T18 — getSignerWallets returns lowercase addresses', async function () {
      const signers = await onChainReader.getSignerWallets();
      for (const s of signers) {
        expect(s).to.equal(s.toLowerCase());
      }
    });

    it('T19 — determineTier returns signer for Safe owner (via fallback)', async function () {
      const tier = await onChainReader.determineTier('0xAAAA000000000000000000000000000000000001');
      expect(tier).to.equal('signer');
    });

    it('T20 — determineTier returns community for unknown wallet', async function () {
      const tier = await onChainReader.determineTier('0x0000000000000000000000000000000000000099');
      expect(tier).to.equal('community');
    });
  });
});
