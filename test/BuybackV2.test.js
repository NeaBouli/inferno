import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

// Local source-only draft. All token quantities are bigint nine-decimal base units.
describe("BuybackVaultV2 hardening draft", function () {
  const UNIT = 10n ** 9n;
  const RATE = 1_000n * UNIT;
  const ETH = 10n ** 18n;
  const MIN = 950n * UNIT;
  const HOUR = 3_600n;
  const DAY = 24n * HOUR;
  let owner, guardian, treasury, stranger, nominee;
  let token, weth, burn, pair, factory, inner, router, vault, deployment, limits;

  async function deploy(name, ...args) {
    const instance = await (await ethers.getContractFactory(name)).deploy(...args);
    await instance.waitForDeployment();
    return instance;
  }

  async function now() { return BigInt((await ethers.provider.getBlock("latest")).timestamp); }
  async function mineAt(timestamp) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
    await ethers.provider.send("evm_mine", []);
  }
  async function advance(seconds) { await mineAt(await now() + seconds); }
  async function expiry() { return await now() + 600n; }
  async function hash(address) { return ethers.keccak256(await ethers.provider.getCode(address)); }

  async function setup({ tokenName = "MockBuybackReturnToken", ready = true, reverse = false } = {}) {
    [owner, guardian, treasury, stranger, nominee] = await ethers.getSigners();
    token = tokenName === "InfernoToken"
      ? await deploy(tokenName, stranger.address) : await deploy(tokenName);
    weth = await deploy("MockFeeOnTransferToken");
    burn = await deploy("BurnReserve", token.target, guardian.address);
    factory = await deploy("MockPairFactory");
    pair = await deploy("MockTwapPair", ...(reverse ? [token.target, weth.target] : [weth.target, token.target]));
    await pair.setReserves(...(reverse ? [100n * RATE, 100n * ETH] : [100n * ETH, 100n * RATE]));
    await factory.setPair(weth.target, token.target, pair.target);
    inner = await deploy("MockRouter", weth.target, token.target, RATE);
    router = await deploy("MockBuybackV2Router", inner.target, factory.target);
    deployment = {
      token: token.target, burnReserve: burn.target, treasury: treasury.address,
      router: router.target, factory: factory.target, pair: pair.target, weth: weth.target,
      guardian: guardian.address, initialOwner: owner.address,
      routerCodeHash: await hash(router.target), pairCodeHash: await hash(pair.target),
    };
    // Test values, deliberately not proposed production liquidity/budget policy.
    limits = { rollingBudget: 2n * ETH, budgetWindow: DAY, minWethReserve: 10n * ETH,
      maxTradeBps: 100n, minOracleWindow: HOUR, maxOracleWindow: 4n * HOUR,
      maxOracleAge: 4n * HOUR, maxDeviationBps: 500n, maxDeadlineWindow: HOUR };
    vault = await deploy("BuybackVaultV2", deployment, limits, ETH);
    if (ready) {
      await mineAt(await vault.activationTime());
      await warm();
      await vault.setActive(true);
    }
    await owner.sendTransaction({ to: vault.target, value: 4n * ETH });
  }

  async function warm() {
    await vault.updateOracle();
    await advance(await vault.oracleWindow());
    await vault.updateOracle();
  }

  async function execute(amount = ETH, minimum = MIN, deadline) {
    return vault.executeBuyback(amount, minimum, deadline ?? await expiry());
  }

  async function snapshot() {
    return Promise.all([ethers.provider.getBalance(vault.target), ethers.provider.getBalance(router.target),
      ethers.provider.getBalance(inner.target), token.balanceOf(vault.target), token.balanceOf(burn.target),
      token.balanceOf(treasury.address), token.totalSupply(), vault.lastBuybackAt(), vault.executionCount(),
      vault.spentInWindow(), token.allowance(vault.target, router.target)]);
  }

  function event(receipt) {
    return receipt.logs.filter(log => log.address.toLowerCase() === vault.target.toLowerCase())
      .map(log => vault.interface.parseLog(log)).find(log => log.name === "BuybackExecuted").args;
  }

  async function makeRouterOwner() {
    await vault.transferOwnership(router.target);
    await router.forward(vault.target, vault.interface.encodeFunctionData("acceptOwnership"));
  }

  beforeEach(async () => { await setup(); });

  describe("Deployment and bounded governance", function () {
    for (const field of ["token", "burnReserve", "router", "factory", "pair", "weth", "guardian"]) {
      it(`rejects zero ${field} at construction`, async () => {
        await expect(deploy("BuybackVaultV2", { ...deployment, [field]: ethers.ZeroAddress }, limits, ETH))
          .to.be.revertedWithCustomError(vault, "InvalidAddress");
      });
    }

    it("rejects zero initial ownership and colliding treasury custody", async () => {
      await expect(deploy("BuybackVaultV2", { ...deployment, initialOwner: ethers.ZeroAddress }, limits, ETH))
        .to.be.revertedWithCustomError(vault, "OwnableInvalidOwner");
      for (const recipient of [ethers.ZeroAddress, token.target, router.target, burn.target, pair.target, weth.target]) {
        await expect(deploy("BuybackVaultV2", { ...deployment, treasury: recipient }, limits, ETH))
          .to.be.revertedWithCustomError(vault, "InvalidAddress");
      }
    });

    it("rejects initial ownership by the vault itself, matching nomination validation", async () => {
      const self = ethers.getCreateAddress({ from: owner.address, nonce: await owner.getNonce() });
      await expect(deploy("BuybackVaultV2", { ...deployment, initialOwner: self }, limits, ETH))
        .to.be.revertedWithCustomError(vault, "OwnableInvalidOwner").withArgs(self);
    });

    it("rejects codeless router identity and a token with non-IFR decimals", async () => {
      await expect(deploy("BuybackVaultV2", { ...deployment, router: stranger.address }, limits, ETH))
        .to.be.revertedWithCustomError(vault, "InvalidAddress");
      const wrong = await deploy("MockToken", "Wrong decimals", "WRONG");
      await expect(deploy("BuybackVaultV2", { ...deployment, token: wrong.target }, limits, ETH))
        .to.be.revertedWithCustomError(vault, "InvalidIdentity");
    });

    it("pins router/pair code hashes, canonical factory registration, WETH and reserve token", async () => {
      for (const field of ["routerCodeHash", "pairCodeHash"]) {
        await expect(deploy("BuybackVaultV2", { ...deployment, [field]: ethers.ZeroHash }, limits, ETH))
          .to.be.revertedWithCustomError(vault, "InvalidIdentity");
      }
      const other = await deploy("MockFeeOnTransferToken");
      await expect(deploy("BuybackVaultV2", { ...deployment, weth: other.target }, limits, ETH))
        .to.be.revertedWithCustomError(vault, "InvalidIdentity");
      const wrongReserve = await deploy("BurnReserve", other.target, guardian.address);
      await expect(deploy("BuybackVaultV2", { ...deployment, burnReserve: wrongReserve.target }, limits, ETH))
        .to.be.revertedWithCustomError(vault, "InvalidIdentity");
      await factory.setPair(weth.target, token.target, ethers.ZeroAddress);
      await expect(deploy("BuybackVaultV2", deployment, limits, ETH))
        .to.be.revertedWithCustomError(vault, "InvalidIdentity");
    });

    it("rejects mismatched pair tokens even when registered and code-pinned", async () => {
      const wrong = await deploy("MockTwapPair", weth.target, stranger.address);
      await factory.setPair(weth.target, token.target, wrong.target);
      await expect(deploy("BuybackVaultV2", { ...deployment, pair: wrong.target, pairCodeHash: await hash(wrong.target) }, limits, ETH))
        .to.be.revertedWithCustomError(vault, "InvalidIdentity");
    });

    const badLimits = [
      ["rollingBudget", ETH - 1n], ["budgetWindow", HOUR - 1n], ["budgetWindow", 7n * DAY + 1n],
      ["minWethReserve", 0n], ["maxTradeBps", 0n], ["maxTradeBps", 1_001n],
      ["minOracleWindow", HOUR - 1n], ["maxOracleWindow", HOUR - 1n],
      ["maxOracleAge", HOUR], ["maxOracleAge", 7n * DAY + 1n],
      ["maxDeviationBps", 0n], ["maxDeviationBps", 1_001n],
      ["maxDeadlineWindow", 0n], ["maxDeadlineWindow", DAY + 1n],
    ];
    for (const [field, value] of badLimits) {
      it(`rejects invalid immutable ${field} = ${value}`, async () => {
        await expect(deploy("BuybackVaultV2", deployment, { ...limits, [field]: value }, ETH))
          .to.be.revertedWithCustomError(vault, "InvalidLimits");
      });
    }

    it("rejects a zero spend ceiling", async () => {
      await expect(deploy("BuybackVaultV2", deployment, limits, 0n))
        .to.be.revertedWithCustomError(vault, "InvalidLimits");
    });

    it("F02: atomically rejects zero/100% slippage and every invalid parameter edge", async () => {
      for (const args of [[10_001n, HOUR, 500n], [5_000n, HOUR - 1n, 500n],
        [5_000n, 7n * DAY + 1n, 500n], [5_000n, HOUR, 0n], [5_000n, HOUR, 1_001n], [5_000n, HOUR, 10_000n]]) {
        await expect(vault.setParams(...args, nominee.address)).to.be.revertedWithCustomError(vault, "InvalidParams");
        expect(await vault.treasury()).to.equal(treasury.address);
        expect(await vault.burnShareBps()).to.equal(5_000n);
        expect(await vault.slippageBps()).to.equal(500n);
      }
    });

    it("accepts inclusive parameter limits and emits all old/new values", async () => {
      await expect(vault.setParams(0n, 7n * DAY, 1n, nominee.address)).to.emit(vault, "ParamsUpdated")
        .withArgs(5_000n, 0n, HOUR, 7n * DAY, 500n, 1n, treasury.address, nominee.address);
      await vault.setParams(10_000n, HOUR, 1_000n, treasury.address);
      expect(await vault.burnShareBps()).to.equal(10_000n);
    });

    it("rejects zero/colliding treasury updates, including the vault itself", async () => {
      for (const recipient of [ethers.ZeroAddress, vault.target, token.target, router.target, burn.target, pair.target, weth.target]) {
        await expect(vault.setParams(5_000n, HOUR, 500n, recipient)).to.be.revertedWithCustomError(vault, "InvalidAddress");
      }
    });

    it("gives outsiders and pending owners no configuration or spending power", async () => {
      await vault.transferOwnership(nominee.address);
      for (const account of [stranger, guardian, nominee]) {
        const child = vault.connect(account);
        for (const call of [() => child.setParams(0n, HOUR, 500n, treasury.address),
          () => child.setGuardian(account.address), () => child.setOracleWindow(HOUR),
          () => child.setActive(true), () => child.unpause(), () => child.transferOwnership(account.address),
          () => child.executeBuyback(ETH, MIN, 2n ** 64n)]) {
          await expect(call()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        }
      }
    });
  });

  describe("Ownership and pause-only guardian", function () {
    it("requires nomination/acceptance, supports replacement/cancellation and rejects stale candidates", async () => {
      await expect(vault.transferOwnership(nominee.address)).to.emit(vault, "OwnershipTransferStarted")
        .withArgs(owner.address, nominee.address);
      expect(await vault.owner()).to.equal(owner.address);
      await vault.transferOwnership(stranger.address);
      await expect(vault.connect(nominee).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.cancelOwnershipTransfer()).to.emit(vault, "OwnershipTransferCancelled")
        .withArgs(owner.address, stranger.address);
      await expect(vault.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.cancelOwnershipTransfer()).to.be.revertedWithCustomError(vault, "NoPendingOwnershipTransfer");
      await vault.transferOwnership(nominee.address);
      await expect(vault.connect(nominee).acceptOwnership()).to.emit(vault, "OwnershipTransferred")
        .withArgs(owner.address, nominee.address);
      expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
      await expect(vault.setActive(false)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("rejects zero/self/current-owner nominees and permanently forbids renunciation", async () => {
      for (const recipient of [ethers.ZeroAddress, vault.target, owner.address]) {
        await expect(vault.transferOwnership(recipient)).to.be.revertedWithCustomError(vault, "InvalidOwnerNominee");
      }
      await expect(vault.renounceOwnership()).to.be.revertedWithCustomError(vault, "OwnershipRenunciationDisabled");
    });

    it("F05: guardian only pauses, governance resumes, and replacement revokes the old pause key", async () => {
      await expect(vault.connect(guardian).pause()).to.emit(vault, "Paused").withArgs(guardian.address);
      await expect(execute()).to.be.revertedWithCustomError(vault, "VaultPaused");
      await expect(vault.connect(guardian).unpause()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await vault.transferOwnership(nominee.address);
      await vault.connect(nominee).acceptOwnership();
      await expect(vault.connect(guardian).unpause()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.connect(nominee).unpause()).to.emit(vault, "Unpaused").withArgs(nominee.address);
      await expect(vault.connect(nominee).setGuardian(stranger.address)).to.emit(vault, "GuardianUpdated")
        .withArgs(guardian.address, stranger.address);
      await expect(vault.connect(guardian).pause()).to.be.revertedWithCustomError(vault, "UnauthorizedGuardian");
      await vault.connect(stranger).pause();
      for (const replacement of [ethers.ZeroAddress, vault.target]) {
        await expect(vault.connect(nominee).setGuardian(replacement)).to.be.revertedWithCustomError(vault, "InvalidAddress");
      }
    });

    it("accepts ownership, resumes and spends through real delayed G2 proposals with an independent executor", async () => {
      const governance = await deploy("GovernanceV2", owner.address, stranger.address, 2n * DAY);
      await vault.transferOwnership(governance.target);
      await governance.propose(vault.target, vault.interface.encodeFunctionData("acceptOwnership"));
      await expect(governance.connect(nominee).execute(0n)).to.be.revertedWithCustomError(governance, "InvalidProposalState");
      await mineAt((await governance.getProposal(0n)).eta);
      await governance.connect(nominee).execute(0n);
      expect(await vault.owner()).to.equal(governance.target);
      expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
      await vault.connect(guardian).pause();
      await governance.propose(vault.target, vault.interface.encodeFunctionData("unpause"));
      const deadline = await now() + 2n * DAY + 600n;
      await governance.propose(vault.target, vault.interface.encodeFunctionData("executeBuyback", [ETH, MIN, deadline]));
      const intent = await governance.getProposal(2n);
      expect(deadline).to.be.gt(intent.eta);
      expect(deadline).to.be.lte(intent.expiresAt);
      await expect(governance.connect(nominee).execute(1n)).to.be.revertedWithCustomError(governance, "InvalidProposalState");
      await mineAt(intent.eta - HOUR - 10n);
      await warm();
      await mineAt(intent.eta);
      await governance.connect(nominee).execute(1n);
      await governance.connect(nominee).execute(2n);
      expect(await vault.executionCount()).to.equal(1n);
      expect(await router.observedDeadline()).to.equal(deadline);
      expect(await token.balanceOf(burn.target)).to.equal(RATE / 2n);
    });
  });

  describe("Activation, deadline and spending lifecycle", function () {
    it("funding, pause/resume and the 60-day clock never implicitly activate", async () => {
      await setup({ ready: false });
      expect(await vault.active()).to.equal(false);
      await expect(vault.setActive(true)).to.be.revertedWithCustomError(vault, "NotActive");
      await vault.connect(guardian).pause();
      await vault.unpause();
      await mineAt(await vault.activationTime());
      await expect(execute()).to.be.revertedWithCustomError(vault, "NotActive");
      await expect(vault.setActive(true)).to.be.revertedWithCustomError(vault, "OracleNotReady");
      await warm();
      await vault.setActive(true);
      await vault.setActive(false);
      await expect(execute()).to.be.revertedWithCustomError(vault, "NotActive");
    });

    it("enforces the activation-time boundary with a mature oracle", async () => {
      await setup({ ready: false });
      const activation = await vault.activationTime();
      await mineAt(activation - 2n * HOUR);
      await warm();
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(activation - 1n)]);
      await expect(vault.setActive(true)).to.be.revertedWithCustomError(vault, "NotActive");
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(activation)]);
      await expect(vault.setActive(true)).to.emit(vault, "ActivationChanged").withArgs(false, true);
    });

    it("F04: rejects equal-now, expired and overlong caller deadlines", async () => {
      for (const offset of [-1n, 0n, HOUR + 1n]) {
        const inclusion = await now() + 10n;
        await ethers.provider.send("evm_setNextBlockTimestamp", [Number(inclusion)]);
        await expect(execute(ETH, MIN, inclusion + offset)).to.be.revertedWithCustomError(vault, "InvalidDeadline");
      }
      expect(await vault.executionCount()).to.equal(0n);
    });

    for (const offset of [1n, HOUR]) {
      it(`passes the caller's unchanged deadline at inclusive offset ${offset}`, async () => {
        const inclusion = await now() + 10n;
        const deadline = inclusion + offset;
        await ethers.provider.send("evm_setNextBlockTimestamp", [Number(inclusion)]);
        await execute(ETH, MIN, deadline);
        expect(await router.observedDeadline()).to.equal(deadline);
        expect(await router.observedMinimum()).to.equal(MIN);
      });
    }

    it("F04: a delayed queued transaction expires rather than receiving a fresh deadline", async () => {
      const deadline = await now() + 60n;
      const before = await snapshot();
      const data = vault.interface.encodeFunctionData("executeBuyback", [ETH, MIN, deadline]);
      const gasLimit = await ethers.provider.estimateGas({ from: owner.address, to: vault.target, data });
      await ethers.provider.send("evm_setAutomine", [false]);
      let tx;
      try {
        tx = await owner.sendTransaction({ to: vault.target, data, gasLimit });
        await mineAt(deadline + 1n);
      } finally {
        await ethers.provider.send("evm_setAutomine", [true]);
      }
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      expect(receipt.status).to.equal(0);
      expect(await snapshot()).to.deep.equal(before);
      expect(await router.swapCalls()).to.equal(0n);
    });

    it("spends only the encoded amount, preserving ETH deposited after intent creation", async () => {
      const deadline = await expiry();
      const beforeETH = await ethers.provider.getBalance(vault.target);
      await stranger.sendTransaction({ to: vault.target, value: ETH });
      await execute(ETH, MIN, deadline);
      expect(await ethers.provider.getBalance(vault.target)).to.equal(beforeETH);
      expect(await vault.spentInWindow()).to.equal(ETH);
    });

    it("rejects zero/excessive/underfunded spends and a zero rounded output floor", async () => {
      for (const amount of [0n, ETH + 1n, 5n * ETH]) {
        await expect(execute(amount)).to.be.revertedWithCustomError(vault, "InvalidAmount");
      }
      await expect(execute(1n, 1n)).to.be.revertedWithCustomError(vault, "MinimumTooLow");
      const empty = await deploy("BuybackVaultV2", deployment, limits, ETH);
      await mineAt(await empty.activationTime());
      await empty.updateOracle();
      await advance(HOUR);
      await empty.updateOracle();
      await empty.setActive(true);
      await expect(empty.executeBuyback(ETH, MIN, await expiry())).to.be.revertedWithCustomError(empty, "InvalidAmount");
    });

    it("enforces cooldown immediately below its boundary and permits exactly at it", async () => {
      await execute();
      const last = await vault.lastBuybackAt();
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(last + HOUR - 1n)]);
      await expect(execute(ETH, MIN, last + HOUR + 10n)).to.be.revertedWithCustomError(vault, "CooldownNotElapsed");
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(last + HOUR)]);
      await execute(ETH, MIN, last + HOUR + 10n);
      expect(await vault.executionCount()).to.equal(2n);
    });

    it("enforces an exact rolling budget and releases spend only at its expiry boundary", async () => {
      await execute();
      const first = await vault.lastBuybackAt();
      await mineAt(first + HOUR - 1n);
      await execute();
      await advance(HOUR);
      await expect(execute()).to.be.revertedWithCustomError(vault, "BudgetExceeded");
      await mineAt(first + DAY - 2n * HOUR);
      await warm();
      await mineAt(first + DAY - 1n);
      expect(await vault.spentInWindow()).to.equal(2n * ETH);
      await mineAt(first + DAY);
      expect(await vault.spentInWindow()).to.equal(ETH);
      await execute();
      expect(await vault.spentInWindow()).to.equal(2n * ETH);
    });
  });

  describe("Independent historical floor and manipulation", function () {
    it("uses a completed cumulative TWAP without calling router.getAmountsOut", async () => {
      await expect(router.getAmountsOut(ETH, [weth.target, token.target])).to.be.revertedWith("spot quote forbidden");
      await expect(execute()).to.emit(vault, "BuybackExecuted");
    });

    it("F02/F03: caller cannot choose zero or below-policy minimum, but a stronger minimum is retained", async () => {
      for (const minimum of [0n, 1n, MIN - 1n]) {
        await expect(execute(ETH, minimum)).to.be.revertedWithCustomError(vault, "MinimumTooLow");
      }
      await execute(ETH, RATE);
      expect(await router.observedMinimum()).to.equal(RATE);
    });

    it("F03: a depressed router quote/output cannot lower the vault's independent floor", async () => {
      await inner.setRate(RATE / 1_000n);
      const before = await snapshot();
      await expect(execute()).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
      expect(await snapshot()).to.deep.equal(before);
    });

    it("F03: spot reserves and router price moved inside one transaction revert atomically", async () => {
      await makeRouterOwner();
      const before = await snapshot();
      const reserves = await pair.getReserves();
      const average = await vault.averagePriceX112();
      const data = vault.interface.encodeFunctionData("executeBuyback", [ETH, MIN, await expiry()]);
      await expect(router.manipulateAndExecute(pair.target, 100n * ETH, RATE / 10n, RATE / 1_000n, vault.target, data))
        .to.be.revertedWithCustomError(vault, "SpotDeviation");
      expect(await pair.getReserves()).to.deep.equal(reserves);
      expect(await inner.rateIfrPerEth()).to.equal(RATE);
      expect(await vault.averagePriceX112()).to.equal(average);
      expect(await snapshot()).to.deep.equal(before);
    });

    it("retains a historical average when publishing immediately after a reserve move", async () => {
      const previous = await vault.averagePriceX112();
      await advance(HOUR);
      await pair.setReserves(100n * ETH, RATE / 10n);
      await vault.updateOracle();
      // At most a few seconds of the full hour use manipulated reserves; the spot floor cannot follow it.
      expect(await vault.averagePriceX112()).to.be.gt(previous * 99n / 100n);
      await expect(execute()).to.be.revertedWithCustomError(vault, "SpotDeviation");
    });

    it("cannot publish and consume an oracle average in the same transaction", async () => {
      await makeRouterOwner();
      await advance(HOUR);
      const before = await snapshot();
      const previousUpdate = await vault.oracleUpdatedAt();
      const data = vault.interface.encodeFunctionData("executeBuyback", [ETH, MIN, await expiry()]);
      await expect(router.updateAndExecute(vault.target, data)).to.be.revertedWithCustomError(vault, "OracleNotReady");
      expect(await vault.oracleUpdatedAt()).to.equal(previousUpdate);
      expect(await snapshot()).to.deep.equal(before);
    });

    it("accrues counterfactual cumulative prices correctly across the uint32 timestamp wrap", async () => {
      const checkpoint = await ethers.provider.send("evm_snapshot", []);
      try {
        const wrap = (await now() / (2n ** 32n) + 1n) * (2n ** 32n);
        await mineAt(wrap - HOUR / 2n);
        await vault.setOracleWindow(HOUR);
        await pair.setReserves(100n * ETH, 100n * RATE);
        await warm();
        expect(await now()).to.be.gt(wrap);
        await execute();
        expect(await token.balanceOf(burn.target)).to.equal(RATE / 2n);
      } finally {
        await ethers.provider.send("evm_revert", [checkpoint]);
      }
    });

    it("reads the inverse cumulative direction when WETH is token1", async () => {
      await setup({ reverse: true });
      expect(await vault.wethIsToken0()).to.equal(false);
      await execute();
      expect(await token.balanceOf(burn.target)).to.equal(RATE / 2n);
    });

    it("fails closed on stale observations and requires a new full warm-up after a stale baseline", async () => {
      await advance(limits.maxOracleAge + 1n);
      await expect(execute()).to.be.revertedWithCustomError(vault, "OracleNotReady");
      await vault.updateOracle();
      expect(await vault.averagePriceX112()).to.equal(0n);
      await expect(execute()).to.be.revertedWithCustomError(vault, "OracleNotReady");
      await expect(vault.updateOracle()).to.be.revertedWithCustomError(vault, "ObservationTooShort");
      await advance(HOUR);
      await vault.updateOracle();
      await execute();
    });

    it("invalidates cached prices when changing windows and rejects out-of-range windows", async () => {
      for (const value of [HOUR - 1n, limits.maxOracleWindow + 1n]) {
        await expect(vault.setOracleWindow(value)).to.be.revertedWithCustomError(vault, "InvalidParams");
      }
      await expect(vault.setOracleWindow(2n * HOUR)).to.emit(vault, "OracleWindowUpdated").withArgs(HOUR, 2n * HOUR);
      await expect(execute()).to.be.revertedWithCustomError(vault, "OracleNotReady");
      await warm();
      await execute();
    });

    for (const [r0, r1] of [[0n, 100n * RATE], [100n * ETH, 0n], [ETH, RATE]]) {
      it(`fails closed on empty or thin reserves ${r0}/${r1}`, async () => {
        await pair.setReserves(r0, r1);
        await expect(execute()).to.be.revertedWithCustomError(vault, "InsufficientDepth");
        await expect(vault.updateOracle()).to.be.revertedWithCustomError(vault, "InsufficientDepth");
      });
    }

    it("fails closed on unavailable pair reads and oversized depth-relative trades", async () => {
      await pair.setBroken(true);
      await expect(execute()).to.be.revertedWith("pair broken");
      await pair.setBroken(false);
      await pair.setReserves(10n * ETH, 10n * RATE);
      await expect(execute()).to.be.revertedWithCustomError(vault, "TradeTooLarge");
      await execute(ETH / 10n, MIN / 10n);
    });
  });

  describe("Safe token accounting and absent approval surface", function () {
    for (const mode of [1n, 2n, 3n]) {
      it(`F01: approval fault mode ${mode} has no allowance to leave or spend`, async () => {
        await token.setApproveMode(mode);
        await token.mint(vault.target, 100n * UNIT);
        await execute();
        expect(await token.approvalCalls()).to.equal(0n);
        expect(await token.allowance(vault.target, router.target)).to.equal(0n);
        await expect(router.pull(token.target, vault.target, stranger.address, 1n))
          .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
        expect(await token.balanceOf(vault.target)).to.equal(100n * UNIT);
      });
    }

    it("F01: failed execution also leaves zero router allowance and cannot switch routers", async () => {
      await token.setApproveMode(3n);
      await inner.setRate(1n);
      await expect(execute()).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
      expect(await token.approvalCalls()).to.equal(0n);
      expect(await token.allowance(vault.target, router.target)).to.equal(0n);
      for (const name of ["approve", "setRouter", "withdrawIFR", "withdrawETH", "execute"])
        expect(vault.interface.hasFunction(name)).to.equal(false);
    });

    it("splits only current receipts, emits debits/credits/identities, and never reports a reserve deposit as a burn", async () => {
      await token.mint(vault.target, 123n * UNIT);
      const args = event(await (await execute()).wait());
      expect([...args]).to.deep.equal([1n, ETH, RATE, burn.target, treasury.address,
        RATE / 2n, RATE / 2n, RATE / 2n, RATE / 2n]);
      expect(await token.balanceOf(vault.target)).to.equal(123n * UNIT);
      expect(await burn.totalBurned()).to.equal(0n);
    });

    it("accepts successful no-return transfers and measures their actual credits", async () => {
      await token.setTransferMode(2n, ethers.ZeroAddress);
      await execute();
      expect(await token.balanceOf(burn.target)).to.equal(RATE / 2n);
      expect(await token.balanceOf(treasury.address)).to.equal(RATE / 2n);
    });

    for (const recipient of ["burn", "treasury"]) {
      it(`false ${recipient} transfer reverts ETH, the earlier split, cooldown and budget atomically`, async () => {
        await token.setTransferMode(1n, recipient === "burn" ? burn.target : treasury.address);
        const before = await snapshot();
        await expect(execute()).to.be.revertedWithCustomError(vault, "SafeERC20FailedOperation");
        expect(await snapshot()).to.deep.equal(before);
        expect(await router.swapCalls()).to.equal(0n);
      });
    }

    it("rejects malformed boolean token returns atomically", async () => {
      await setup({ tokenName: "MockBuybackV2MalformedToken" });
      const before = await snapshot();
      await expect(execute()).to.be.revertedWithCustomError(vault, "SafeERC20FailedOperation");
      expect(await snapshot()).to.deep.equal(before);
    });

    it("checks receipt independently even if the reviewed-router mock skips its own minimum", async () => {
      await router.setIgnoreMinimum(true);
      await inner.setRate(RATE / 2n);
      const before = await snapshot();
      await expect(execute()).to.be.revertedWithCustomError(vault, "InsufficientReceipt");
      expect(await snapshot()).to.deep.equal(before);
    });

    it("retains fee-on-transfer net accounting on both swap and distribution hops", async () => {
      await inner.setTransferFeeBpsOnOutput(200n);
      await token.setFeeBps(200n);
      const args = event(await (await execute()).wait());
      const received = RATE * 98n / 100n;
      const debit = received / 2n;
      const credit = debit * 98n / 100n;
      expect(args.received).to.equal(received);
      expect(args.burnDebit).to.equal(debit);
      expect(args.burnCredit).to.equal(credit);
      expect(args.treasuryCredit).to.equal(credit);
      expect(await token.balanceOf(vault.target)).to.equal(0n);
    });

    it("rejects swap transfer taxes exceeding the independent net floor, without lowering it", async () => {
      await inner.setTransferFeeBpsOnOutput(501n);
      const before = await snapshot();
      await expect(execute()).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
      expect(await snapshot()).to.deep.equal(before);
    });

    it("rejects excessive second-hop tax with complete rollback", async () => {
      await token.setFeeBps(10_000n);
      const before = await snapshot();
      await expect(execute()).to.be.revertedWithCustomError(vault, "InsufficientCredit");
      expect(await snapshot()).to.deep.equal(before);
    });

    for (const burnBps of [0n, 10_000n]) {
      it(`accounts for tiny receipts/rounding and a zero split leg at ${burnBps} bps`, async () => {
        await vault.setParams(burnBps, HOUR, 500n, treasury.address);
        const args = event(await (await execute(3_000_000n, 2n)).wait());
        expect(args.received).to.equal(3n);
        expect(args.burnDebit).to.equal(burnBps === 0n ? 0n : 3n);
        expect(args.burnCredit).to.equal(args.burnDebit);
        expect(args.treasuryCredit).to.equal(args.treasuryDebit);
      });
    }

    it("rounds the reserve debit down and assigns the exact remainder to treasury", async () => {
      const args = event(await (await execute(3_000_000n, 2n)).wait());
      expect(args.received).to.equal(3n);
      expect(args.burnDebit).to.equal(1n);
      expect(args.treasuryDebit).to.equal(2n);
      expect(args.burnCredit + args.treasuryCredit).to.equal(3n);
    });
  });

  describe("Real nine-decimal InfernoToken", function () {
    for (const exempt of [false, true]) {
      it(`reconciles nonzero burn/pool fees with exemptions ${exempt}`, async () => {
        await setup({ tokenName: "InfernoToken" });
        await inner.setPayFromBalance(true);
        await token.setFeeExempt(owner.address, true);
        await token.transfer(inner.target, 1_000_000n * UNIT);
        if (exempt) {
          for (const address of [vault.target, burn.target, treasury.address]) await token.setFeeExempt(address, true);
        }
        const supplyBefore = await token.totalSupply();
        const poolBefore = await token.balanceOf(stranger.address);
        const args = event(await (await execute()).wait());
        expect(args.burnCredit).to.equal(await token.balanceOf(burn.target));
        expect(args.treasuryCredit).to.equal(await token.balanceOf(treasury.address));
        expect(args.received).to.equal(args.burnDebit + args.treasuryDebit);
        expect(await token.balanceOf(vault.target)).to.equal(0n);
        expect(await burn.totalBurned()).to.equal(0n);
        if (exempt) {
          expect(args.received).to.equal(RATE);
          expect(args.burnCredit + args.treasuryCredit).to.equal(RATE);
          expect(await token.totalSupply()).to.equal(supplyBefore);
        } else {
          expect(args.received).to.be.lt(RATE);
          expect(args.burnCredit + args.treasuryCredit).to.be.lt(args.received);
          expect(await token.totalSupply()).to.be.lt(supplyBefore);
          expect(await token.balanceOf(stranger.address)).to.be.gt(poolBefore);
        }
      });
    }

    for (const endpoint of ["vault", "burn", "treasury"]) {
      it(`retains exact balance accounting with only ${endpoint} fee-exempt`, async () => {
        await setup({ tokenName: "InfernoToken" });
        await inner.setPayFromBalance(true);
        await token.setFeeExempt(owner.address, true);
        await token.transfer(inner.target, 1_000_000n * UNIT);
        await token.setFeeExempt(endpoint === "vault" ? vault.target : endpoint === "burn" ? burn.target : treasury.address, true);
        const args = event(await (await execute()).wait());
        expect(args.received).to.equal(args.burnDebit + args.treasuryDebit);
        expect(args.burnCredit).to.equal(await token.balanceOf(burn.target));
        expect(args.treasuryCredit).to.equal(await token.balanceOf(treasury.address));
        expect(await token.balanceOf(vault.target)).to.equal(0n);
        expect(await burn.totalBurned()).to.equal(0n);
      });
    }
  });

  describe("Cross-function reentrancy", function () {
    for (const name of ["executeBuyback", "setParams", "setGuardian", "setOracleWindow", "setActive", "unpause", "pause",
      "transferOwnership", "cancelOwnershipTransfer", "acceptOwnership", "updateOracle", "depositETH"]) {
      it(`rejects a privileged router callback into ${name}`, async () => {
        await makeRouterOwner();
        const args = { executeBuyback: [ETH, MIN, await expiry()], setParams: [0n, HOUR, 500n, treasury.address],
          setGuardian: [stranger.address], setOracleWindow: [HOUR], setActive: [false],
          transferOwnership: [nominee.address] };
        await router.arm(vault.target, vault.interface.encodeFunctionData(name, args[name] ?? []));
        await router.forward(vault.target, vault.interface.encodeFunctionData("executeBuyback", [ETH, MIN, await expiry()]));
        expect(await router.callbackSucceeded()).to.equal(false);
        expect(await router.callbackResult()).to.equal(ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10));
        expect(await vault.executionCount()).to.equal(1n);
        expect(await vault.treasury()).to.equal(treasury.address);
        expect(await vault.active()).to.equal(true);
      });
    }

    it("rejects a privileged token callback and rolls back all swap and accounting effects", async () => {
      await setup({ tokenName: "MockReentrantToken" });
      await inner.setPayFromBalance(true);
      await token.transfer(inner.target, 100_000n * UNIT);
      await vault.transferOwnership(token.target);
      // The token's transfer hook accepts ownership, then its next hook tries reentering execution.
      await token.arm(vault.target, vault.interface.encodeFunctionData("acceptOwnership"));
      await token.transfer(stranger.address, 1n);
      // Use the token callback as owner to initiate execution from an outer ordinary transfer.
      await token.arm(vault.target, vault.interface.encodeFunctionData("executeBuyback", [ETH, MIN, await expiry()]));
      const before = await snapshot();
      // The one-shot existing mock clears its hook before calling, so use a router callback to
      // attempt privileged token configuration while the outer execution holds the same guard.
      await router.arm(token.target, token.interface.encodeFunctionData("arm", [vault.target,
        vault.interface.encodeFunctionData("setActive", [false])]));
      await expect(token.transfer(stranger.address, 1n)).to.be.revertedWithCustomError(vault, "ReentrancyGuardReentrantCall");
      expect(await snapshot()).to.deep.equal(before);
      expect(await vault.active()).to.equal(true);
    });
  });
});
