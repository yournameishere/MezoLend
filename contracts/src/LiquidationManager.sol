// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILendingPool, ICollateralManager, IBorrowManager} from "./interfaces/IMezoLend.sol";

/// @title LiquidationManager
/// @notice Permissionless liquidations for one MezoLend market. When an account's health factor drops
///         below 1.0, anyone can repay part of its MUSD debt and receive the equivalent collateral plus
///         the asset's liquidation bonus. A share of that bonus goes to the protocol treasury.
///         - Close factor: at most `closeFactor` of the debt per call, unless the account is deeply
///           underwater (HF < fullLiquidationHealthFactor) or the debt is small (<= minCloseDebt).
///         - If an account is left with debt but no collateral, the remainder is written off as bad debt
///           (reserves first, then lenders).
contract LiquidationManager is AccessControl, Pausable, ReentrancyGuard {
    using Math for uint256;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 internal constant WAD = 1e18;

    ILendingPool public immutable pool;
    ICollateralManager public immutable collateralManager;
    IBorrowManager public immutable borrowManager;

    uint256 public closeFactor;
    uint256 public fullLiquidationHealthFactor;
    uint256 public minCloseDebt;
    uint256 public protocolShare;

    struct LiquidationPreview {
        uint256 healthFactor;
        uint256 debt;
        uint256 maxRepay;
        uint256 repayAmount;
        uint256 seizeToLiquidator;
        uint256 protocolCut;
        uint256 collateralPrice;
        uint256 bonusValue; // USD value of the liquidator's bonus
    }

    event Liquidation(
        address indexed borrower,
        address indexed liquidator,
        address indexed asset,
        uint256 repaid,
        uint256 seizedToLiquidator,
        uint256 protocolCut,
        uint256 healthFactorBefore,
        uint256 badDebt
    );
    event ParamsUpdated(uint256 closeFactor, uint256 fullLiquidationHealthFactor, uint256 minCloseDebt, uint256 protocolShare);

    error NotLiquidatable();
    error NoCollateral();
    error ZeroAmount();
    error SlippageExceeded();
    error InvalidParam();

    constructor(
        address admin,
        ILendingPool pool_,
        ICollateralManager collateralManager_,
        IBorrowManager borrowManager_,
        uint256 closeFactor_,
        uint256 fullLiquidationHealthFactor_,
        uint256 minCloseDebt_,
        uint256 protocolShare_
    ) {
        pool = pool_;
        collateralManager = collateralManager_;
        borrowManager = borrowManager_;
        _setParams(closeFactor_, fullLiquidationHealthFactor_, minCloseDebt_, protocolShare_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @param borrower Account to liquidate (health factor must be < 1).
    /// @param asset Collateral asset to seize.
    /// @param repayAmount MUSD to repay (capped by the close factor and available collateral). The caller
    ///        must have approved the LendingPool for this amount.
    /// @param minSeizeAmount Minimum collateral the liquidator accepts (slippage guard).
    function liquidate(address borrower, address asset, uint256 repayAmount, uint256 minSeizeAmount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 repaid, uint256 seizedToLiquidator)
    {
        if (repayAmount == 0) revert ZeroAmount();
        pool.accrueInterest();
        IBorrowManager.AccountData memory d = borrowManager.getAccountData(borrower);
        if (d.debt == 0 || d.healthFactor >= WAD) revert NotLiquidatable();

        (uint256 actualRepay, uint256 toLiquidator, uint256 protocolCut,) =
            _compute(borrower, asset, repayAmount, d.debt, d.healthFactor);
        if (actualRepay == 0 || toLiquidator == 0) revert NoCollateral();
        if (toLiquidator < minSeizeAmount) revert SlippageExceeded();

        repaid = pool.repayFrom(msg.sender, borrower, actualRepay);
        seizedToLiquidator = toLiquidator;
        // Protocol cut stays inside the collateral manager (no external call), then the liquidator is paid.
        if (protocolCut > 0) collateralManager.seizeToProtocol(borrower, asset, protocolCut);
        collateralManager.seize(borrower, asset, toLiquidator, msg.sender);

        uint256 badDebt;
        if (!collateralManager.hasCollateral(borrower) && pool.borrowBalanceStored(borrower) > 0) {
            badDebt = pool.writeOffBadDebt(borrower);
        }
        borrowManager.syncAccount(borrower);

        emit Liquidation(borrower, msg.sender, asset, repaid, toLiquidator, protocolCut, d.healthFactor, badDebt);
    }

    /// @notice Off-chain helper: what a liquidation of `borrower` for `repayAmount` would do right now.
    function previewLiquidation(address borrower, address asset, uint256 repayAmount)
        external
        view
        returns (LiquidationPreview memory p)
    {
        IBorrowManager.AccountData memory d = borrowManager.getAccountData(borrower);
        p.healthFactor = d.healthFactor;
        p.debt = d.debt;
        if (d.debt == 0 || d.healthFactor >= WAD) return p;
        p.maxRepay = _maxRepay(d.debt, d.healthFactor);
        uint256 price;
        (p.repayAmount, p.seizeToLiquidator, p.protocolCut, price) =
            _compute(borrower, asset, repayAmount == 0 ? p.maxRepay : repayAmount, d.debt, d.healthFactor);
        p.collateralPrice = price;
        ICollateralManager.AssetConfig memory c = collateralManager.getAssetConfig(asset);
        uint256 seizedValue = p.seizeToLiquidator.mulDiv(price, 10 ** c.decimals);
        p.bonusValue = seizedValue > p.repayAmount ? seizedValue - p.repayAmount : 0;
    }

    function _maxRepay(uint256 debt, uint256 hf) internal view returns (uint256) {
        if (hf < fullLiquidationHealthFactor || debt <= minCloseDebt) return debt;
        return debt.mulDiv(closeFactor, WAD);
    }

    function _compute(address borrower, address asset, uint256 repayAmount, uint256 debt, uint256 hf)
        internal
        view
        returns (uint256 repay, uint256 toLiquidator, uint256 protocolCut, uint256 price)
    {
        uint256 maxRepay = _maxRepay(debt, hf);
        repay = repayAmount > maxRepay ? maxRepay : repayAmount;

        ICollateralManager.AssetConfig memory c = collateralManager.getAssetConfig(asset);
        uint256 bal = collateralManager.balanceOf(borrower, asset);
        if (bal == 0) return (0, 0, 0, 0);
        price = borrowManager.oracle().getPrice(asset);
        uint256 unit = 10 ** c.decimals;
        uint256 bonusMul = WAD + c.liquidationBonus;

        uint256 seizeTotal = repay.mulDiv(bonusMul, WAD).mulDiv(unit, price);
        if (seizeTotal > bal) {
            seizeTotal = bal;
            repay = bal.mulDiv(price, unit).mulDiv(WAD, bonusMul);
        }
        uint256 bonusAmount = seizeTotal - seizeTotal.mulDiv(WAD, bonusMul);
        protocolCut = bonusAmount.mulDiv(protocolShare, WAD);
        toLiquidator = seizeTotal - protocolCut;
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setParams(uint256 closeFactor_, uint256 fullLiquidationHealthFactor_, uint256 minCloseDebt_, uint256 protocolShare_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setParams(closeFactor_, fullLiquidationHealthFactor_, minCloseDebt_, protocolShare_);
    }

    function _setParams(uint256 cf, uint256 fullHf, uint256 minDebt, uint256 share) internal {
        if (cf == 0 || cf > WAD || fullHf > WAD || share > 0.5e18) revert InvalidParam();
        closeFactor = cf;
        fullLiquidationHealthFactor = fullHf;
        minCloseDebt = minDebt;
        protocolShare = share;
        emit ParamsUpdated(cf, fullHf, minDebt, share);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
