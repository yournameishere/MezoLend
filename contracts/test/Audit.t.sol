// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {BorrowManager} from "../src/BorrowManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {IBorrowManager} from "../src/interfaces/IMezoLend.sol";

/// @dev A treasury (e.g. a multisig without a payable fallback) that cannot receive native BTC.
contract RejectsNative {
    receive() external payable {
        revert("no BTC");
    }
}

/// @notice Proof-of-concept tests for every finding in the README security review. Each one failed against the
///         pre-audit contracts and is kept as a regression test.
contract AuditTest is BaseTest {
    function _openPosition() internal {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether); // $70k
        _borrow(bob, 48_000e18); // debt 48,048 (0.1% fee), HF = 56,000 / 48,048 = 1.165
    }

    // ───────────── M-01: a treasury that rejects BTC blocks every liquidation ─────────────
    // The protocol's share of the liquidation bonus was pushed to the treasury in native BTC inside
    // liquidate(). If the treasury cannot receive BTC, every liquidation reverts and bad debt piles up.
    function test_PoC_M01_TreasuryRejectingBtcCannotBlockLiquidations() public {
        _openPosition();
        address badTreasury = address(new RejectsNative());
        vm.prank(admin);
        pool.setTreasury(badTreasury);

        _setPrice(59_000e18); // HF 0.98
        vm.prank(liq);
        (uint256 repaid, uint256 seized) = lm.liquidate(bob, BTC, type(uint256).max, 0);
        assertGt(repaid, 0);
        assertGt(seized, 0);

        // the protocol cut is held by the collateral manager and can be claimed later
        uint256 cut = cm.protocolBalance(BTC);
        assertGt(cut, 0);
        address payable sink = payable(makeAddr("sink"));
        vm.prank(admin);
        cm.claimProtocolCollateral(BTC, cut, sink);
        assertEq(sink.balance, cut);
        assertEq(cm.protocolBalance(BTC), 0);
    }

    // ───────────── M-02: pausing borrows locks collateral of accounts with no debt ─────────────
    function test_PoC_M02_DebtFreeCollateralWithdrawableWhilePaused() public {
        _depositBtc(bob, 1 ether);
        vm.prank(admin);
        bm.pause();

        uint256 before = bob.balance;
        vm.prank(bob);
        bm.withdrawCollateral(BTC, type(uint256).max);
        assertEq(bob.balance - before, 1 ether);
    }

    function test_PoC_M02_RepayInFullAndWithdrawWhilePaused() public {
        _openPosition();
        vm.prank(admin);
        bm.pause();

        uint256 before = bob.balance;
        musd.mint(bob, 1_000e18);
        vm.prank(bob);
        bm.repayAndWithdraw(type(uint256).max, BTC, type(uint256).max);
        assertEq(pool.borrowBalanceStored(bob), 0);
        assertEq(bob.balance - before, 1 ether);
    }

    function test_M02_PausedStillBlocksWithdrawalsBackingDebt() public {
        _openPosition();
        vm.prank(admin);
        bm.pause();
        vm.prank(bob);
        vm.expectRevert();
        bm.withdrawCollateral(BTC, 0.01 ether);
    }

    // ───────────── L-01: "withdraw max" reverts because of rounding ─────────────
    // maxWithdrawable() rounded the per-token capacity down, so the amount it returned could remove
    // 1 wei more capacity than the solvency check allows and the "Max" button reverted.
    function testFuzz_PoC_L01_MaxCollateralWithdrawNeverReverts(uint96 collateral, uint256 borrowBps, uint256 price)
        public
    {
        _checkMaxWithdraw(collateral, borrowBps, price);
    }

    function _checkMaxWithdraw(uint96 collateral, uint256 borrowBps, uint256 price) internal {
        collateral = uint96(bound(collateral, 0.001 ether, 20 ether));
        price = bound(price, 20_000e18, 200_000e18);
        borrowBps = bound(borrowBps, 1, 9_900);
        _setPrice(price);
        _supply(alice, 1_000_000e18);
        _depositBtc(bob, collateral);
        uint256 avail = bm.availableToBorrow(bob);
        uint256 amount = avail * borrowBps / 10_000;
        if (amount < 10e18) return; // below min borrow
        _borrow(bob, amount);

        uint256 maxW = bm.maxWithdrawable(bob, BTC);
        if (maxW == 0) return;
        vm.prank(bob);
        bm.withdrawCollateral(BTC, type(uint256).max);
        IBorrowManager.AccountData memory d = bm.getAccountData(bob);
        assertLe(d.debt, d.borrowCapacity);
    }

    function test_PoC_L01_MaxWithdrawConcreteCase() public {
        // counterexample the fuzzer found against the pre-audit code
        _checkMaxWithdraw(246927074566174126194987, 31906290588976, type(uint256).max - 3);
    }

    // ───────────── L-02: future-dated prices count as fresh until that date ─────────────
    function test_PoC_L02_FutureDatedPriceIsRejected() public {
        skipFeed.setUpdatedAt(block.timestamp + 365 days);
        (bool ok,, , uint8 source) = oracle.tryGetPrice(BTC);
        // primary is rejected; the oracle falls back to Pyth
        assertTrue(ok);
        assertEq(source, 2);

        pyth.set(keccak256("BTC/USD"), 70_000e8, 10e8, -8, block.timestamp + 365 days);
        (ok,,,) = oracle.tryGetPrice(BTC);
        assertFalse(ok);
    }

    function test_L02_SmallClockDriftStillAccepted() public {
        skipFeed.setUpdatedAt(block.timestamp + 30);
        (bool ok,,, uint8 source) = oracle.tryGetPrice(BTC);
        assertTrue(ok);
        assertEq(source, 1);
    }
}
