// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Chainlink-compatible aggregator. Mezo's Skip Connect BTC/USD feed exposes this interface.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Minimal Pyth interface (only what the oracle adapter reads).
interface IPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);
}
