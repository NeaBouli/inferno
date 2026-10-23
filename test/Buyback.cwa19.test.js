import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

// CWA-19: executable evidence for current source, with no fork or external RPC.
describe("CWA-19 dormant buyback evidence", function () {
  const UNIT = 10n ** 9n;
  const RATE = 1000n * UNIT;
  const ETH = ethers.parseEther("1");
  const HALF = ETH / 2n;
  const ERROR = new ethers.Interface(["error Error(string)"]);
  let owner, guardian, burn, treasury, user;
  let token, router, probe, controller, vault;

  async function deploy(name, ...args) {
    const contract = await (await ethers.getContractFactory(name)).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  }

  async function setup(tokenName = "MockFeeOnTransferToken") {
    [owner, guardian, burn, treasury, user] = await ethers.getSigners();
    token = await deploy(tokenName);
    // WETH is only an address marker in MockRouter; no wrapped-ETH calls are made.
    router = await deploy("MockRouter", user.address, token.target, RATE);
    probe = await deploy("MockBuybackRouterProbe", router.target);
    controller = await deploy("BuybackController", token.target, burn.address, probe.target,
      treasury.address, guardian.address, owner.address);
    vault = await deploy("BuybackVault", token.target, burn.address, treasury.address,
      probe.target, guardian.address, 0);
    if (tokenName === "MockReentrantToken") {
      await router.setPayFromBalance(true);
      await token.transfer(router.target, 100_000n * UNIT);
    }
  }

  async function fund(target, value = ETH) {
    await owner.sendTransaction({ to: target.target, value });
  }

  async function credit(target, amount) {
    if (token.interface.hasFunction("mint")) await token.mint(target.target, amount);
    else await token.transfer(target.target, amount);
  }

  function observed(receipt, contract, event) {
    return receipt.logs.filter((log) => log.address.toLowerCase() === contract.target.toLowerCase())
      .map((log) => contract.interface.parseLog(log)).filter((log) => log.name === event);
  }

  async function expectFailedCallback(reason) {
    expect(await probe.callbackHook()).to.equal(0n); // callback really ran
    expect(await probe.callbackSucceeded()).to.equal(false);
    expect(await probe.callbackResult()).to.equal(ERROR.encodeErrorResult("Error", [reason]));
  }

  async function balances() {
    return Promise.all([
      ethers.provider.getBalance(controller.target), ethers.provider.getBalance(vault.target),
      ethers.provider.getBalance(router.target), ethers.provider.getBalance(probe.target),
      token.balanceOf(controller.target), token.balanceOf(vault.target),
      token.balanceOf(router.target), token.balanceOf(probe.target),
      token.balanceOf(burn.address), token.balanceOf(treasury.address), token.balanceOf(user.address),
      token.totalSupply(),
    ]);
  }

  beforeEach(async () => { await setup(); });

  describe("Reentrancy and accounting boundaries", function () {
    it("R01: router callback into execute is rejected by nonReentrant, while one outer cycle succeeds", async () => {
      await router.setReenterTarget(controller.target);
      await fund(controller);
      await controller.connect(user).execute();
      expect(await router.lastReentryRevertSelector()).to.equal(
        ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10));
      expect(await controller.executionCount()).to.equal(1n);
      expect(await controller.totalETHProcessed()).to.equal(ETH);
      expect(await controller.totalIFRBurned()).to.equal(RATE);
      expect(await token.balanceOf(burn.address)).to.equal(RATE);
    });

    it("R02: malicious token callback into execute rolls back ETH, tokens and execution accounting", async () => {
      await setup("MockReentrantToken");
      await fund(controller);
      const before = await balances();
      await token.arm(controller.target, controller.interface.encodeFunctionData("execute"));
      await expect(controller.connect(user).execute())
        .to.be.revertedWithCustomError(controller, "ReentrancyGuardReentrantCall");
      expect(await balances()).to.deep.equal(before);
      expect(await controller.stats()).to.deep.equal([0n, 0n, 0n, 0n]);
      expect(await controller.lastExecution()).to.equal(0n);
    });

    for (const method of ["withdrawIFR", "withdrawETH"]) {
      it(`R03-${method}: a swap router cannot reenter an owner-only withdrawal`, async () => {
        await credit(controller, 100n * UNIT);
        await fund(controller);
        await probe.arm(controller.target,
          controller.interface.encodeFunctionData(method, [user.address, 1n]), 1);
        await controller.connect(user).execute();
        await expectFailedCallback("not owner");
        expect(await token.balanceOf(user.address)).to.equal(0n);
        expect(await controller.executionCount()).to.equal(1n);
      });
    }

    it("R04: a callback during the LP token pull cannot enter execute", async () => {
      await credit(controller, 100n * UNIT);
      await fund(controller);
      await probe.arm(controller.target, controller.interface.encodeFunctionData("execute"), 2);
      await controller.connect(user).execute();
      expect(await probe.callbackHook()).to.equal(0n);
      expect(await probe.callbackSucceeded()).to.equal(false);
      expect(await probe.callbackResult()).to.equal(ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10));
      expect(await controller.executionCount()).to.equal(1n);
      expect(await token.allowance(controller.target, probe.target)).to.equal(0n);
    });

    it("R05: a token cannot recursively withdraw; the failed outer withdrawal is atomic", async () => {
      await setup("MockReentrantToken");
      await credit(controller, 100n * UNIT);
      const before = await balances();
      await token.arm(controller.target,
        controller.interface.encodeFunctionData("withdrawIFR", [user.address, UNIT]));
      await expect(controller.withdrawIFR(user.address, UNIT)).to.be.revertedWith("not owner");
      expect(await balances()).to.deep.equal(before);
    });

    it("R05-ETH: an adversarial ETH recipient cannot withdraw recursively; the withdrawal fails atomically", async () => {
      await fund(controller);
      const before = await balances();
      await expect(controller.withdrawETH(probe.target, HALF)).to.revert(ethers);
      expect(await balances()).to.deep.equal(before);
    });

    it("R06: LIMITATION - withdrawIFR has no guard, so its token callback can trigger permissionless execute", async () => {
      await setup("MockReentrantToken");
      await credit(controller, 100n * UNIT);
      await fund(controller);
      await token.arm(controller.target, controller.interface.encodeFunctionData("execute"));
      await controller.withdrawIFR(user.address, UNIT);
      expect(await token.balanceOf(user.address)).to.equal(UNIT);
      expect(await controller.executionCount()).to.equal(1n);
      expect(await controller.totalETHProcessed()).to.equal(ETH);
      expect(await token.balanceOf(burn.address)).to.equal(RATE / 2n);
      expect(await token.balanceOf(controller.target)).to.equal(0n);
    });

    it("R07: a router without ownership cannot reenter the vault buyback", async () => {
      await fund(vault);
      await probe.arm(vault.target, vault.interface.encodeFunctionData("executeBuyback"), 1);
      await vault.executeBuyback();
      await expectFailedCallback("not owner");
      expect(await token.balanceOf(burn.address)).to.equal(RATE / 2n);
      expect(await token.balanceOf(treasury.address)).to.equal(RATE / 2n);
    });

    it("R08: a malicious token's vault callback is rejected by onlyOwner and rolls back the swap", async () => {
      await setup("MockReentrantToken");
      await fund(vault);
      const before = await balances();
      await token.arm(vault.target, vault.interface.encodeFunctionData("executeBuyback"));
      await expect(vault.executeBuyback()).to.be.revertedWith("not owner");
      expect(await balances()).to.deep.equal(before);
      expect(await vault.lastBuybackAt()).to.equal(0n);
    });

    it("R09: even an owner/router callback hits the vault's already-updated cooldown", async () => {
      await fund(vault);
      await vault.transferOwnership(probe.target);
      await probe.arm(vault.target, vault.interface.encodeFunctionData("executeBuyback"), 1);
      await probe.forward(vault.target, vault.interface.encodeFunctionData("executeBuyback"));
      await expectFailedCallback("cooldown");
      expect(await token.balanceOf(burn.address)).to.equal(RATE / 2n);
    });

    it("R10: LIMITATION - zero cooldown permits owner/router reentry, with no second ETH spend", async () => {
      await vault.setParams(5000, 0, 500, probe.target, treasury.address);
      await fund(vault);
      await vault.transferOwnership(probe.target);
      await probe.arm(vault.target, vault.interface.encodeFunctionData("executeBuyback"), 1);
      const receipt = await (await probe.forward(vault.target,
        vault.interface.encodeFunctionData("executeBuyback"))).wait();
      expect(await probe.callbackHook()).to.equal(0n);
      expect(await probe.callbackSucceeded()).to.equal(true);
      const events = observed(receipt, vault, "BuybackExecuted");
      expect(events.map((event) => [...event.args])).to.deep.equal([
        [0n, 0n, 0n], [ETH, RATE / 2n, RATE / 2n],
      ]);
      expect(await probe.swapCalls()).to.equal(1n);
      expect(await ethers.provider.getBalance(vault.target)).to.equal(0n);
      expect(await token.balanceOf(vault.target)).to.equal(0n);
    });
  });

  describe("ERC20 return values", function () {
    it("E01: the existing false-return mock is rejected by withdrawIFR", async () => {
      await setup("MockFalseReturnToken");
      await expect(controller.withdrawIFR(user.address, UNIT)).to.be.revertedWith("transfer failed");
    });

    for (const [mode, label] of [[1, "false"], [2, "empty"]]) {
      it(`E02-${label}: controller withdrawal fails closed on a ${label} transfer return`, async () => {
        await setup("MockBuybackReturnToken");
        await credit(controller, 100n * UNIT);
        await token.setTransferMode(mode, ethers.ZeroAddress);
        const before = await balances();
        const withdrawal = expect(controller.withdrawIFR(user.address, UNIT));
        if (mode === 1) await withdrawal.to.be.revertedWith("transfer failed");
        else await withdrawal.to.revert(ethers);
        expect(await balances()).to.deep.equal(before);
      });

      for (const recipient of ["burn", "treasury"]) {
        it(`E03-${label}-${recipient}: vault ${recipient} transfer fails closed on a ${label} return`, async () => {
          await setup("MockBuybackReturnToken");
          await fund(vault);
          await token.setTransferMode(mode, recipient === "burn" ? burn.address : treasury.address);
          const before = await balances();
          const execution = expect(vault.executeBuyback());
          if (mode === 1) await execution.to.be.revertedWith(`${recipient} transfer failed`);
          else await execution.to.revert(ethers);
          expect(await balances()).to.deep.equal(before);
          expect(await vault.lastBuybackAt()).to.equal(0n);
        });
      }
    }

    it("E04: a false approve is ignored, but a real LP token pull fails and the ETH takes the fallback", async () => {
      await setup("MockBuybackReturnToken");
      await credit(controller, 100n * UNIT);
      await token.setApproveMode(1);
      await fund(controller);
      await expect(controller.connect(user).execute()).to.emit(controller, "LiquidityFallback").withArgs(HALF);
      expect(await token.approvalCalls()).to.equal(2n);
      expect(await token.allowance(controller.target, probe.target)).to.equal(0n);
      expect(await token.balanceOf(controller.target)).to.equal(100n * UNIT);
      expect(await controller.totalIFRBurned()).to.equal(RATE);
      expect(await controller.totalLiquidityAdded()).to.equal(0n);
    });

    it("E05: an empty approve return reverts the entire cycle, including the earlier burn-share swap", async () => {
      await setup("MockBuybackReturnToken");
      await credit(controller, 100n * UNIT);
      await token.setApproveMode(2);
      await fund(controller);
      const before = await balances();
      await expect(controller.connect(user).execute()).to.revert(ethers);
      expect(await balances()).to.deep.equal(before);
      expect(await token.allowance(controller.target, probe.target)).to.equal(0n);
      expect(await controller.stats()).to.deep.equal([0n, 0n, 0n, 0n]);
    });

    it("E06: FINDING - a false approval reset leaves a previous router able to spend remaining IFR", async () => {
      await setup("MockBuybackReturnToken");
      await credit(controller, 100n * UNIT);
      await token.setApproveMode(3);
      await probe.setLpUseBps(9500);
      await fund(controller);
      await expect(controller.connect(user).execute()).to.emit(controller, "LiquidityAdded");
      expect(await token.approvalCalls()).to.equal(2n);
      expect(await token.balanceOf(controller.target)).to.equal(5n * UNIT);
      expect(await token.allowance(controller.target, probe.target)).to.equal(5n * UNIT);
      await controller.setRouter(router.target);
      await probe.connect(user).pull(token.target, controller.target, user.address, 5n * UNIT);
      expect(await token.balanceOf(user.address)).to.equal(5n * UNIT);
      expect(await token.balanceOf(controller.target)).to.equal(0n);
    });

    it("E07: FINDING - a false reset after LP failure retains the entire token allowance", async () => {
      await setup("MockBuybackReturnToken");
      await credit(controller, 100n * UNIT);
      await token.setApproveMode(3);
      await router.setAddLiquidityReverts(true);
      await fund(controller);
      await expect(controller.connect(user).execute()).to.emit(controller, "LiquidityFallback").withArgs(HALF);
      expect(await token.approvalCalls()).to.equal(2n);
      expect(await token.balanceOf(controller.target)).to.equal(100n * UNIT);
      expect(await token.allowance(controller.target, probe.target)).to.equal(100n * UNIT);
      expect(await controller.totalIFRBurned()).to.equal(RATE);
    });
  });

  describe("Slippage, quotes and deadlines", function () {
    for (const kind of ["controller", "vault"]) {
      it(`M01-${kind}: swaps pass a computed minimum and the execution block timestamp`, async () => {
        const target = kind === "controller" ? controller : vault;
        await fund(target);
        const receipt = await (await (kind === "controller"
          ? controller.connect(user).execute() : vault.executeBuyback())).wait();
        const block = await ethers.provider.getBlock(receipt.blockNumber);
        const swaps = observed(receipt, probe, "SwapObserved");
        expect(swaps).to.have.length(kind === "controller" ? 2 : 1);
        for (const swap of swaps) {
          const quoted = swap.args.ethIn * RATE / ETH;
          expect(swap.args.minOut).to.equal(quoted * 9500n / 10_000n);
          expect(swap.args.minOut).to.be.gt(0n);
          expect(swap.args.deadline).to.equal(BigInt(block.timestamp));
        }
      });

      it(`M02-${kind}: output below the default minimum reverts atomically`, async () => {
        const target = kind === "controller" ? controller : vault;
        await fund(target);
        await router.setSlippageBpsNextSwap(600);
        const before = await balances();
        await expect(kind === "controller" ? controller.connect(user).execute() : vault.executeBuyback())
          .to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        expect(await balances()).to.deep.equal(before);
      });

      it(`M03-${kind}: FINDING - a depressed spot quote is accepted without an independent price floor`, async () => {
        const target = kind === "controller" ? controller : vault;
        await fund(target);
        await router.setRate(RATE / 1000n);
        await (kind === "controller" ? controller.connect(user).execute() : vault.executeBuyback());
        const totalCredited = await token.balanceOf(burn.address) + await token.balanceOf(treasury.address);
        expect(totalCredited).to.equal(RATE / 1000n);
        expect(await ethers.provider.getBalance(target.target)).to.equal(0n);
      });

      it(`M04-${kind}: FINDING - integer rounding permits zero minOut even with 5% configured slippage`, async () => {
        const target = kind === "controller" ? controller : vault;
        await fund(target);
        // Each swap now quotes exactly one raw token unit (one billionth of an IFR).
        await router.setRate(kind === "controller" ? 2n : 1n);
        await router.setTransferFeeBpsOnOutput(10_000);
        const receipt = await (await (kind === "controller"
          ? controller.connect(user).execute() : vault.executeBuyback())).wait();
        const swaps = observed(receipt, probe, "SwapObserved");
        for (const swap of swaps) expect(swap.args.minOut).to.equal(0n);
        expect(await token.balanceOf(burn.address)).to.equal(0n);
        expect(await token.balanceOf(treasury.address)).to.equal(0n);
        expect(await ethers.provider.getBalance(target.target)).to.equal(0n);
      });

      it(`M05-${kind}: FINDING - a queued execution has no caller-bound expiry`, async () => {
        const target = kind === "controller" ? controller : vault;
        await fund(target);
        const submittedAt = (await ethers.provider.getBlock("latest")).timestamp;
        let receipt;
        await ethers.provider.send("evm_setAutomine", [false]);
        try {
          const tx = await (kind === "controller"
            ? controller.connect(user).execute({ gasLimit: 3_000_000 })
            : vault.executeBuyback({ gasLimit: 3_000_000 }));
          await ethers.provider.send("evm_setNextBlockTimestamp", [submittedAt + 86400]);
          await ethers.provider.send("evm_mine", []);
          receipt = await tx.wait();
        } finally {
          await ethers.provider.send("evm_setAutomine", [true]);
        }
        const swaps = observed(receipt, probe, "SwapObserved");
        expect(swaps.length).to.be.gt(0);
        for (const swap of swaps) expect(swap.args.deadline).to.equal(BigInt(submittedAt + 86400));
      });
    }

    it("M06: FINDING - vault owner can allow 100% slippage and spend all ETH for zero IFR", async () => {
      await vault.setParams(5000, 3600, 10_000, probe.target, treasury.address);
      await router.setTransferFeeBpsOnOutput(10_000);
      await fund(vault);
      const receipt = await (await vault.executeBuyback()).wait();
      expect(observed(receipt, probe, "SwapObserved")[0].args.minOut).to.equal(0n);
      expect([...observed(receipt, vault, "BuybackExecuted")[0].args]).to.deep.equal([ETH, 0n, 0n]);
      expect(await ethers.provider.getBalance(vault.target)).to.equal(0n);
      expect(await ethers.provider.getBalance(router.target)).to.equal(ETH);
    });

    it("M07: controller caps slippage at 10%; zero bps means the full quote, not zero minOut", async () => {
      await expect(controller.setSlippage(1001)).to.be.revertedWith("max 10%");
      await expect(controller.setSlippage(10_000)).to.be.revertedWith("max 10%");
      await controller.setSlippage(0);
      await fund(controller);
      const receipt = await (await controller.connect(user).execute()).wait();
      for (const swap of observed(receipt, probe, "SwapObserved")) {
        expect(swap.args.minOut).to.equal(RATE / 2n);
      }
    });

    it("M08: controller supplies LP minima, a current deadline, and clears a standard token's unused allowance", async () => {
      await credit(controller, 100n * UNIT);
      await probe.setLpUseBps(9500);
      await fund(controller);
      const receipt = await (await controller.connect(user).execute()).wait();
      const [lp] = observed(receipt, probe, "LiquidityObserved");
      expect(lp.args.minToken).to.equal(95n * UNIT);
      expect(lp.args.minETH).to.equal(HALF * 9500n / 10_000n);
      expect(lp.args.deadline).to.equal(BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp));
      expect(await token.balanceOf(controller.target)).to.equal(5n * UNIT);
      expect(await token.allowance(controller.target, probe.target)).to.equal(0n);
    });
  });

  describe("Roles, immutable guardians and dormancy", function () {
    it("A01: only the controller owner can configure, withdraw or transfer ownership", async () => {
      const calls = [
        ["setCooldown", [3600]], ["setMinTrigger", [1n]], ["setSlippage", [1000]],
        ["setRouter", [router.target]], ["setLpReceiver", [user.address]],
        ["withdrawETH", [user.address, 1n]], ["withdrawIFR", [user.address, 1n]],
        ["transferOwnership", [user.address]],
      ];
      for (const actor of [user, guardian]) {
        for (const [method, args] of calls) {
          await expect(controller.connect(actor)[method](...args)).to.be.revertedWith("not owner");
        }
      }
      await controller.setCooldown(3600);
      await controller.setMinTrigger(1n);
      await controller.setSlippage(1000);
      await controller.setRouter(router.target);
      await controller.setLpReceiver(user.address);
      expect(await controller.cooldown()).to.equal(3600n);
      expect(await controller.minTriggerAmount()).to.equal(1n);
      expect(await controller.slippageBps()).to.equal(1000n);
      expect(await controller.router()).to.equal(router.target);
      expect(await controller.lpReceiver()).to.equal(user.address);
    });

    it("A02: vault execution, parameters, router, treasury and ownership are owner-only", async () => {
      for (const actor of [user, guardian]) {
        await expect(vault.connect(actor).executeBuyback()).to.be.revertedWith("not owner");
        await expect(vault.connect(actor).setParams(6000, 0, 1000, router.target, user.address))
          .to.be.revertedWith("not owner");
        await expect(vault.connect(actor).transferOwnership(user.address)).to.be.revertedWith("not owner");
      }
      await vault.setParams(6000, 0, 1000, router.target, user.address);
      expect(await vault.burnShareBps()).to.equal(6000n);
      expect(await vault.cooldown()).to.equal(0n);
      expect(await vault.slippageBps()).to.equal(1000n);
      expect(await vault.router()).to.equal(router.target);
      expect(await vault.treasury()).to.equal(user.address);
      expect(vault.interface.hasFunction("withdrawETH")).to.equal(false);
      expect(vault.interface.hasFunction("withdrawIFR")).to.equal(false);
      for (const target of [vault, controller]) expect(target.interface.hasFunction("burn")).to.equal(false);
    });

    for (const kind of ["controller", "vault"]) {
      it(`A03-${kind}: FINDING - immutable guardian can both pause and unpause, including after ownership changes`, async () => {
        const target = kind === "controller" ? controller : vault;
        await fund(target);
        await target.transferOwnership(user.address);
        expect(await target.guardian()).to.equal(guardian.address);
        expect(target.interface.hasFunction("setGuardian")).to.equal(false);
        for (const actor of [owner, user]) {
          await expect(target.connect(actor).pause()).to.be.revertedWith("not guardian");
          await expect(target.connect(actor).unpause()).to.be.revertedWith("not guardian");
        }
        await target.connect(guardian).pause();
        await expect(kind === "controller" ? controller.connect(user).execute() : vault.connect(user).executeBuyback())
          .to.be.revertedWith("Pausable: paused");
        await target.connect(guardian).unpause();
        expect(await target.paused()).to.equal(false);
        await expect(kind === "controller" ? controller.connect(user).execute() : vault.connect(user).executeBuyback())
          .to.emit(target, "BuybackExecuted");
      });
    }

    it("A04: owner emergency withdrawals remain available while the controller is paused", async () => {
      await fund(controller);
      await credit(controller, 100n * UNIT);
      await controller.connect(guardian).pause();
      await controller.withdrawETH(user.address, ETH);
      await controller.withdrawIFR(user.address, 100n * UNIT);
      expect(await ethers.provider.getBalance(controller.target)).to.equal(0n);
      expect(await token.balanceOf(controller.target)).to.equal(0n);
      expect(await token.balanceOf(user.address)).to.equal(100n * UNIT);
    });

    it("D01: without ETH or IFR, controller execution/positive withdrawals fail and no tokens move", async () => {
      const before = await balances();
      expect(await controller.canExecute()).to.equal(false);
      await expect(controller.connect(user).execute()).to.be.revertedWith("insufficient ETH");
      await expect(controller.withdrawETH(user.address, 1n)).to.be.revertedWith("insufficient");
      await expect(controller.withdrawIFR(user.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
      await controller.withdrawETH(user.address, 0n);
      await controller.withdrawIFR(user.address, 0n);
      await controller.setCooldown(3600);
      await controller.setMinTrigger(1n);
      await controller.connect(guardian).pause();
      await controller.connect(guardian).unpause();
      expect(await balances()).to.deep.equal(before);
      expect(await controller.stats()).to.deep.equal([0n, 0n, 0n, 0n]);
      expect(await probe.swapCalls()).to.equal(0n);
    });

    it("D02: an unfunded vault only emits a zero-amount event and updates its cooldown timestamp", async () => {
      const before = await balances();
      await expect(vault.executeBuyback()).to.emit(vault, "BuybackExecuted").withArgs(0n, 0n, 0n);
      expect(await vault.lastBuybackAt()).to.be.gt(0n);
      await expect(vault.executeBuyback()).to.be.revertedWith("cooldown");
      await vault.setParams(5000, 0, 500, probe.target, treasury.address);
      await vault.executeBuyback();
      await vault.connect(guardian).pause();
      await vault.connect(guardian).unpause();
      expect(await balances()).to.deep.equal(before);
      expect(await probe.swapCalls()).to.equal(0n);
    });

    it("D03: zero ETH alone is not no funding: controller-held IFR is still owner-recoverable", async () => {
      await credit(controller, 100n * UNIT);
      expect(await controller.canExecute()).to.equal(false);
      await expect(controller.connect(user).execute()).to.be.revertedWith("insufficient ETH");
      await controller.withdrawIFR(user.address, 100n * UNIT);
      expect(await token.balanceOf(user.address)).to.equal(100n * UNIT);
      expect(await probe.swapCalls()).to.equal(0n);
    });
  });
});
