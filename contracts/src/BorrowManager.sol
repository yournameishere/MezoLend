// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ILendingPool, ICollateralManager, IPriceOracle, IBorrowManager} from "./interfaces/IMezoLend.sol";

/// @title BorrowManager
/// @notice Borrower entry point for one MezoLend market. Prices collateral through the oracle, enforces
///         the loan-to-value limit on new debt and collateral withdrawals, and tracks every open account
///         on-chain so positions and their health can be enumerated without an indexer.
///         Health factor = sum(collateral value * liquidation threshold) / debt. Below 1.0 the account
///         can be liquidated through the market's LiquidationManager.
contract BorrowManager is AccessControl, Pausable, ReentrancyGuard, IBorrowManager {
    using Math for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 internal constant WAD = 1e18;

    ILendingPool public immutable pool;
    ICollateralManager public immutable collateralManager;
    IPriceOracle public oracle;

    EnumerableSet.AddressSet internal _accounts;

    event OracleUpdated(address indexed oracle);

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientCollateral();
    error InvalidValue();

    constructor(address admin, ILendingPool pool_, ICollateralManager collateralManager_, IPriceOracle oracle_) {
        if (
            admin == address(0) || address(pool_) == address(0) || address(collateralManager_) == address(0)
                || address(oracle_) == address(0)
        ) revert ZeroAddress();
        pool = pool_;
        collateralManager = collateralManager_;
        oracle = oracle_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ───────────────────────────── User actions ─────────────────────────────

    /// @notice Add collateral. Always allowed (even while paused) so borrowers can defend positions.
    function depositCollateral(address asset, uint256 amount) external payable nonReentrant {
        collateralManager.depositFor{value: msg.value}(msg.sender, asset, amount);
        _accounts.add(msg.sender);
    }

    /// @notice Withdraw collateral while keeping debt within the LTV limit. Pass type(uint256).max for the maximum.
    ///         Accounts with no debt can always withdraw, even while the market is paused (audit M-02).
    function withdrawCollateral(address asset, uint256 amount) external nonReentrant {
        pool.accrueInterest();
        if (_withdraw(msg.sender, asset, amount) == 0) revert ZeroAmount();
        _sync(msg.sender);
    }

    /// @notice Borrow MUSD against deposited collateral. Debt after borrowing (incl. origination fee) must
    ///         not exceed the account's borrow capacity.
    function borrow(uint256 amount) external nonReentrant whenNotPaused {
        _borrow(msg.sender, amount);
    }

    /// @notice One-step "deposit collateral and borrow" (the core borrow workflow).
    function depositAndBorrow(address asset, uint256 collateralAmount, uint256 borrowAmount)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (collateralAmount > 0) {
            collateralManager.depositFor{value: msg.value}(msg.sender, asset, collateralAmount);
        } else if (msg.value != 0) {
            revert InvalidValue();
        }
        _accounts.add(msg.sender);
        if (borrowAmount > 0) _borrow(msg.sender, borrowAmount);
    }

    /// @notice Repay MUSD (approved to the pool) and optionally withdraw collateral in one transaction.
    function repayAndWithdraw(uint256 repayAmount, address asset, uint256 withdrawAmount) external nonReentrant {
        pool.accrueInterest();
        if (repayAmount > 0) pool.repayFrom(msg.sender, msg.sender, repayAmount);
        if (withdrawAmount > 0) _withdraw(msg.sender, asset, withdrawAmount);
        _sync(msg.sender);
    }

    /// @notice Removes an account with no collateral and no debt from the active set. Anyone may call.
    function syncAccount(address account) external {
        _sync(account);
    }

    function _borrow(address account, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        pool.accrueInterest();
        uint256 fee = amount.mulDiv(pool.originationFee(), WAD, Math.Rounding.Ceil);
        AccountData memory d = _accountData(account, pool.borrowBalanceStored(account));
        if (d.debt + amount + fee > d.borrowCapacity) revert InsufficientCollateral();
        _accounts.add(account);
        pool.borrow(account, amount, account);
    }

    /// @dev Withdraws up to `amount` (max = everything the LTV allows). Pausing only blocks withdrawals that
    ///      back open debt; returns the amount withdrawn.
    function _withdraw(address account, address asset, uint256 amount) internal returns (uint256) {
        uint256 debt = pool.borrowBalanceStored(account);
        if (debt > 0) _requireNotPaused();
        if (amount == type(uint256).max) amount = _maxWithdrawable(account, asset, debt);
        if (amount == 0) return 0;
        _requireSolventAfterWithdraw(account, asset, amount);
        collateralManager.withdrawTo(account, asset, amount, account);
        return amount;
    }

    function _requireSolventAfterWithdraw(address account, address asset, uint256 amount) internal view {
        uint256 debt = pool.borrowBalanceStored(account);
        if (debt == 0) return;
        AccountData memory d = _accountData(account, debt);
        ICollateralManager.AssetConfig memory c = collateralManager.getAssetConfig(asset);
        uint256 removedValue = amount.mulDiv(oracle.getPrice(asset), 10 ** c.decimals);
        uint256 removedCapacity = removedValue.mulDiv(c.ltv, WAD, Math.Rounding.Ceil);
        if (removedCapacity > d.borrowCapacity || d.borrowCapacity - removedCapacity < debt) {
            revert InsufficientCollateral();
        }
    }

    function _sync(address account) internal {
        if (pool.borrowBalanceStored(account) == 0 && !collateralManager.hasCollateral(account)) {
            _accounts.remove(account);
        }
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getAccountData(address account) public view returns (AccountData memory) {
        return _accountData(account, pool.borrowBalanceCurrent(account));
    }

    function healthFactor(address account) external view returns (uint256) {
        return getAccountData(account).healthFactor;
    }

    function isLiquidatable(address account) external view returns (bool) {
        AccountData memory d = getAccountData(account);
        return d.debt > 0 && d.healthFactor < WAD;
    }

    /// @notice Max MUSD `account` can borrow right now (net of origination fee and pool liquidity).
    function availableToBorrow(address account) external view returns (uint256) {
        AccountData memory d = getAccountData(account);
        if (d.borrowCapacity <= d.debt) return 0;
        uint256 room = (d.borrowCapacity - d.debt).mulDiv(WAD, WAD + pool.originationFee());
        uint256 cash = pool.totalCash();
        return room < cash ? room : cash;
    }

    function maxWithdrawable(address account, address asset) external view returns (uint256) {
        return _maxWithdrawable(account, asset, pool.borrowBalanceCurrent(account));
    }

    /// @notice Price of `asset` at which `account` becomes liquidatable, holding other collateral constant.
    ///         Returns 0 when the account cannot be liquidated through this asset's price alone.
    function liquidationPrice(address account, address asset) external view returns (uint256) {
        uint256 debt = pool.borrowBalanceCurrent(account);
        uint256 bal = collateralManager.balanceOf(account, asset);
        if (debt == 0 || bal == 0) return 0;
        ICollateralManager.AssetConfig memory c = collateralManager.getAssetConfig(asset);
        AccountData memory d = _accountData(account, debt);
        uint256 ownLiqCap = bal.mulDiv(oracle.getPrice(asset), 10 ** c.decimals).mulDiv(c.liquidationThreshold, WAD);
        uint256 otherLiqCap = d.liquidationCapacity - ownLiqCap;
        if (otherLiqCap >= debt) return 0;
        return (debt - otherLiqCap).mulDiv(10 ** c.decimals, bal).mulDiv(WAD, c.liquidationThreshold);
    }

    /// @notice Simulates a borrow: origination fee, resulting debt and health factor.
    function previewBorrow(address account, uint256 amount)
        external
        view
        returns (uint256 fee, uint256 debtAfter, uint256 healthFactorAfter)
    {
        fee = amount.mulDiv(pool.originationFee(), WAD, Math.Rounding.Ceil);
        AccountData memory d = getAccountData(account);
        debtAfter = d.debt + amount + fee;
        healthFactorAfter = debtAfter == 0 ? type(uint256).max : d.liquidationCapacity.mulDiv(WAD, debtAfter);
    }

    function accountCount() external view returns (uint256) {
        return _accounts.length();
    }

    function getAccounts(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 n = _accounts.length();
        if (offset >= n) return new address[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _accounts.at(i);
        }
    }

    function _maxWithdrawable(address account, address asset, uint256 debt) internal view returns (uint256) {
        uint256 bal = collateralManager.balanceOf(account, asset);
        if (debt == 0 || bal == 0) return bal;
        AccountData memory d = _accountData(account, debt);
        if (d.borrowCapacity <= debt) return 0;
        ICollateralManager.AssetConfig memory c = collateralManager.getAssetConfig(asset);
        uint256 spare = d.borrowCapacity - debt;
        // Inverse of _requireSolventAfterWithdraw, rounding down at every step so the result always passes
        // it (audit L-01): the most collateral value that can leave, then that value in tokens.
        uint256 maxValue = spare.mulDiv(WAD, c.ltv);
        uint256 maxAmt = maxValue.mulDiv(10 ** c.decimals, oracle.getPrice(asset));
        return maxAmt < bal ? maxAmt : bal;
    }

    function _accountData(address account, uint256 debt) internal view returns (AccountData memory d) {
        address[] memory assets = collateralManager.getAssets();
        for (uint256 i; i < assets.length; ++i) {
            uint256 bal = collateralManager.balanceOf(account, assets[i]);
            if (bal == 0) continue;
            ICollateralManager.AssetConfig memory c = collateralManager.getAssetConfig(assets[i]);
            uint256 value = bal.mulDiv(oracle.getPrice(assets[i]), 10 ** c.decimals);
            d.collateralValue += value;
            d.borrowCapacity += value.mulDiv(c.ltv, WAD);
            d.liquidationCapacity += value.mulDiv(c.liquidationThreshold, WAD);
        }
        d.debt = debt;
        d.healthFactor = debt == 0 ? type(uint256).max : d.liquidationCapacity.mulDiv(WAD, debt);
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setOracle(IPriceOracle oracle_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(oracle_) == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleUpdated(address(oracle_));
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
