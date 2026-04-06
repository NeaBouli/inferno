const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Phase 5 — Contract Library", function () {
  let owner, user, user2, governance;
  let IFR, Vault;

  const ONE_IFR = ethers.utils.parseUnits("1", 9); // 9 decimals
  const MIN_REQUIRED = ethers.utils.parseUnits("500", 9); // 500 IFR
  const TIER2 = ethers.utils.parseUnits("2000", 9);
  const TIER3 = ethers.utils.parseUnits("10000", 9);
  const SEVEN_DAYS = 7 * 86400;
  const ONE_DAY = 86400;

  beforeEach(async () => {
    [owner, user, user2, governance] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    IFR = await MockToken.deploy("Inferno Token", "IFR");
    await IFR.deployed();

    // Give user tokens
    await IFR.mint(user.address, ethers.utils.parseUnits("20000", 9));
    await IFR.mint(user2.address, ethers.utils.parseUnits("100", 9));

    const IFRBuilderVault = await ethers.getContractFactory("IFRBuilderVault");
    Vault = await IFRBuilderVault.deploy(
      IFR.address,
      MIN_REQUIRED,
      SEVEN_DAYS,
      "TestProduct",
      "https://test.example.com",
      governance.address
    );
    await Vault.deployed();

    // Approve vault to spend user tokens
    await IFR.connect(user).approve(Vault.address, ethers.constants.MaxUint256);
    await IFR.connect(user2).approve(Vault.address, ethers.constants.MaxUint256);
  });

  // ── BaseAccessModule (T01-T04) ────────────────────────

  it("T01: hasAccess() true when enough balance (before lock, uses HardLock override)", async () => {
    // HardLockModule overrides: needs lock, not just balance
    expect(await Vault.hasAccess(user.address)).to.equal(false);
  });

  it("T02: hasAccess() false when insufficient balance", async () => {
    expect(await Vault.hasAccess(user2.address)).to.equal(false);
  });

  it("T03: hasAccessAmount() custom amount check", async () => {
    expect(await Vault.hasAccessAmount(user.address, ethers.utils.parseUnits("1000", 9))).to.equal(true);
    expect(await Vault.hasAccessAmount(user2.address, ethers.utils.parseUnits("1000", 9))).to.equal(false);
  });

  it("T04: userBalance() returns correct balance", async () => {
    expect(await Vault.userBalance(user.address)).to.equal(ethers.utils.parseUnits("20000", 9));
  });

  // ── HardLockModule (T05-T13) ──────────────────────────

  it("T05: lock() succeeds with valid params", async () => {
    await expect(Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS))
      .to.emit(Vault, "Locked")
      .withArgs(user.address, MIN_REQUIRED, SEVEN_DAYS);
  });

  it("T06: lock() reverts below minimum", async () => {
    await expect(Vault.connect(user).lock(ONE_IFR, SEVEN_DAYS))
      .to.be.revertedWith("Below minimum");
  });

  it("T07: lock() reverts with too short duration", async () => {
    await expect(Vault.connect(user).lock(MIN_REQUIRED, ONE_DAY))
      .to.be.revertedWith("Duration too short");
  });

  it("T08: hasAccess() true after lock", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    expect(await Vault.hasAccess(user.address)).to.equal(true);
  });

  it("T09: unlock() reverts before duration expires", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    await expect(Vault.connect(user).unlock()).to.be.revertedWith("Still locked");
  });

  it("T10: unlock() succeeds after duration", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    await ethers.provider.send("evm_increaseTime", [SEVEN_DAYS]);
    await ethers.provider.send("evm_mine", []);

    await expect(Vault.connect(user).unlock())
      .to.emit(Vault, "Unlocked")
      .withArgs(user.address, MIN_REQUIRED);
  });

  it("T11: isLockActive() correct before and after expiry", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    expect(await Vault.isLockActive(user.address)).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [SEVEN_DAYS]);
    await ethers.provider.send("evm_mine", []);

    expect(await Vault.isLockActive(user.address)).to.equal(false);
  });

  it("T12: timeUntilUnlock() correct", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    const remaining = await Vault.timeUntilUnlock(user.address);
    expect(remaining).to.be.closeTo(ethers.BigNumber.from(SEVEN_DAYS), 5);
  });

  it("T13: lockedAmount() correct", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    expect(await Vault.lockedAmount(user.address)).to.equal(MIN_REQUIRED);
  });

  // ── TierModule (T14-T20) ──────────────────────────────

  it("T14: getTier() returns 0 when no lock", async () => {
    expect(await Vault.getTier(user.address)).to.equal(0);
  });

  it("T15: getTier() returns 1 at 500 IFR locked", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    expect(await Vault.getTier(user.address)).to.equal(1);
  });

  it("T16: getTier() returns 2 at 2000 IFR locked", async () => {
    await Vault.connect(user).lock(TIER2, SEVEN_DAYS);
    expect(await Vault.getTier(user.address)).to.equal(2);
  });

  it("T17: getTier() returns 3 at 10000 IFR locked", async () => {
    await Vault.connect(user).lock(TIER3, SEVEN_DAYS);
    expect(await Vault.getTier(user.address)).to.equal(3);
  });

  it("T18: hasTier() correct", async () => {
    await Vault.connect(user).lock(TIER2, SEVEN_DAYS);
    expect(await Vault.hasTier(user.address, 1)).to.equal(true);
    expect(await Vault.hasTier(user.address, 2)).to.equal(true);
    expect(await Vault.hasTier(user.address, 3)).to.equal(false);
  });

  it("T19: getTierName() correct", async () => {
    expect(await Vault.getTierName(user.address)).to.equal("None");
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    expect(await Vault.getTierName(user.address)).to.equal("Basic");
  });

  it("T20: ifrToNextTier() correct", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    // 500 locked, need 2000 for tier 2 → 1500 to go
    expect(await Vault.ifrToNextTier(user.address)).to.equal(TIER2.sub(MIN_REQUIRED));
  });

  // ── CooldownModule (T21-T25) ──────────────────────────

  it("T21: isInCooldown() false initially", async () => {
    expect(await Vault.isInCooldown(user.address)).to.equal(false);
  });

  it("T22: cooldownRemaining() returns 0 initially", async () => {
    expect(await Vault.cooldownRemaining(user.address)).to.equal(0);
  });

  it("T23: cooldownDuration default is 24h", async () => {
    expect(await Vault.cooldownDuration()).to.equal(24 * 3600);
  });

  it("T24: MIN_COOLDOWN is 1h", async () => {
    expect(await Vault.MIN_COOLDOWN()).to.equal(3600);
  });

  it("T25: MAX_COOLDOWN is 30 days", async () => {
    expect(await Vault.MAX_COOLDOWN()).to.equal(30 * 86400);
  });

  // ── IFRBuilderVault Combined (T26-T40) ────────────────

  it("T26: deploys with correct params", async () => {
    expect(await Vault.productName()).to.equal("TestProduct");
    expect(await Vault.productUrl()).to.equal("https://test.example.com");
    expect(await Vault.owner()).to.equal(governance.address);
    expect(await Vault.minRequired()).to.equal(MIN_REQUIRED);
    expect(await Vault.minLockDuration()).to.equal(SEVEN_DAYS);
  });

  it("T27: hasAccess() combines lock + amount", async () => {
    expect(await Vault.hasAccess(user.address)).to.equal(false);
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    expect(await Vault.hasAccess(user.address)).to.equal(true);
  });

  it("T28: hasPremium() requires Tier 2 + lock", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    expect(await Vault.hasPremium(user.address)).to.equal(false); // tier 1 only

    // New vault for fresh lock with tier 2
    const V2 = await (await ethers.getContractFactory("IFRBuilderVault")).deploy(
      IFR.address, MIN_REQUIRED, SEVEN_DAYS, "P2", "https://p2.com", governance.address
    );
    await IFR.connect(user).approve(V2.address, ethers.constants.MaxUint256);
    await V2.connect(user).lock(TIER2, SEVEN_DAYS);
    expect(await V2.hasPremium(user.address)).to.equal(true);
  });

  it("T29: hasPro() requires Tier 3 + lock", async () => {
    await Vault.connect(user).lock(TIER3, SEVEN_DAYS);
    expect(await Vault.hasPro(user.address)).to.equal(true);
  });

  it("T30: getStatus() returns full info", async () => {
    await Vault.connect(user).lock(TIER2, SEVEN_DAYS);
    const s = await Vault.getStatus(user.address);
    expect(s.access).to.equal(true);
    expect(s.tier).to.equal(2);
    expect(s.tierName).to.equal("Premium");
    expect(s.locked).to.equal(TIER2);
    expect(s.unlockIn).to.be.gt(0);
    expect(s.inCooldown).to.equal(false);
  });

  it("T31: updateProduct() only owner", async () => {
    await expect(Vault.connect(user).updateProduct("X", "https://x.com"))
      .to.be.reverted;
    await Vault.connect(governance).updateProduct("NewName", "https://new.com");
    expect(await Vault.productName()).to.equal("NewName");
  });

  it("T32: lock() then getStatus() shows updated values", async () => {
    const sBefore = await Vault.getStatus(user.address);
    expect(sBefore.access).to.equal(false);
    expect(sBefore.locked).to.equal(0);

    await Vault.connect(user).lock(TIER3, SEVEN_DAYS);
    const sAfter = await Vault.getStatus(user.address);
    expect(sAfter.access).to.equal(true);
    expect(sAfter.tier).to.equal(3);
    expect(sAfter.locked).to.equal(TIER3);
  });

  it("T33: unlock() returns tokens to user", async () => {
    const balBefore = await IFR.balanceOf(user.address);
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    const balAfterLock = await IFR.balanceOf(user.address);
    expect(balAfterLock).to.equal(balBefore.sub(MIN_REQUIRED));

    await ethers.provider.send("evm_increaseTime", [SEVEN_DAYS]);
    await ethers.provider.send("evm_mine", []);
    await Vault.connect(user).unlock();

    const balAfterUnlock = await IFR.balanceOf(user.address);
    expect(balAfterUnlock).to.equal(balBefore);
  });

  it("T34: productName set in constructor", async () => {
    expect(await Vault.productName()).to.equal("TestProduct");
  });

  it("T35: productUrl set in constructor", async () => {
    expect(await Vault.productUrl()).to.equal("https://test.example.com");
  });

  it("T36: setMinRequired() only owner", async () => {
    await expect(Vault.connect(user).setMinRequired(100)).to.be.reverted;
    await Vault.connect(governance).setMinRequired(ethers.utils.parseUnits("1000", 9));
    expect(await Vault.minRequired()).to.equal(ethers.utils.parseUnits("1000", 9));
  });

  it("T37: setMinLockDuration() only owner", async () => {
    await expect(Vault.connect(user).setMinLockDuration(30 * 86400)).to.be.reverted;
    await Vault.connect(governance).setMinLockDuration(30 * 86400);
    expect(await Vault.minLockDuration()).to.equal(30 * 86400);
  });

  it("T38: setTierThresholds() only owner + ascending", async () => {
    await expect(Vault.connect(user).setTierThresholds(1, 2, 3)).to.be.reverted;
    await expect(Vault.connect(governance).setTierThresholds(1000, 500, 2000))
      .to.be.revertedWith("Thresholds must be ascending");
    await Vault.connect(governance).setTierThresholds(100e9, 500e9, 1000e9);
    expect(await Vault.tier1Threshold()).to.equal(100e9);
  });

  it("T39: setCooldownDuration() only owner", async () => {
    await expect(Vault.connect(user).setCooldownDuration(3600)).to.be.reverted;
    await Vault.connect(governance).setCooldownDuration(2 * 3600);
    expect(await Vault.cooldownDuration()).to.equal(2 * 3600);
  });

  it("T40: constructor reverts with empty product name", async () => {
    const F = await ethers.getContractFactory("IFRBuilderVault");
    await expect(F.deploy(IFR.address, MIN_REQUIRED, SEVEN_DAYS, "", "https://x.com", governance.address))
      .to.be.revertedWith("name empty");
  });

  it("T41: constructor reverts with zero token address", async () => {
    const F = await ethers.getContractFactory("IFRBuilderVault");
    await expect(F.deploy(ethers.constants.AddressZero, MIN_REQUIRED, SEVEN_DAYS, "X", "https://x.com", governance.address))
      .to.be.revertedWith("token=0");
  });

  it("T42: lock() reverts if already locked", async () => {
    await Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS);
    await expect(Vault.connect(user).lock(MIN_REQUIRED, SEVEN_DAYS))
      .to.be.revertedWith("Already locked");
  });

  it("T43: unlock() reverts when nothing locked", async () => {
    await expect(Vault.connect(user).unlock()).to.be.revertedWith("Nothing locked");
  });

  it("T44: lock() reverts with too long duration", async () => {
    await expect(Vault.connect(user).lock(MIN_REQUIRED, 400 * 86400))
      .to.be.revertedWith("Duration too long");
  });

  it("T45: ifrToNextTier() returns 0 at max tier", async () => {
    await Vault.connect(user).lock(TIER3, SEVEN_DAYS);
    expect(await Vault.ifrToNextTier(user.address)).to.equal(0);
  });
});
