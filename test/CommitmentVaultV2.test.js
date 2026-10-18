import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

describe("CommitmentVaultV2 release candidate (time-only specification boundary)", function () {
  const U = 10n ** 9n;
  const DAY = 86400n;
  const MAX_DURATION = 1461n * DAY;
  const DEFAULT_LIMITS = [100000n * U, 250000n * U, 1000000n * U, 100000n * U];
  let owner, alice, bob, caller, nominee, token, vault;

  const now = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const next = async (timestamp) => ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  async function mineAt(timestamp) {
    await next(timestamp);
    await ethers.provider.send("evm_mine", []);
  }
  async function deployVault(asset = token, governance = owner.address) {
    const factory = await ethers.getContractFactory("CommitmentVaultV2");
    return factory.deploy(asset.target, governance);
  }
  async function configure(limits = DEFAULT_LIMITS) {
    await vault.queueEntryConfiguration(limits);
    await next(await vault.configurationEta());
    await vault.executeEntryConfiguration(await vault.configurationNonce());
  }
  async function lock(user = alice, amount = 100n * U, deadline) {
    const id = await vault.getTrancheCount(user.address);
    const at = deadline ?? (await now()) + DAY + 100n;
    await vault.connect(user).lock(amount, 0, at, 0);
    return { id, at };
  }
  async function assertConservation(users = [alice, bob]) {
    let total = 0n;
    for (const user of users) {
      let wallet = 0n;
      let count = 0n;
      const length = await vault.getTrancheCount(user.address);
      for (let id = 0n; id < length; id++) {
        const tranche = await vault.getTranche(user.address, id);
        expect(tranche.depositor).to.equal(user.address);
        if (!tranche.unlocked) { wallet += tranche.amount; count++; }
        else expect(tranche.amount).to.equal(0n);
      }
      expect(await vault.lockedBalance(user.address)).to.equal(wallet);
      expect(await vault.activeLockCount(user.address)).to.equal(count);
      expect(await vault.hasActiveLock(user.address)).to.equal(count > 0n);
      total += wallet;
    }
    expect(await vault.totalLocked()).to.equal(total);
    expect(await token.balanceOf(vault.target)).to.be.gte(total);
  }
  async function useFaultToken() {
    token = await (await ethers.getContractFactory("MockCommitmentV2Token")).deploy();
    vault = await deployVault();
    await token.mint(alice.address, 1000000n * U);
    await token.connect(alice).approve(vault.target, ethers.MaxUint256);
    await configure();
  }

  beforeEach(async function () {
    [owner, alice, bob, caller, nominee] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("InfernoToken")).deploy(owner.address);
    await token.setFeeExempt(owner.address, true);
    vault = await deployVault();
    await token.setFeeExempt(vault.target, true);
    for (const user of [alice, bob]) {
      await token.transfer(user.address, 2000000n * U);
      await token.connect(user).approve(vault.target, ethers.MaxUint256);
    }
    await configure();
  });

  it("CV2-T01 constructs with the exact token/owner, disabled entries and zero ceilings", async function () {
    const candidate = await deployVault();
    expect(await candidate.ifrToken()).to.equal(token.target);
    expect(await candidate.owner()).to.equal(owner.address);
    expect(await candidate.pendingOwner()).to.equal(ethers.ZeroAddress);
    expect(await candidate.depositsEnabled()).to.equal(false);
    expect(await candidate.entryLimits()).to.deep.equal([0n, 0n, 0n, 0n]);
    expect(await candidate.pendingEntryLimits()).to.deep.equal([0n, 0n, 0n, 0n]);
    expect(await candidate.totalLocked()).to.equal(0n);
    expect(await candidate.configurationEta()).to.equal(0n);
    expect(await candidate.VERSION()).to.equal(2n);
    expect(await candidate.IFR_UNIT()).to.equal(U);
  });

  it("CV2-T02 rejects zero/EOA tokens and a zero initial owner", async function () {
    const factory = await ethers.getContractFactory("CommitmentVaultV2");
    for (const address of [ethers.ZeroAddress, alice.address]) {
      await expect(factory.deploy(address, owner.address)).to.be.revertedWithCustomError(vault, "InvalidToken");
    }
    await expect(factory.deploy(token.target, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(vault, "OwnableInvalidOwner").withArgs(ethers.ZeroAddress);
  });

  it("CV2-T03 rejects wrong or missing decimal metadata", async function () {
    const eighteen = await (await ethers.getContractFactory("MockToken")).deploy("Wrong", "WRONG");
    await expect(deployVault(eighteen)).to.be.revertedWithCustomError(vault, "UnsupportedDecimals").withArgs(18);
    const missing = await (await ethers.getContractFactory("MockFalseReturnToken")).deploy();
    await expect(deployVault(missing)).to.be.revertedWithCustomError(vault, "InvalidToken");
  });

  it("CV2-T04 exposes no price, migration, sweep, rescue, proxy or arbitrary-call entry point", async function () {
    const forbidden = ["setP0", "setPriceOracle", "priceOracle", "markConditionMet", "rescue", "sweep", "upgradeTo", "delegatecall", "migrate"];
    for (const name of forbidden) expect(vault.interface.getFunction(name)).to.equal(null);
  });

  for (const type of [1, 2, 3]) {
    it(`CV2-T05.${type} rejects price enum ${type} before custody, including paused entries`, async function () {
      const balance = await token.balanceOf(alice.address);
      await vault.pauseDeposits();
      await expect(vault.connect(alice).lock(U, type, (await now()) + DAY, 200))
        .to.be.revertedWithCustomError(vault, "PriceConditionsDisabled");
      expect(await token.balanceOf(alice.address)).to.equal(balance);
      expect(await vault.getTrancheCount(alice.address)).to.equal(0n);
      expect(await vault.totalLocked()).to.equal(0n);
    });
  }

  it("CV2-T06 rejects ambiguous multiplier data even for TIME_ONLY", async function () {
    await expect(vault.connect(alice).lock(U, 0, (await now()) + DAY + 10n, 1))
      .to.be.revertedWithCustomError(vault, "UnexpectedPriceParameter");
  });

  it("CV2-T07 queues exact limits and enables only at the 48-hour equality boundary", async function () {
    await vault.pauseDeposits();
    const queuedAt = (await now()) + 1n;
    const nonce = (await vault.configurationNonce()) + 1n;
    await next(queuedAt);
    await expect(vault.queueEntryConfiguration(DEFAULT_LIMITS)).to.emit(vault, "EntryConfigurationQueued")
      .withArgs(nonce, ...DEFAULT_LIMITS, queuedAt + 2n * DAY);
    const eta = await vault.configurationEta();
    await next(eta - 1n);
    await expect(vault.executeEntryConfiguration(nonce))
      .to.be.revertedWithCustomError(vault, "ConfigurationNotReady").withArgs(eta);
    expect(await vault.depositsEnabled()).to.equal(false);
    await next(eta);
    await expect(vault.executeEntryConfiguration(nonce))
      .to.emit(vault, "EntryConfigurationExecuted").withArgs(nonce, ...DEFAULT_LIMITS)
      .and.to.emit(vault, "DepositsEnabledChanged").withArgs(false, true);
    expect(await vault.entryLimits()).to.deep.equal(DEFAULT_LIMITS);
    expect(await vault.pendingEntryLimits()).to.deep.equal([0n, 0n, 0n, 0n]);
    expect(await vault.configurationEta()).to.equal(0n);
    await expect(vault.executeEntryConfiguration(nonce)).to.be.revertedWithCustomError(vault, "NoPendingConfiguration");
  });

  it("CV2-T08 replacing/cancelling configurations invalidates stale IDs and restarts the delay", async function () {
    await vault.queueEntryConfiguration(DEFAULT_LIMITS);
    const stale = await vault.configurationNonce();
    const previousEta = await vault.configurationEta();
    const smaller = [U, 2n * U, 3n * U, 4n * U];
    await expect(vault.queueEntryConfiguration(smaller)).to.emit(vault, "EntryConfigurationCancelled").withArgs(stale);
    expect(await vault.configurationEta()).to.be.gt(previousEta);
    await expect(vault.executeEntryConfiguration(stale)).to.be.revertedWithCustomError(vault, "InvalidConfigurationNonce");
    const nonce = await vault.configurationNonce();
    await expect(vault.cancelEntryConfiguration()).to.emit(vault, "EntryConfigurationCancelled").withArgs(nonce);
    expect(await vault.configurationEta()).to.equal(0n);
    await expect(vault.cancelEntryConfiguration()).to.be.revertedWithCustomError(vault, "NoPendingConfiguration");
    await expect(vault.executeEntryConfiguration(nonce)).to.be.revertedWithCustomError(vault, "NoPendingConfiguration");
  });

  it("CV2-T09 validates every zero and maximum-plus-one cap; accepts one-base-unit and hard maximum values", async function () {
    for (let index = 0; index < DEFAULT_LIMITS.length; index++) {
      for (const value of [0n, DEFAULT_LIMITS[index] + 1n]) {
        const limits = [...DEFAULT_LIMITS]; limits[index] = value;
        await expect(vault.queueEntryConfiguration(limits)).to.be.revertedWithCustomError(vault, "InvalidEntryLimits");
      }
    }
    await configure([1n, 1n, 1n, 1n]);
    await lock(alice, 1n);
    await assertConservation();
  });

  it("CV2-T10 pending owner, depositor and strangers have no administrative powers", async function () {
    await vault.transferOwnership(nominee.address);
    for (const user of [alice, caller, nominee]) {
      const actions = [
        () => vault.connect(user).queueEntryConfiguration(DEFAULT_LIMITS),
        () => vault.connect(user).executeEntryConfiguration(1),
        () => vault.connect(user).cancelEntryConfiguration(),
        () => vault.connect(user).pauseDeposits(),
        () => vault.connect(user).transferOwnership(bob.address),
        () => vault.connect(user).cancelOwnershipTransfer(),
        () => vault.connect(user).renounceOwnership(),
      ];
      for (const action of actions) {
        await expect(action()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount").withArgs(user.address);
      }
    }
    expect(await vault.owner()).to.equal(owner.address);
  });

  it("CV2-T11 ownership requires nomination and acceptance, and clears previous queues on acceptance", async function () {
    await vault.queueEntryConfiguration(DEFAULT_LIMITS);
    const nonce = await vault.configurationNonce();
    await expect(vault.transferOwnership(nominee.address)).to.emit(vault, "OwnershipTransferStarted")
      .withArgs(owner.address, nominee.address);
    await expect(vault.connect(bob).acceptOwnership())
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount").withArgs(bob.address);
    await expect(vault.connect(nominee).acceptOwnership()).to.emit(vault, "OwnershipTransferred")
      .withArgs(owner.address, nominee.address)
      .and.to.emit(vault, "EntryConfigurationCancelled").withArgs(nonce);
    expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
    expect(await vault.configurationEta()).to.equal(0n);
    await expect(vault.pauseDeposits()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await vault.connect(nominee).pauseDeposits();
    await expect(vault.connect(nominee).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });

  it("CV2-T12 ownership cancellation/replacement rejects zero and stale nominees", async function () {
    await expect(vault.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "InvalidOwnerNominee");
    await expect(vault.cancelOwnershipTransfer()).to.be.revertedWithCustomError(vault, "NoPendingOwnershipTransfer");
    await vault.transferOwnership(alice.address);
    await vault.transferOwnership(nominee.address);
    await expect(vault.connect(alice).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.cancelOwnershipTransfer()).to.emit(vault, "OwnershipTransferCancelled").withArgs(owner.address, nominee.address);
    expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
    await expect(vault.connect(nominee).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });

  it("CV2-T13 renunciation is disabled both without and with custody", async function () {
    await expect(vault.renounceOwnership()).to.be.revertedWithCustomError(vault, "OwnershipRenunciationDisabled");
    await lock();
    await expect(vault.renounceOwnership()).to.be.revertedWithCustomError(vault, "OwnershipRenunciationDisabled");
  });

  it("CV2-T14 an existing governance contract can accept through its real 48-hour queued call", async function () {
    const governance = await (await ethers.getContractFactory("Governance")).deploy(2n * DAY, caller.address);
    await vault.transferOwnership(governance.target);
    const data = vault.interface.encodeFunctionData("acceptOwnership");
    await governance.propose(vault.target, data);
    await expect(governance.execute(0)).to.be.revertedWith("too early");
    await next((await governance.getProposal(0)).eta);
    await governance.execute(0);
    expect(await vault.owner()).to.equal(governance.target);
    expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
    // Existing Governance is reused, not modified or claimed to meet successor ownership standards.
    await governance.propose(vault.target, vault.interface.encodeFunctionData("pauseDeposits"));
    await next((await governance.getProposal(1)).eta);
    await governance.execute(1);
    expect(await vault.depositsEnabled()).to.equal(false);
  });

  it("CV2-T15 an owner pause cancels pending resumption, and disabled entries never take custody", async function () {
    await vault.queueEntryConfiguration(DEFAULT_LIMITS);
    const nonce = await vault.configurationNonce();
    await expect(vault.pauseDeposits()).to.emit(vault, "DepositsEnabledChanged").withArgs(true, false)
      .and.to.emit(vault, "EntryConfigurationCancelled").withArgs(nonce);
    const before = await token.balanceOf(alice.address);
    await expect(lock()).to.be.revertedWithCustomError(vault, "DepositsDisabled");
    expect(await token.balanceOf(alice.address)).to.equal(before);
    await expect(vault.executeEntryConfiguration(nonce)).to.be.revertedWithCustomError(vault, "NoPendingConfiguration");
    await configure();
    await lock();
  });

  it("CV2-T16 records measured exact receipts, stable IDs, immutable deadlines and versioned events", async function () {
    const timestamp = (await now()) + 1n;
    const deadline = timestamp + DAY;
    const amount = 1234567890123n;
    await next(timestamp);
    await expect(vault.connect(alice).lock(amount, 0, deadline, 0)).to.emit(vault, "Locked")
      .withArgs(alice.address, 0, 2, amount, amount, timestamp, deadline);
    expect(await vault.getTranche(alice.address, 0)).to.deep.equal([alice.address, amount, timestamp, deadline, false]);
    expect(await vault.isConditionMet(alice.address, 0)).to.equal(false);
    await assertConservation();
  });

  it("CV2-T17 rejects zero amount without creating a claim", async function () {
    await expect(lock(alice, 0n)).to.be.revertedWithCustomError(vault, "InvalidAmount");
    await assertConservation();
  });

  for (const [label, duration, valid] of [
    ["past", -1n, false], ["now", 0n, false], ["minimum minus one", DAY - 1n, false],
    ["minimum", DAY, true], ["maximum", MAX_DURATION, true], ["maximum plus one", MAX_DURATION + 1n, false],
  ]) {
    it(`CV2-T18.${label} enforces deposit-relative duration at ${label}`, async function () {
      const timestamp = (await now()) + 1n;
      await next(timestamp);
      const tx = vault.connect(alice).lock(U, 0, timestamp + duration, 0);
      if (valid) await expect(tx).to.emit(vault, "Locked");
      else await expect(tx).to.be.revertedWithCustomError(vault, "InvalidUnlockTime");
    });
  }

  it("CV2-T19 releases at deadline equality but rejects one second before, without a prior mark", async function () {
    const { at } = await lock();
    await next(at - 1n);
    await expect(vault.connect(alice).unlock(alice.address, 0)).to.be.revertedWithCustomError(vault, "ConditionNotMet");
    await next(at);
    await vault.connect(caller).unlock(alice.address, 0);
    expect(await vault.isConditionMet(alice.address, 0)).to.equal(true);
    await assertConservation();
  });

  it("CV2-T20 caller/owner cannot redirect a payment or consume another wallet's identifier", async function () {
    const amount = 765432109n;
    const { at } = await lock(alice, amount);
    const aliceBefore = await token.balanceOf(alice.address);
    const callerBefore = await token.balanceOf(caller.address);
    await next(at);
    await expect(vault.connect(caller).unlock(alice.address, 0)).to.emit(vault, "Unlocked")
      .withArgs(alice.address, 0, caller.address, 2, amount, amount);
    expect(await token.balanceOf(alice.address)).to.equal(aliceBefore + amount);
    expect(await token.balanceOf(caller.address)).to.equal(callerBefore);
    await expect(vault.unlock(caller.address, 0)).to.be.revertedWithCustomError(vault, "InvalidTranche");
    await expect(vault.unlock(alice.address, 0)).to.be.revertedWithCustomError(vault, "AlreadyUnlocked");
    await assertConservation();
  });

  it("CV2-T21 invalid IDs fail in all tranche readers and unlock", async function () {
    for (const id of [0n, ethers.MaxUint256]) {
      await expect(vault.getTranche(alice.address, id)).to.be.revertedWithCustomError(vault, "InvalidTranche");
      await expect(vault.isConditionMet(alice.address, id)).to.be.revertedWithCustomError(vault, "InvalidTranche");
      await expect(vault.unlock(alice.address, id)).to.be.revertedWithCustomError(vault, "InvalidTranche");
    }
  });

  it("CV2-T22 deadline return ignores paused entry and unaccepted ownership", async function () {
    const { at } = await lock();
    await vault.pauseDeposits();
    await vault.transferOwnership(nominee.address);
    await next(at);
    await vault.connect(caller).unlock(alice.address, 0);
    expect(await vault.depositsEnabled()).to.equal(false);
    expect(await vault.owner()).to.equal(owner.address);
    await assertConservation();
  });

  it("CV2-T23 exemption is required again at configuration execution and each deposit", async function () {
    await vault.queueEntryConfiguration(DEFAULT_LIMITS);
    await token.setFeeExempt(vault.target, false);
    await mineAt(await vault.configurationEta());
    await expect(vault.executeEntryConfiguration(await vault.configurationNonce()))
      .to.be.revertedWithCustomError(vault, "FeeExemptionRequired");
    await expect(lock()).to.be.revertedWithCustomError(vault, "FeeExemptionRequired");
    expect(await vault.configurationEta()).to.not.equal(0n);
    await token.setFeeExempt(vault.target, true);
    await vault.executeEntryConfiguration(await vault.configurationNonce());
    await lock();
  });

  it("CV2-T24 absent or reverting exemption metadata fails closed for activation and entry", async function () {
    const noGetter = await (await ethers.getContractFactory("MockInfernoToken")).deploy();
    const candidate = await deployVault(noGetter);
    await candidate.queueEntryConfiguration(DEFAULT_LIMITS);
    await next(await candidate.configurationEta());
    await expect(candidate.executeEntryConfiguration(1)).to.be.revertedWithCustomError(candidate, "FeeExemptionRequired");
    await useFaultToken();
    await token.setExemption(true, true);
    await expect(lock()).to.be.revertedWithCustomError(vault, "FeeExemptionRequired");
  });

  it("CV2-T25 real IFR tax after revoked exemption reduces exit credit but never traps or grosses up the claim", async function () {
    const amount = 1234567890123n;
    const { at } = await lock(alice, amount);
    await token.setFeeExempt(vault.target, false);
    await vault.pauseDeposits();
    const received = amount - amount * 200n / 10000n - amount * 50n / 10000n - amount * 100n / 10000n;
    const before = await token.balanceOf(alice.address);
    await next(at);
    await expect(vault.connect(caller).unlock(alice.address, 0)).to.emit(vault, "Unlocked")
      .withArgs(alice.address, 0, caller.address, 2, amount, received);
    expect(await token.balanceOf(alice.address)).to.equal(before + received);
    await assertConservation();
  });

  for (const fee of [1n, 350n, 10000n]) {
    it(`CV2-T26.${fee} measured incoming tax ${fee} bps rolls back all reservations and balances`, async function () {
      await useFaultToken();
      await token.setFeeBps(fee);
      const amount = 123456789n;
      const before = await token.balanceOf(alice.address);
      const supply = await token.totalSupply();
      await expect(lock(alice, amount)).to.be.revertedWithCustomError(vault, "ReceiptMismatch")
        .withArgs(amount, amount - amount * fee / 10000n);
      expect(await token.balanceOf(alice.address)).to.equal(before);
      expect(await token.totalSupply()).to.equal(supply);
      expect(await vault.getTrancheCount(alice.address)).to.equal(0n);
      expect(await vault.unprunedEntryAmount()).to.equal(0n);
      await assertConservation();
    });
  }

  it("CV2-T27 base-unit rounding is exact and a zero-rounded tax is not fabricated", async function () {
    await useFaultToken();
    await token.setFeeBps(350);
    await lock(alice, 1n);
    expect(await vault.lockedBalance(alice.address)).to.equal(1n);
    await assertConservation();
  });

  it("CV2-T28 a reverting exemption getter is never consulted on exit", async function () {
    await useFaultToken();
    const { at } = await lock();
    await token.setExemption(false, true);
    await next(at);
    await vault.connect(caller).unlock(alice.address, 0);
    await assertConservation();
  });

  for (const [fault, error] of [[1, "SafeERC20FailedOperation"], [2, "MockTransferRejected"]]) {
    it(`CV2-T29.${fault} incoming transfer fault ${fault} is atomic`, async function () {
      await useFaultToken();
      await token.setTransferFaults(0, fault);
      await expect(lock()).to.be.revertedWithCustomError(fault === 1 ? vault : token, error);
      expect(await vault.getTrancheCount(alice.address)).to.equal(0n);
      expect(await vault.unprunedEntryAmount()).to.equal(0n);
      await assertConservation();
    });

    it(`CV2-T30.${fault} outgoing transfer fault ${fault} preserves the whole claim for retry`, async function () {
      await useFaultToken();
      const { at } = await lock();
      const before = await vault.getTranche(alice.address, 0);
      await token.setTransferFaults(fault, 0);
      await next(at);
      await expect(vault.unlock(alice.address, 0)).to.be.revertedWithCustomError(fault === 1 ? vault : token, error);
      expect(await vault.getTranche(alice.address, 0)).to.deep.equal(before);
      await assertConservation();
      await token.setTransferFaults(0, 0);
      await vault.unlock(alice.address, 0);
      await assertConservation();
    });
  }

  it("CV2-T31 missing allowance and insufficient token balance cannot reserve claims", async function () {
    await token.connect(alice).approve(vault.target, 0);
    await expect(lock()).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    await token.connect(caller).approve(vault.target, ethers.MaxUint256);
    await expect(lock(caller)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    await assertConservation([alice, bob, caller]);
  });

  it("CV2-T32 direct donations create no claims, cap capacity or depositor entitlements", async function () {
    await token.transfer(vault.target, 100000n * U);
    expect(await vault.totalLocked()).to.equal(0n);
    expect(await vault.unprunedEntryAmount()).to.equal(0n);
    const { at } = await lock();
    await next(at);
    await vault.unlock(alice.address, 0);
    expect(await token.balanceOf(vault.target)).to.equal(100000n * U);
    await assertConservation();
  });

  it("CV2-T33 per-lock cap rejects plus one and allows equality", async function () {
    await expect(lock(alice, DEFAULT_LIMITS[0] + 1n)).to.be.revertedWithCustomError(vault, "EntryLimitExceeded");
    await lock(alice, DEFAULT_LIMITS[0]);
    await assertConservation();
  });

  it("CV2-T34 per-wallet cap is independent of global and daily capacity", async function () {
    await configure([100n * U, 150n * U, 1000n * U, 1000n * U]);
    await lock(alice, 100n * U);
    await lock(alice, 50n * U);
    await expect(lock(alice, 1n)).to.be.revertedWithCustomError(vault, "EntryLimitExceeded");
    await lock(bob, 1n);
    await assertConservation();
  });

  it("CV2-T35 global outstanding cap resists wallet splitting and frees only on release", async function () {
    await configure([100n * U, 200n * U, 150n * U, 1000n * U]);
    const { at } = await lock(alice, 100n * U);
    await lock(bob, 50n * U);
    await expect(lock(bob, 1n)).to.be.revertedWithCustomError(vault, "EntryLimitExceeded");
    await next(at);
    await vault.unlock(alice.address, 0);
    await lock(bob, 100n * U);
    await assertConservation();
  });

  it("CV2-T36 exact rolling gross limit resists split wallets/calls and expires at 24-hour equality", async function () {
    await configure([100n * U, 1000n * U, 10000n * U, 100n * U]);
    const timestamp = (await now()) + 1n;
    await next(timestamp);
    await lock(alice, 60n * U, timestamp + 2n * DAY);
    await lock(bob, 40n * U, timestamp + 2n * DAY);
    await expect(lock(bob, 1n)).to.be.revertedWithCustomError(vault, "EntryLimitExceeded");
    await next(timestamp + DAY - 1n);
    await expect(lock(alice, 1n, timestamp + 3n * DAY)).to.be.revertedWithCustomError(vault, "EntryLimitExceeded");
    await next(timestamp + DAY);
    await expect(vault.connect(alice).lock(60n * U, 0, timestamp + 3n * DAY, 0))
      .to.emit(vault, "EntryHistoryPruned").withArgs(0, 1, 60n * U);
    expect(await vault.unprunedEntryAmount()).to.equal(100n * U);
    await assertConservation();
  });

  it("CV2-T37 pruning is permissionless, bounded and necessary after more than 50 expired entries", async function () {
    for (let i = 0; i < 50; i++) await lock(alice, 1n);
    await lock(bob, 1n);
    const tail = await now();
    await mineAt(tail + DAY);
    await expect(lock(bob, 1n)).to.be.revertedWithCustomError(vault, "EntryHistoryNeedsPruning");
    // The failed deposit also rolls back its attempted pruning; maintenance is a separate bounded call.
    expect(await vault.entryHead()).to.equal(0n);
    await expect(vault.connect(caller).pruneEntryHistory(50)).to.emit(vault, "EntryHistoryPruned").withArgs(0, 50, 50);
    await lock(bob, 1n);
    expect(await vault.entryHead()).to.equal(51n);
    expect(await vault.unprunedEntryAmount()).to.equal(1n);
    await assertConservation();
  });

  it("CV2-T38 maintenance/page loop bounds reject zero and oversized work", async function () {
    for (const limit of [0n, 51n, ethers.MaxUint256]) {
      await expect(vault.pruneEntryHistory(limit)).to.be.revertedWithCustomError(vault, "InvalidBatchSize");
      await expect(vault.getTranches(alice.address, 0, limit)).to.be.revertedWithCustomError(vault, "InvalidBatchSize");
    }
    await vault.pruneEntryHistory(1);
    await vault.pruneEntryHistory(50);
    expect(await vault.entryHead()).to.equal(0n);
  });

  it("CV2-T39 historical pagination stays bounded, including huge offsets", async function () {
    await lock(alice, 1n); await lock(alice, 2n); await lock(alice, 3n);
    expect((await vault.getTranches(alice.address, 1, 1))[0].amount).to.equal(2n);
    expect((await vault.getTranches(alice.address, 2, 50)).length).to.equal(1);
    expect((await vault.getTranches(alice.address, 3, 50)).length).to.equal(0);
    expect((await vault.getTranches(alice.address, ethers.MaxUint256, 50)).length).to.equal(0);
    expect((await vault.getTranches(bob.address, 0, 1)).length).to.equal(0);
  });

  it("CV2-T40 concurrent count is capped at 50 and terminal release frees a slot without reusing IDs", async function () {
    let first;
    for (let i = 0; i < 50; i++) {
      const result = await lock(alice, 1n);
      first ??= result;
    }
    await expect(lock(alice, 1n)).to.be.revertedWithCustomError(vault, "TooManyActiveLocks");
    await next(first.at);
    await vault.connect(caller).unlock(alice.address, 0);
    await lock(alice, 1n);
    expect(await vault.getTrancheCount(alice.address)).to.equal(51n);
    expect(await vault.activeLockCount(alice.address)).to.equal(50n);
    expect((await vault.getTranche(alice.address, 0)).unlocked).to.equal(true);
    expect((await vault.getTranche(alice.address, 50)).unlocked).to.equal(false);
    await assertConservation();
  });

  it("CV2-T41 reducing caps never rewrites old claims or blocks deadline return", async function () {
    const { at } = await lock(alice, 100n * U, (await now()) + 5n * DAY);
    const before = await vault.getTranche(alice.address, 0);
    await configure([1n, 1n, 1n, 1n]);
    expect(await vault.getTranche(alice.address, 0)).to.deep.equal(before);
    await expect(lock(bob, 1n)).to.be.revertedWithCustomError(vault, "EntryLimitExceeded");
    await next(at);
    await vault.unlock(alice.address, 0);
    await lock(bob, 1n);
    await assertConservation();
  });

  it("CV2-T42 even a ten-year outage cannot require oracle/governance cooperation to release", async function () {
    await lock(alice, U, (await now()) + MAX_DURATION);
    await vault.pauseDeposits();
    await mineAt((await now()) + 3660n * DAY);
    await vault.connect(caller).unlock(alice.address, 0);
    await assertConservation();
  });

  it("CV2-T43 transfer callback cannot reenter a deposit; reservations roll back", async function () {
    token = await (await ethers.getContractFactory("MockCommitmentV2ReentrantToken")).deploy();
    vault = await deployVault();
    await token.transfer(alice.address, 1000n * U);
    await token.connect(alice).approve(vault.target, ethers.MaxUint256);
    await configure();
    const at = (await now()) + 2n * DAY;
    const payload = vault.interface.encodeFunctionData("lock", [1n, 0, at, 0]);
    await token.arm(vault.target, payload);
    await expect(lock(alice, U, at)).to.be.revertedWithCustomError(vault, "ReentrancyGuardReentrantCall");
    expect(await vault.getTrancheCount(alice.address)).to.equal(0n);
    expect(await vault.unprunedEntryAmount()).to.equal(0n);
    await assertConservation();
    await token.arm(ethers.ZeroAddress, "0x");
    await lock(alice, U, at);
    await assertConservation();
  });

  for (const reentry of ["unlock", "lock", "pruneEntryHistory"]) {
    it(`CV2-T44.${reentry} outgoing callback cannot reenter ${reentry} or double-spend a claim`, async function () {
      token = await (await ethers.getContractFactory("MockCommitmentV2ReentrantToken")).deploy();
      vault = await deployVault();
      await token.transfer(alice.address, 1000n * U);
      await token.connect(alice).approve(vault.target, ethers.MaxUint256);
      await configure();
      const { at } = await lock(alice, U);
      const args = reentry === "unlock" ? [alice.address, 0] : reentry === "lock" ? [1n, 0, at + DAY, 0] : [1];
      await token.arm(vault.target, vault.interface.encodeFunctionData(reentry, args));
      await next(at);
      await expect(vault.unlock(alice.address, 0)).to.be.revertedWithCustomError(vault, "ReentrancyGuardReentrantCall");
      expect((await vault.getTranche(alice.address, 0)).unlocked).to.equal(false);
      await assertConservation();
      await token.arm(ethers.ZeroAddress, "0x");
      await vault.unlock(alice.address, 0);
      await assertConservation();
    });
  }

  it("CV2-T45 deterministic mixed-wallet sequences preserve liabilities, immutable terms and single consumption", async function () {
    let seed = 20261018n;
    const random = () => { seed = (seed * 1103515245n + 12345n) % (2n ** 31n); return seed; };
    const terms = [];
    await token.transfer(vault.target, 123n);
    for (let step = 0; step < 35; step++) {
      const user = random() % 2n === 0n ? alice : bob;
      const amount = random() % (100n * U) + 1n;
      const result = await lock(user, amount, (await now()) + DAY + random() % DAY + 10n);
      terms.push({ user, ...result, tranche: await vault.getTranche(user.address, result.id) });
      if (step % 5 === 4) {
        await mineAt((await now()) + 2n * DAY);
        for (const term of terms) {
          const current = await vault.getTranche(term.user.address, term.id);
          expect(current.unlockTime).to.equal(term.tranche.unlockTime);
          expect(current.lockedAt).to.equal(term.tranche.lockedAt);
          if (!current.unlocked && (random() % 2n === 0n)) {
            await vault.connect(caller).unlock(term.user.address, term.id);
          }
        }
      }
      await assertConservation();
    }
    await mineAt((await now()) + MAX_DURATION);
    for (const term of terms) {
      if (!(await vault.getTranche(term.user.address, term.id)).unlocked) await vault.unlock(term.user.address, term.id);
      await expect(vault.unlock(term.user.address, term.id)).to.be.revertedWithCustomError(vault, "AlreadyUnlocked");
    }
    await assertConservation();
    expect(await token.balanceOf(vault.target)).to.equal(123n);
  });

  it("CV2-T46 release frees outstanding capacity without changing recorded gross-entry spend", async function () {
    const { at } = await lock(alice, 100n * U);
    const gross = await vault.unprunedEntryAmount();
    await next(at);
    await vault.unlock(alice.address, 0);
    expect(await vault.unprunedEntryAmount()).to.equal(gross);
    expect(await vault.totalLocked()).to.equal(0n);
    await vault.connect(caller).pruneEntryHistory(50);
    expect(await vault.unprunedEntryAmount()).to.equal(0n);
    await assertConservation();
  });

  it("CV2-T47 a separate new vault cannot consume legacy vault custody, IDs or allowances", async function () {
    const legacy = await (await ethers.getContractFactory("CommitmentVault")).deploy(token.target, owner.address);
    await token.setFeeExempt(legacy.target, true);
    await token.connect(alice).approve(legacy.target, U);
    const at = (await now()) + 2n * DAY;
    await legacy.connect(alice).lock(U, 0, at, 0);
    const legacyClaim = await legacy.getTranche(alice.address, 0);
    const legacyBalance = await token.balanceOf(legacy.target);
    await expect(vault.unlock(alice.address, 0)).to.be.revertedWithCustomError(vault, "InvalidTranche");
    await lock(alice, 2n * U, at);
    await next(at);
    await vault.connect(caller).unlock(alice.address, 0);
    expect(await legacy.getTranche(alice.address, 0)).to.deep.equal(legacyClaim);
    expect(await token.balanceOf(legacy.target)).to.equal(legacyBalance);
    expect(await legacy.totalLocked()).to.equal(U);
    await assertConservation();
  });
});
