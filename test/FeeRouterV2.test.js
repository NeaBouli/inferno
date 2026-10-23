import { expect } from "chai";
import hre from "hardhat";
import { connection, ethers } from "./helpers/hardhat.js";

const SWAP_VALUE = ethers.parseEther("1");
const VOUCHER_TYPES = {
  DiscountVoucher: [
    { name: "user", type: "address" },
    { name: "discountBps", type: "uint16" },
    { name: "maxUses", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

async function deployFixture(runtime = ethers) {
  const [governance, feeCollector, voucherSigner, userA, userB] = await runtime.getSigners();
  const Router = await runtime.getContractFactory("FeeRouterV2");
  const router = await Router.deploy(governance.address, feeCollector.address, voucherSigner.address);
  await router.waitForDeployment();
  const adapter = await (await runtime.getContractFactory("MockAdapter")).deploy();
  await adapter.waitForDeployment();
  await router.setAdapter(adapter.target, true);
  return { Router, router, adapter, governance, feeCollector, voucherSigner, userA, userB };
}

async function signVoucher(signer, voucher, routerAddress, overrides = {}) {
  return signer.signTypedData({
    name: "InfernoFeeRouter",
    version: "2",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: routerAddress,
    ...overrides,
  }, VOUCHER_TYPES, voucher);
}

describe("FeeRouterV2", function () {
  let f;

  async function makeVoucher(overrides = {}) {
    const block = await ethers.provider.getBlock("latest");
    return {
      user: f.userA.address,
      discountBps: 3n,
      maxUses: 1n,
      expiry: BigInt(block.timestamp) + 3600n,
      nonce: 18n,
      ...overrides,
    };
  }

  function swap(voucher, signature = "0x", {
    router = f.router, adapter = f.adapter.target, user = f.userA,
    useVoucher = true, value = SWAP_VALUE, swapData = "0x",
  } = {}) {
    return router.connect(user).swapWithFee(adapter, swapData, voucher, signature, useVoucher, { value });
  }

  async function usage(voucher, count, exhausted = false) {
    expect(await f.router.voucherUses(voucher.user, voucher.nonce)).to.equal(count);
    expect(await f.router.usedNonces(voucher.user, voucher.nonce)).to.equal(exhausted);
  }

  async function rejectedVoucher(voucher, signature, viewReason, revertReason, user = f.userA) {
    const count = await f.router.voucherUses(voucher.user, voucher.nonce);
    const exhausted = await f.router.usedNonces(voucher.user, voucher.nonce);
    const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
    const adapterBefore = await ethers.provider.getBalance(f.adapter.target);
    expect(await f.router.connect(user).isVoucherValid(voucher, signature)).to.deep.equal([false, viewReason]);
    await expect(swap(voucher, signature, { user })).to.be.revertedWith(revertReason);
    await usage(voucher, count, exhausted);
    expect(await ethers.provider.getBalance(f.feeCollector.address)).to.equal(collectorBefore);
    expect(await ethers.provider.getBalance(f.adapter.target)).to.equal(adapterBefore);
  }

  beforeEach(async function () {
    f = await deployFixture();
  });

  describe("deployment and zero-address rejection", function () {
    it("initializes nonzero roles, the fee cap, pause and domain version 2", async function () {
      expect(await f.router.governance()).to.equal(f.governance.address);
      expect(await f.router.pendingGovernance()).to.equal(ethers.ZeroAddress);
      expect(await f.router.feeCollector()).to.equal(f.feeCollector.address);
      expect(await f.router.voucherSigner()).to.equal(f.voucherSigner.address);
      expect(await f.router.protocolFeeBps()).to.equal(5n);
      expect(await f.router.FEE_CAP_BPS()).to.equal(25n);
      expect(await f.router.paused()).to.equal(false);
      const domain = await f.router.eip712Domain();
      expect(domain.name).to.equal("InfernoFeeRouter");
      expect(domain.version).to.equal("2");
      expect(domain.chainId).to.equal((await ethers.provider.getNetwork()).chainId);
      expect(domain.verifyingContract).to.equal(f.router.target);
      expect(await f.router.VOUCHER_TYPEHASH()).to.equal(ethers.id(
        "DiscountVoucher(address user,uint16 discountBps,uint32 maxUses,uint64 expiry,uint256 nonce)",
      ));
    });

    for (const [index, role, reason] of [
      [0, "governance", "Zero governance"],
      [1, "feeCollector", "Zero fee collector"],
      [2, "voucherSigner", "Zero voucher signer"],
    ]) {
      it(`rejects zero ${role} in the constructor (CWA-18)`, async function () {
        const args = [f.governance.address, f.feeCollector.address, f.voucherSigner.address];
        args[index] = ethers.ZeroAddress;
        await expect(f.Router.deploy(...args)).to.be.revertedWith(reason);
      });
    }

    it("emits initial role assignments", async function () {
      const fresh = await f.Router.deploy(f.governance.address, f.feeCollector.address, f.voucherSigner.address);
      await expect(fresh.deploymentTransaction()).to.emit(fresh, "GovernanceTransferred")
        .withArgs(ethers.ZeroAddress, f.governance.address)
        .and.to.emit(fresh, "FeeCollectorUpdated").withArgs(ethers.ZeroAddress, f.feeCollector.address)
        .and.to.emit(fresh, "VoucherSignerUpdated").withArgs(ethers.ZeroAddress, f.voucherSigner.address);
    });

    for (const [setter, getter, reason] of [
      ["setFeeCollector", "feeCollector", "Zero fee collector"],
      ["setVoucherSigner", "voucherSigner", "Zero voucher signer"],
    ]) {
      it(`rejects ${setter}(zero) without changing the role (CWA-18)`, async function () {
        const before = await f.router[getter]();
        await expect(f.router[setter](ethers.ZeroAddress)).to.be.revertedWith(reason);
        expect(await f.router[getter]()).to.equal(before);
        const voucher = await makeVoucher();
        await expect(swap(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target)))
          .to.emit(f.router, "VoucherUsed");
      });
    }

    for (const status of [true, false]) {
      it(`rejects setAdapter(zero, ${status}) and prevents swaps to zero (CWA-18)`, async function () {
        await expect(f.router.setAdapter(ethers.ZeroAddress, status)).to.be.revertedWith("Zero adapter");
        expect(await f.router.whitelistedAdapters(ethers.ZeroAddress)).to.equal(false);
        const zeroBefore = await ethers.provider.getBalance(ethers.ZeroAddress);
        await expect(swap(await makeVoucher(), "0x", { adapter: ethers.ZeroAddress, useVoucher: false }))
          .to.be.revertedWith("Adapter not whitelisted");
        expect(await ethers.provider.getBalance(ethers.ZeroAddress)).to.equal(zeroBefore);
      });
    }
  });

  describe("administration and two-step governance", function () {
    for (const [setter, args] of [
      ["setFeeBps", () => [10n]],
      ["setPaused", () => [true]],
      ["setAdapter", () => [ethers.ZeroAddress, true]],
      ["setVoucherSigner", () => [ethers.ZeroAddress]],
      ["setFeeCollector", () => [ethers.ZeroAddress]],
      ["proposeGovernance", () => [ethers.ZeroAddress]],
      ["cancelGovernanceTransfer", () => []],
    ]) {
      it(`rejects unauthorized ${setter} calls`, async function () {
        await expect(f.router.connect(f.userA)[setter](...args())).to.be.revertedWith("Not governance");
      });
    }

    it("rotates the fee collector with an event and routes the next fee to it", async function () {
      await expect(f.router.setFeeCollector(f.userB.address)).to.emit(f.router, "FeeCollectorUpdated")
        .withArgs(f.feeCollector.address, f.userB.address);
      expect(await f.router.feeCollector()).to.equal(f.userB.address);
      const oldBefore = await ethers.provider.getBalance(f.feeCollector.address);
      const newBefore = await ethers.provider.getBalance(f.userB.address);
      await swap(await makeVoucher(), "0x", { useVoucher: false });
      expect(await ethers.provider.getBalance(f.userB.address) - newBefore).to.equal(SWAP_VALUE * 5n / 10000n);
      expect(await ethers.provider.getBalance(f.feeCollector.address)).to.equal(oldBefore);
    });

    it("rotates the signer with an event, invalidates old signatures and preserves usage", async function () {
      const voucher = await makeVoucher({ maxUses: 3n });
      const oldSignature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await swap(voucher, oldSignature);
      await expect(f.router.setVoucherSigner(f.userB.address)).to.emit(f.router, "VoucherSignerUpdated")
        .withArgs(f.voucherSigner.address, f.userB.address);
      expect(await f.router.voucherSigner()).to.equal(f.userB.address);
      await rejectedVoucher(voucher, oldSignature, "Invalid signature", "Invalid voucher signature");
      const newSignature = await signVoucher(f.userB, voucher, f.router.target);
      await swap(voucher, newSignature);
      await swap(voucher, newSignature);
      await usage(voucher, 3n, true);
      await rejectedVoucher(voucher, newSignature, "Used", "Nonce already used");
    });

    it("emits adapter additions/removals and blocks a removed adapter", async function () {
      await expect(f.router.setAdapter(f.adapter.target, false)).to.emit(f.router, "AdapterWhitelisted")
        .withArgs(f.adapter.target, false);
      expect(await f.router.whitelistedAdapters(f.adapter.target)).to.equal(false);
      await expect(swap(await makeVoucher(), "0x", { useVoucher: false }))
        .to.be.revertedWith("Adapter not whitelisted");
      await expect(f.router.setAdapter(f.adapter.target, true)).to.emit(f.router, "AdapterWhitelisted")
        .withArgs(f.adapter.target, true);
      await swap(await makeVoucher(), "0x", { useVoucher: false });
    });

    it("rejects a zero governance proposal while preserving an existing nomination", async function () {
      await f.router.proposeGovernance(f.userB.address);
      await expect(f.router.proposeGovernance(ethers.ZeroAddress)).to.be.revertedWith("Zero governance");
      expect(await f.router.governance()).to.equal(f.governance.address);
      expect(await f.router.pendingGovernance()).to.equal(f.userB.address);
    });

    it("requires nominee acceptance before transferring authority and clears the nomination", async function () {
      await expect(f.router.proposeGovernance(f.userB.address)).to.emit(f.router, "GovernanceTransferProposed")
        .withArgs(f.governance.address, f.userB.address);
      expect(await f.router.governance()).to.equal(f.governance.address);
      expect(await f.router.pendingGovernance()).to.equal(f.userB.address);
      await expect(f.router.connect(f.userB).setPaused(true)).to.be.revertedWith("Not governance");
      await f.router.setFeeBps(10n);
      for (const outsider of [f.governance, f.userA]) {
        await expect(f.router.connect(outsider).acceptGovernance()).to.be.revertedWith("Not pending governance");
      }
      await expect(f.router.connect(f.userB).acceptGovernance()).to.emit(f.router, "GovernanceTransferred")
        .withArgs(f.governance.address, f.userB.address);
      expect(await f.router.governance()).to.equal(f.userB.address);
      expect(await f.router.pendingGovernance()).to.equal(ethers.ZeroAddress);
      await expect(f.router.setFeeBps(5n)).to.be.revertedWith("Not governance");
      await f.router.connect(f.userB).setFeeBps(5n);
      await expect(f.router.connect(f.userB).acceptGovernance()).to.be.revertedWith("Not pending governance");
    });

    it("cancels a nomination explicitly and prevents stale acceptance", async function () {
      await f.router.proposeGovernance(f.userB.address);
      await expect(f.router.connect(f.userB).cancelGovernanceTransfer()).to.be.revertedWith("Not governance");
      await expect(f.router.cancelGovernanceTransfer()).to.emit(f.router, "GovernanceTransferCancelled")
        .withArgs(f.governance.address, f.userB.address);
      expect(await f.router.pendingGovernance()).to.equal(ethers.ZeroAddress);
      expect(await f.router.governance()).to.equal(f.governance.address);
      await expect(f.router.connect(f.userB).acceptGovernance()).to.be.revertedWith("Not pending governance");
      await f.router.setPaused(true);
    });

    it("replaces a nomination with cancellation/proposal events and invalidates the former nominee", async function () {
      await f.router.proposeGovernance(f.userB.address);
      await expect(f.router.proposeGovernance(f.userA.address)).to.emit(f.router, "GovernanceTransferCancelled")
        .withArgs(f.governance.address, f.userB.address)
        .and.to.emit(f.router, "GovernanceTransferProposed").withArgs(f.governance.address, f.userA.address);
      expect(await f.router.pendingGovernance()).to.equal(f.userA.address);
      await expect(f.router.connect(f.userB).acceptGovernance()).to.be.revertedWith("Not pending governance");
      await f.router.connect(f.userA).acceptGovernance();
      expect(await f.router.governance()).to.equal(f.userA.address);
    });

    it("rejects acceptance or cancellation without a pending transfer", async function () {
      await expect(f.router.connect(f.userA).acceptGovernance()).to.be.revertedWith("Not pending governance");
      await expect(f.router.cancelGovernanceTransfer()).to.be.revertedWith("No pending governance transfer");
    });

    it("preserves voucher usage and configuration across governance acceptance while paused", async function () {
      const voucher = await makeVoucher({ maxUses: 2n });
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await swap(voucher, signature);
      await f.router.setPaused(true);
      await f.router.proposeGovernance(f.userB.address);
      await f.router.connect(f.userB).acceptGovernance();
      expect(await f.router.paused()).to.equal(true);
      expect(await f.router.feeCollector()).to.equal(f.feeCollector.address);
      expect(await f.router.voucherSigner()).to.equal(f.voucherSigner.address);
      expect(await f.router.whitelistedAdapters(f.adapter.target)).to.equal(true);
      await usage(voucher, 1n);
      await f.router.connect(f.userB).setPaused(false);
      await swap(voucher, signature);
      await usage(voucher, 2n, true);
    });
  });

  describe("voucher usage limits and nonce binding", function () {
    it("rejects a signed maxUses=0 in both validation and redemption (CWA-18)", async function () {
      const voucher = await makeVoucher({ maxUses: 0n });
      await rejectedVoucher(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target),
        "Invalid max uses", "Invalid max uses");
      await usage(voucher, 0n);
    });

    for (const maxUses of [1n, 2n, 3n]) {
      it(`permits exactly ${maxUses} uses and rejects use N+1 (CWA-18)`, async function () {
        const voucher = await makeVoucher({ maxUses });
        const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
        const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
        for (let n = 1n; n <= maxUses; n++) {
          expect(await f.router.connect(f.userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
          await expect(swap(voucher, signature)).to.emit(f.router, "VoucherUsed")
            .withArgs(f.userA.address, voucher.nonce, voucher.discountBps);
          await usage(voucher, n, n === maxUses);
          expect(await ethers.provider.getBalance(f.feeCollector.address) - collectorBefore)
            .to.equal(n * SWAP_VALUE * 2n / 10000n);
          expect(await f.adapter.lastReceived()).to.equal(SWAP_VALUE - SWAP_VALUE * 2n / 10000n);
        }
        await rejectedVoucher(voucher, signature, "Used", "Nonce already used");
      });
    }

    it("accepts uint32-max maxUses and counts repeated uses without truncating the limit", async function () {
      const voucher = await makeVoucher({ maxUses: 4294967295n });
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      for (let n = 1n; n <= 3n; n++) {
        await swap(voucher, signature);
        await usage(voucher, n);
      }
      expect(await f.router.connect(f.userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
    });

    for (const changes of [{ maxUses: 4n }, { maxUses: 1n }, { discountBps: 2n }, { expiry: 9999999999n }]) {
      const field = Object.keys(changes)[0];
      it(`rejects re-signed ${field}=${Object.values(changes)[0]} on a partially used nonce`, async function () {
        const voucher = await makeVoucher({ maxUses: 3n });
        const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
        await swap(voucher, signature);
        const replacement = { ...voucher, ...changes };
        await rejectedVoucher(replacement, await signVoucher(f.voucherSigner, replacement, f.router.target),
          "Nonce bound to another voucher", "Nonce bound to another voucher");
        await swap(voucher, signature);
        await swap(voucher, signature);
        await usage(voucher, 3n, true);
      });
    }

    it("does not revive an exhausted nonce with newly signed terms", async function () {
      const voucher = await makeVoucher();
      await swap(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target));
      const replacement = { ...voucher, maxUses: 3n, discountBps: 2n, expiry: voucher.expiry + 100n };
      await rejectedVoucher(replacement, await signVoucher(f.voucherSigner, replacement, f.router.target),
        "Used", "Nonce already used");
    });

    it("keeps the same numeric nonce independent across users and different nonces independent per user", async function () {
      const first = await makeVoucher({ maxUses: 2n });
      const secondUser = { ...first, user: f.userB.address };
      const secondNonce = { ...first, nonce: first.nonce + 1n };
      const firstSig = await signVoucher(f.voucherSigner, first, f.router.target);
      await swap(first, firstSig);
      await swap(first, firstSig);
      await usage(first, 2n, true);
      await usage(secondUser, 0n);
      await usage(secondNonce, 0n);
      await swap(secondUser, await signVoucher(f.voucherSigner, secondUser, f.router.target), { user: f.userB });
      await swap(secondNonce, await signVoucher(f.voucherSigner, secondNonce, f.router.target));
      await usage(secondUser, 1n);
      await usage(secondNonce, 1n);
    });

    it("ignores invalid voucher data/signatures when useVoucher=false without consuming or binding the nonce", async function () {
      const invalid = await makeVoucher({ maxUses: 0n, expiry: 0n, user: f.userB.address });
      await expect(swap(invalid, "0x", { useVoucher: false })).to.emit(f.router, "FeeCharged")
        .withArgs(f.userA.address, SWAP_VALUE * 5n / 10000n);
      await usage(invalid, 0n);
      const voucher = await makeVoucher();
      await usage(voucher, 0n);
      await swap(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target));
      await usage(voucher, 1n, true);
    });

    it("consumes one use on zero-value swaps and enforces the same limit", async function () {
      const voucher = await makeVoucher({ maxUses: 2n });
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await expect(swap(voucher, signature, { value: 0n })).to.emit(f.router, "VoucherUsed")
        .and.not.to.emit(f.router, "FeeCharged");
      await usage(voucher, 1n);
      await swap(voucher, signature);
      await usage(voucher, 2n, true);
      await rejectedVoucher(voucher, signature, "Used", "Nonce already used");
    });

    it("rolls back the first digest binding, usage and fee transfer if the adapter reverts", async function () {
      await f.router.setAdapter(f.router.target, true);
      const voucher = await makeVoucher();
      const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
      await expect(swap(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target), {
        adapter: f.router.target, swapData: "0x12345678",
      })).to.be.revertedWith("Swap failed");
      await usage(voucher, 0n);
      expect(await ethers.provider.getBalance(f.feeCollector.address)).to.equal(collectorBefore);
      expect(await ethers.provider.getBalance(f.router.target)).to.equal(0n);
      const replacement = { ...voucher, maxUses: 2n };
      await swap(replacement, await signVoucher(f.voucherSigner, replacement, f.router.target));
      await usage(replacement, 1n);
    });

    it("restores a partially consumed voucher when its final-use adapter call reverts", async function () {
      const voucher = await makeVoucher({ maxUses: 2n });
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await swap(voucher, signature);
      await f.router.setAdapter(f.router.target, true);
      const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
      await expect(swap(voucher, signature, { adapter: f.router.target, swapData: "0x12345678" }))
        .to.be.revertedWith("Swap failed");
      await usage(voucher, 1n);
      expect(await ethers.provider.getBalance(f.feeCollector.address)).to.equal(collectorBefore);
      expect(await f.router.connect(f.userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
      await swap(voucher, signature);
      await usage(voucher, 2n, true);
    });

    it("rolls back usage and transfers if the collector rejects ETH", async function () {
      // MockToken has no payable receive/fallback, so it deterministically rejects the fee.
      const rejectingCollector = await (await ethers.getContractFactory("MockToken")).deploy("Mock", "M");
      await rejectingCollector.waitForDeployment();
      await f.router.setFeeCollector(rejectingCollector.target);
      const voucher = await makeVoucher();
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      const adapterBefore = await ethers.provider.getBalance(f.adapter.target);
      await expect(swap(voucher, signature)).to.be.revertedWith("Fee transfer failed");
      await usage(voucher, 0n);
      expect(await ethers.provider.getBalance(f.adapter.target)).to.equal(adapterBefore);
      await f.router.setFeeCollector(f.feeCollector.address);
      await swap(voucher, signature);
      await usage(voucher, 1n, true);
    });
  });

  describe("signature, user, expiry and domain binding", function () {
    it("rejects the wrong signer without consuming a use and then accepts the correct signer", async function () {
      const voucher = await makeVoucher();
      await rejectedVoucher(voucher, await signVoucher(f.userB, voucher, f.router.target),
        "Invalid signature", "Invalid voucher signature");
      await swap(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target));
    });

    it("rejects another user without consuming either user's nonce", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await rejectedVoucher(voucher, signature, "Wrong user", "Voucher not for sender", f.userB);
      expect(await f.router.voucherUses(f.userB.address, voucher.nonce)).to.equal(0n);
      await swap(voucher, signature);
    });

    for (const [field, replacement] of [["maxUses", 3n], ["discountBps", 2n], ["expiry", 9999999999n], ["nonce", 19n]]) {
      it(`rejects unsigned changes to ${field}`, async function () {
        const voucher = await makeVoucher();
        const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
        await rejectedVoucher({ ...voucher, [field]: replacement }, signature,
          "Invalid signature", "Invalid voucher signature");
        await swap(voucher, signature);
      });
    }

    for (const [signature, error, errorArgs] of [
      ["0x", "ECDSAInvalidSignatureLength", [0n]],
      [`0x${"00".repeat(65)}`, "ECDSAInvalidSignature", []],
    ]) {
      it(`rejects malformed signatures (${ethers.dataLength(signature)} bytes) without consuming a use`, async function () {
        const voucher = await makeVoucher();
        await expect(f.router.connect(f.userA).isVoucherValid(voucher, signature))
          .to.be.revertedWithCustomError(f.router, error).withArgs(...errorArgs);
        await expect(swap(voucher, signature)).to.be.revertedWithCustomError(f.router, error).withArgs(...errorArgs);
        await usage(voucher, 0n);
        await swap(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target));
      });
    }

    for (const overrides of [{ version: "1" }, { name: "OtherFeeRouter" }]) {
      it(`rejects signatures from the wrong domain ${JSON.stringify(overrides)}`, async function () {
        const voucher = await makeVoucher();
        await rejectedVoucher(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target, overrides),
          "Invalid signature", "Invalid voucher signature");
        await swap(voucher, await signVoucher(f.voucherSigner, voucher, f.router.target));
      });
    }

    it("rejects replay at another router address with identical configuration", async function () {
      const other = await f.Router.deploy(f.governance.address, f.feeCollector.address, f.voucherSigner.address);
      await other.waitForDeployment();
      await other.setAdapter(f.adapter.target, true);
      const voucher = await makeVoucher();
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await swap(voucher, signature);
      expect(await other.connect(f.userA).isVoucherValid(voucher, signature)).to.deep.equal([false, "Invalid signature"]);
      await expect(swap(voucher, signature, { router: other })).to.be.revertedWith("Invalid voucher signature");
      expect(await other.voucherUses(voucher.user, voucher.nonce)).to.equal(0n);
      await swap(voucher, await signVoucher(f.voucherSigner, voucher, other.target), { router: other });
    });

    it("rejects replay on a different chain even at the same contract address", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const networks = [];
      try {
        for (const id of [chainId, chainId + 1n]) {
          networks.push(await hre.network.create({ network: "hardhat", override: { chainId: Number(id) } }));
        }
        const source = await deployFixture(networks[0].ethers);
        const target = await deployFixture(networks[1].ethers);
        expect(source.router.target).to.equal(target.router.target);
        expect(source.userA.address).to.equal(target.userA.address);
        expect(source.voucherSigner.address).to.equal(target.voucherSigner.address);
        expect((await networks[0].ethers.provider.getNetwork()).chainId).to.equal(chainId);
        expect((await networks[1].ethers.provider.getNetwork()).chainId).to.equal(chainId + 1n);
        const voucher = await makeVoucher();
        const signature = await signVoucher(source.voucherSigner, voucher, source.router.target, { chainId });
        const sourceOptions = { router: source.router, adapter: source.adapter.target, user: source.userA };
        const targetOptions = { router: target.router, adapter: target.adapter.target, user: target.userA };
        await swap(voucher, signature, sourceOptions);
        expect(await target.router.connect(target.userA).isVoucherValid(voucher, signature))
          .to.deep.equal([false, "Invalid signature"]);
        await expect(swap(voucher, signature, targetOptions)).to.be.revertedWith("Invalid voucher signature");
        expect(await target.router.voucherUses(voucher.user, voucher.nonce)).to.equal(0n);
        await swap(voucher, await signVoucher(target.voucherSigner, voucher, target.router.target,
          { chainId: chainId + 1n }), targetOptions);
      } finally {
        for (const network of networks) await network.close();
      }
    });

    it("accepts redemption at the exact expiry timestamp", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await connection.provider.send("evm_setNextBlockTimestamp", [Number(voucher.expiry)]);
      const tx = await swap(voucher, signature);
      await expect(tx).to.emit(f.router, "VoucherUsed");
      const block = await ethers.provider.getBlock((await tx.wait()).blockNumber);
      expect(BigInt(block.timestamp)).to.equal(voucher.expiry);
    });

    it("rejects redemption one second after expiry", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await connection.provider.send("evm_setNextBlockTimestamp", [Number(voucher.expiry + 1n)]);
      await connection.provider.send("evm_mine", []);
      await rejectedVoucher(voucher, signature, "Expired", "Voucher expired");
    });
  });

  describe("fees, forwarding and pause compatibility", function () {
    for (const feeBps of [0n, 5n, 10n, 25n]) {
      it(`accepts feeBps=${feeBps}, emits the change and charges that exact rate`, async function () {
        await expect(f.router.setFeeBps(feeBps)).to.emit(f.router, "FeeBpsUpdated").withArgs(5n, feeBps);
        expect(await f.router.protocolFeeBps()).to.equal(feeBps);
        const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
        await swap(await makeVoucher(), "0x", { useVoucher: false });
        const fee = SWAP_VALUE * feeBps / 10000n;
        expect(await ethers.provider.getBalance(f.feeCollector.address) - collectorBefore).to.equal(fee);
        expect(await f.adapter.lastReceived()).to.equal(SWAP_VALUE - fee);
      });
    }

    for (const feeBps of [26n, 65535n]) {
      it(`rejects feeBps=${feeBps} above the cap without changing the fee`, async function () {
        await f.router.setFeeBps(25n);
        await expect(f.router.setFeeBps(feeBps)).to.be.revertedWith("Exceeds fee cap");
        expect(await f.router.protocolFeeBps()).to.equal(25n);
      });
    }

    it("rounds native-ETH fees down with integer arithmetic and forwards calldata", async function () {
      const value = 12345n;
      const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
      await swap(await makeVoucher(), "0x", { useVoucher: false, value, swapData: "0x12345678" });
      expect(await ethers.provider.getBalance(f.feeCollector.address) - collectorBefore).to.equal(6n);
      expect(await f.adapter.lastReceived()).to.equal(value - 6n);
    });

    it("allows a full-fee discount without charging the collector and consumes a use", async function () {
      const voucher = await makeVoucher({ discountBps: 5n });
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
      await expect(swap(voucher, signature)).to.emit(f.router, "VoucherUsed")
        .and.not.to.emit(f.router, "FeeCharged");
      expect(await ethers.provider.getBalance(f.feeCollector.address)).to.equal(collectorBefore);
      expect(await f.adapter.lastReceived()).to.equal(SWAP_VALUE);
      await usage(voucher, 1n, true);
    });

    it("rejects discounts above the fee and accepts the same voucher after a sufficient fee increase", async function () {
      const voucher = await makeVoucher({ discountBps: 6n });
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await rejectedVoucher(voucher, signature, "Discount too high", "Discount exceeds fee");
      await f.router.setFeeBps(10n);
      await expect(swap(voucher, signature)).to.emit(f.router, "FeeCharged")
        .withArgs(f.userA.address, SWAP_VALUE * 4n / 10000n);
    });

    it("rejects an unapproved adapter without consuming a valid voucher", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
      await expect(swap(voucher, signature, { adapter: f.userB.address }))
        .to.be.revertedWith("Adapter not whitelisted");
      await usage(voucher, 0n);
      await swap(voucher, signature);
    });

    for (const useVoucher of [false, true]) {
      it(`blocks swaps with useVoucher=${useVoucher} while paused and resumes with configuration and usage intact`, async function () {
        const voucher = await makeVoucher({ maxUses: 2n });
        const signature = await signVoucher(f.voucherSigner, voucher, f.router.target);
        await swap(voucher, signature);
        await expect(f.router.setPaused(true)).to.emit(f.router, "Paused").withArgs(true);
        expect(await f.router.paused()).to.equal(true);
        expect(await f.router.connect(f.userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
        const collectorBefore = await ethers.provider.getBalance(f.feeCollector.address);
        const adapterBefore = await ethers.provider.getBalance(f.adapter.target);
        await expect(swap(voucher, signature, { useVoucher })).to.be.revertedWith("FeeRouter paused");
        await usage(voucher, 1n);
        expect(await ethers.provider.getBalance(f.feeCollector.address)).to.equal(collectorBefore);
        expect(await ethers.provider.getBalance(f.adapter.target)).to.equal(adapterBefore);
        await f.router.setFeeBps(10n);
        await expect(f.router.setPaused(false)).to.emit(f.router, "Paused").withArgs(false);
        expect(await f.router.paused()).to.equal(false);
        await swap(voucher, signature, { useVoucher });
        await usage(voucher, useVoucher ? 2n : 1n, useVoucher);
        const fee = SWAP_VALUE * (10n - (useVoucher ? voucher.discountBps : 0n)) / 10000n;
        expect(await ethers.provider.getBalance(f.feeCollector.address) - collectorBefore).to.equal(fee);
        expect(await f.adapter.lastReceived()).to.equal(SWAP_VALUE - fee);
      });
    }

    it("charges no fee on a zero-value swap without a voucher", async function () {
      await expect(swap(await makeVoucher(), "0x", { useVoucher: false, value: 0n }))
        .not.to.emit(f.router, "FeeCharged");
      expect(await f.adapter.lastReceived()).to.equal(0n);
    });

    it("accepts direct ETH while paused and leaves that balance intact during swaps", async function () {
      await f.router.setPaused(true);
      await f.userA.sendTransaction({ to: f.router.target, value: SWAP_VALUE });
      expect(await ethers.provider.getBalance(f.router.target)).to.equal(SWAP_VALUE);
      await f.router.setPaused(false);
      await swap(await makeVoucher(), "0x", { useVoucher: false });
      expect(await ethers.provider.getBalance(f.router.target)).to.equal(SWAP_VALUE);
    });
  });
});
