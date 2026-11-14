// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IInterestRateModel} from "./interfaces/IMezoLend.sol";

/// @title LendingPool
/// @notice MUSD lending pool for one MezoLend market.
///         Lenders: ERC-4626 vault. Supplying MUSD mints pool shares (e.g. mlMUSD-CORE) whose value grows as
///         borrowers pay interest. Withdrawals are limited by idle liquidity (cash not lent out).
///         Borrowers: debt ledger with a Compound-style borrow index. Only the market's BorrowManager can open
///         debt (after it has verified collateral); anyone can repay anyone's debt.
///         Interest: per-second simple accrual compounded at every interaction, rate from the InterestRateModel.
///         A `reserveFactor` share of interest and the one-time origination fee accrue to protocol reserves.
contract LendingPool is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant BORROW_MANAGER_ROLE = keccak256("BORROW_MANAGER_ROLE");
    bytes32 public constant LIQUIDATION_MANAGER_ROLE = keccak256("LIQUIDATION_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 internal constant WAD = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MAX_RESERVE_FACTOR = 0.5e18;
    uint256 public constant MAX_ORIGINATION_FEE = 0.02e18;

    struct BorrowSnapshot {
        uint256 debt; // debt at `index`
        uint256 index; // borrowIndex when `debt` was recorded
    }

    struct PoolState {
        uint256 totalAssets;
        uint256 totalSupply;
        uint256 totalCash;
        uint256 totalBorrows;
        uint256 totalReserves;
        uint256 borrowIndex;
        uint256 utilization;
        uint256 borrowRatePerYear;
        uint256 supplyRatePerYear;
        uint256 lastAccrual;
    }

    IInterestRateModel public interestRateModel;
    address public treasury;
    uint256 public reserveFactor;
    uint256 public originationFee;
    uint256 public supplyCap;
    uint256 public borrowCap;
    uint256 public minBorrow;

    uint256 public totalCash;
    uint256 public totalBorrows;
    uint256 public totalReserves;
    uint256 public borrowIndex;
    uint256 public lastAccrual;
    uint256 public totalBadDebt;

    mapping(address => BorrowSnapshot) internal _borrows;
    /// @notice Net MUSD borrowed (incl. origination fee), excluding interest. debt - principal = interest owed.
    mapping(address => uint256) public borrowPrincipal;
    /// @notice Net MUSD supplied, excluding earned interest. Moves pro-rata with share transfers.
    mapping(address => uint256) public supplyPrincipal;

    event InterestAccrued(uint256 interest, uint256 borrowIndex, uint256 totalBorrows, uint256 totalReserves);
    event Borrow(address indexed borrower, address indexed receiver, uint256 amount, uint256 fee, uint256 debtAfter);
    event Repay(address indexed borrower, address indexed payer, uint256 amount, uint256 debtAfter);
    event BadDebtWrittenOff(address indexed borrower, uint256 debt, uint256 coveredByReserves, uint256 socialized);
    event ReservesWithdrawn(address indexed to, uint256 amount);
    event PoolSnapshot(
        uint256 totalAssets,
        uint256 totalBorrows,
        uint256 totalCash,
        uint256 utilization,
        uint256 borrowRatePerYear,
        uint256 supplyRatePerYear
    );
    event InterestRateModelUpdated(address indexed model);
    event RiskParamsUpdated(uint256 reserveFactor, uint256 originationFee, uint256 supplyCap, uint256 borrowCap, uint256 minBorrow);
    event TreasuryUpdated(address indexed treasury);

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientLiquidity();
    error BorrowCapExceeded();
    error BelowMinBorrow();
    error NoDebt();
    error InvalidParam();
    error Unauthorized();

    constructor(
        IERC20 musd,
        string memory name_,
        string memory symbol_,
        address admin,
        IInterestRateModel model,
        address treasury_,
        uint256 reserveFactor_,
        uint256 originationFee_,
        uint256 minBorrow_
    ) ERC20(name_, symbol_) ERC4626(musd) {
        if (admin == address(0) || treasury_ == address(0) || address(model) == address(0)) revert ZeroAddress();
        if (reserveFactor_ > MAX_RESERVE_FACTOR || originationFee_ > MAX_ORIGINATION_FEE) revert InvalidParam();
        interestRateModel = model;
        treasury = treasury_;
        reserveFactor = reserveFactor_;
        originationFee = originationFee_;
        minBorrow = minBorrow_;
        borrowIndex = WAD;
        lastAccrual = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ───────────────────────────── Interest ─────────────────────────────

    function accrueInterest() public {
        if (block.timestamp == lastAccrual) return;
        (uint256 borrows, uint256 reserves, uint256 index) = _pendingState();
        uint256 interest = borrows - totalBorrows;
        totalBorrows = borrows;
        totalReserves = reserves;
        borrowIndex = index;
        lastAccrual = block.timestamp;
        if (interest > 0) emit InterestAccrued(interest, index, borrows, reserves);
    }

    function _pendingState() internal view returns (uint256 borrows, uint256 reserves, uint256 index) {
        borrows = totalBorrows;
        reserves = totalReserves;
        index = borrowIndex;
        uint256 dt = block.timestamp - lastAccrual;
        if (dt == 0 || borrows == 0) return (borrows, reserves, index);
        uint256 factor = interestRateModel.getBorrowRate(totalCash, borrows, reserves) * dt;
        uint256 interest = borrows.mulDiv(factor, WAD);
        borrows += interest;
        reserves += interest.mulDiv(reserveFactor, WAD);
        index += index.mulDiv(factor, WAD);
    }

    // ───────────────────────────── ERC-4626 (lenders) ─────────────────────────────

    function totalAssets() public view override returns (uint256) {
        (uint256 borrows, uint256 reserves,) = _pendingState();
        uint256 gross = totalCash + borrows;
        return gross > reserves ? gross - reserves : 0;
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        accrueInterest();
        shares = super.deposit(assets, receiver);
        _emitSnapshot();
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        accrueInterest();
        assets = super.mint(shares, receiver);
        _emitSnapshot();
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        accrueInterest();
        shares = super.withdraw(assets, receiver, owner);
        _emitSnapshot();
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        accrueInterest();
        assets = super.redeem(shares, receiver, owner);
        _emitSnapshot();
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        if (supplyCap == 0) return type(uint256).max;
        uint256 ta = totalAssets();
        return ta >= supplyCap ? 0 : supplyCap - ta;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        if (maxAssets == type(uint256).max) return type(uint256).max;
        return _convertToShares(maxAssets, Math.Rounding.Floor);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(_convertToAssets(balanceOf(owner), Math.Rounding.Floor), totalCash);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return Math.min(balanceOf(owner), _convertToShares(totalCash, Math.Rounding.Floor));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (assets == 0 || shares == 0) revert ZeroAmount();
        super._deposit(caller, receiver, assets, shares);
        totalCash += assets;
        supplyPrincipal[receiver] += assets;
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        if (assets == 0 || shares == 0) revert ZeroAmount();
        if (assets > totalCash) revert InsufficientLiquidity();
        uint256 bal = balanceOf(owner);
        uint256 principalOut = bal == 0 ? 0 : supplyPrincipal[owner].mulDiv(shares, bal);
        supplyPrincipal[owner] -= principalOut;
        totalCash -= assets;
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /// @dev Share transfers carry a pro-rata slice of the sender's supplied principal so that
    ///      "earned interest = position value - principal" stays correct for both parties.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 0) {
            uint256 bal = balanceOf(from);
            uint256 moved = bal == 0 ? 0 : supplyPrincipal[from].mulDiv(value, bal);
            supplyPrincipal[from] -= moved;
            supplyPrincipal[to] += moved;
        }
        super._update(from, to, value);
    }

    // ───────────────────────────── Borrowing ─────────────────────────────

    /// @notice Opens/extends debt. Callable only by the market's BorrowManager after collateral checks.
    function borrow(address borrower, uint256 amount, address receiver)
        external
        onlyRole(BORROW_MANAGER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 fee)
    {
        accrueInterest();
        if (amount == 0) revert ZeroAmount();
        if (amount > totalCash) revert InsufficientLiquidity();
        fee = amount.mulDiv(originationFee, WAD, Math.Rounding.Ceil);
        uint256 increase = amount + fee;
        if (borrowCap != 0 && totalBorrows + increase > borrowCap) revert BorrowCapExceeded();
        uint256 newDebt = _borrowBalance(borrower, borrowIndex) + increase;
        if (newDebt < minBorrow) revert BelowMinBorrow();

        _borrows[borrower] = BorrowSnapshot({debt: newDebt, index: borrowIndex});
        borrowPrincipal[borrower] += increase;
        totalBorrows += increase;
        totalReserves += fee;
        totalCash -= amount;

        IERC20(asset()).safeTransfer(receiver, amount);
        emit Borrow(borrower, receiver, amount, fee, newDebt);
        _emitSnapshot();
    }

    /// @notice Repay `amount` (use type(uint256).max for full) of `borrower`'s debt from msg.sender.
    function repay(address borrower, uint256 amount) external nonReentrant returns (uint256) {
        accrueInterest();
        return _repay(msg.sender, borrower, amount);
    }

    /// @notice Repay on behalf of `payer` (who approved this pool). Market managers only.
    function repayFrom(address payer, address borrower, uint256 amount) external nonReentrant returns (uint256) {
        if (!hasRole(BORROW_MANAGER_ROLE, msg.sender) && !hasRole(LIQUIDATION_MANAGER_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        accrueInterest();
        return _repay(payer, borrower, amount);
    }

    function _repay(address payer, address borrower, uint256 amount) internal returns (uint256 repaid) {
        uint256 debt = _borrowBalance(borrower, borrowIndex);
        if (debt == 0) revert NoDebt();
        repaid = amount > debt ? debt : amount;
        if (repaid == 0) revert ZeroAmount();
        uint256 newDebt = debt - repaid;

        uint256 principal = borrowPrincipal[borrower];
        uint256 interestOwed = debt > principal ? debt - principal : 0;
        if (newDebt == 0) {
            borrowPrincipal[borrower] = 0;
        } else if (repaid > interestOwed) {
            uint256 principalPaid = repaid - interestOwed;
            borrowPrincipal[borrower] = principal > principalPaid ? principal - principalPaid : 0;
        }

        _borrows[borrower] = BorrowSnapshot({debt: newDebt, index: borrowIndex});
        totalBorrows = totalBorrows > repaid ? totalBorrows - repaid : 0;
        totalCash += repaid;

        IERC20(asset()).safeTransferFrom(payer, address(this), repaid);
        emit Repay(borrower, payer, repaid, newDebt);
        _emitSnapshot();
    }

    /// @notice Clears debt left on an account with no collateral after liquidation.
    ///         Reserves absorb the loss first; any remainder is socialized across lenders.
    function writeOffBadDebt(address borrower) external onlyRole(LIQUIDATION_MANAGER_ROLE) returns (uint256 debt) {
        accrueInterest();
        debt = _borrowBalance(borrower, borrowIndex);
        if (debt == 0) return 0;
        _borrows[borrower] = BorrowSnapshot({debt: 0, index: borrowIndex});
        borrowPrincipal[borrower] = 0;
        totalBorrows = totalBorrows > debt ? totalBorrows - debt : 0;
        uint256 covered = debt > totalReserves ? totalReserves : debt;
        totalReserves -= covered;
        uint256 socialized = debt - covered;
        totalBadDebt += socialized;
        emit BadDebtWrittenOff(borrower, debt, covered, socialized);
        _emitSnapshot();
    }

    // ───────────────────────────── Views ─────────────────────────────

    function borrowBalanceStored(address borrower) public view returns (uint256) {
        return _borrowBalance(borrower, borrowIndex);
    }

    function borrowBalanceCurrent(address borrower) public view returns (uint256) {
        (,, uint256 index) = _pendingState();
        return _borrowBalance(borrower, index);
    }

    function _borrowBalance(address borrower, uint256 index) internal view returns (uint256) {
        BorrowSnapshot memory s = _borrows[borrower];
        if (s.debt == 0) return 0;
        return s.debt.mulDiv(index, s.index, Math.Rounding.Ceil);
    }

    function utilization() public view returns (uint256) {
        (uint256 borrows, uint256 reserves,) = _pendingState();
        return interestRateModel.utilizationRate(totalCash, borrows, reserves);
    }

    function borrowRatePerYear() public view returns (uint256) {
        return interestRateModel.getBorrowRateAtUtilization(utilization());
    }

    function supplyRatePerYear() public view returns (uint256) {
        uint256 u = utilization();
        return interestRateModel.getBorrowRateAtUtilization(u).mulDiv(u, WAD).mulDiv(WAD - reserveFactor, WAD);
    }

    function getPoolState() external view returns (PoolState memory s) {
        (uint256 borrows, uint256 reserves, uint256 index) = _pendingState();
        s.totalCash = totalCash;
        s.totalBorrows = borrows;
        s.totalReserves = reserves;
        s.borrowIndex = index;
        s.totalAssets = totalAssets();
        s.totalSupply = totalSupply();
        s.utilization = interestRateModel.utilizationRate(totalCash, borrows, reserves);
        s.borrowRatePerYear = interestRateModel.getBorrowRateAtUtilization(s.utilization);
        s.supplyRatePerYear = s.borrowRatePerYear.mulDiv(s.utilization, WAD).mulDiv(WAD - reserveFactor, WAD);
        s.lastAccrual = lastAccrual;
    }

    function _emitSnapshot() internal {
        uint256 u = interestRateModel.utilizationRate(totalCash, totalBorrows, totalReserves);
        uint256 b = interestRateModel.getBorrowRateAtUtilization(u);
        uint256 s = b.mulDiv(u, WAD).mulDiv(WAD - reserveFactor, WAD);
        uint256 gross = totalCash + totalBorrows;
        emit PoolSnapshot(gross > totalReserves ? gross - totalReserves : 0, totalBorrows, totalCash, u, b, s);
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setInterestRateModel(IInterestRateModel model) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(model) == address(0)) revert ZeroAddress();
        accrueInterest();
        interestRateModel = model;
        emit InterestRateModelUpdated(address(model));
        _emitSnapshot();
    }

    function setRiskParams(
        uint256 reserveFactor_,
        uint256 originationFee_,
        uint256 supplyCap_,
        uint256 borrowCap_,
        uint256 minBorrow_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (reserveFactor_ > MAX_RESERVE_FACTOR || originationFee_ > MAX_ORIGINATION_FEE) revert InvalidParam();
        accrueInterest();
        reserveFactor = reserveFactor_;
        originationFee = originationFee_;
        supplyCap = supplyCap_;
        borrowCap = borrowCap_;
        minBorrow = minBorrow_;
        emit RiskParamsUpdated(reserveFactor_, originationFee_, supplyCap_, borrowCap_, minBorrow_);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function withdrawReserves(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        accrueInterest();
        if (amount == 0 || amount > totalReserves || amount > totalCash) revert InvalidParam();
        totalReserves -= amount;
        totalCash -= amount;
        IERC20(asset()).safeTransfer(treasury, amount);
        emit ReservesWithdrawn(treasury, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
