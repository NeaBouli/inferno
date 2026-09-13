// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// CWA deep-audit fuzz harness — evidence artifact, not part of the audited tree.
// Contracts are imported read-only from the pinned repo checkout (see foundry.toml).

import {Test} from "forge-std/Test.sol";
import {InfernoToken} from "ifr/token/InfernoToken.sol";
import {IFRLock} from "ifr/lock/IFRLock.sol";
import {Vesting} from "ifr/vesting/Vesting.sol";
import {LiquidityReserve} from "ifr/liquidity/LiquidityReserve.sol";
import {CommitmentVault} from "ifr/vault/CommitmentVault.sol";
import {FeeRouterV1} from "ifr/FeeRouterV1.sol";

contract MockAdapter {
    receive() external payable {}
    fallback() external payable {}
}

contract IFRDeepAuditTest is Test {
    uint256 constant GENESIS = 1_000_000_000 * 1e9;
    uint256 constant BASE_TIME = 1_700_000_000;

    InfernoToken token;
    FeeRouterV1 router;
    MockAdapter adapter;
    address feeSink = address(0xFEE1);
    address guardian = address(0x6A12);
    address gov = address(0x607);
    address collector = address(0xC011);
    address user = address(0x1234);
    address signer;
    uint256 signerPk;
    address deployer;

    function setUp() public {
        vm.warp(BASE_TIME);
        deployer = address(this);
        token = new InfernoToken(feeSink);
        token.setFeeExempt(deployer, true); // ops transfers in tests move without fees

        (signer, signerPk) = makeAddrAndKey("voucherSigner");
        router = new FeeRouterV1(gov, collector, signer);
        adapter = new MockAdapter();
        vm.prank(gov);
        router.setAdapter(address(adapter), true);
        vm.deal(user, 10 ether);
    }

    // ── 1. Token: fee conservation + deflation-only supply ────────────────
    function testFuzz_feeConservation(uint256 amountSeed, uint16 sB, uint16 rB, uint16 pB) public {
        vm.assume(uint256(sB) + uint256(rB) + uint256(pB) <= 500);
        token.setFeeExempt(deployer, false);
        token.setFeeRates(sB, rB, pB);

        address alice = address(0xA11CE);
        uint256 amount = bound(amountSeed, 1, token.balanceOf(deployer));

        uint256 burnS = (amount * sB) / 10_000;
        uint256 burnR = (amount * rB) / 10_000;
        uint256 pool = (amount * pB) / 10_000;
        uint256 net = amount - burnS - burnR - pool;

        uint256 supplyBefore = token.totalSupply();
        uint256 sinkBefore = token.balanceOf(feeSink);
        uint256 deployerBefore = token.balanceOf(deployer);

        token.transfer(alice, amount);

        assertEq(token.balanceOf(alice), net, "recipient net mismatch");
        assertEq(token.balanceOf(feeSink), sinkBefore + pool, "pool fee mismatch");
        assertEq(token.totalSupply(), supplyBefore - burnS - burnR, "supply burn mismatch");
        assertEq(token.balanceOf(deployer), deployerBefore - amount, "sender debit mismatch");
        assertLe(token.totalSupply(), GENESIS, "supply must never exceed genesis");
    }

    // ── 2. Token: feeExempt skips all fees (documents exemption blast radius) ──
    function testFuzz_exemptTransferSkipsFees(uint256 amountSeed) public {
        address alice = address(0xA11CE);
        uint256 amount = bound(amountSeed, 1, token.balanceOf(deployer));
        token.transfer(alice, amount); // deployer exempt in setUp
        assertEq(token.balanceOf(alice), amount, "exempt transfer must be fee-free");
        assertEq(token.totalSupply(), GENESIS, "exempt transfer must not burn");
    }

    // ── 3. IFRLock: accounting invariants under random lock/unlock sequences ──
    function testFuzz_lockAccounting(uint256 seed) public {
        IFRLock lock = new IFRLock(address(token), guardian);
        token.setFeeExempt(address(lock), true);

        address[3] memory users = [address(0xA), address(0xB), address(0xC)];
        uint256 rounds = bound(seed & 0xff, 1, 24);

        for (uint256 i = 0; i < rounds; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address u = users[r % 3];
            uint256 amt = 1_000e9 + (r % 5_000e9);
            if (token.balanceOf(deployer) < amt) break;

            token.transfer(u, amt); // deployer exempt → full amount
            vm.prank(u);
            token.approve(address(lock), amt);
            vm.prank(u);
            lock.lock(amt);

            if (r & 0x10 != 0) {
                vm.prank(u);
                lock.unlock(); // clears that user's full accumulated lock
            }
        }
        assertEq(token.balanceOf(address(lock)), lock.totalLocked(), "balanceOf == totalLocked");
        uint256 sumUsers = 0;
        for (uint256 i = 0; i < 3; i++) sumUsers += lock.lockedBalance(users[i]);
        assertEq(sumUsers, lock.totalLocked(), "sum(user locks) == totalLocked");
    }

    // ── 4. IFRLock: PROOF that feeExempt is load-bearing (invariant dependency) ──
    function test_lockWithoutExemption_provesAccountingDrift() public {
        IFRLock lock = new IFRLock(address(token), guardian); // NOT fee-exempt
        token.setFeeExempt(deployer, false);

        address u = address(0xD1);
        token.transfer(u, 10_000e9); // u receives 9650e9 (3.5% fees)

        vm.startPrank(u);
        token.approve(address(lock), 1_000e9);
        lock.lock(1_000e9); // lock receives 965e9 but credits 1000e9
        vm.stopPrank();

        assertEq(lock.lockedBalance(u), 1_000e9, "credited full amount");
        assertEq(token.balanceOf(address(lock)), 965e9, "received less (fees)");

        vm.prank(u);
        vm.expectRevert(); // ERC20InsufficientBalance inside token._update
        lock.unlock(); // user CANNOT unlock the credited amount → funds stuck
    }

    // ── 5. Vesting: monotonicity, cap, release consistency ───────────────
    function testFuzz_vestingMonotonic(uint32 t1, uint32 t2) public {
        vm.assume(t1 <= t2);
        address bob = address(0xB0B);
        token.setFeeExempt(bob, true);

        Vesting v = new Vesting(address(token), bob, 365 days, 1460 days, 150_000_000e9, guardian);
        token.setFeeExempt(address(v), true);
        token.transfer(address(v), 150_000_000e9);

        vm.warp(BASE_TIME + t1);
        uint256 v1 = v.vestedAmount();
        vm.warp(BASE_TIME + uint256(t2));
        uint256 v2 = v.vestedAmount();

        assertLe(v1, v2, "vested must be non-decreasing");
        assertLe(v2, 150_000_000e9, "vested must never exceed allocation");
        if (t1 < 365 days) assertEq(v1, 0, "zero before cliff");
        if (uint256(t2) >= 1460 days) assertEq(v2, 150_000_000e9, "full after duration");

        if (v2 > 0) {
            vm.prank(bob);
            v.release();
            assertEq(token.balanceOf(bob), v2, "release pays exactly vested");
            assertEq(v.released(), v2);
            assertEq(v.releasableAmount(), 0, "nothing left after release");
        }
    }

    // ── 6. LiquidityReserve: per-period cap cannot be exceeded ───────────
    function testFuzz_reservePeriodCaps(uint8 periodsSeed) public {
        uint256 periods = bound(periodsSeed, 1, 4);
        LiquidityReserve res =
            new LiquidityReserve(address(token), 180 days, 50_000_000e9, 90 days, guardian);
        token.setFeeExempt(address(res), true);
        token.setFeeExempt(address(0xBEEF), true);
        token.transfer(address(res), 200_000_000e9);

        vm.expectRevert(); // "locked" before lockEnd
        res.withdraw(address(0xBEEF), 1e9);

        uint256 total;
        for (uint256 p = 0; p < periods; p++) {
            vm.warp(BASE_TIME + 180 days + p * 90 days + 1);
            res.withdraw(address(0xBEEF), 50_000_000e9); // exactly the cap: ok
            total += 50_000_000e9;
            vm.expectRevert(); // 1 wei more in the same period: revert
            res.withdraw(address(0xBEEF), 1);
        }
        assertEq(res.totalWithdrawn(), total);
        assertLe(res.totalWithdrawn(), 200_000_000e9);
    }

    // ── 7. CommitmentVault: PROOF price tranches can never unlock (CWA-03) ──
    function test_priceTrancheNeverUnlocks() public {
        address carl = address(0xCA21);
        CommitmentVault cv = new CommitmentVault(address(token), gov);
        token.setFeeExempt(address(cv), true);
        token.setFeeExempt(carl, true);
        token.transfer(carl, 10_000e9);

        vm.startPrank(carl);
        token.approve(address(cv), 10_000e9);
        cv.lock(5_000e9, CommitmentVault.ConditionType.PRICE_ONLY, 0, 200); // target: 2x P0
        cv.lock(5_000e9, CommitmentVault.ConditionType.TIME_ONLY, block.timestamp + 30 days, 0);
        vm.stopPrank();

        // Governance sets P0 and even a non-zero oracle:
        vm.startPrank(gov);
        cv.setP0(300_000_000);
        cv.setPriceOracle(address(0x0AC1E));
        vm.stopPrank();

        vm.warp(block.timestamp + 2000 days);

        vm.prank(carl);
        vm.expectRevert(); // "condition not met" — price stub always returns 0
        cv.unlock(carl, 0);

        vm.prank(address(0xD00D)); // permissionless auto-unlock path also fails
        vm.expectRevert();
        cv.unlock(carl, 0);

        vm.prank(carl); // control: TIME_ONLY tranche unlocks normally
        cv.unlock(carl, 1);

        assertEq(token.balanceOf(carl), 5_000e9, "time tranche returned");
        assertEq(token.balanceOf(address(cv)), 5_000e9, "price tranche stranded permanently");
    }

    // ── 8. FeeRouterV1: voucher lifecycle (split into focused cases) ──────
    function _digest(FeeRouterV1.DiscountVoucher memory v) internal view returns (bytes32) {
        bytes32 DOMAIN_TYPEHASH = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 domainSep = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("InfernoFeeRouter")),
                keccak256(bytes("1")),
                block.chainid,
                address(router)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(router.VOUCHER_TYPEHASH(), v.user, v.discountBps, v.maxUses, v.expiry, v.nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    function _voucher(uint16 discountBps, uint64 expiry, uint256 nonce)
        internal
        view
        returns (FeeRouterV1.DiscountVoucher memory)
    {
        return FeeRouterV1.DiscountVoucher({
            user: user,
            discountBps: discountBps,
            maxUses: uint32(1),
            expiry: expiry,
            nonce: nonce
        });
    }

    function _sign(FeeRouterV1.DiscountVoucher memory v, uint256 pk) internal view returns (bytes memory) {
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pk, _digest(v));
        return abi.encodePacked(r, s, vv);
    }

    function test_voucherValidDiscount() public {
        FeeRouterV1.DiscountVoucher memory v = _voucher(uint16(5), uint64(block.timestamp + 1 days), 42);
        bytes memory sig = _sign(v, signerPk); // precompute: cheatcode calls would consume prank/expectRevert
        vm.prank(user);
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), v, sig, true);
        assertEq(address(adapter).balance, 1 ether, "discount == fee -> full value to adapter");
        assertEq(collector.balance, 0, "no fee charged with full discount");
    }

    function test_voucherReplayReverts() public {
        FeeRouterV1.DiscountVoucher memory v = _voucher(uint16(5), uint64(block.timestamp + 1 days), 42);
        bytes memory sig = _sign(v, signerPk);
        vm.prank(user);
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), v, sig, true);
        vm.prank(user);
        vm.expectRevert();
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), v, sig, true);
    }

    function test_voucherWrongSignerReverts() public {
        FeeRouterV1.DiscountVoucher memory v = _voucher(uint16(5), uint64(block.timestamp + 1 days), 43);
        (, uint256 badPk) = makeAddrAndKey("badSigner");
        bytes memory badSig = _sign(v, badPk);
        vm.prank(user);
        vm.expectRevert();
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), v, badSig, true);
    }

    function test_voucherDiscountCappedAtFee() public {
        FeeRouterV1.DiscountVoucher memory v = _voucher(uint16(6), uint64(block.timestamp + 1 days), 44);
        bytes memory sig = _sign(v, signerPk);
        vm.prank(user);
        vm.expectRevert(); // "Discount exceeds fee" even with a genuine signer signature
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), v, sig, true);
    }

    function test_voucherExpiredReverts() public {
        FeeRouterV1.DiscountVoucher memory v = _voucher(uint16(5), uint64(block.timestamp + 1 hours), 45);
        bytes memory sig = _sign(v, signerPk);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(user);
        vm.expectRevert();
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), v, sig, true);
    }

    function test_swapWithoutVoucher_collectsFee() public {
        FeeRouterV1.DiscountVoucher memory empty;
        vm.prank(user);
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), empty, bytes(""), false);
        assertEq(collector.balance, (1 ether * 5) / 10_000, "5 bps fee collected");
        assertEq(address(adapter).balance, 1 ether - (1 ether * 5) / 10_000);
    }

    function test_feeCollectorZeroAddress_burnsFee() public {
        vm.prank(gov);
        router.setFeeCollector(address(0)); // W10/CWA-18: accepted, no zero check

        uint256 fee = (1 ether * 5) / 10_000;
        FeeRouterV1.DiscountVoucher memory empty;
        vm.prank(user);
        router.swapWithFee{value: 1 ether}(address(adapter), bytes(""), empty, bytes(""), false);

        assertEq(address(0).balance, fee, "fee silently burned at address(0)");
        assertEq(address(adapter).balance, 1 ether - fee);
    }
}
