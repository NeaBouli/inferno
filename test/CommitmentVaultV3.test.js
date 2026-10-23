import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

describe("CommitmentVaultV3 native batch/split draft", function () {
  const U = 10n ** 9n;
  const DAY = 86400n;
  const LIMITS = [100000n * U, 250000n * U, 1000000n * U, 100000n * U];
  let owner, alice, bob, caller, token, vault;

  const now = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const next = async (at) => ethers.provider.send("evm_setNextBlockTimestamp", [Number(at)]);
  const sum = (amounts) => amounts.reduce((total, amount) => total + amount, 0n);
  const condition = (at) => [0, at, 0];
  const parts = (amounts, conditions) => amounts.map((amount, i) => [amount, conditions[i]]);

  async function deadlines(count) {
    const at = (await now()) + 3n * DAY;
    return Array.from({ length: count }, (_, i) => condition(at + BigInt(i) * DAY));
  }

  async function configure(candidate = vault, limits = LIMITS) {
    await candidate.queueEntryConfiguration(limits);
    await next(await candidate.configurationEta());
    await candidate.executeEntryConfiguration(await candidate.configurationNonce());
  }

  function submit(mode, amounts, conditions, user = alice, total = sum(amounts)) {
    return mode === "batch"
      ? vault.connect(user).lockBatch(amounts, conditions)
      : vault.connect(user).lockSplit(total, parts(amounts, conditions));
  }

  function events(receipt, name, candidate = vault) {
    return receipt.logs.filter((log) => log.address.toLowerCase() === candidate.target.toLowerCase())
      .map((log) => candidate.interface.parseLog(log)).filter((log) => log.name === name);
  }

  async function ledger(candidate = vault) {
    const wallets = [];
    for (const user of [alice, bob, caller]) {
      const count = await candidate.getTrancheCount(user.address);
      const tranches = [];
      for (let id = 0n; id < count; id++) tranches.push(await candidate.getTranche(user.address, id));
      wallets.push({
        balance: await token.balanceOf(user.address),
        allowance: await token.allowance(user.address, candidate.target),
        locked: await candidate.lockedBalance(user.address),
        active: await candidate.activeLockCount(user.address),
        tranches,
      });
    }
    return {
      wallets,
      custody: await token.balanceOf(candidate.target),
      supply: await token.totalSupply(),
      total: await candidate.totalLocked(),
      gross: await candidate.unprunedEntryAmount(),
      head: await candidate.entryHead(),
    };
  }

  async function unchanged(action, error, args, source = vault) {
    const before = await ledger();
    const assertion = expect(action()).to.be.revertedWithCustomError(source, error);
    if (args) await assertion.withArgs(...args);
    else await assertion;
    expect(await ledger()).to.deep.equal(before);
  }

  async function conservation() {
    const state = await ledger();
    let total = 0n;
    for (const [i, wallet] of state.wallets.entries()) {
      let locked = 0n, active = 0n;
      for (const tranche of wallet.tranches) {
        expect(tranche.depositor).to.equal([alice, bob, caller][i].address);
        if (!tranche.unlocked) { locked += tranche.amount; active++; }
        else expect(tranche.amount).to.equal(0n);
      }
      expect(wallet.locked).to.equal(locked);
      expect(wallet.active).to.equal(active);
      total += locked;
    }
    expect(state.total).to.equal(total);
    expect(state.custody).to.be.gte(total);
  }

  async function useReentrantToken() {
    token = await (await ethers.getContractFactory("MockCommitmentV2ReentrantToken")).deploy();
    vault = await (await ethers.getContractFactory("CommitmentVaultV3")).deploy(token.target, owner.address);
    await token.transfer(alice.address, 1000n * U);
    await token.connect(alice).approve(vault.target, ethers.MaxUint256);
    await configure();
  }

  beforeEach(async function () {
    [owner, alice, bob, caller] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockCommitmentV3Token")).deploy();
    vault = await (await ethers.getContractFactory("CommitmentVaultV3")).deploy(token.target, owner.address);
    for (const user of [alice, bob, caller]) {
      await token.mint(user.address, 2000000n * U);
      await token.connect(user).approve(vault.target, ethers.MaxUint256);
    }
    await configure();
  });

  it("starts disabled with V2 hard bounds, a distinct version, and no extra administration", async function () {
    const candidate = await (await ethers.getContractFactory("CommitmentVaultV3")).deploy(token.target, owner.address);
    expect(await candidate.depositsEnabled()).to.equal(false);
    expect(await candidate.entryLimits()).to.deep.equal([0n, 0n, 0n, 0n]);
    expect(await candidate.owner()).to.equal(owner.address);
    expect(await candidate.VERSION()).to.equal(3n);
    expect(await candidate.MAX_LOCK_BATCH()).to.equal(20n);
    expect(await candidate.MAX_BATCH()).to.equal(50n);
    expect(await candidate.MAX_ACTIVE_LOCKS()).to.equal(50n);
    expect(await candidate.CONFIGURATION_DELAY()).to.equal(2n * DAY);
    expect(await candidate.MIN_LOCK_DURATION()).to.equal(DAY);
    expect(await candidate.MAX_LOCK_DURATION()).to.equal(1461n * DAY);
    for (const name of ["lockFor", "migrate", "rescue", "sweep", "upgradeTo", "setPriceOracle"]) {
      expect(candidate.interface.getFunction(name)).to.equal(null);
    }
    const code = await ethers.provider.getCode(candidate.target);
    expect((code.length - 2) / 2).to.be.at.most(24576);
  });

  it("preserves the V2 constructor token and governance restrictions", async function () {
    const factory = await ethers.getContractFactory("CommitmentVaultV3");
    for (const asset of [ethers.ZeroAddress, alice.address]) {
      await expect(factory.deploy(asset, owner.address)).to.be.revertedWithCustomError(vault, "InvalidToken");
    }
    const wrong = await (await ethers.getContractFactory("MockToken")).deploy("Wrong", "WRONG");
    await expect(factory.deploy(wrong.target, owner.address))
      .to.be.revertedWithCustomError(vault, "UnsupportedDecimals").withArgs(18);
    await expect(factory.deploy(token.target, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(vault, "OwnableInvalidOwner");
  });

  it("preserves the V2 single-lock state, events, errors and permissionless exit", async function () {
    const v2 = await (await ethers.getContractFactory("CommitmentVaultV2")).deploy(token.target, owner.address);
    await configure(v2);
    await token.connect(alice).approve(v2.target, ethers.MaxUint256);
    const at = (await now()) + 2n * DAY;
    const amount = 1234567890123n;
    for (const candidate of [v2, vault]) {
      const receipt = await (await candidate.connect(alice).lock(amount, 0, at, 0)).wait();
      const locked = events(receipt, "Locked", candidate)[0].args;
      expect([...locked].slice(0, 2)).to.deep.equal([alice.address, 0n]);
      expect(locked.version).to.equal(await candidate.VERSION());
      expect(locked.requested).to.equal(amount);
      expect(locked.credited).to.equal(amount);
      expect(locked.unlockTime).to.equal(at);
      expect(events(receipt, "BatchLocked", candidate)).to.have.length(0);
      expect(await candidate.getTranche(alice.address, 0))
        .to.deep.equal([alice.address, amount, locked.lockedAt, at, false]);
      expect(await candidate.lockedBalance(alice.address)).to.equal(amount);
      expect(await candidate.totalLocked()).to.equal(amount);
      await expect(candidate.connect(alice).lock(0, 0, at, 0)).to.be.revertedWithCustomError(candidate, "InvalidAmount");
      await candidate.pauseDeposits();
      await expect(candidate.connect(alice).lock(U, 1, at, 0))
        .to.be.revertedWithCustomError(candidate, "PriceConditionsDisabled");
    }
    await next(at);
    for (const candidate of [v2, vault]) {
      await expect(candidate.connect(caller).unlock(alice.address, 0)).to.emit(candidate, "Unlocked")
        .withArgs(alice.address, 0, caller.address, await candidate.VERSION(), amount, amount);
      expect(await candidate.totalLocked()).to.equal(0n);
    }
  });

  for (const mode of ["batch", "split"]) {
    it(`${mode}: one exact approval and one transfer reserve every caller-owned claim before interaction`, async function () {
      const amounts = [1n, 123456789n, 987654321n];
      const conditions = await deadlines(amounts.length);
      const total = sum(amounts);
      await token.connect(alice).approve(vault.target, total);
      const firstId = mode === "batch"
        ? await vault.connect(alice).lockBatch.staticCall(amounts, conditions)
        : await vault.connect(alice).lockSplit.staticCall(total, parts(amounts, conditions));
      expect(firstId).to.equal(0n);
      const receipt = await (await submit(mode, amounts, conditions)).wait();
      const timestamp = BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
      expect(await token.allowance(alice.address, vault.target)).to.equal(0n);
      expect(await token.transferFromCalls()).to.equal(1n);
      expect(await token.observedTotal()).to.equal(total);
      expect(await token.observedWallet()).to.equal(total);
      expect(await token.observedActive()).to.equal(3n);
      expect(await token.observedHistory()).to.equal(3n);
      expect(await token.observedEntries()).to.equal(total);
      const locked = events(receipt, "Locked");
      expect(locked).to.have.length(3);
      for (let i = 0; i < amounts.length; i++) {
        expect([...locked[i].args]).to.deep.equal([
          alice.address, BigInt(i), 3n, amounts[i], amounts[i], timestamp, conditions[i][1],
        ]);
        expect(await vault.getTranche(alice.address, i))
          .to.deep.equal([alice.address, amounts[i], timestamp, conditions[i][1], false]);
      }
      expect(events(receipt, "BatchLocked")).to.have.length(1);
      expect([...events(receipt, "BatchLocked")[0].args]).to.deep.equal([alice.address, 0n, 3n, 3n, total]);
      expect(receipt.logs.at(-1).topics[0]).to.equal(vault.interface.getEvent("BatchLocked").topicHash);
      expect(await vault.getTrancheCount(owner.address)).to.equal(0n);
      expect(await vault.getTrancheCount(token.target)).to.equal(0n);
      expect(await vault.getTrancheCount(vault.target)).to.equal(0n);
      await conservation();
    });

    it(`${mode}: matches separate V2 locks and pays only each original depositor`, async function () {
      const v2 = await (await ethers.getContractFactory("CommitmentVaultV2")).deploy(token.target, owner.address);
      await configure(v2);
      await token.connect(alice).approve(v2.target, ethers.MaxUint256);
      const amounts = [123n, 5n * U, 1234567890n];
      const conditions = await deadlines(3);
      await submit(mode, amounts, conditions);
      for (let i = 0; i < amounts.length; i++) {
        await v2.connect(alice).lock(amounts[i], ...conditions[i]);
        const actual = await vault.getTranche(alice.address, i);
        const single = await v2.getTranche(alice.address, i);
        for (const key of ["depositor", "amount", "unlockTime", "unlocked"]) expect(actual[key]).to.equal(single[key]);
      }
      for (const getter of ["lockedBalance", "activeLockCount", "getTrancheCount", "hasActiveLock"]) {
        expect(await vault[getter](alice.address)).to.equal(await v2[getter](alice.address));
      }
      expect(await vault.totalLocked()).to.equal(await v2.totalLocked());
      expect(await vault.unprunedEntryAmount()).to.equal(await v2.unprunedEntryAmount());
      await submit(mode, [7n], await deadlines(1), bob);
      expect((await vault.getTranche(bob.address, 0)).depositor).to.equal(bob.address);
      await vault.pauseDeposits();
      await token.setExemption(false, true);
      await next(conditions.at(-1)[1]);
      const before = await token.balanceOf(alice.address);
      const executorBefore = await token.balanceOf(caller.address);
      for (let i = 0; i < amounts.length; i++) await vault.connect(caller).unlock(alice.address, i);
      expect(await token.balanceOf(alice.address)).to.equal(before + sum(amounts));
      expect(await token.balanceOf(caller.address)).to.equal(executorBefore);
      await expect(vault.unlock(alice.address, 0)).to.be.revertedWithCustomError(vault, "AlreadyUnlocked");
      await conservation();
    });

    it(`${mode}: accepts one through exactly 20 parts and appends stable IDs after a single lock`, async function () {
      await vault.connect(alice).lock(1n, ...(await deadlines(1))[0]);
      await expect(submit(mode, [2n], await deadlines(1))).to.emit(vault, "BatchLocked")
        .withArgs(alice.address, 1, 3, 1, 2);
      const amounts = Array(20).fill(1n);
      await expect(submit(mode, amounts, await deadlines(20))).to.emit(vault, "BatchLocked")
        .withArgs(alice.address, 2, 3, 20, 20);
      expect(await vault.getTrancheCount(alice.address)).to.equal(22n);
      await conservation();
    });

    for (const count of [0, 21]) {
      it(`${mode}: rejects ${count} parts atomically`, async function () {
        const conditions = await deadlines(count);
        await unchanged(() => submit(mode, Array(count).fill(1n), conditions), "InvalidBatchSize");
      });
    }

    it(`${mode}: a zero-valued later part rolls back the complete call`, async function () {
      const conditions = await deadlines(3);
      await unchanged(() => submit(mode, [U, 0n, U], conditions), "InvalidAmount");
    });

    for (const type of [1, 2, 3]) {
      it(`${mode}: rejects price condition ${type} in a later part, including while paused`, async function () {
        const conditions = await deadlines(2);
        conditions[1][0] = type;
        await unchanged(() => submit(mode, [U, U], conditions), "PriceConditionsDisabled");
        await vault.pauseDeposits();
        await unchanged(() => submit(mode, [U, U], conditions), "PriceConditionsDisabled");
      });
    }

    it(`${mode}: rejects nonzero multipliers and out-of-range enum values`, async function () {
      const conditions = await deadlines(2);
      conditions[1][2] = 1n;
      await unchanged(() => submit(mode, [U, U], conditions), "UnexpectedPriceParameter");
      conditions[1] = [4, conditions[1][1], 0];
      const before = await ledger();
      await expect(submit(mode, [U, U], conditions)).to.revert(ethers);
      expect(await ledger()).to.deep.equal(before);
      await conservation();
    });

    for (const [label, duration, valid] of [
      ["minimum minus one", DAY - 1n, false], ["minimum", DAY, true],
      ["maximum", 1461n * DAY, true], ["maximum plus one", 1461n * DAY + 1n, false],
    ]) {
      it(`${mode}: enforces per-part duration at ${label}`, async function () {
        const timestamp = (await now()) + 1n;
        const conditions = [condition(timestamp + 2n * DAY), condition(timestamp + duration)];
        await next(timestamp);
        if (valid) await expect(submit(mode, [U, U], conditions)).to.emit(vault, "Locked");
        else await unchanged(() => submit(mode, [U, U], conditions), "InvalidUnlockTime");
      });
    }

    it(`${mode}: rejects paused deposits and false/reverting exemptions without custody`, async function () {
      let conditions = await deadlines(2);
      await vault.pauseDeposits();
      await unchanged(() => submit(mode, [U, U], conditions), "DepositsDisabled");
      await configure();
      conditions = await deadlines(2);
      for (const reverts of [false, true]) {
        await token.setExemption(false, reverts);
        await unchanged(() => submit(mode, [U, U], conditions), "FeeExemptionRequired");
      }
    });

    for (const [label, limits, amounts] of [
      ["per-lock", [10n, 100n, 100n, 100n], [1n, 11n]],
      ["wallet", [10n, 10n, 100n, 100n], [6n, 5n]],
      ["global", [10n, 100n, 10n, 100n], [6n, 5n]],
      ["rolling gross", [10n, 100n, 100n, 10n], [6n, 5n]],
    ]) {
      it(`${mode}: enforces the ${label} cap on the entire request`, async function () {
        await configure(vault, limits);
        const conditions = await deadlines(2);
        await unchanged(() => submit(mode, amounts, conditions), "EntryLimitExceeded");
        await submit(mode, [5n, 5n], conditions);
        await conservation();
      });
    }

    it(`${mode}: pre-existing claims and other wallets consume aggregate capacity`, async function () {
      await configure(vault, [10n, 15n, 20n, 100n]);
      const conditions = await deadlines(2);
      await vault.connect(alice).lock(10n, ...conditions[0]);
      await unchanged(() => submit(mode, [3n, 3n], conditions), "EntryLimitExceeded");
      await submit(mode, [2n, 3n], conditions);
      await unchanged(() => submit(mode, [3n, 3n], conditions, bob), "EntryLimitExceeded");
      await submit(mode, [2n, 3n], conditions, bob);
      await conservation();
    });

    for (const fee of [1n, 350n, 10000n]) {
      it(`${mode}: ${fee} bps incoming tax reverts supply, allowance and every reservation`, async function () {
        await token.setFeeBps(fee);
        const amounts = [123456789n, 987654321n];
        const conditions = await deadlines(2);
        const total = sum(amounts);
        await token.connect(alice).approve(vault.target, total);
        await unchanged(() => submit(mode, amounts, conditions), "ReceiptMismatch", [total, total - total * fee / 10000n]);
        expect(await token.transferFromCalls()).to.equal(0n);
      });
    }

    it(`${mode}: donations cannot hide short receipts and excess receipts also revert`, async function () {
      await token.mint(vault.target, 100n * U);
      const amounts = [U, U];
      const conditions = await deadlines(2);
      await token.setFeeBps(350);
      await unchanged(() => submit(mode, amounts, conditions), "ReceiptMismatch", [2n * U, 1930000000n]);
      await token.setFeeBps(0);
      await token.setReceiptBonus(1n);
      await unchanged(() => submit(mode, amounts, conditions), "ReceiptMismatch", [2n * U, 2n * U + 1n]);
      await token.setReceiptBonus(0n);
      await submit(mode, amounts, conditions);
      expect(await vault.totalLocked()).to.equal(2n * U);
      expect(await token.balanceOf(vault.target)).to.equal(102n * U);
      await conservation();
    });

    it(`${mode}: one-base-unit allocations use integer math with zero-rounded aggregate tax`, async function () {
      await token.setFeeBps(350);
      await submit(mode, [1n, 2n, 3n], await deadlines(3));
      expect(await vault.totalLocked()).to.equal(6n);
      await conservation();
    });

    for (const [fault, error] of [[1, "SafeERC20FailedOperation"], [2, "MockTransferRejected"]]) {
      it(`${mode}: transfer fault ${fault} restores all state`, async function () {
        await token.setTransferFaults(0, fault);
        const conditions = await deadlines(2);
        await unchanged(() => submit(mode, [U, U], conditions), error, undefined, fault === 1 ? vault : token);
      });
    }

    it(`${mode}: insufficient allowance or balance cannot leave partial locks`, async function () {
      const conditions = await deadlines(2);
      await token.connect(alice).approve(vault.target, 2n * U - 1n);
      await unchanged(() => submit(mode, [U, U], conditions), "ERC20InsufficientAllowance", undefined, token);
      const balance = await token.balanceOf(alice.address);
      await token.connect(alice).transfer(bob.address, balance);
      await token.connect(alice).approve(vault.target, 2n * U);
      await unchanged(() => submit(mode, [U, U], conditions), "ERC20InsufficientBalance", undefined, token);
    });

    it(`${mode}: the shared active cap counts every part and release frees slots without reusing IDs`, async function () {
      const conditions = await deadlines(20);
      await submit(mode, Array(20).fill(1n), conditions);
      await submit(mode, Array(20).fill(1n), conditions);
      await unchanged(() => submit(mode, Array(11).fill(1n), conditions.slice(0, 11)), "TooManyActiveLocks");
      await submit(mode, Array(10).fill(1n), conditions.slice(0, 10));
      await unchanged(() => submit(mode, [1n], conditions.slice(0, 1)), "TooManyActiveLocks");
      await next(conditions[0][1]);
      await vault.connect(caller).unlock(alice.address, 0);
      await expect(submit(mode, [1n], await deadlines(1))).to.emit(vault, "BatchLocked")
        .withArgs(alice.address, 50, 3, 1, 1);
      expect(await vault.activeLockCount(alice.address)).to.equal(50n);
      expect(await vault.getTrancheCount(alice.address)).to.equal(51n);
      await conservation();
    });

    for (const reentry of ["lock", "lockBatch", "lockSplit", "unlock", "pruneEntryHistory"]) {
      it(`${mode}: incoming callback cannot reenter ${reentry}`, async function () {
        await useReentrantToken();
        const conditions = await deadlines(2);
        const args = {
          lock: [1n, ...conditions[0]], lockBatch: [[1n], [conditions[0]]],
          lockSplit: [1n, parts([1n], [conditions[0]])], unlock: [alice.address, 0], pruneEntryHistory: [1],
        };
        await token.arm(vault.target, vault.interface.encodeFunctionData(reentry, args[reentry]));
        await unchanged(() => submit(mode, [U, U], conditions), "ReentrancyGuardReentrantCall");
        await token.arm(ethers.ZeroAddress, "0x");
        await submit(mode, [U, U], conditions);
        await conservation();
      });
    }
  }

  it("batch: mismatched amount/condition lengths fail before token interaction", async function () {
    const conditions = await deadlines(2);
    for (const values of [[], conditions]) {
      await unchanged(() => vault.connect(alice).lockBatch([U], values), "ArrayLengthMismatch");
    }
  });

  it("split: zero totals and sums below/above total are rejected atomically", async function () {
    const conditions = await deadlines(2);
    await unchanged(() => submit("split", [1n, 1n], conditions, alice, 0n), "InvalidAmount");
    for (const total of [1n, 3n]) {
      await unchanged(() => submit("split", [1n, 1n], conditions, alice, total), "SplitTotalMismatch", [total, 2n]);
    }
  });

  it("checked aggregate arithmetic rejects overflow before any custody or claim", async function () {
    const conditions = await deadlines(2);
    for (const mode of ["batch", "split"]) {
      const before = await ledger();
      await expect(submit(mode, [ethers.MaxUint256, 1n], conditions, alice, 1n)).to.be.revertedWithPanic(0x11);
      expect(await ledger()).to.deep.equal(before);
    }
  });

  it("preserves per-lock rolling history and bounded maintenance after more than 50 expired entries", async function () {
    const amounts = Array(20).fill(1n);
    const conditions = await deadlines(20);
    for (const user of [alice, bob, caller]) await submit("batch", amounts, conditions, user);
    const tail = await now();
    await next(tail + DAY);
    const fresh = conditions.slice(0, 2);
    await unchanged(() => submit("split", [1n, 1n], fresh), "EntryHistoryNeedsPruning");
    expect(await vault.entryHead()).to.equal(0n);
    await expect(vault.connect(caller).pruneEntryHistory(50)).to.emit(vault, "EntryHistoryPruned").withArgs(0, 50, 50);
    await expect(submit("split", [1n, 1n], fresh)).to.emit(vault, "EntryHistoryPruned").withArgs(50, 60, 10);
    expect(await vault.unprunedEntryAmount()).to.equal(2n);
    await conservation();
  });

  it("expires every part at exact rolling-day equality and never refunds gross budget on release", async function () {
    await configure(vault, [10n, 100n, 100n, 10n]);
    const timestamp = (await now()) + 1n;
    await next(timestamp);
    await submit("batch", [4n, 6n], [condition(timestamp + DAY), condition(timestamp + DAY)]);
    const future = [condition(timestamp + 3n * DAY)];
    await next(timestamp + DAY - 1n);
    await unchanged(() => submit("split", [1n], future, bob), "EntryLimitExceeded");
    await next(timestamp + DAY);
    await vault.connect(caller).unlock(alice.address, 0);
    expect(await vault.unprunedEntryAmount()).to.equal(10n);
    await expect(submit("split", [10n], future, bob)).to.emit(vault, "EntryHistoryPruned").withArgs(0, 2, 10);
    expect(await vault.unprunedEntryAmount()).to.equal(10n);
    await conservation();
  });

  for (const reentry of ["lockBatch", "lockSplit"]) {
    it(`outgoing callback cannot reenter ${reentry}, and a failed exit retains its batch claim`, async function () {
      await useReentrantToken();
      const conditions = await deadlines(2);
      await submit("batch", [U, U], conditions);
      const args = reentry === "lockBatch" ? [[1n], [conditions[0]]] : [1n, parts([1n], [conditions[0]])];
      await token.arm(vault.target, vault.interface.encodeFunctionData(reentry, args));
      await next(conditions[0][1]);
      await unchanged(() => vault.connect(caller).unlock(alice.address, 0), "ReentrancyGuardReentrantCall");
      await token.arm(ethers.ZeroAddress, "0x");
      await vault.connect(caller).unlock(alice.address, 0);
      await conservation();
    });
  }

  it("V2 ownership handover still cancels stale configurations and cannot renounce or rewrite batch terms", async function () {
    const conditions = await deadlines(2);
    await submit("split", [U, U], conditions);
    const tranche = await vault.getTranche(alice.address, 0);
    await vault.queueEntryConfiguration(LIMITS);
    const nonce = await vault.configurationNonce();
    await vault.transferOwnership(bob.address);
    await expect(vault.connect(bob).pauseDeposits()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.connect(bob).acceptOwnership()).to.emit(vault, "EntryConfigurationCancelled").withArgs(nonce);
    expect(await vault.configurationEta()).to.equal(0n);
    await expect(vault.connect(bob).renounceOwnership()).to.be.revertedWithCustomError(vault, "OwnershipRenunciationDisabled");
    await expect(vault.pauseDeposits()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await vault.connect(bob).pauseDeposits();
    expect(await vault.getTranche(alice.address, 0)).to.deep.equal(tranche);
    await next(conditions[0][1]);
    await vault.connect(caller).unlock(alice.address, 0);
    await conservation();
  });

  it("real IFR revocation blocks new batches while permissionless exits report net recipient credit", async function () {
    token = await (await ethers.getContractFactory("InfernoToken")).deploy(owner.address);
    await token.setFeeExempt(owner.address, true);
    vault = await (await ethers.getContractFactory("CommitmentVaultV3")).deploy(token.target, owner.address);
    await token.setFeeExempt(vault.target, true);
    await token.transfer(alice.address, 100n * U);
    await token.connect(alice).approve(vault.target, ethers.MaxUint256);
    await configure();
    const conditions = await deadlines(2);
    await submit("batch", [10n * U, 20n * U], conditions);
    await token.setFeeExempt(vault.target, false);
    await unchanged(() => submit("split", [U, U], conditions), "FeeExemptionRequired");
    await vault.pauseDeposits();
    await next(conditions[0][1]);
    const before = await token.balanceOf(alice.address);
    const tx = await vault.connect(caller).unlock(alice.address, 0);
    const received = (await token.balanceOf(alice.address)) - before;
    expect(received).to.be.gt(0n).and.lt(10n * U);
    await expect(tx).to.emit(vault, "Unlocked").withArgs(alice.address, 0, caller.address, 3, 10n * U, received);
    await conservation();
  });

  it("mixed single/batch/split sequences conserve all claims and preserve independent deadlines", async function () {
    let seed = 20261023n;
    const random = () => { seed = (seed * 1103515245n + 12345n) % (2n ** 31n); return seed; };
    for (let round = 0; round < 5; round++) {
      for (const user of [alice, bob]) {
        const amounts = Array.from({ length: 3 }, () => random() % U + 1n);
        const conditions = await deadlines(3);
        await vault.connect(user).lock(amounts[0], ...conditions[0]);
        await submit("batch", amounts.slice(1), conditions.slice(1), user);
        await submit("split", amounts, conditions, user);
        await conservation();
      }
      await next((await now()) + 6n * DAY);
      await ethers.provider.send("evm_mine", []);
      for (const user of [alice, bob]) {
        const count = await vault.getTrancheCount(user.address);
        for (let id = 0n; id < count; id++) {
          if (!(await vault.getTranche(user.address, id)).unlocked) await vault.connect(caller).unlock(user.address, id);
        }
      }
      await conservation();
    }
  });

  it("batch and split save gas versus separate locks and a maximum batch stays below 6M gas", async function () {
    const amounts = Array(10).fill(U);
    const conditions = await deadlines(20);
    let checkpoint = await ethers.provider.send("evm_snapshot", []);
    const batch = await (await submit("batch", amounts, conditions.slice(0, 10))).wait();
    await ethers.provider.send("evm_revert", [checkpoint]);
    checkpoint = await ethers.provider.send("evm_snapshot", []);
    const split = await (await submit("split", amounts, conditions.slice(0, 10))).wait();
    await ethers.provider.send("evm_revert", [checkpoint]);
    checkpoint = await ethers.provider.send("evm_snapshot", []);
    let singlesGas = 0n;
    for (let i = 0; i < 10; i++) {
      singlesGas += (await (await vault.connect(alice).lock(U, ...conditions[i])).wait()).gasUsed;
    }
    expect(batch.gasUsed).to.be.lt(singlesGas);
    expect(split.gasUsed).to.be.lt(singlesGas);
    await ethers.provider.send("evm_revert", [checkpoint]);
    const maximum = await (await submit("batch", Array(20).fill(U), conditions)).wait();
    expect(maximum.gasUsed).to.be.lt(6000000n);
    console.log(`    gas: 10 singles=${singlesGas}, batch10=${batch.gasUsed}, split10=${split.gasUsed}, batch20=${maximum.gasUsed}`);
  });
});
