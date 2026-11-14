// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICollateralManager} from "./interfaces/IMezoLend.sol";

/// @title CollateralManager
/// @notice Custody and risk configuration for one market's collateral. Holds native BTC (Mezo's gas token,
///         identified by its ERC-20 precompile address) and any listed ERC-20 collateral.
///         Balances can only move through the market's controllers (BorrowManager, LiquidationManager),
///         which enforce solvency. Risk parameters per asset:
///         - ltv: max borrow power per $1 of collateral
///         - liquidationThreshold: collateral weight used for the health factor
///         - liquidationBonus: discount liquidators receive on seized collateral
contract CollateralManager is AccessControl, ReentrancyGuard, ICollateralManager {
    using SafeERC20 for IERC20;

    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    address public constant NATIVE_BTC = 0x7b7C000000000000000000000000000000000000;
    uint256 internal constant WAD = 1e18;
    uint256 public constant MAX_LIQUIDATION_THRESHOLD = 0.95e18;
    uint256 public constant MAX_LIQUIDATION_BONUS = 0.2e18;

    address[] internal _assets;
    mapping(address asset => AssetConfig) internal _configs;
    mapping(address user => mapping(address asset => uint256)) internal _balances;
    mapping(address asset => uint256) public totalDeposits;
    /// @notice Protocol's share of liquidation bonuses, held here until an admin claims it. Kept out of
    ///         liquidate() so a treasury that cannot receive BTC can never block liquidations (audit M-01).
    mapping(address asset => uint256) public protocolBalance;

    event AssetConfigured(
        address indexed asset,
        bool enabled,
        bool depositsPaused,
        uint64 ltv,
        uint64 liquidationThreshold,
        uint64 liquidationBonus,
        uint256 supplyCap
    );
    event CollateralDeposited(address indexed user, address indexed asset, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed asset, uint256 amount, address to);
    event CollateralSeized(address indexed user, address indexed asset, uint256 amount, address indexed to);
    event ProtocolCollateralCredited(address indexed user, address indexed asset, uint256 amount);
    event ProtocolCollateralClaimed(address indexed asset, uint256 amount, address indexed to);

    error AssetNotAccepted();
    error InvalidConfig();
    error ZeroAmount();
    error InvalidValue();
    error SupplyCapExceeded();
    error InsufficientCollateral();
    error NativeTransferFailed();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ───────────────────────────── Config ─────────────────────────────

    function configureAsset(
        address asset,
        bool enabled,
        bool depositsPaused,
        uint64 ltv,
        uint64 liquidationThreshold,
        uint64 liquidationBonus,
        uint256 supplyCap
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (asset == address(0)) revert InvalidConfig();
        if (ltv == 0 || ltv >= liquidationThreshold) revert InvalidConfig();
        if (liquidationThreshold > MAX_LIQUIDATION_THRESHOLD) revert InvalidConfig();
        if (liquidationBonus == 0 || liquidationBonus > MAX_LIQUIDATION_BONUS) revert InvalidConfig();
        // A liquidation must leave the account healthier: LT * (1 + bonus) < 1.
        if ((uint256(liquidationThreshold) * (WAD + liquidationBonus)) / WAD >= WAD) revert InvalidConfig();

        AssetConfig storage c = _configs[asset];
        if (!c.listed) {
            c.listed = true;
            c.decimals = asset == NATIVE_BTC ? 18 : IERC20Metadata(asset).decimals();
            _assets.push(asset);
        }
        c.enabled = enabled;
        c.depositsPaused = depositsPaused;
        c.ltv = ltv;
        c.liquidationThreshold = liquidationThreshold;
        c.liquidationBonus = liquidationBonus;
        c.supplyCap = supplyCap;
        emit AssetConfigured(asset, enabled, depositsPaused, ltv, liquidationThreshold, liquidationBonus, supplyCap);
    }

    // ───────────────────────────── Controller actions ─────────────────────────────

    function depositFor(address user, address asset, uint256 amount)
        external
        payable
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        AssetConfig memory c = _configs[asset];
        if (!c.listed || !c.enabled || c.depositsPaused) revert AssetNotAccepted();
        if (amount == 0) revert ZeroAmount();
        if (c.supplyCap != 0 && totalDeposits[asset] + amount > c.supplyCap) revert SupplyCapExceeded();

        _balances[user][asset] += amount;
        totalDeposits[asset] += amount;

        if (asset == NATIVE_BTC) {
            if (msg.value != amount) revert InvalidValue();
        } else {
            if (msg.value != 0) revert InvalidValue();
            IERC20(asset).safeTransferFrom(user, address(this), amount);
        }
        emit CollateralDeposited(user, asset, amount);
    }

    function withdrawTo(address user, address asset, uint256 amount, address to)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        _debit(user, asset, amount);
        _send(asset, to, amount);
        emit CollateralWithdrawn(user, asset, amount, to);
    }

    function seize(address from, address asset, uint256 amount, address to)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        _debit(from, asset, amount);
        _send(asset, to, amount);
        emit CollateralSeized(from, asset, amount, to);
    }

    /// @notice Moves `amount` of `from`'s collateral to the protocol balance (no transfer out).
    function seizeToProtocol(address from, address asset, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        _debit(from, asset, amount);
        protocolBalance[asset] += amount;
        emit ProtocolCollateralCredited(from, asset, amount);
    }

    /// @notice Sends accumulated protocol collateral to `to`.
    function claimProtocolCollateral(address asset, uint256 amount, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (amount > protocolBalance[asset]) revert InsufficientCollateral();
        protocolBalance[asset] -= amount;
        _send(asset, to, amount);
        emit ProtocolCollateralClaimed(asset, amount, to);
    }

    function _debit(address user, address asset, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = _balances[user][asset];
        if (amount > bal) revert InsufficientCollateral();
        _balances[user][asset] = bal - amount;
        totalDeposits[asset] -= amount;
    }

    function _send(address asset, address to, uint256 amount) internal {
        if (asset == NATIVE_BTC) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    // ───────────────────────────── Views ─────────────────────────────

    function balanceOf(address user, address asset) external view returns (uint256) {
        return _balances[user][asset];
    }

    function getAssets() external view returns (address[] memory) {
        return _assets;
    }

    function getAssetConfig(address asset) external view returns (AssetConfig memory) {
        return _configs[asset];
    }

    function hasCollateral(address user) external view returns (bool) {
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            if (_balances[user][_assets[i]] != 0) return true;
        }
        return false;
    }
}
