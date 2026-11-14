// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MarketRegistry
/// @notice On-chain directory of MezoLend markets. Each market is an isolated MUSD lending pool with its own
///         collateral set, interest-rate curve and risk parameters. The app discovers markets from here.
contract MarketRegistry is AccessControl {
    struct Market {
        string name;
        string description;
        address pool;
        address borrowManager;
        address collateralManager;
        address liquidationManager;
        address interestRateModel;
        bool active;
    }

    address public immutable musd;
    address public immutable oracle;
    Market[] internal _markets;

    event MarketAdded(uint256 indexed id, string name, address pool);
    event MarketStatusChanged(uint256 indexed id, bool active);

    error UnknownMarket();

    constructor(address admin, address musd_, address oracle_) {
        musd = musd_;
        oracle = oracle_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function addMarket(Market calldata m) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 id) {
        id = _markets.length;
        _markets.push(m);
        emit MarketAdded(id, m.name, m.pool);
    }

    function setMarketActive(uint256 id, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (id >= _markets.length) revert UnknownMarket();
        _markets[id].active = active;
        emit MarketStatusChanged(id, active);
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function getMarket(uint256 id) external view returns (Market memory) {
        if (id >= _markets.length) revert UnknownMarket();
        return _markets[id];
    }

    function getMarkets() external view returns (Market[] memory) {
        return _markets;
    }
}
