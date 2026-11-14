// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAggregatorV3, IPyth} from "./interfaces/IExternal.sol";
import {IPriceOracle} from "./interfaces/IMezoLend.sol";

/// @title PriceOracle
/// @notice USD price adapter for MezoLend collateral. Each asset has a primary Chainlink-style feed
///         (Mezo's Skip Connect aggregator for BTC/USD) and an optional Pyth fallback.
///         Every read is validated for: positive answer, freshness (per-source staleness window),
///         sanity bounds (min/max price) and, for Pyth, a confidence-interval ceiling.
///         If neither source passes, `getPrice` reverts — borrowing, collateral withdrawal and
///         liquidation halt rather than act on a bad price. Repayments and deposits never need a price.
///         Prices are returned as USD per 1 whole token, scaled to 1e18.
contract PriceOracle is AccessControl, IPriceOracle {
    uint8 public constant SOURCE_NONE = 0;
    uint8 public constant SOURCE_PRIMARY = 1;
    uint8 public constant SOURCE_FALLBACK = 2;
    uint256 public constant MAX_PYTH_CONF_BPS = 200; // reject Pyth prices whose confidence band exceeds 2%
    /// @notice A price stamped further than this in the future is invalid (audit L-02). Small drift between
    ///         the feed's clock and block time is normal; a far-future stamp would otherwise stay "fresh".
    uint256 public constant MAX_CLOCK_DRIFT = 5 minutes;

    struct FeedConfig {
        address aggregator;
        uint8 aggregatorDecimals;
        uint32 maxStaleness;
        bytes32 pythId;
        uint32 pythMaxStaleness;
        uint128 minPrice;
        uint128 maxPrice;
        bool configured;
    }

    IPyth public immutable pyth;
    mapping(address asset => FeedConfig) internal _feeds;
    address[] internal _assets;

    event FeedConfigured(
        address indexed asset,
        address aggregator,
        uint32 maxStaleness,
        bytes32 pythId,
        uint32 pythMaxStaleness,
        uint128 minPrice,
        uint128 maxPrice
    );

    error InvalidFeed();
    error PriceUnavailable(address asset);

    constructor(address admin, address pyth_) {
        pyth = IPyth(pyth_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setFeed(
        address asset,
        address aggregator,
        uint32 maxStaleness,
        bytes32 pythId,
        uint32 pythMaxStaleness,
        uint128 minPrice,
        uint128 maxPrice
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (aggregator == address(0) && pythId == bytes32(0)) revert InvalidFeed();
        if (maxPrice <= minPrice || minPrice == 0) revert InvalidFeed();
        uint8 dec;
        if (aggregator != address(0)) {
            if (aggregator.code.length == 0 || maxStaleness == 0) revert InvalidFeed();
            dec = IAggregatorV3(aggregator).decimals();
            if (dec > 36) revert InvalidFeed();
        }
        if (pythId != bytes32(0) && pythMaxStaleness == 0) revert InvalidFeed();
        if (!_feeds[asset].configured) _assets.push(asset);
        _feeds[asset] = FeedConfig({
            aggregator: aggregator,
            aggregatorDecimals: dec,
            maxStaleness: maxStaleness,
            pythId: pythId,
            pythMaxStaleness: pythMaxStaleness,
            minPrice: minPrice,
            maxPrice: maxPrice,
            configured: true
        });
        emit FeedConfigured(asset, aggregator, maxStaleness, pythId, pythMaxStaleness, minPrice, maxPrice);
    }

    function getPrice(address asset) external view returns (uint256) {
        (bool ok, uint256 price,,) = tryGetPrice(asset);
        if (!ok) revert PriceUnavailable(asset);
        return price;
    }

    function tryGetPrice(address asset)
        public
        view
        returns (bool ok, uint256 price, uint256 updatedAt, uint8 source)
    {
        FeedConfig memory f = _feeds[asset];
        if (!f.configured) return (false, 0, 0, SOURCE_NONE);
        if (f.aggregator != address(0)) {
            (ok, price, updatedAt) = _readAggregator(f);
            if (ok) return (true, price, updatedAt, SOURCE_PRIMARY);
        }
        if (f.pythId != bytes32(0) && address(pyth).code.length > 0) {
            (ok, price, updatedAt) = _readPyth(f);
            if (ok) return (true, price, updatedAt, SOURCE_FALLBACK);
        }
        return (false, 0, 0, SOURCE_NONE);
    }

    function getFeed(address asset) external view returns (FeedConfig memory) {
        return _feeds[asset];
    }

    function getAssets() external view returns (address[] memory) {
        return _assets;
    }

    function _readAggregator(FeedConfig memory f) internal view returns (bool, uint256, uint256) {
        try IAggregatorV3(f.aggregator).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (answer <= 0 || updatedAt == 0) return (false, 0, 0);
            if (_isStale(updatedAt, f.maxStaleness)) return (false, 0, 0);
            uint256 p = _scale(uint256(answer), f.aggregatorDecimals);
            if (p < f.minPrice || p > f.maxPrice) return (false, 0, 0);
            return (true, p, updatedAt);
        } catch {
            return (false, 0, 0);
        }
    }

    function _readPyth(FeedConfig memory f) internal view returns (bool, uint256, uint256) {
        try pyth.getPriceUnsafe(f.pythId) returns (IPyth.Price memory p) {
            if (p.price <= 0 || p.publishTime == 0) return (false, 0, 0);
            if (_isStale(p.publishTime, f.pythMaxStaleness)) return (false, 0, 0);
            uint256 raw = uint256(uint64(p.price));
            if (uint256(p.conf) * 10_000 > raw * MAX_PYTH_CONF_BPS) return (false, 0, 0);
            if (p.expo > 0 || p.expo < -36) return (false, 0, 0);
            uint256 scaled = _scale(raw, uint8(uint32(-p.expo)));
            if (scaled < f.minPrice || scaled > f.maxPrice) return (false, 0, 0);
            return (true, scaled, p.publishTime);
        } catch {
            return (false, 0, 0);
        }
    }

    function _isStale(uint256 updatedAt, uint256 maxAge) internal view returns (bool) {
        if (updatedAt >= block.timestamp) return updatedAt - block.timestamp > MAX_CLOCK_DRIFT;
        return block.timestamp - updatedAt > maxAge;
    }

    function _scale(uint256 value, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) return value;
        if (decimals < 18) return value * 10 ** (18 - decimals);
        return value / 10 ** (decimals - 18);
    }
}
