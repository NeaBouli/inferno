import { expect } from "chai";
import hre from "hardhat";
import { connection, ethers } from "./helpers/hardhat.js";

const VOUCHER_TYPES = {
  DiscountVoucher: [
    { name: "user", type: "address" },
    { name: "discountBps", type: "uint16" },
    { name: "maxUses", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};
const SWAP_VALUE = ethers.parseEther("1");

async function deployFixture(runtime = ethers) {
  const [governance, feeCollector, voucherSigner, userA, userB] = await runtime.getSigners();
  const Router = await runtime.getContractFactory("FeeRouterV1");
  const router = await Router.deploy(governance.address, feeCollector.address, voucherSigner.address);
  await router.waitForDeployment();
  const adapter = await (await runtime.getContractFactory("MockAdapter")).deploy();
  await adapter.waitForDeployment();
  await router.setAdapter(adapter.target, true);
  return { Router, router, adapter, governance, feeCollector, voucherSigner, userA, userB };
}

async function signVoucher(signer, voucher, routerAddress, chainId) {
  return signer.signTypedData({
    name: "InfernoFeeRouter",
    version: "1",
    chainId: chainId ?? (await ethers.provider.getNetwork()).chainId,
    verifyingContract: routerAddress,
  }, VOUCHER_TYPES, voucher);
}

function swap(router, adapter, user, voucher, signature, useVoucher = true, swapData = "0x") {
  return router.connect(user).swapWithFee(
    adapter, swapData, voucher, signature, useVoucher, { value: SWAP_VALUE },
  );
}

describe("FeeRouterV1 CWA-18 / JUL-22 evidence", function () {
  let Router, router, adapter, governance, feeCollector, voucherSigner, userA, userB;

  async function makeVoucher(overrides = {}) {
    const block = await ethers.provider.getBlock("latest");
    return {
      user: userA.address,
      discountBps: 3n,
      maxUses: 1n,
      expiry: BigInt(block.timestamp) + 3600n,
      nonce: 18n,
      ...overrides,
    };
  }

  beforeEach(async function () {
    ({ Router, router, adapter, governance, feeCollector, voucherSigner, userA, userB } =
      await deployFixture());
  });

  describe("zero-address constructor and setter paths", function () {
    it("FINDING ZERO-01: constructor accepts zero governance and leaves administration inaccessible", async function () {
      const zeroGovernance = await Router.deploy(ethers.ZeroAddress, feeCollector.address, voucherSigner.address);
      await zeroGovernance.waitForDeployment();
      expect(await zeroGovernance.governance()).to.equal(ethers.ZeroAddress);
      for (const caller of [governance, feeCollector, voucherSigner, userA, userB]) {
        await expect(zeroGovernance.connect(caller).setPaused(true)).to.be.revertedWith("Not governance");
      }
      expect(await zeroGovernance.paused()).to.equal(false);
      expect(await zeroGovernance.whitelistedAdapters(adapter.target)).to.equal(false);
    });

    it("FINDING ZERO-02: constructor accepts zero feeCollector and sends fees to zero", async function () {
      const zeroCollector = await Router.deploy(governance.address, ethers.ZeroAddress, voucherSigner.address);
      await zeroCollector.waitForDeployment();
      await zeroCollector.setAdapter(adapter.target, true);
      expect(await zeroCollector.feeCollector()).to.equal(ethers.ZeroAddress);
      const before = await ethers.provider.getBalance(ethers.ZeroAddress);
      await expect(swap(zeroCollector, adapter.target, userA, await makeVoucher(), "0x", false))
        .to.emit(zeroCollector, "FeeCharged").withArgs(userA.address, SWAP_VALUE * 5n / 10000n);
      expect(await ethers.provider.getBalance(ethers.ZeroAddress) - before).to.equal(SWAP_VALUE * 5n / 10000n);
      expect(await adapter.lastReceived()).to.equal(SWAP_VALUE - SWAP_VALUE * 5n / 10000n);
    });

    it("FINDING ZERO-03: constructor accepts zero voucherSigner and rejects otherwise valid signatures", async function () {
      const zeroSigner = await Router.deploy(governance.address, feeCollector.address, ethers.ZeroAddress);
      await zeroSigner.waitForDeployment();
      await zeroSigner.setAdapter(adapter.target, true);
      expect(await zeroSigner.voucherSigner()).to.equal(ethers.ZeroAddress);
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, zeroSigner.target);
      expect(await zeroSigner.connect(userA).isVoucherValid(voucher, signature))
        .to.deep.equal([false, "Invalid signature"]);
      await expect(swap(zeroSigner, adapter.target, userA, voucher, signature))
        .to.be.revertedWith("Invalid voucher signature");
      expect(await zeroSigner.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      await expect(swap(zeroSigner, adapter.target, userA, voucher, "0x", false))
        .to.emit(zeroSigner, "FeeCharged");
    });

    it("FINDING ZERO-02: setFeeCollector accepts zero and sends fees to zero", async function () {
      await router.setFeeCollector(ethers.ZeroAddress);
      expect(await router.feeCollector()).to.equal(ethers.ZeroAddress);
      const before = await ethers.provider.getBalance(ethers.ZeroAddress);
      await expect(swap(router, adapter.target, userA, await makeVoucher(), "0x", false))
        .to.emit(router, "FeeCharged").withArgs(userA.address, SWAP_VALUE * 5n / 10000n);
      expect(await ethers.provider.getBalance(ethers.ZeroAddress) - before).to.equal(SWAP_VALUE * 5n / 10000n);
      expect(await adapter.lastReceived()).to.equal(SWAP_VALUE - SWAP_VALUE * 5n / 10000n);
    });

    it("FINDING ZERO-03: setVoucherSigner accepts zero and disables signed vouchers until restored", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      expect(await router.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
      await router.setVoucherSigner(ethers.ZeroAddress);
      expect(await router.voucherSigner()).to.equal(ethers.ZeroAddress);
      expect(await router.connect(userA).isVoucherValid(voucher, signature))
        .to.deep.equal([false, "Invalid signature"]);
      await expect(swap(router, adapter.target, userA, voucher, signature))
        .to.be.revertedWith("Invalid voucher signature");
      expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      await router.setVoucherSigner(voucherSigner.address);
      await expect(swap(router, adapter.target, userA, voucher, signature)).to.emit(router, "VoucherUsed");
    });

    it("FINDING ZERO-04: setAdapter(zero, true) enables a successful value transfer to zero", async function () {
      await expect(router.setAdapter(ethers.ZeroAddress, true))
        .to.emit(router, "AdapterWhitelisted").withArgs(ethers.ZeroAddress, true);
      expect(await router.whitelistedAdapters(ethers.ZeroAddress)).to.equal(true);
      const zeroBefore = await ethers.provider.getBalance(ethers.ZeroAddress);
      const collectorBefore = await ethers.provider.getBalance(feeCollector.address);
      await swap(router, ethers.ZeroAddress, userA, await makeVoucher(), "0x", false);
      const fee = SWAP_VALUE * 5n / 10000n;
      expect(await ethers.provider.getBalance(ethers.ZeroAddress) - zeroBefore).to.equal(SWAP_VALUE - fee);
      expect(await ethers.provider.getBalance(feeCollector.address) - collectorBefore).to.equal(fee);
    });

    it("FINDING ZERO-04: setAdapter(zero, false) accepts zero and removes its whitelist entry", async function () {
      await router.setAdapter(ethers.ZeroAddress, true);
      await expect(router.setAdapter(ethers.ZeroAddress, false))
        .to.emit(router, "AdapterWhitelisted").withArgs(ethers.ZeroAddress, false);
      expect(await router.whitelistedAdapters(ethers.ZeroAddress)).to.equal(false);
      await expect(swap(router, ethers.ZeroAddress, userA, await makeVoucher(), "0x", false))
        .to.be.revertedWith("Adapter not whitelisted");
    });

    for (const [setter, args, getter] of [
      ["setFeeCollector", [ethers.ZeroAddress], "feeCollector"],
      ["setVoucherSigner", [ethers.ZeroAddress], "voucherSigner"],
      ["setAdapter", [ethers.ZeroAddress, true], "whitelistedAdapters"],
    ]) {
      it(`${setter} still rejects a non-governance caller supplying zero`, async function () {
        const getterArgs = getter === "whitelistedAdapters" ? [ethers.ZeroAddress] : [];
        const before = await router[getter](...getterArgs);
        await expect(router.connect(userA)[setter](...args)).to.be.revertedWith("Not governance");
        expect(await router[getter](...getterArgs)).to.equal(before);
      });
    }
  });

  describe("maxUses and nonce scope", function () {
    for (const maxUses of [0n, 1n, 2n, 3n, 4294967295n]) {
      const title = maxUses === 1n
        ? "enforces exactly one successful use when maxUses=1 (N succeeds, N+1 reverts)"
        : maxUses === 0n
          ? "FINDING USE-01: maxUses=0 still permits one successful use"
          : `FINDING USE-01: maxUses=${maxUses} rejects the second use before the signed limit`;
      it(title, async function () {
        const voucher = await makeVoucher({ maxUses });
        const signature = await signVoucher(voucherSigner, voucher, router.target);
        expect(await router.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
        await expect(swap(router, adapter.target, userA, voucher, signature))
          .to.emit(router, "VoucherUsed").withArgs(userA.address, voucher.nonce, voucher.discountBps);
        expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(true);
        expect(await router.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([false, "Used"]);
        const adapterBefore = await ethers.provider.getBalance(adapter.target);
        const collectorBefore = await ethers.provider.getBalance(feeCollector.address);
        await expect(swap(router, adapter.target, userA, voucher, signature))
          .to.be.revertedWith("Nonce already used");
        expect(await ethers.provider.getBalance(adapter.target)).to.equal(adapterBefore);
        expect(await ethers.provider.getBalance(feeCollector.address)).to.equal(collectorBefore);
      });
    }

    it("binds maxUses in the signature even though it does not enforce a use counter", async function () {
      const voucher = await makeVoucher({ maxUses: 2n });
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      for (const maxUses of [0n, 1n, 3n, 4294967295n]) {
        const tampered = { ...voucher, maxUses };
        expect(await router.connect(userA).isVoucherValid(tampered, signature))
          .to.deep.equal([false, "Invalid signature"]);
        await expect(swap(router, adapter.target, userA, tampered, signature))
          .to.be.revertedWith("Invalid voucher signature");
        expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      }
      await expect(swap(router, adapter.target, userA, voucher, signature)).to.emit(router, "VoucherUsed");
    });

    it("tracks nonces per user rather than globally or as a per-user total", async function () {
      const first = await makeVoucher();
      const secondUser = { ...first, user: userB.address };
      const secondNonce = { ...first, nonce: first.nonce + 1n };
      await swap(router, adapter.target, userA, first, await signVoucher(voucherSigner, first, router.target));
      expect(await router.usedNonces(userB.address, first.nonce)).to.equal(false);
      expect(await router.usedNonces(userA.address, secondNonce.nonce)).to.equal(false);
      await expect(swap(router, adapter.target, userB, secondUser,
        await signVoucher(voucherSigner, secondUser, router.target))).to.emit(router, "VoucherUsed");
      await expect(swap(router, adapter.target, userA, secondNonce,
        await signVoucher(voucherSigner, secondNonce, router.target))).to.emit(router, "VoucherUsed");
      expect(await router.usedNonces(userA.address, first.nonce)).to.equal(true);
      expect(await router.usedNonces(userB.address, first.nonce)).to.equal(true);
      expect(await router.usedNonces(userA.address, secondNonce.nonce)).to.equal(true);
    });

    it("rejects a newly signed voucher that reuses an already consumed user nonce", async function () {
      const voucher = await makeVoucher();
      await swap(router, adapter.target, userA, voucher, await signVoucher(voucherSigner, voucher, router.target));
      const replacement = { ...voucher, maxUses: 3n, discountBps: 2n, expiry: voucher.expiry + 100n };
      const signature = await signVoucher(voucherSigner, replacement, router.target);
      expect(await router.connect(userA).isVoucherValid(replacement, signature)).to.deep.equal([false, "Used"]);
      await expect(swap(router, adapter.target, userA, replacement, signature))
        .to.be.revertedWith("Nonce already used");
    });

    it("ignores an unused voucher when useVoucher=false but consumes it even on a zero-value voucher swap", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      await swap(router, adapter.target, userA, voucher, "0x", false);
      expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      await expect(router.connect(userA).swapWithFee(adapter.target, "0x", voucher, signature, true, { value: 0n }))
        .to.emit(router, "VoucherUsed");
      expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(true);
      await expect(swap(router, adapter.target, userA, voucher, signature)).to.be.revertedWith("Nonce already used");
    });

    it("rolls back nonce consumption and fee transfers when the adapter call reverts", async function () {
      // The router has receive() but no fallback for this unknown function selector.
      await router.setAdapter(router.target, true);
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      const collectorBefore = await ethers.provider.getBalance(feeCollector.address);
      await expect(swap(router, router.target, userA, voucher, signature, true, "0x12345678"))
        .to.be.revertedWith("Swap failed");
      expect(await ethers.provider.getBalance(feeCollector.address)).to.equal(collectorBefore);
      expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      expect(await router.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
      await expect(swap(router, adapter.target, userA, voucher, signature)).to.emit(router, "VoucherUsed");
    });
  });

  describe("signature replay and expiry boundaries", function () {
    it("rejects replay on another router address with identical configuration and an unused nonce", async function () {
      const other = await Router.deploy(governance.address, feeCollector.address, voucherSigner.address);
      await other.waitForDeployment();
      await other.setAdapter(adapter.target, true);
      expect(other.target).not.to.equal(router.target);
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      await swap(router, adapter.target, userA, voucher, signature);
      expect(await other.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      expect(await other.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([false, "Invalid signature"]);
      await expect(swap(other, adapter.target, userA, voucher, signature)).to.be.revertedWith("Invalid voucher signature");
      expect(await other.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      await expect(swap(other, adapter.target, userA, voucher,
        await signVoucher(voucherSigner, voucher, other.target))).to.emit(other, "VoucherUsed");
    });

    it("rejects replay on another chainId at the same router address", async function () {
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
        const signature = await signVoucher(source.voucherSigner, voucher, source.router.target, chainId);
        await swap(source.router, source.adapter.target, source.userA, voucher, signature);
        expect(await target.router.usedNonces(target.userA.address, voucher.nonce)).to.equal(false);
        expect(await target.router.connect(target.userA).isVoucherValid(voucher, signature))
          .to.deep.equal([false, "Invalid signature"]);
        await expect(swap(target.router, target.adapter.target, target.userA, voucher, signature))
          .to.be.revertedWith("Invalid voucher signature");
        expect(await target.router.usedNonces(target.userA.address, voucher.nonce)).to.equal(false);
        await expect(swap(target.router, target.adapter.target, target.userA, voucher,
          await signVoucher(target.voucherSigner, voucher, target.router.target, chainId + 1n)))
          .to.emit(target.router, "VoucherUsed");
      } finally {
        for (const network of networks) await network.close();
      }
    });

    it("rejects a voucher signed by the wrong signer without consuming its nonce", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(userB, voucher, router.target);
      expect(await router.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([false, "Invalid signature"]);
      await expect(swap(router, adapter.target, userA, voucher, signature)).to.be.revertedWith("Invalid voucher signature");
      expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      await expect(swap(router, adapter.target, userA, voucher,
        await signVoucher(voucherSigner, voucher, router.target))).to.emit(router, "VoucherUsed");
    });

    it("rejects another user's signed voucher without consuming either user's nonce", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      expect(await router.connect(userB).isVoucherValid(voucher, signature)).to.deep.equal([false, "Wrong user"]);
      await expect(swap(router, adapter.target, userB, voucher, signature)).to.be.revertedWith("Voucher not for sender");
      expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
      expect(await router.usedNonces(userB.address, voucher.nonce)).to.equal(false);
      await expect(swap(router, adapter.target, userA, voucher, signature)).to.emit(router, "VoucherUsed");
    });

    it("accepts a voucher at its exact expiry timestamp", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      await connection.provider.send("evm_setNextBlockTimestamp", [Number(voucher.expiry)]);
      const tx = await swap(router, adapter.target, userA, voucher, signature);
      await expect(tx).to.emit(router, "VoucherUsed");
      const block = await ethers.provider.getBlock((await tx.wait()).blockNumber);
      expect(BigInt(block.timestamp)).to.equal(voucher.expiry);
    });

    it("rejects a voucher one second after expiry without consuming its nonce", async function () {
      const voucher = await makeVoucher();
      const signature = await signVoucher(voucherSigner, voucher, router.target);
      await connection.provider.send("evm_setNextBlockTimestamp", [Number(voucher.expiry + 1n)]);
      await connection.provider.send("evm_mine", []);
      expect(await router.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([false, "Expired"]);
      await expect(swap(router, adapter.target, userA, voucher, signature)).to.be.revertedWith("Voucher expired");
      expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
    });
  });

  describe("fee cap and pause boundaries", function () {
    for (const feeBps of [0n, 25n]) {
      it(`accepts feeBps=${feeBps} and charges that exact rate`, async function () {
        await expect(router.setFeeBps(feeBps)).to.emit(router, "FeeBpsUpdated").withArgs(5n, feeBps);
        expect(await router.FEE_CAP_BPS()).to.equal(25n);
        expect(await router.protocolFeeBps()).to.equal(feeBps);
        const before = await ethers.provider.getBalance(feeCollector.address);
        await swap(router, adapter.target, userA, await makeVoucher(), "0x", false);
        const fee = SWAP_VALUE * feeBps / 10000n;
        expect(await ethers.provider.getBalance(feeCollector.address) - before).to.equal(fee);
        expect(await adapter.lastReceived()).to.equal(SWAP_VALUE - fee);
      });
    }

    for (const feeBps of [26n, 65535n]) {
      it(`rejects feeBps=${feeBps} above the cap without changing the fee`, async function () {
        await router.setFeeBps(25n);
        await expect(router.setFeeBps(feeBps)).to.be.revertedWith("Exceeds fee cap");
        expect(await router.protocolFeeBps()).to.equal(25n);
      });
    }

    for (const useVoucher of [false, true]) {
      it(`blocks swaps with useVoucher=${useVoucher} while paused and resumes without losing the voucher`, async function () {
        const voucher = await makeVoucher();
        const signature = await signVoucher(voucherSigner, voucher, router.target);
        await expect(router.setPaused(true)).to.emit(router, "Paused").withArgs(true);
        expect(await router.paused()).to.equal(true);
        // This view validates voucher fields; it does not promise a swap can execute while paused.
        expect(await router.connect(userA).isVoucherValid(voucher, signature)).to.deep.equal([true, "Valid"]);
        const adapterBefore = await ethers.provider.getBalance(adapter.target);
        const collectorBefore = await ethers.provider.getBalance(feeCollector.address);
        await expect(swap(router, adapter.target, userA, voucher, signature, useVoucher))
          .to.be.revertedWith("FeeRouter paused");
        expect(await ethers.provider.getBalance(adapter.target)).to.equal(adapterBefore);
        expect(await ethers.provider.getBalance(feeCollector.address)).to.equal(collectorBefore);
        expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(false);
        // Governance configuration remains available during the pause.
        await router.setFeeBps(10n);
        expect(await router.protocolFeeBps()).to.equal(10n);
        await expect(router.setPaused(false)).to.emit(router, "Paused").withArgs(false);
        expect(await router.paused()).to.equal(false);
        await swap(router, adapter.target, userA, voucher, signature, useVoucher);
        expect(await router.usedNonces(userA.address, voucher.nonce)).to.equal(useVoucher);
        const fee = SWAP_VALUE * (10n - (useVoucher ? voucher.discountBps : 0n)) / 10000n;
        expect(await ethers.provider.getBalance(feeCollector.address) - collectorBefore).to.equal(fee);
        expect(await adapter.lastReceived()).to.equal(SWAP_VALUE - fee);
      });
    }

    it("continues to accept direct ETH deposits while paused", async function () {
      await router.setPaused(true);
      await userA.sendTransaction({ to: router.target, value: SWAP_VALUE });
      expect(await router.paused()).to.equal(true);
      expect(await ethers.provider.getBalance(router.target)).to.equal(SWAP_VALUE);
    });
  });
});
