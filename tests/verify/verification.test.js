// tests/verify/verification.test.js — IFR 3-Tier Wallet Verification Tests (T01–T14)
const { expect } = require('chai');

// Stub env BEFORE requiring verificationStore
process.env.SIGNER_WALLETS = '0xaaaa000000000000000000000000000000000001,0xaaaa000000000000000000000000000000000002';
process.env.BUILDER_WALLETS = '0xbbbb000000000000000000000000000000000001';

const {
  createNonce, getNonce, consumeNonce,
  setVerified, isVerified, getUser, hasTopicAccess, getTier,
  SIGNER_WHITELIST, TOPIC_ACCESS, builderWhitelist
} = require('../../apps/telegram/telegram-bot/src/services/verificationStore');

describe('IFR 3-Tier Wallet Verification', function () {

  // ── T01: Nonce Creation ─────────────────────────────
  describe('Nonce Management', function () {
    it('T01 — createNonce returns IFR-prefixed nonce', function () {
      const nonce = createNonce('100', 'testuser');
      expect(nonce).to.match(/^IFR-[A-Z0-9]+-[A-Z0-9]+$/);
    });

    // ── T02: Nonce is retrievable ─────────────────────
    it('T02 — getNonce returns nonce data', function () {
      const nonce = createNonce('101', 'alice');
      const data = getNonce(nonce);
      expect(data).to.not.be.null;
      expect(data.userId).to.equal('101');
      expect(data.username).to.equal('alice');
    });

    // ── T03: Old nonce replaced on new creation ───────
    it('T03 — creating new nonce removes old nonce for same user', function () {
      const old = createNonce('102', 'bob');
      const fresh = createNonce('102', 'bob');
      expect(getNonce(old)).to.be.null;
      expect(getNonce(fresh)).to.not.be.null;
    });

    // ── T04: consumeNonce removes nonce ───────────────
    it('T04 — consumeNonce removes nonce from store', function () {
      const nonce = createNonce('103', 'charlie');
      consumeNonce(nonce);
      expect(getNonce(nonce)).to.be.null;
    });

    // ── T05: Invalid nonce returns null ────────────────
    it('T05 — getNonce returns null for unknown nonce', function () {
      expect(getNonce('IFR-INVALID-000')).to.be.null;
    });
  });

  // ── T06: Signer Whitelist Loaded ────────────────────
  describe('Signer Whitelist', function () {
    it('T06 — SIGNER_WHITELIST contains env addresses (lowercase)', function () {
      expect(SIGNER_WHITELIST).to.include('0xaaaa000000000000000000000000000000000001');
      expect(SIGNER_WHITELIST).to.include('0xaaaa000000000000000000000000000000000002');
    });
  });

  // ── T07: Builder Whitelist Loaded ───────────────────
  describe('Builder Whitelist', function () {
    it('T07 — builderWhitelist contains env addresses', function () {
      expect(builderWhitelist.has('0xbbbb000000000000000000000000000000000001')).to.be.true;
    });
  });

  // ── T08: getTier — signer ──────────────────────────
  describe('Tier Determination (offline)', function () {
    it('T08 — getTier returns signer for whitelisted address', function () {
      expect(getTier('0xAAAA000000000000000000000000000000000001')).to.equal('signer');
    });

    // ── T09: getTier — builder ────────────────────────
    it('T09 — getTier returns builder for builder-whitelisted address', function () {
      expect(getTier('0xBBBB000000000000000000000000000000000001')).to.equal('builder');
    });

    // ── T10: getTier — community (unknown wallet) ─────
    it('T10 — getTier returns community for unknown wallet', function () {
      expect(getTier('0x0000000000000000000000000000000000000099')).to.equal('community');
    });
  });

  // ── T11: setVerified + isVerified + getUser ─────────
  describe('User Verification Storage', function () {
    it('T11 — setVerified stores user, isVerified returns true, getUser returns data', function () {
      setVerified('200', '0xAAAA000000000000000000000000000000000001', 'signer');
      expect(isVerified('200')).to.be.true;
      const user = getUser('200');
      expect(user).to.not.be.null;
      expect(user.wallet).to.equal('0xaaaa000000000000000000000000000000000001');
      expect(user.tier).to.equal('signer');
    });

    // ── T12: unverified user ──────────────────────────
    it('T12 — isVerified returns false for unknown user', function () {
      expect(isVerified('999')).to.be.false;
      expect(getUser('999')).to.be.null;
    });
  });

  // ── T13: hasTopicAccess ─────────────────────────────
  describe('Topic Access Control', function () {
    before(function () {
      setVerified('300', '0xAAAA000000000000000000000000000000000001', 'signer');
      setVerified('301', '0x1111111111111111111111111111111111111111', 'voter');
      setVerified('302', '0xBBBB000000000000000000000000000000000001', 'builder');
      setVerified('303', '0x2222222222222222222222222222222222222222', 'community');
    });

    it('T13a — signer has access to all protected topics', function () {
      expect(hasTopicAccess('300', 58)).to.be.true;  // Core Dev
      expect(hasTopicAccess('300', 21)).to.be.true;  // Council
      expect(hasTopicAccess('300', 23)).to.be.true;  // Vote
      expect(hasTopicAccess('300', 11)).to.be.true;  // Dev & Builder
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

    // ── T14: Unprotected topic always accessible ──────
    it('T14 — non-protected topic returns true for everyone', function () {
      expect(hasTopicAccess('303', 5)).to.be.true;   // General topic
      expect(hasTopicAccess('999', 5)).to.be.true;   // Even unverified
    });
  });
});
