// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "./Base.t.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {BorrowManager} from "../src/BorrowManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {CollateralManager} from "../src/CollateralManager.sol";
import {MockERC20, MockAggregator, MockPyth} from "./mocks/Mocks.sol";

/// @dev Random sequences of supply / withdraw / borrow / repay / price moves / liquidations / time jumps.
contract Handler is Test {
    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;
    LendingPool internal pool;
    BorrowManager internal bm;
    LiquidationManager internal lm;
    CollateralManager internal cm;
    MockERC20 internal musd;
    MockAggregator internal skipFeed;
    MockPyth internal pyth;
    bytes32 internal pythId;
    address[] internal actors;

    constructor(
        LendingPool p,
        BorrowManager b,
        LiquidationManager l,
        CollateralManager c,
        MockERC20 m,
        MockAggregator s,
        MockPyth py,
        bytes32 id
    ) {
        pool = p;
        bm = b;
        lm = l;
        cm = c;
        musd = m;
        skipFeed = s;
        pyth = py;
        pythId = id;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            musd.mint(a, 10_000_000e18);
            vm.deal(a, 1_000 ether);
            vm.prank(a);
            musd.approve(address(pool), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function supply(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 1e18, 500_000e18);
        vm.prank(a);
        pool.deposit(amount, a);
    }

    function withdraw(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 max = pool.maxWithdraw(a);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        pool.withdraw(amount, a, a);
    }

    function depositCollateral(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 0.01 ether, 20 ether);
        vm.prank(a);
        bm.depositCollateral{value: amount}(BTC, amount);
    }

    function borrow(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        try bm.availableToBorrow(a) returns (uint256 avail) {
            if (avail < 10e18) return;
            amount = bound(amount, 10e18, avail);
            vm.prank(a);
            try bm.borrow(amount) {} catch {}
        } catch {}
    }

    function repay(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 debt = pool.borrowBalanceCurrent(a);
        if (debt == 0) return;
        amount = bound(amount, 1, debt);
        vm.prank(a);
        pool.repay(a, amount);
    }

    function movePrice(uint256 price) external {
        price = bound(price, 20_000e18, 150_000e18);
        skipFeed.set(int256(price));
        pyth.set(pythId, int64(int256(price / 1e10)), 1e8, -8, block.timestamp);
    }

    function liquidate(uint256 seed, uint256 victimSeed) external {
        address l = _actor(seed);
        address v = _actor(victimSeed);
        if (l == v) return;
        try bm.isLiquidatable(v) returns (bool yes) {
            if (!yes) return;
            vm.prank(l);
            try lm.liquidate(v, BTC, type(uint256).max, 0) {} catch {}
        } catch {}
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 1, 30 days);
        vm.warp(block.timestamp + dt);
        skipFeed.set(skipFeed.answer());
        pyth.set(pythId, int64(int256(uint256(skipFeed.answer()) / 1e10)), 1e8, -8, block.timestamp);
    }
}

contract InvariantTest is BaseTest {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        cm.configureAsset(BTC, true, false, 0.7e18, 0.8e18, 0.05e18, 0);
        handler = new Handler(pool, bm, lm, cm, musd, skipFeed, pyth, PYTH_BTC);
        targetContract(address(handler));
    }

    /// Internal cash accounting always matches the MUSD actually held.
    function invariant_CashMatchesBalance() public view {
        assertEq(musd.balanceOf(address(pool)), pool.totalCash());
    }

    /// Collateral accounting always matches native BTC held by the CollateralManager.
    function invariant_CollateralMatchesBalance() public view {
        assertEq(address(cm).balance, cm.totalDeposits(BTC));
    }

    /// Pool is never insolvent in accounting terms: assets cover reserves claims.
    function invariant_AssetsCoverReserves() public view {
        assertGe(pool.totalCash() + pool.totalBorrows(), pool.totalReserves());
    }

    /// Share price never drops below 1 unless bad debt was socialized.
    function invariant_SharePriceMonotonic() public view {
        if (pool.totalBadDebt() == 0 && pool.totalSupply() > 0) {
            assertGe(pool.convertToAssets(1e18) + 1, 1e18);
        }
    }
}
