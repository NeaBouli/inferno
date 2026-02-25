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
});
