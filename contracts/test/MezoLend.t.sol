// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {BorrowManager} from "../src/BorrowManager.sol";
import {CollateralManager} from "../src/CollateralManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {InterestRateModel} from "../src/InterestRateModel.sol";
import {MezoLendLens} from "../src/MezoLendLens.sol";
import {IBorrowManager} from "../src/interfaces/IMezoLend.sol";

contract MezoLendTest is BaseTest {
    // ───────────────────────── Lending ─────────────────────────

    function test_SupplyMintsSharesAndTracksPrincipal() public {
        uint256 shares = _supply(alice, 10_000e18);
        assertEq(pool.balanceOf(alice), shares);
        assertEq(pool.totalAssets(), 10_000e18);
        assertEq(pool.totalCash(), 10_000e18);
        assertEq(pool.supplyPrincipal(alice), 10_000e18);
        assertEq(pool.maxWithdraw(alice), 10_000e18);
    }

    function test_WithdrawReducesPrincipalProRata() public {
        _supply(alice, 10_000e18);
        vm.prank(alice);
        pool.withdraw(4_000e18, alice, alice);
        assertEq(pool.supplyPrincipal(alice), 6_000e18);
        assertEq(pool.totalCash(), 6_000e18);
        assertEq(musd.balanceOf(alice), 1_000_000e18 - 6_000e18);
    }

    function test_WithdrawLimitedByLiquidity() public {
        _supply(alice, 10_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 40_000e18 / 10); // 4,000 MUSD
        assertEq(pool.maxWithdraw(alice), 6_000e18);
        vm.prank(alice);
        vm.expectRevert();
        pool.withdraw(7_000e18, alice, alice);
    }

    function test_ShareTransferMovesPrincipal() public {
        _supply(alice, 10_000e18);
        uint256 half = pool.balanceOf(alice) / 2;
        vm.prank(alice);
        pool.transfer(carol, half);
        assertEq(pool.supplyPrincipal(alice), 5_000e18);
        assertEq(pool.supplyPrincipal(carol), 5_000e18);
    }

    function test_SupplyCap() public {
        vm.prank(admin);
        pool.setRiskParams(0.1e18, 0.001e18, 5_000e18, 0, 10e18);
        _supply(alice, 5_000e18);
        vm.prank(alice);
        vm.expectRevert();
        pool.deposit(1e18, alice);
    }

    // ───────────────────────── Borrowing ─────────────────────────

    function test_BorrowWithinLtv() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether); // $70,000 -> capacity $49,000
        uint256 before = musd.balanceOf(bob);
        _borrow(bob, 40_000e18);
        assertEq(musd.balanceOf(bob) - before, 40_000e18);
        assertEq(pool.borrowBalanceStored(bob), 40_040e18); // + 0.1% origination fee
        assertEq(pool.totalReserves(), 40e18);
        assertEq(pool.borrowPrincipal(bob), 40_040e18);

        IBorrowManager.AccountData memory d = bm.getAccountData(bob);
        assertEq(d.collateralValue, 70_000e18);
        assertEq(d.borrowCapacity, 49_000e18);
        assertEq(d.liquidationCapacity, 56_000e18);
        assertApproxEqAbs(d.healthFactor, (56_000e18 * WAD) / 40_040e18, 1);
    }

    function test_RevertBorrowAboveLtv() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(BorrowManager.InsufficientCollateral.selector);
        bm.borrow(49_000e18); // fee pushes debt above capacity
    }

    function test_AvailableToBorrowIsExactlyBorrowable() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        uint256 avail = bm.availableToBorrow(bob);
        _borrow(bob, avail);
        assertLe(pool.borrowBalanceStored(bob), bm.getAccountData(bob).borrowCapacity);
    }

    function test_RevertBelowMinBorrow() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(LendingPool.BelowMinBorrow.selector);
        bm.borrow(5e18);
    }

    function test_RevertBorrowWithoutLiquidity() public {
        _supply(alice, 1_000e18);
        _depositBtc(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(LendingPool.InsufficientLiquidity.selector);
        bm.borrow(2_000e18);
    }

    function test_OnlyBorrowManagerCanOpenDebt() public {
        _supply(alice, 10_000e18);
        vm.prank(bob);
        vm.expectRevert();
        pool.borrow(bob, 1_000e18, bob);
    }

    function test_DepositAndBorrowOneStep() public {
        _supply(alice, 100_000e18);
        vm.prank(bob);
        bm.depositAndBorrow{value: 0.5 ether}(BTC, 0.5 ether, 10_000e18);
        assertEq(cm.balanceOf(bob, BTC), 0.5 ether);
        assertEq(pool.borrowBalanceStored(bob), 10_010e18);
        assertEq(bm.accountCount(), 1);
    }

    // ───────────────────────── Interest ─────────────────────────

    function test_InterestAccruesToLendersAndReserves() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 2 ether);
        _borrow(bob, 50_000e18); // ~50% utilization

        uint256 u = pool.utilization();
        uint256 apr = irm.getBorrowRateAtUtilization(u);
        uint256 debt0 = pool.borrowBalanceStored(bob);
        uint256 assets0 = pool.totalAssets();
        uint256 reserves0 = pool.totalReserves();

        vm.warp(block.timestamp + 365 days);
        pool.accrueInterest();

        uint256 debt1 = pool.borrowBalanceStored(bob);
        uint256 interest = debt1 - debt0;
        assertApproxEqRel(interest, (debt0 * apr) / WAD, 0.001e18);
        // Lenders earn interest minus the 10% reserve factor
        assertApproxEqRel(pool.totalAssets() - assets0, (interest * 9) / 10, 0.001e18);
        assertApproxEqRel(pool.totalReserves() - reserves0, interest / 10, 0.001e18);
        // Earned interest visible to the lender
        assertGt(pool.convertToAssets(pool.balanceOf(alice)), pool.supplyPrincipal(alice));
    }

    function test_SupplyRateMatchesFormula() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 2 ether);
        _borrow(bob, 80_000e18);
        uint256 u = pool.utilization();
        uint256 b = pool.borrowRatePerYear();
        assertApproxEqAbs(pool.supplyRatePerYear(), (((b * u) / WAD) * 9) / 10, 1e3);
    }

    function test_KinkedRateCurve() public view {
        assertEq(irm.getBorrowRateAtUtilization(0), 0.01e18);
        assertEq(irm.getBorrowRateAtUtilization(0.8e18), 0.07e18);
        assertEq(irm.getBorrowRateAtUtilization(1e18), 0.87e18);
        assertEq(irm.getBorrowRateAtUtilization(0.9e18), 0.47e18);
    }

    function test_RevertInvalidRateModel() public {
        vm.expectRevert(InterestRateModel.InvalidKink.selector);
        new InterestRateModel(0, 0.1e18, 1e18, 1e18);
        vm.expectRevert(InterestRateModel.RateTooHigh.selector);
        new InterestRateModel(5e18, 5e18, 5e18, 0.8e18);
    }

    // ───────────────────────── Repayment ─────────────────────────

    function test_PartialRepayPaysInterestFirst() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 20_000e18);
        vm.warp(block.timestamp + 180 days);
        uint256 debt = pool.borrowBalanceCurrent(bob);
        uint256 principal = pool.borrowPrincipal(bob);
        uint256 interest = debt - principal;
        assertGt(interest, 0);

        vm.prank(bob);
        pool.repay(bob, interest);
        assertEq(pool.borrowPrincipal(bob), principal);
        assertApproxEqAbs(pool.borrowBalanceStored(bob), principal, 2);
    }

    function test_FullRepayThenWithdrawAllCollateral() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 20_000e18);
        vm.warp(block.timestamp + 30 days);
        musd.mint(bob, 1_000e18); // cover interest

        vm.prank(bob);
        bm.repayAndWithdraw(type(uint256).max, BTC, type(uint256).max);
        assertEq(pool.borrowBalanceStored(bob), 0);
        assertEq(pool.borrowPrincipal(bob), 0);
        assertEq(cm.balanceOf(bob, BTC), 0);
        assertEq(bob.balance, 100 ether);
        assertEq(bm.accountCount(), 0);
    }

    function test_AnyoneCanRepayForBorrower() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 10_000e18);
        vm.prank(alice);
        pool.repay(bob, 5_000e18);
        assertEq(pool.borrowBalanceStored(bob), 5_010e18);
    }

    function test_RepayWorksWhilePaused() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 10_000e18);
        vm.startPrank(admin);
        pool.pause();
        bm.pause();
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert();
        bm.borrow(1_000e18);

        vm.prank(bob);
        pool.repay(bob, 1_000e18);
        assertEq(pool.borrowBalanceStored(bob), 9_010e18);

        // Adding collateral to defend a position is still allowed while paused
        _depositBtc(bob, 0.1 ether);
        assertEq(cm.balanceOf(bob, BTC), 1.1 ether);
    }

    // ───────────────────────── Collateral ─────────────────────────

    function test_WithdrawCollateralRespectsLtv() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 35_000e18); // debt 35,035
        uint256 maxW = bm.maxWithdrawable(bob, BTC);
        // capacity after withdraw must cover debt: (1 - x) * 70k * 0.7 >= 35,035
        assertApproxEqRel(maxW, 1 ether - (35_035e18 * 1 ether) / 49_000e18, 0.0001e18);

        vm.prank(bob);
        vm.expectRevert(BorrowManager.InsufficientCollateral.selector);
        bm.withdrawCollateral(BTC, maxW + 0.001 ether);

        vm.prank(bob);
        bm.withdrawCollateral(BTC, maxW);
        assertLe(pool.borrowBalanceStored(bob), bm.getAccountData(bob).borrowCapacity);
    }

    function test_CollateralSupplyCap() public {
        vm.deal(bob, 2_000 ether);
        vm.prank(bob);
        vm.expectRevert(CollateralManager.SupplyCapExceeded.selector);
        bm.depositCollateral{value: 1_001 ether}(BTC, 1_001 ether);
    }

    function test_RevertNativeValueMismatch() public {
        vm.prank(bob);
        vm.expectRevert(CollateralManager.InvalidValue.selector);
        bm.depositCollateral{value: 0.5 ether}(BTC, 1 ether);
    }

    function test_RevertInvalidAssetConfig() public {
        vm.startPrank(admin);
        vm.expectRevert(CollateralManager.InvalidConfig.selector);
        cm.configureAsset(BTC, true, false, 0.8e18, 0.8e18, 0.05e18, 0); // ltv == LT
        vm.expectRevert(CollateralManager.InvalidConfig.selector);
        cm.configureAsset(BTC, true, false, 0.8e18, 0.95e18, 0.06e18, 0); // LT*(1+bonus) >= 1
        vm.stopPrank();
    }

    function test_ERC20Collateral() public {
        MockERC20Collateral tok = new MockERC20Collateral();
        vm.prank(admin);
        oracle.setFeed(address(tok), address(skipFeed), 1 hours, bytes32(0), 0, 1_000e18, 10_000_000e18);
        vm.prank(admin);
        cm.configureAsset(address(tok), true, false, 0.7e18, 0.8e18, 0.05e18, 0);
        _supply(alice, 100_000e18);
        tok.mint(carol, 1e8); // 1 token, 8 decimals
        vm.startPrank(carol);
        tok.approve(address(cm), type(uint256).max);
        bm.depositCollateral(address(tok), 1e8);
        bm.borrow(10_000e18);
        vm.stopPrank();
        assertEq(bm.getAccountData(carol).collateralValue, 70_000e18);
        assertEq(musd.balanceOf(carol), 10_000e18);
    }

    // ───────────────────────── Oracle ─────────────────────────

    function test_OracleUsesPrimary() public view {
        (bool ok, uint256 p,, uint8 src) = oracle.tryGetPrice(BTC);
        assertTrue(ok);
        assertEq(p, 70_000e18);
        assertEq(src, 1);
    }

    function test_OracleFallsBackToPythWhenPrimaryStale() public {
        vm.warp(block.timestamp + 2 hours);
        pyth.set(PYTH_BTC, 69_900e8, 10e8, -8, block.timestamp);
        (bool ok, uint256 p,, uint8 src) = oracle.tryGetPrice(BTC);
        assertTrue(ok);
        assertEq(p, 69_900e18);
        assertEq(src, 2);
    }

    function test_OracleFallsBackWhenPrimaryReverts() public {
        skipFeed.setRevert(true);
        (bool ok,,, uint8 src) = oracle.tryGetPrice(BTC);
        assertTrue(ok);
        assertEq(src, 2);
    }

    function test_OracleRejectsWideConfidence() public {
        skipFeed.setRevert(true);
        pyth.set(PYTH_BTC, 70_000e8, 2_000e8, -8, block.timestamp); // ~2.9% band
        (bool ok,,,) = oracle.tryGetPrice(BTC);
        assertFalse(ok);
    }

    function test_OracleRejectsOutOfBounds() public {
        skipFeed.set(500e18); // below $1,000 floor
        pyth.set(PYTH_BTC, 500e8, 1e8, -8, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.PriceUnavailable.selector, BTC));
        oracle.getPrice(BTC);
    }

    function test_StalePricesHaltBorrowingButNotRepay() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 10_000e18);
        vm.warp(block.timestamp + 2 hours); // both feeds stale

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.PriceUnavailable.selector, BTC));
        bm.borrow(1_000e18);

        vm.prank(bob);
        pool.repay(bob, 1_000e18);

        // Lens degrades gracefully
        MezoLendLens.UserOverview memory o = lens.getUserOverview(bob);
        assertFalse(o.markets[0].dataOk);
        assertGt(o.markets[0].debt, 0);
    }

    // ───────────────────────── Liquidation ─────────────────────────

    function _openRiskyPosition() internal {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether); // $70k
        _borrow(bob, 48_000e18); // debt 48,048 ; liq cap 56,000 -> HF 1.165
    }

    function test_NotLiquidatableWhenHealthy() public {
        _openRiskyPosition();
        vm.prank(liq);
        vm.expectRevert(LiquidationManager.NotLiquidatable.selector);
        lm.liquidate(bob, BTC, 10_000e18, 0);
    }

    function test_LiquidationPriceIsWhereHealthFactorHitsOne() public {
        _openRiskyPosition();
        uint256 lp = bm.liquidationPrice(bob, BTC);
        // debt / (amount * LT) = 48,048 / 0.8
        assertApproxEqAbs(lp, 60_060e18, 1e6);
        _setPrice(lp + 1e18);
        assertFalse(bm.isLiquidatable(bob));
        _setPrice(lp - 1e18);
        assertTrue(bm.isLiquidatable(bob));
    }

    function test_PartialLiquidationWithCloseFactor() public {
        _openRiskyPosition();
        _setPrice(59_000e18); // HF = 47,200 / 48,048 = 0.982 (above full-liquidation threshold)
        IBorrowManager.AccountData memory before = bm.getAccountData(bob);
        assertLt(before.healthFactor, WAD);
        assertGt(before.healthFactor, 0.95e18);

        LiquidationManager.LiquidationPreview memory p = lm.previewLiquidation(bob, BTC, 0);
        assertEq(p.maxRepay, before.debt / 2);

        uint256 liqBtcBefore = liq.balance;
        vm.prank(liq);
        (uint256 repaid, uint256 seized) = lm.liquidate(bob, BTC, type(uint256).max, 0);

        assertEq(repaid, before.debt / 2);
        // seized total = repaid * 1.05 / price; protocol gets 10% of the bonus
        uint256 seizeTotal = (repaid * 105 / 100) * 1e18 / 59_000e18;
        uint256 bonus = seizeTotal - (seizeTotal * 100 / 105);
        uint256 cut = bonus / 10;
        assertApproxEqAbs(seized, seizeTotal - cut, 10);
        assertEq(liq.balance - liqBtcBefore, seized);
        assertApproxEqAbs(cm.protocolBalance(BTC), cut, 10);
        assertEq(seized, p.seizeToLiquidator);

        IBorrowManager.AccountData memory afterD = bm.getAccountData(bob);
        assertGt(afterD.healthFactor, before.healthFactor);
    }

    function test_FullLiquidationWhenDeeplyUnderwater() public {
        _openRiskyPosition();
        _setPrice(56_000e18); // HF = 44,800 / 48,048 = 0.932 < 0.95
        vm.prank(liq);
        (uint256 repaid,) = lm.liquidate(bob, BTC, type(uint256).max, 0);
        assertEq(repaid, 48_048e18);
        assertEq(pool.borrowBalanceStored(bob), 0);
        assertGt(cm.balanceOf(bob, BTC), 0); // borrower keeps the surplus collateral
    }

    function test_BadDebtAbsorbedByReservesThenLenders() public {
        _openRiskyPosition();
        _setPrice(40_000e18); // collateral $40k < debt $48k
        uint256 assetsBefore = pool.totalAssets();
        vm.prank(liq);
        lm.liquidate(bob, BTC, type(uint256).max, 0);

        assertEq(cm.balanceOf(bob, BTC), 0);
        assertEq(pool.borrowBalanceStored(bob), 0);
        assertGt(pool.totalBadDebt(), 0);
        assertLt(pool.totalAssets(), assetsBefore);
        assertEq(bm.accountCount(), 0);
    }

    function test_LiquidationSlippageGuard() public {
        _openRiskyPosition();
        _setPrice(59_000e18);
        vm.prank(liq);
        vm.expectRevert(LiquidationManager.SlippageExceeded.selector);
        lm.liquidate(bob, BTC, type(uint256).max, 100 ether);
    }

    function test_LiquidationPausable() public {
        _openRiskyPosition();
        _setPrice(59_000e18);
        vm.prank(admin);
        lm.pause();
        vm.prank(liq);
        vm.expectRevert();
        lm.liquidate(bob, BTC, 1_000e18, 0);
    }

    // ───────────────────────── Admin & access ─────────────────────────

    function test_WithdrawReservesToTreasury() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 30_000e18);
        uint256 r = pool.totalReserves();
        vm.prank(admin);
        pool.withdrawReserves(r);
        assertEq(musd.balanceOf(treasury), r);
        assertEq(pool.totalReserves(), 0);
    }

    function test_OnlyAdminCanConfigure() public {
        vm.startPrank(bob);
        vm.expectRevert();
        pool.setRiskParams(0, 0, 0, 0, 0);
        vm.expectRevert();
        cm.configureAsset(BTC, true, false, 0.9e18, 0.92e18, 0.05e18, 0);
        vm.expectRevert();
        oracle.setFeed(BTC, address(skipFeed), 1, bytes32(0), 0, 1, 2);
        vm.expectRevert();
        pool.pause();
        vm.stopPrank();
    }

    function test_RiskParamBounds() public {
        vm.prank(admin);
        vm.expectRevert(LendingPool.InvalidParam.selector);
        pool.setRiskParams(0.6e18, 0, 0, 0, 0);
    }

    // ───────────────────────── Lens ─────────────────────────

    function test_LensMarketAndUserViews() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 20_000e18);

        MezoLendLens.MarketInfo[] memory ms = lens.getMarkets();
        assertEq(ms.length, 1);
        assertEq(ms[0].name, "Core");
        assertEq(ms[0].totalBorrows, 20_020e18);
        assertEq(ms[0].collaterals.length, 1);
        assertEq(ms[0].collaterals[0].symbol, "BTC");
        assertEq(ms[0].collaterals[0].price, 70_000e18);
        assertEq(ms[0].accountCount, 1);

        MezoLendLens.UserOverview memory o = lens.getUserOverview(bob);
        assertTrue(o.markets[0].dataOk);
        assertEq(o.markets[0].debt, 20_020e18);
        assertEq(o.markets[0].collaterals[0].balance, 1 ether);
        assertGt(o.markets[0].collaterals[0].liquidationPrice, 0);

        (MezoLendLens.AccountPosition[] memory ps, uint256 total) = lens.getAccounts(0, 0, 50);
        assertEq(total, 1);
        assertEq(ps[0].account, bob);
        assertEq(ps[0].collateralBalances[0], 1 ether);
    }

    // ───────────────────────── Fuzz ─────────────────────────

    function testFuzz_SupplyWithdrawRoundTrip(uint256 amount) public {
        amount = bound(amount, 1e6, 1_000_000e18);
        _supply(alice, amount);
        uint256 shares = pool.balanceOf(alice);
        vm.prank(alice);
        uint256 out = pool.redeem(shares, alice, alice);
        assertApproxEqAbs(out, amount, 1);
        assertEq(pool.supplyPrincipal(alice), 0);
    }

    function testFuzz_BorrowNeverExceedsCapacity(uint256 collateral, uint256 amount) public {
        collateral = bound(collateral, 0.001 ether, 10 ether);
        amount = bound(amount, 10e18, 1_000_000e18);
        _supply(alice, 1_000_000e18);
        _depositBtc(bob, collateral);
        IBorrowManager.AccountData memory d = bm.getAccountData(bob);
        vm.prank(bob);
        try bm.borrow(amount) {
            assertLe(pool.borrowBalanceStored(bob), d.borrowCapacity);
        } catch {
            assertGt(amount + (amount + 999) / 1000, d.borrowCapacity);
        }
    }

    function testFuzz_InterestNeverDecreasesSharePrice(uint256 dt, uint256 borrowAmt) public {
        dt = bound(dt, 1, 3 * 365 days);
        borrowAmt = bound(borrowAmt, 10e18, 60_000e18);
        _supply(alice, 100_000e18);
        _depositBtc(bob, 2 ether);
        _borrow(bob, borrowAmt);
        uint256 p0 = pool.convertToAssets(1e18);
        vm.warp(block.timestamp + dt);
        _setPrice(70_000e18);
        pool.accrueInterest();
        assertGe(pool.convertToAssets(1e18), p0);
    }
}

contract MockERC20Collateral {
    string public name = "Wrapped Test BTC";
    string public symbol = "wtBTC";
    uint8 public decimals = 8;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}
