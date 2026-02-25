const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FeeRouterV1", function () {
  let router, adapter;
  let governance, feeCollector, voucherSigner, userA, userB;

  // EIP-712 domain and types (must match contract)
  const DOMAIN_NAME = "InfernoFeeRouter";
  const DOMAIN_VERSION = "1";
  const VOUCHER_TYPES = {
    DiscountVoucher: [
      { name: "user", type: "address" },
      { name: "discountBps", type: "uint16" },
      { name: "maxUses", type: "uint32" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
  };

  async function signVoucher(signer, voucher, routerAddress) {
    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: routerAddress,
    };
    return signer._signTypedData(domain, VOUCHER_TYPES, voucher);
  }

  async function blockTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
  }

  function emptyVoucher() {
    return {
      user: ethers.constants.AddressZero,
      discountBps: 0,
      maxUses: 0,
      expiry: 0,
      nonce: 0,
    };
  }

  beforeEach(async function () {
    [governance, feeCollector, voucherSigner, userA, userB] = await ethers.getSigners();

    const Router = await ethers.getContractFactory("FeeRouterV1");
    router = await Router.deploy(governance.address, feeCollector.address, voucherSigner.address);
    await router.deployed();

    const Adapter = await ethers.getContractFactory("MockAdapter");
    adapter = await Adapter.deploy();
    await adapter.deployed();

    // Whitelist the adapter
    await router.connect(governance).setAdapter(adapter.address, true);
  });

  // --- Test 1: Deployment ---
  it("sets governance, feeCollector, voucherSigner correctly", async function () {
    expect(await router.governance()).to.equal(governance.address);
    expect(await router.feeCollector()).to.equal(feeCollector.address);
    expect(await router.voucherSigner()).to.equal(voucherSigner.address);
    expect(await router.protocolFeeBps()).to.equal(5);
    expect(await router.FEE_CAP_BPS()).to.equal(25);
  });

  // --- Test 2: setFeeBps governance ---
  it("governance can set fee bps", async function () {
    await expect(router.connect(governance).setFeeBps(10))
      .to.emit(router, "FeeBpsUpdated").withArgs(5, 10);
    expect(await router.protocolFeeBps()).to.equal(10);
  });

  it("non-governance cannot set fee bps", async function () {
    await expect(router.connect(userA).setFeeBps(10))
      .to.be.revertedWith("Not governance");
  });

  // --- Test 3: setFeeBps cap ---
  it("reverts if fee bps exceeds cap", async function () {
    await expect(router.connect(governance).setFeeBps(26))
      .to.be.revertedWith("Exceeds fee cap");
  });

  // --- Test 4: setAdapter governance ---
  it("only governance can whitelist adapters", async function () {
    await expect(router.connect(userA).setAdapter(userB.address, true))
      .to.be.revertedWith("Not governance");
  });

  // --- Test 5: swapWithFee non-whitelisted adapter ---
  it("reverts swap with non-whitelisted adapter", async function () {
    await expect(
      router.connect(userA).swapWithFee(
        userB.address, "0x", emptyVoucher(), "0x", false,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("Adapter not whitelisted");
  });

  // --- Test 6: swapWithFee without voucher → full fee ---
  it("charges full protocol fee without voucher", async function () {
    const swapAmount = ethers.utils.parseEther("1"); // 1 ETH
    const feeBps = await router.protocolFeeBps(); // 5 bps = 0.05%
    const expectedFee = swapAmount.mul(feeBps).div(10000);

    const collectorBefore = await ethers.provider.getBalance(feeCollector.address);

    await router.connect(userA).swapWithFee(
      adapter.address, "0x", emptyVoucher(), "0x", false,
      { value: swapAmount }
    );

    const collectorAfter = await ethers.provider.getBalance(feeCollector.address);
    expect(collectorAfter.sub(collectorBefore)).to.equal(expectedFee);

    // Adapter should receive swapAmount - fee
    expect(await adapter.lastReceived()).to.equal(swapAmount.sub(expectedFee));
  });

  // --- Test 7: swapWithFee with valid voucher → reduced fee ---
  it("reduces fee with valid voucher", async function () {
    const swapAmount = ethers.utils.parseEther("1");
    const discountBps = 3; // 3 bps discount → effective 2 bps
    const nonce = 42;
    const expiry = await blockTimestamp() + 3600; // 1h from now

    const voucher = {
      user: userA.address,
      discountBps,
      maxUses: 1,
      expiry,
      nonce,
    };

    const sig = await signVoucher(voucherSigner, voucher, router.address);

    const expectedFee = swapAmount.mul(5 - discountBps).div(10000); // 2 bps
    const collectorBefore = await ethers.provider.getBalance(feeCollector.address);

    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, sig, true,
        { value: swapAmount }
      )
    ).to.emit(router, "VoucherUsed").withArgs(userA.address, nonce, discountBps);

    const collectorAfter = await ethers.provider.getBalance(feeCollector.address);
    expect(collectorAfter.sub(collectorBefore)).to.equal(expectedFee);
  });

  // --- Test 8: expired voucher ---
  it("reverts with expired voucher", async function () {
    const voucher = {
      user: userA.address,
      discountBps: 3,
      maxUses: 1,
      expiry: 1, // expired (timestamp 1)
      nonce: 100,
    };

    const sig = await signVoucher(voucherSigner, voucher, router.address);

    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, sig, true,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("Voucher expired");
  });

  // --- Test 9: replay protection (same nonce) ---
  it("reverts voucher replay with same nonce", async function () {
    const expiry = await blockTimestamp() + 3600;
    const voucher = {
      user: userA.address,
      discountBps: 3,
      maxUses: 1,
      expiry,
      nonce: 200,
    };

    const sig = await signVoucher(voucherSigner, voucher, router.address);

    // First use: success
    await router.connect(userA).swapWithFee(
      adapter.address, "0x", voucher, sig, true,
      { value: ethers.utils.parseEther("1") }
    );

    // Second use: replay → revert
    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, sig, true,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("Nonce already used");
  });

  // --- Test 10: wrong signer ---
  it("reverts voucher with wrong signer", async function () {
    const expiry = await blockTimestamp() + 3600;
    const voucher = {
      user: userA.address,
      discountBps: 3,
      maxUses: 1,
      expiry,
      nonce: 300,
    };

    // Sign with userB instead of voucherSigner
    const badSig = await signVoucher(userB, voucher, router.address);

    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, badSig, true,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("Invalid voucher signature");
  });

  // --- Test 11: discount >= protocolFee → fee clamps to 0 ---
  it("clamps fee to 0 when discount >= protocolFee", async function () {
    const swapAmount = ethers.utils.parseEther("1");
    const expiry = await blockTimestamp() + 3600;
    const voucher = {
      user: userA.address,
      discountBps: 5, // equals protocolFeeBps
      maxUses: 1,
      expiry,
      nonce: 400,
    };

    const sig = await signVoucher(voucherSigner, voucher, router.address);

    const collectorBefore = await ethers.provider.getBalance(feeCollector.address);

    await router.connect(userA).swapWithFee(
      adapter.address, "0x", voucher, sig, true,
      { value: swapAmount }
    );

    // No fee should be charged
    const collectorAfter = await ethers.provider.getBalance(feeCollector.address);
    expect(collectorAfter.sub(collectorBefore)).to.equal(0);

    // Adapter gets full amount
    expect(await adapter.lastReceived()).to.equal(swapAmount);
  });

  // --- Test 12: paused ---
  it("reverts swap when paused", async function () {
    await router.connect(governance).setPaused(true);

    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", emptyVoucher(), "0x", false,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("FeeRouter paused");
  });

  // --- Test 13: setVoucherSigner governance ---
  it("governance can set voucher signer", async function () {
    await router.connect(governance).setVoucherSigner(userB.address);
    expect(await router.voucherSigner()).to.equal(userB.address);
  });

  // --- Test 14: setVoucherSigner non-governance ---
  it("non-governance cannot set voucher signer", async function () {
    await expect(router.connect(userA).setVoucherSigner(userB.address))
      .to.be.revertedWith("Not governance");
  });

  // --- Test 15: setFeeCollector governance ---
  it("governance can set fee collector", async function () {
    await router.connect(governance).setFeeCollector(userB.address);
    expect(await router.feeCollector()).to.equal(userB.address);
  });

  // --- Test 16: setFeeCollector non-governance ---
  it("non-governance cannot set fee collector", async function () {
    await expect(router.connect(userA).setFeeCollector(userB.address))
      .to.be.revertedWith("Not governance");
  });

  // --- Test 17: setPaused non-governance ---
  it("non-governance cannot set paused", async function () {
    await expect(router.connect(userA).setPaused(true))
      .to.be.revertedWith("Not governance");
  });

  // --- Test 18: setFeeBps at exact cap ---
  it("setFeeBps at exact cap (25) succeeds", async function () {
    await router.connect(governance).setFeeBps(25);
    expect(await router.protocolFeeBps()).to.equal(25);
  });

  // --- Test 19: setAdapter emits event ---
  it("setAdapter emits AdapterWhitelisted event", async function () {
    await expect(router.connect(governance).setAdapter(userB.address, true))
      .to.emit(router, "AdapterWhitelisted").withArgs(userB.address, true);
  });

  // --- Test 20: voucher not for sender ---
  it("reverts voucher not for sender", async function () {
    const expiry = await blockTimestamp() + 3600;
    const voucher = {
      user: userB.address, // voucher is for userB
      discountBps: 3,
      maxUses: 1,
      expiry,
      nonce: 500,
    };

    const sig = await signVoucher(voucherSigner, voucher, router.address);

    // userA tries to use userB's voucher
    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, sig, true,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("Voucher not for sender");
  });

  // --- Test 21: discount exceeds fee ---
  it("reverts when discount exceeds protocol fee", async function () {
    const expiry = await blockTimestamp() + 3600;
    const voucher = {
      user: userA.address,
      discountBps: 6, // 6 > protocolFeeBps (5)
      maxUses: 1,
      expiry,
      nonce: 600,
    };

    const sig = await signVoucher(voucherSigner, voucher, router.address);

    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, sig, true,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("Discount exceeds fee");
  });

  // --- Test 22: receive() accepts ETH ---
  it("contract can receive ETH via receive()", async function () {
    const amount = ethers.utils.parseEther("0.1");
    await userA.sendTransaction({ to: router.address, value: amount });
    expect(await ethers.provider.getBalance(router.address)).to.equal(amount);
  });

  // --- Test 23: swapWithFee with value=0 ---
  it("swapWithFee with value=0 charges no fee", async function () {
    const collectorBefore = await ethers.provider.getBalance(feeCollector.address);

    await router.connect(userA).swapWithFee(
      adapter.address, "0x", emptyVoucher(), "0x", false,
      { value: 0 }
    );

    const collectorAfter = await ethers.provider.getBalance(feeCollector.address);
    expect(collectorAfter.sub(collectorBefore)).to.equal(0);
  });

  // --- Test 24: setPaused emits event ---
  it("setPaused emits Paused event", async function () {
    await expect(router.connect(governance).setPaused(true))
      .to.emit(router, "Paused").withArgs(true);
  });

  // --- isVoucherValid tests ---
  describe("isVoucherValid", function () {
    // --- Test 25: valid voucher ---
    it("returns (true, Valid) for valid voucher", async function () {
      const expiry = await blockTimestamp() + 3600;
      const voucher = {
        user: userA.address,
        discountBps: 3,
        maxUses: 1,
        expiry,
        nonce: 700,
      };

      const sig = await signVoucher(voucherSigner, voucher, router.address);
      const [valid, reason] = await router.connect(userA).isVoucherValid(voucher, sig);
      expect(valid).to.equal(true);
      expect(reason).to.equal("Valid");
    });

    // --- Test 26: wrong user ---
    it("returns (false, Wrong user) for wrong caller", async function () {
      const expiry = await blockTimestamp() + 3600;
      const voucher = {
        user: userB.address,
        discountBps: 3,
        maxUses: 1,
        expiry,
        nonce: 701,
      };

      const sig = await signVoucher(voucherSigner, voucher, router.address);
      const [valid, reason] = await router.connect(userA).isVoucherValid(voucher, sig);
      expect(valid).to.equal(false);
      expect(reason).to.equal("Wrong user");
    });

    // --- Test 27: expired ---
    it("returns (false, Expired) for expired voucher", async function () {
      const voucher = {
        user: userA.address,
        discountBps: 3,
        maxUses: 1,
        expiry: 1, // way in the past
        nonce: 702,
      };

      const sig = await signVoucher(voucherSigner, voucher, router.address);
      const [valid, reason] = await router.connect(userA).isVoucherValid(voucher, sig);
      expect(valid).to.equal(false);
      expect(reason).to.equal("Expired");
    });

    // --- Test 28: used nonce ---
    it("returns (false, Used) for used nonce", async function () {
      const expiry = await blockTimestamp() + 3600;
      const voucher = {
        user: userA.address,
        discountBps: 3,
        maxUses: 1,
        expiry,
        nonce: 703,
      };

      const sig = await signVoucher(voucherSigner, voucher, router.address);

      // Use the voucher first
      await router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, sig, true,
        { value: ethers.utils.parseEther("1") }
      );

      // Now check validity — nonce is used
      const [valid, reason] = await router.connect(userA).isVoucherValid(voucher, sig);
      expect(valid).to.equal(false);
      expect(reason).to.equal("Used");
    });

    // --- Test 29: discount too high ---
    it("returns (false, Discount too high) for discount > fee", async function () {
      const expiry = await blockTimestamp() + 3600;
      const voucher = {
        user: userA.address,
        discountBps: 10, // > protocolFeeBps (5)
        maxUses: 1,
        expiry,
        nonce: 704,
      };

      const sig = await signVoucher(voucherSigner, voucher, router.address);
      const [valid, reason] = await router.connect(userA).isVoucherValid(voucher, sig);
      expect(valid).to.equal(false);
      expect(reason).to.equal("Discount too high");
    });

    // --- Test 30: invalid signature ---
    it("returns (false, Invalid signature) for wrong signer", async function () {
      const expiry = await blockTimestamp() + 3600;
      const voucher = {
        user: userA.address,
        discountBps: 3,
        maxUses: 1,
        expiry,
        nonce: 705,
      };

      // Sign with wrong key
      const badSig = await signVoucher(userB, voucher, router.address);
      const [valid, reason] = await router.connect(userA).isVoucherValid(voucher, badSig);
      expect(valid).to.equal(false);
      expect(reason).to.equal("Invalid signature");
    });
  });

  // --- Test 31: voucher with new signer after rotation ---
  it("voucher works with rotated signer", async function () {
    // Rotate signer to userB
    await router.connect(governance).setVoucherSigner(userB.address);

    const expiry = await blockTimestamp() + 3600;
    const voucher = {
      user: userA.address,
      discountBps: 3,
      maxUses: 1,
      expiry,
      nonce: 800,
    };

    // Sign with new signer (userB)
    const sig = await signVoucher(userB, voucher, router.address);

    await expect(
      router.connect(userA).swapWithFee(
        adapter.address, "0x", voucher, sig, true,
        { value: ethers.utils.parseEther("1") }
      )
    ).to.emit(router, "VoucherUsed");
  });

  // --- Test 32: fee collector receives after rotation ---
  it("fee goes to new collector after setFeeCollector", async function () {
    await router.connect(governance).setFeeCollector(userB.address);

    const swapAmount = ethers.utils.parseEther("1");
    const feeBps = await router.protocolFeeBps();
    const expectedFee = swapAmount.mul(feeBps).div(10000);

    const collectorBefore = await ethers.provider.getBalance(userB.address);

    await router.connect(userA).swapWithFee(
      adapter.address, "0x", emptyVoucher(), "0x", false,
      { value: swapAmount }
    );

    const collectorAfter = await ethers.provider.getBalance(userB.address);
    expect(collectorAfter.sub(collectorBefore)).to.equal(expectedFee);
  });
});
