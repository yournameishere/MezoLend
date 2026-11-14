// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InterestRateModel} from "../src/InterestRateModel.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {CollateralManager} from "../src/CollateralManager.sol";
import {BorrowManager} from "../src/BorrowManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {MezoLendLens} from "../src/MezoLendLens.sol";
import {ILendingPool, ICollateralManager, IPriceOracle, IBorrowManager} from "../src/interfaces/IMezoLend.sol";
import {MockERC20, MockAggregator, MockPyth} from "./mocks/Mocks.sol";

abstract contract BaseTest is Test {
    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;
    bytes32 internal constant PYTH_BTC = keccak256("BTC/USD");
    uint256 internal constant WAD = 1e18;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice"); // lender
    address internal bob = makeAddr("bob"); // borrower
    address internal carol = makeAddr("carol"); // second borrower
    address internal liq = makeAddr("liquidator");

    MockERC20 internal musd;
    MockAggregator internal skipFeed;
    MockPyth internal pyth;
    PriceOracle internal oracle;
    InterestRateModel internal irm;
    LendingPool internal pool;
    CollateralManager internal cm;
    BorrowManager internal bm;
    LiquidationManager internal lm;
    MarketRegistry internal registry;
    MezoLendLens internal lens;

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        musd = new MockERC20("Mezo USD", "MUSD", 18);
        skipFeed = new MockAggregator(18, 70_000e18);
        pyth = new MockPyth();
        pyth.set(PYTH_BTC, 69_900e8, 10e8, -8, block.timestamp);

        vm.startPrank(admin);
        oracle = new PriceOracle(admin, address(pyth));
        oracle.setFeed(BTC, address(skipFeed), 1 hours, PYTH_BTC, 1 hours, 1_000e18, 10_000_000e18);

        irm = new InterestRateModel(0.01e18, 0.06e18, 0.8e18, 0.8e18);
        cm = new CollateralManager(admin);
        pool = new LendingPool(
            IERC20(address(musd)), "MezoLend Core MUSD", "mlMUSD-CORE", admin, irm, treasury, 0.1e18, 0.001e18, 10e18
        );
        bm = new BorrowManager(admin, ILendingPool(address(pool)), ICollateralManager(address(cm)), IPriceOracle(address(oracle)));
        lm = new LiquidationManager(
            admin, ILendingPool(address(pool)), ICollateralManager(address(cm)), IBorrowManager(address(bm)), 0.5e18, 0.95e18, 100e18, 0.1e18
        );
        pool.grantRole(pool.BORROW_MANAGER_ROLE(), address(bm));
        pool.grantRole(pool.LIQUIDATION_MANAGER_ROLE(), address(lm));
        cm.grantRole(cm.CONTROLLER_ROLE(), address(bm));
        cm.grantRole(cm.CONTROLLER_ROLE(), address(lm));
        cm.configureAsset(BTC, true, false, 0.7e18, 0.8e18, 0.05e18, 1_000e18);

        registry = new MarketRegistry(admin, address(musd), address(oracle));
        registry.addMarket(
            MarketRegistry.Market({
                name: "Core",
                description: "Conservative BTC-backed MUSD market",
                pool: address(pool),
                borrowManager: address(bm),
                collateralManager: address(cm),
                liquidationManager: address(lm),
                interestRateModel: address(irm),
                active: true
            })
        );
        lens = new MezoLendLens(registry);
        vm.stopPrank();

        musd.mint(alice, 1_000_000e18);
        musd.mint(liq, 1_000_000e18);
        musd.mint(bob, 10_000e18);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);

        vm.prank(alice);
        musd.approve(address(pool), type(uint256).max);
        vm.prank(liq);
        musd.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        musd.approve(address(pool), type(uint256).max);
    }

    function _supply(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        shares = pool.deposit(amount, who);
    }

    function _depositBtc(address who, uint256 amount) internal {
        vm.prank(who);
        bm.depositCollateral{value: amount}(BTC, amount);
    }

    function _borrow(address who, uint256 amount) internal {
        vm.prank(who);
        bm.borrow(amount);
    }

    function _setPrice(uint256 usd) internal {
        skipFeed.set(int256(usd));
        pyth.set(PYTH_BTC, int64(int256(usd / 1e10)), 1e8, -8, block.timestamp);
    }
}
