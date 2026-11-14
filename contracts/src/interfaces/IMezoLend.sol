// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IInterestRateModel {
    function utilizationRate(uint256 cash, uint256 borrows, uint256 reserves) external pure returns (uint256);
    function getBorrowRateAtUtilization(uint256 utilization) external view returns (uint256 ratePerYear);
    function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) external view returns (uint256 ratePerSecond);
    function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactor)
        external
        view
        returns (uint256 ratePerSecond);
    function params()
        external
        view
        returns (uint256 baseRatePerYear, uint256 slope1PerYear, uint256 slope2PerYear, uint256 kink);
}

interface IPriceOracle {
    function getPrice(address asset) external view returns (uint256 priceWad);
    function tryGetPrice(address asset)
        external
        view
        returns (bool ok, uint256 priceWad, uint256 updatedAt, uint8 source);
}

interface ILendingPool {
    function asset() external view returns (address);
    function accrueInterest() external;
    function borrow(address borrower, uint256 amount, address receiver) external returns (uint256 fee);
    function repayFrom(address payer, address borrower, uint256 amount) external returns (uint256 repaid);
    function writeOffBadDebt(address borrower) external returns (uint256 debt);
    function borrowBalanceStored(address borrower) external view returns (uint256);
    function borrowBalanceCurrent(address borrower) external view returns (uint256);
    function originationFee() external view returns (uint256);
    function treasury() external view returns (address);
    function totalCash() external view returns (uint256);
}

interface ICollateralManager {
    struct AssetConfig {
        bool listed;
        bool enabled;
        bool depositsPaused;
        uint8 decimals;
        uint64 ltv;
        uint64 liquidationThreshold;
        uint64 liquidationBonus;
        uint256 supplyCap;
    }

    function NATIVE_BTC() external view returns (address);
    function depositFor(address user, address asset, uint256 amount) external payable;
    function withdrawTo(address user, address asset, uint256 amount, address to) external;
    function seize(address from, address asset, uint256 amount, address to) external;
    function balanceOf(address user, address asset) external view returns (uint256);
    function totalDeposits(address asset) external view returns (uint256);
    function getAssets() external view returns (address[] memory);
    function getAssetConfig(address asset) external view returns (AssetConfig memory);
    function hasCollateral(address user) external view returns (bool);
}

interface IBorrowManager {
    struct AccountData {
        uint256 collateralValue; // USD, WAD
        uint256 borrowCapacity; // sum(value * LTV)
        uint256 liquidationCapacity; // sum(value * liquidation threshold)
        uint256 debt; // MUSD, WAD
        uint256 healthFactor; // liquidationCapacity / debt, WAD (max uint when no debt)
    }

    function getAccountData(address account) external view returns (AccountData memory);
    function syncAccount(address account) external;
    function oracle() external view returns (IPriceOracle);
}
