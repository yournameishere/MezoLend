// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IInterestRateModel} from "./interfaces/IMezoLend.sol";

/// @title InterestRateModel
/// @notice Kinked utilization model.
///         - Utilization u = borrows / (cash + borrows - reserves)
///         - u <= kink : borrowAPR = base + slope1 * u / kink
///         - u >  kink : borrowAPR = base + slope1 + slope2 * (u - kink) / (1 - kink)
///         - supplyAPR = borrowAPR * u * (1 - reserveFactor)
///         All values are WAD (1e18 = 100%). Parameters are immutable; governance swaps the model to change them.
contract InterestRateModel is IInterestRateModel {
    uint256 internal constant WAD = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MAX_TOTAL_RATE = 10e18; // 1000% APR hard ceiling

    uint256 public immutable baseRatePerYear;
    uint256 public immutable slope1PerYear;
    uint256 public immutable slope2PerYear;
    uint256 public immutable kink;

    error InvalidKink();
    error RateTooHigh();

    constructor(uint256 baseRatePerYear_, uint256 slope1PerYear_, uint256 slope2PerYear_, uint256 kink_) {
        if (kink_ == 0 || kink_ >= WAD) revert InvalidKink();
        if (baseRatePerYear_ + slope1PerYear_ + slope2PerYear_ > MAX_TOTAL_RATE) revert RateTooHigh();
        baseRatePerYear = baseRatePerYear_;
        slope1PerYear = slope1PerYear_;
        slope2PerYear = slope2PerYear_;
        kink = kink_;
    }

    function utilizationRate(uint256 cash, uint256 borrows, uint256 reserves) public pure returns (uint256) {
        if (borrows == 0) return 0;
        uint256 gross = cash + borrows;
        if (gross <= reserves) return WAD;
        uint256 u = (borrows * WAD) / (gross - reserves);
        return u > WAD ? WAD : u;
    }

    function getBorrowRateAtUtilization(uint256 u) public view returns (uint256) {
        if (u > WAD) u = WAD;
        if (u <= kink) return baseRatePerYear + (slope1PerYear * u) / kink;
        return baseRatePerYear + slope1PerYear + (slope2PerYear * (u - kink)) / (WAD - kink);
    }

    function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) external view returns (uint256) {
        return getBorrowRateAtUtilization(utilizationRate(cash, borrows, reserves)) / SECONDS_PER_YEAR;
    }

    function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactor)
        external
        view
        returns (uint256)
    {
        uint256 u = utilizationRate(cash, borrows, reserves);
        // borrowAPR * u * (1 - rf), converted to per-second in a single division (max ~1e55, no overflow)
        return (getBorrowRateAtUtilization(u) * u * (WAD - reserveFactor)) / (WAD * WAD * SECONDS_PER_YEAR);
    }

    function params() external view returns (uint256, uint256, uint256, uint256) {
        return (baseRatePerYear, slope1PerYear, slope2PerYear, kink);
    }
}
