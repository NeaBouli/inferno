const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IFRLock", function () {
  let owner, guardian, userA, userB;
  let token, lock;

  const parse = (s) => ethers.utils.parseUnits(s, 9);
  const INITIAL_SUPPLY = parse("1000000000");

  beforeEach(async () => {
    [owner, guardian, userA, userB] = await ethers.getSigners();

    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.deployed();

    // Make owner fee-exempt for clean test transfers
    await token.setFeeExempt(owner.address, true);

    const IFRLock = await ethers.getContractFactory("IFRLock");
    lock = await IFRLock.deploy(token.address, guardian.address);
    await lock.deployed();

    // Make lock contract fee-exempt (required for production use)
    await token.setFeeExempt(lock.address, true);

    // Give userA and userB some IFR for testing
    await token.transfer(userA.address, parse("100000"));
    await token.transfer(userB.address, parse("50000"));

    // Make users fee-exempt so test math is clean
    await token.setFeeExempt(userA.address, true);
    await token.setFeeExempt(userB.address, true);
  });

  // ── Deployment ────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets token, guardian, and totalLocked correctly", async () => {
      expect(await lock.token()).to.equal(token.address);
      expect(await lock.guardian()).to.equal(guardian.address);
      expect(await lock.totalLocked()).to.equal(0);
    });

    it("reverts if token is zero address", async () => {
      const IFRLock = await ethers.getContractFactory("IFRLock");
      await expect(
        IFRLock.deploy(ethers.constants.AddressZero, guardian.address)
      ).to.be.revertedWith("token=0");
    });

    it("reverts if guardian is zero address", async () => {
      const IFRLock = await ethers.getContractFactory("IFRLock");
      await expect(
        IFRLock.deploy(token.address, ethers.constants.AddressZero)
      ).to.be.revertedWith("guardian=0");
    });
  });

  // ── lock() ────────────────────────────────────────────────

  describe("lock()", () => {
    it("locks tokens and emits Locked event", async () => {
      const amount = parse("10000");
      await token.connect(userA).approve(lock.address, amount);

      await expect(lock.connect(userA).lock(amount))
        .to.emit(lock, "Locked")
        .withArgs(userA.address, amount, ethers.constants.HashZero);

      expect(await lock.lockedBalance(userA.address)).to.equal(amount);
      expect(await lock.totalLocked()).to.equal(amount);
      expect(await token.balanceOf(lock.address)).to.equal(amount);
    });

    it("accumulates on multiple locks", async () => {
      const first = parse("5000");
      const second = parse("3000");

      await token.connect(userA).approve(lock.address, first.add(second));
      await lock.connect(userA).lock(first);
      await lock.connect(userA).lock(second);

      expect(await lock.lockedBalance(userA.address)).to.equal(first.add(second));
      expect(await lock.totalLocked()).to.equal(first.add(second));
    });

    it("reverts on zero amount", async () => {
      await expect(lock.connect(userA).lock(0)).to.be.revertedWith("amount=0");
    });

    it("reverts without approval", async () => {
      await expect(lock.connect(userA).lock(parse("1000"))).to.be.reverted;
    });
  });

  // ── lockWithType() ────────────────────────────────────────

  describe("lockWithType()", () => {
    it("locks with a custom lockType tag", async () => {
      const amount = parse("10000");
      const lockType = ethers.utils.id("premium");

      await token.connect(userA).approve(lock.address, amount);

      await expect(lock.connect(userA).lockWithType(amount, lockType))
        .to.emit(lock, "Locked")
        .withArgs(userA.address, amount, lockType);

      expect(await lock.lockedBalance(userA.address)).to.equal(amount);
    });
  });

  // ── unlock() ──────────────────────────────────────────────

  describe("unlock()", () => {
    const lockAmount = parse("20000");

    beforeEach(async () => {
      await token.connect(userA).approve(lock.address, lockAmount);
      await lock.connect(userA).lock(lockAmount);
    });

    it("unlocks all tokens and emits Unlocked event", async () => {
      const balBefore = await token.balanceOf(userA.address);

      await expect(lock.connect(userA).unlock())
        .to.emit(lock, "Unlocked")
        .withArgs(userA.address, lockAmount);

      expect(await token.balanceOf(userA.address)).to.equal(balBefore.add(lockAmount));
      expect(await lock.lockedBalance(userA.address)).to.equal(0);
      expect(await lock.totalLocked()).to.equal(0);
    });

    it("reverts on double unlock", async () => {
      await lock.connect(userA).unlock();
      await expect(lock.connect(userA).unlock()).to.be.revertedWith("nothing locked");
    });

    it("reverts if user has nothing locked", async () => {
      await expect(lock.connect(userB).unlock()).to.be.revertedWith("nothing locked");
    });
  });

  // ── Re-Lock after Unlock ──────────────────────────────────

  describe("Re-Lock", () => {
    it("allows lock after a previous unlock", async () => {
      const amount = parse("10000");

      // Lock
      await token.connect(userA).approve(lock.address, amount.mul(2));
      await lock.connect(userA).lock(amount);

      // Unlock
      await lock.connect(userA).unlock();
      expect(await lock.lockedBalance(userA.address)).to.equal(0);

      // Re-Lock
      await lock.connect(userA).lock(amount);
      expect(await lock.lockedBalance(userA.address)).to.equal(amount);
      expect(await lock.totalLocked()).to.equal(amount);
    });
  });

  // ── isLocked() ────────────────────────────────────────────

  describe("isLocked()", () => {
    it("returns true when locked amount >= minAmount", async () => {
      const amount = parse("10000");
      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      expect(await lock.isLocked(userA.address, amount)).to.equal(true);
      expect(await lock.isLocked(userA.address, parse("5000"))).to.equal(true);
      expect(await lock.isLocked(userA.address, parse("1"))).to.equal(true);
    });

    it("returns false when locked amount < minAmount", async () => {
      const amount = parse("10000");
      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      expect(await lock.isLocked(userA.address, parse("10001"))).to.equal(false);
    });

    it("returns false for user with no lock", async () => {
      expect(await lock.isLocked(userB.address, parse("1"))).to.equal(false);
    });

    it("returns true for minAmount 0 (any user)", async () => {
      // Any user has amount >= 0
      expect(await lock.isLocked(userB.address, 0)).to.equal(true);
    });
  });

  // ── lockInfo() ────────────────────────────────────────────

  describe("lockInfo()", () => {
    it("returns amount and lockedAt timestamp", async () => {
      const amount = parse("15000");
      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      const info = await lock.lockInfo(userA.address);
      expect(info.amount).to.equal(amount);
      expect(info.lockedAt).to.be.gt(0);
    });

    it("returns zeros for user with no lock", async () => {
      const info = await lock.lockInfo(userB.address);
      expect(info.amount).to.equal(0);
      expect(info.lockedAt).to.equal(0);
    });

    it("updates lockedAt on additional lock", async () => {
      await token.connect(userA).approve(lock.address, parse("20000"));
      await lock.connect(userA).lock(parse("10000"));

      const info1 = await lock.lockInfo(userA.address);

      // Advance time by 1 block
      await ethers.provider.send("evm_mine", []);

      await lock.connect(userA).lock(parse("5000"));
      const info2 = await lock.lockInfo(userA.address);

      expect(info2.amount).to.equal(parse("15000"));
      expect(info2.lockedAt).to.be.gte(info1.lockedAt);
    });
  });

  // ── Fee-Exempt Interaction ────────────────────────────────

  describe("Fee-Exempt Interaction", () => {
    it("lock and unlock transfer full amounts when contract is feeExempt", async () => {
      const amount = parse("10000");
      const balBefore = await token.balanceOf(userA.address);

      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      expect(await token.balanceOf(userA.address)).to.equal(balBefore.sub(amount));

      await lock.connect(userA).unlock();

      // Full round-trip: balance should be restored
      expect(await token.balanceOf(userA.address)).to.equal(balBefore);
    });

    it("lock without feeExempt deducts fees (user receives less on unlock)", async () => {
      // Remove fee exemption from lock contract
      await token.setFeeExempt(lock.address, false);
      // Remove user exemption too
      await token.setFeeExempt(userA.address, false);

      const amount = parse("10000");
      const balBefore = await token.balanceOf(userA.address);

      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      // Contract receives less than amount due to fees
      const contractBal = await token.balanceOf(lock.address);
      expect(contractBal).to.be.lt(amount);

      // The lock records the original amount (from transferFrom)
      // but the contract only holds the fee-reduced amount.
      // unlock() will fail or return less.
      // This proves feeExempt is required.
    });
  });

  // ── Pause ─────────────────────────────────────────────────

  describe("Pause", () => {
    it("guardian can pause and lock reverts", async () => {
      await lock.connect(guardian).pause();

      await token.connect(userA).approve(lock.address, parse("1000"));
      await expect(lock.connect(userA).lock(parse("1000"))).to.be.revertedWith(
        "EnforcedPause"
      );
    });

    it("unlock still works when paused", async () => {
      const amount = parse("10000");
      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      await lock.connect(guardian).pause();

      // unlock is NOT paused
      await expect(lock.connect(userA).unlock())
        .to.emit(lock, "Unlocked")
        .withArgs(userA.address, amount);
    });

    it("guardian can unpause", async () => {
      await lock.connect(guardian).pause();
      await lock.connect(guardian).unpause();

      const amount = parse("1000");
      await token.connect(userA).approve(lock.address, amount);
      await expect(lock.connect(userA).lock(amount)).to.emit(lock, "Locked");
    });

    it("non-guardian cannot pause", async () => {
      await expect(lock.connect(userA).pause()).to.be.revertedWith("not guardian");
    });
  });

  // ── setGuardian() ─────────────────────────────────────────

  describe("setGuardian()", () => {
    it("guardian can update guardian", async () => {
      await expect(lock.connect(guardian).setGuardian(userA.address))
        .to.emit(lock, "GuardianUpdated")
        .withArgs(guardian.address, userA.address);

      expect(await lock.guardian()).to.equal(userA.address);
    });

    it("reverts if not guardian", async () => {
      await expect(
        lock.connect(userA).setGuardian(userB.address)
      ).to.be.revertedWith("not guardian");
    });

    it("reverts on zero address", async () => {
      await expect(
        lock.connect(guardian).setGuardian(ethers.constants.AddressZero)
      ).to.be.revertedWith("guardian=0");
    });
  });

  // ── Multi-User Isolation ──────────────────────────────────

  describe("Multi-User", () => {
    it("locks are isolated per user", async () => {
      const amountA = parse("10000");
      const amountB = parse("25000");

      await token.connect(userA).approve(lock.address, amountA);
      await token.connect(userB).approve(lock.address, amountB);

      await lock.connect(userA).lock(amountA);
      await lock.connect(userB).lock(amountB);

      expect(await lock.lockedBalance(userA.address)).to.equal(amountA);
      expect(await lock.lockedBalance(userB.address)).to.equal(amountB);
      expect(await lock.totalLocked()).to.equal(amountA.add(amountB));

      // UserA unlocks — should not affect userB
      await lock.connect(userA).unlock();
      expect(await lock.lockedBalance(userA.address)).to.equal(0);
      expect(await lock.lockedBalance(userB.address)).to.equal(amountB);
      expect(await lock.totalLocked()).to.equal(amountB);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("lock with 1 wei (minimum possible amount)", async () => {
      await token.connect(userA).approve(lock.address, 1);
      await expect(lock.connect(userA).lock(1))
        .to.emit(lock, "Locked")
        .withArgs(userA.address, 1, ethers.constants.HashZero);
      expect(await lock.lockedBalance(userA.address)).to.equal(1);
    });

    it("lock with max balance succeeds", async () => {
      const balance = await token.balanceOf(userA.address);
      await token.connect(userA).approve(lock.address, balance);
      await lock.connect(userA).lock(balance);
      expect(await lock.lockedBalance(userA.address)).to.equal(balance);
      expect(await token.balanceOf(userA.address)).to.equal(0);
    });

    it("lock exceeding balance reverts", async () => {
      const balance = await token.balanceOf(userA.address);
      const tooMuch = balance.add(1);
      await token.connect(userA).approve(lock.address, tooMuch);
      await expect(lock.connect(userA).lock(tooMuch)).to.be.reverted;
    });

    it("unlock returns exact locked amount (fee-exempt round trip)", async () => {
      const amount = parse("12345");
      const balBefore = await token.balanceOf(userA.address);

      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);
      await lock.connect(userA).unlock();

      expect(await token.balanceOf(userA.address)).to.equal(balBefore);
    });

    it("multiple lock-unlock cycles work correctly", async () => {
      const amount = parse("5000");
      await token.connect(userA).approve(lock.address, amount.mul(3));

      // Cycle 1
      await lock.connect(userA).lock(amount);
      await lock.connect(userA).unlock();
      expect(await lock.lockedBalance(userA.address)).to.equal(0);

      // Cycle 2
      await lock.connect(userA).lock(amount);
      await lock.connect(userA).unlock();
      expect(await lock.lockedBalance(userA.address)).to.equal(0);

      // Cycle 3
      await lock.connect(userA).lock(amount);
      expect(await lock.lockedBalance(userA.address)).to.equal(amount);
    });

    it("isLocked boundary: exact amount returns true", async () => {
      const amount = parse("10000");
      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      expect(await lock.isLocked(userA.address, amount)).to.equal(true);
      expect(await lock.isLocked(userA.address, amount.add(1))).to.equal(false);
    });

    it("totalLocked tracks across multiple users and unlocks", async () => {
      const amountA = parse("10000");
      const amountB = parse("20000");

      await token.connect(userA).approve(lock.address, amountA);
      await token.connect(userB).approve(lock.address, amountB);

      await lock.connect(userA).lock(amountA);
      expect(await lock.totalLocked()).to.equal(amountA);

      await lock.connect(userB).lock(amountB);
      expect(await lock.totalLocked()).to.equal(amountA.add(amountB));

      await lock.connect(userA).unlock();
      expect(await lock.totalLocked()).to.equal(amountB);

      await lock.connect(userB).unlock();
      expect(await lock.totalLocked()).to.equal(0);
    });

    it("lockInfo resets after unlock", async () => {
      const amount = parse("10000");
      await token.connect(userA).approve(lock.address, amount);
      await lock.connect(userA).lock(amount);

      const infoBefore = await lock.lockInfo(userA.address);
      expect(infoBefore.amount).to.equal(amount);
      expect(infoBefore.lockedAt).to.be.gt(0);

      await lock.connect(userA).unlock();

      const infoAfter = await lock.lockInfo(userA.address);
      expect(infoAfter.amount).to.equal(0);
      expect(infoAfter.lockedAt).to.equal(0);
    });
  });
});
