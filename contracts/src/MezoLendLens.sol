// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MarketRegistry} from "./MarketRegistry.sol";
import {LendingPool} from "./LendingPool.sol";
import {BorrowManager} from "./BorrowManager.sol";
import {LiquidationManager} from "./LiquidationManager.sol";
import {PriceOracle} from "./PriceOracle.sol";
import {ICollateralManager, IBorrowManager, IInterestRateModel} from "./interfaces/IMezoLend.sol";

/// @title MezoLendLens
/// @notice Read-only aggregator so the app can load full market and account state in a single eth_call.
///         Every oracle-dependent read is wrapped so one failing feed degrades gracefully instead of
///         blanking the UI.
contract MezoLendLens {
    uint256 internal constant WAD = 1e18;

    MarketRegistry public immutable registry;

    struct CollateralInfo {
        address asset;
        string symbol;
        uint8 decimals;
        bool enabled;
        bool depositsPaused;
        uint256 ltv;
        uint256 liquidationThreshold;
        uint256 liquidationBonus;
        uint256 supplyCap;
        uint256 totalDeposited;
        bool priceOk;
        uint256 price;
        uint256 priceUpdatedAt;
        uint8 priceSource;
    }

    struct MarketInfo {
        uint256 id;
        string name;
        string description;
        bool active;
        address pool;
        address borrowManager;
        address collateralManager;
        address liquidationManager;
        address interestRateModel;
        string shareSymbol;
        uint256 totalAssets;
        uint256 totalSupply;
        uint256 totalCash;
        uint256 totalBorrows;
        uint256 totalReserves;
        uint256 totalBadDebt;
        uint256 utilization;
        uint256 borrowRatePerYear;
        uint256 supplyRatePerYear;
        uint256 reserveFactor;
        uint256 originationFee;
        uint256 supplyCap;
        uint256 borrowCap;
        uint256 minBorrow;
        uint256 baseRatePerYear;
        uint256 slope1PerYear;
        uint256 slope2PerYear;
        uint256 kink;
        uint256 closeFactor;
        uint256 fullLiquidationHealthFactor;
        uint256 minCloseDebt;
        uint256 protocolLiquidationShare;
        bool poolPaused;
        bool borrowPaused;
        bool liquidationPaused;
        uint256 accountCount;
        uint256 lastAccrual;
        CollateralInfo[] collaterals;
    }

    struct UserCollateral {
        address asset;
        uint256 balance;
        uint256 value;
        uint256 maxWithdrawable;
        uint256 liquidationPrice;
        uint256 walletBalance;
        uint256 allowance;
    }

    struct UserMarket {
        uint256 id;
        uint256 shares;
        uint256 supplied;
        uint256 supplyPrincipal;
        uint256 maxWithdraw;
        uint256 debt;
        uint256 borrowPrincipal;
        uint256 collateralValue;
        uint256 borrowCapacity;
        uint256 liquidationCapacity;
        uint256 healthFactor;
        uint256 availableToBorrow;
        uint256 musdAllowance;
        bool dataOk;
        UserCollateral[] collaterals;
    }

    struct UserOverview {
        address account;
        uint256 musdBalance;
        uint256 nativeBalance;
        UserMarket[] markets;
    }

    struct AccountPosition {
        address account;
        uint256 debt;
        uint256 collateralValue;
        uint256 liquidationCapacity;
        uint256 healthFactor;
        bool dataOk;
        uint256[] collateralBalances;
    }

    constructor(MarketRegistry registry_) {
        registry = registry_;
    }

    // ───────────────────────────── Markets ─────────────────────────────

    function getMarkets() external view returns (MarketInfo[] memory infos) {
        MarketRegistry.Market[] memory ms = registry.getMarkets();
        infos = new MarketInfo[](ms.length);
        for (uint256 i; i < ms.length; ++i) {
            infos[i] = _marketInfo(i, ms[i]);
        }
    }

    function getMarket(uint256 id) external view returns (MarketInfo memory) {
        return _marketInfo(id, registry.getMarket(id));
    }

    function _marketInfo(uint256 id, MarketRegistry.Market memory m) internal view returns (MarketInfo memory info) {
        LendingPool pool = LendingPool(m.pool);
        BorrowManager bm = BorrowManager(m.borrowManager);
        LiquidationManager lm = LiquidationManager(m.liquidationManager);
        LendingPool.PoolState memory s = pool.getPoolState();

        info.id = id;
        info.name = m.name;
        info.description = m.description;
        info.active = m.active;
        info.pool = m.pool;
        info.borrowManager = m.borrowManager;
        info.collateralManager = m.collateralManager;
        info.liquidationManager = m.liquidationManager;
        info.interestRateModel = address(pool.interestRateModel());
        info.shareSymbol = pool.symbol();
        info.totalAssets = s.totalAssets;
        info.totalSupply = s.totalSupply;
        info.totalCash = s.totalCash;
        info.totalBorrows = s.totalBorrows;
        info.totalReserves = s.totalReserves;
        info.totalBadDebt = pool.totalBadDebt();
        info.utilization = s.utilization;
        info.borrowRatePerYear = s.borrowRatePerYear;
        info.supplyRatePerYear = s.supplyRatePerYear;
        info.reserveFactor = pool.reserveFactor();
        info.originationFee = pool.originationFee();
        info.supplyCap = pool.supplyCap();
        info.borrowCap = pool.borrowCap();
        info.minBorrow = pool.minBorrow();
        (info.baseRatePerYear, info.slope1PerYear, info.slope2PerYear, info.kink) =
            IInterestRateModel(info.interestRateModel).params();
        info.closeFactor = lm.closeFactor();
        info.fullLiquidationHealthFactor = lm.fullLiquidationHealthFactor();
        info.minCloseDebt = lm.minCloseDebt();
        info.protocolLiquidationShare = lm.protocolShare();
        info.poolPaused = pool.paused();
        info.borrowPaused = bm.paused();
        info.liquidationPaused = lm.paused();
        info.accountCount = bm.accountCount();
        info.lastAccrual = s.lastAccrual;
        info.collaterals = _collaterals(ICollateralManager(m.collateralManager), PriceOracle(address(bm.oracle())));
    }

    function _collaterals(ICollateralManager cm, PriceOracle oracle) internal view returns (CollateralInfo[] memory out) {
        address[] memory assets = cm.getAssets();
        out = new CollateralInfo[](assets.length);
        for (uint256 i; i < assets.length; ++i) {
            ICollateralManager.AssetConfig memory c = cm.getAssetConfig(assets[i]);
            CollateralInfo memory ci = out[i];
            ci.asset = assets[i];
            ci.symbol = _symbol(assets[i]);
            ci.decimals = c.decimals;
            ci.enabled = c.enabled;
            ci.depositsPaused = c.depositsPaused;
            ci.ltv = c.ltv;
            ci.liquidationThreshold = c.liquidationThreshold;
            ci.liquidationBonus = c.liquidationBonus;
            ci.supplyCap = c.supplyCap;
            ci.totalDeposited = cm.totalDeposits(assets[i]);
            (ci.priceOk, ci.price, ci.priceUpdatedAt, ci.priceSource) = oracle.tryGetPrice(assets[i]);
        }
    }

    // ───────────────────────────── Users ─────────────────────────────

    function getUserOverview(address account) external view returns (UserOverview memory o) {
        MarketRegistry.Market[] memory ms = registry.getMarkets();
        o.account = account;
        o.musdBalance = IERC20(registry.musd()).balanceOf(account);
        o.nativeBalance = account.balance;
        o.markets = new UserMarket[](ms.length);
        for (uint256 i; i < ms.length; ++i) {
            o.markets[i] = _userMarket(i, ms[i], account);
        }
    }

    function _userMarket(uint256 id, MarketRegistry.Market memory m, address account)
        internal
        view
        returns (UserMarket memory u)
    {
        LendingPool pool = LendingPool(m.pool);
        BorrowManager bm = BorrowManager(m.borrowManager);
        ICollateralManager cm = ICollateralManager(m.collateralManager);

        u.id = id;
        u.shares = pool.balanceOf(account);
        u.supplied = pool.convertToAssets(u.shares);
        u.supplyPrincipal = pool.supplyPrincipal(account);
        u.maxWithdraw = pool.maxWithdraw(account);
        u.debt = pool.borrowBalanceCurrent(account);
        u.borrowPrincipal = pool.borrowPrincipal(account);
        u.musdAllowance = IERC20(registry.musd()).allowance(account, m.pool);

        try bm.getAccountData(account) returns (IBorrowManager.AccountData memory d) {
            u.collateralValue = d.collateralValue;
            u.borrowCapacity = d.borrowCapacity;
            u.liquidationCapacity = d.liquidationCapacity;
            u.healthFactor = d.healthFactor;
            u.dataOk = true;
        } catch {}
        if (u.dataOk) {
            try bm.availableToBorrow(account) returns (uint256 a) {
                u.availableToBorrow = a;
            } catch {}
        }

        address[] memory assets = cm.getAssets();
        u.collaterals = new UserCollateral[](assets.length);
        for (uint256 j; j < assets.length; ++j) {
            UserCollateral memory uc = u.collaterals[j];
            address a = assets[j];
            uc.asset = a;
            uc.balance = cm.balanceOf(account, a);
            bool native = a == cm.NATIVE_BTC();
            uc.walletBalance = native ? account.balance : IERC20(a).balanceOf(account);
            uc.allowance = native ? type(uint256).max : IERC20(a).allowance(account, m.collateralManager);
            if (uc.balance > 0 && u.dataOk) {
                ICollateralManager.AssetConfig memory c = cm.getAssetConfig(a);
                (bool ok, uint256 price,,) = PriceOracle(address(bm.oracle())).tryGetPrice(a);
                if (ok) uc.value = (uc.balance * price) / (10 ** c.decimals);
                try bm.maxWithdrawable(account, a) returns (uint256 mw) {
                    uc.maxWithdrawable = mw;
                } catch {}
                try bm.liquidationPrice(account, a) returns (uint256 lp) {
                    uc.liquidationPrice = lp;
                } catch {}
            }
        }
    }

    // ───────────────────────────── Accounts (risk monitor) ─────────────────────────────

    function getAccounts(uint256 marketId, uint256 offset, uint256 limit)
        external
        view
        returns (AccountPosition[] memory positions, uint256 total)
    {
        MarketRegistry.Market memory m = registry.getMarket(marketId);
        BorrowManager bm = BorrowManager(m.borrowManager);
        ICollateralManager cm = ICollateralManager(m.collateralManager);
        total = bm.accountCount();
        address[] memory accounts = bm.getAccounts(offset, limit);
        address[] memory assets = cm.getAssets();
        positions = new AccountPosition[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            AccountPosition memory p = positions[i];
            p.account = accounts[i];
            p.collateralBalances = new uint256[](assets.length);
            for (uint256 j; j < assets.length; ++j) {
                p.collateralBalances[j] = cm.balanceOf(accounts[i], assets[j]);
            }
            try bm.getAccountData(accounts[i]) returns (IBorrowManager.AccountData memory d) {
                p.debt = d.debt;
                p.collateralValue = d.collateralValue;
                p.liquidationCapacity = d.liquidationCapacity;
                p.healthFactor = d.healthFactor;
                p.dataOk = true;
            } catch {
                p.debt = LendingPool(m.pool).borrowBalanceCurrent(accounts[i]);
            }
        }
    }

    function _symbol(address asset) internal view returns (string memory) {
        if (asset == 0x7b7C000000000000000000000000000000000000) return "BTC";
        if (asset.code.length == 0) return "";
        try IERC20Metadata(asset).symbol() returns (string memory s) {
            return s;
        } catch {
            return "";
        }
    }
}
