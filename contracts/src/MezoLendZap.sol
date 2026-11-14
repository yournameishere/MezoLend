// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MarketRegistry} from "./MarketRegistry.sol";
import {PermitLib} from "./libraries/PermitLib.sol";

/// @notice The parts of the Mezo Pools router (Velodrome-style) the zap uses.
interface IMezoPoolsRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IRepayablePool {
    function repay(address borrower, uint256 amount) external returns (uint256);
}

/// @title MezoLendZap
/// @notice Gets a new Mezo user from faucet BTC (or MEZO) to a working MezoLend position in one transaction.
///         Swaps through Mezo Pools into MUSD, then optionally supplies it to a market or repays a loan.
///         - BTC: send it as the transaction value (Mezo's gas token); no approval needed.
///         - MEZO, or BTC as its ERC-20: pulled with an EIP-2612 permit signature (both precompiles support it)
///           or an existing allowance.
///         The zap is stateless and has no owner: it never holds funds between transactions, only accepts
///         MezoLend markets listed in the registry, and enforces the caller's minimum MUSD output and deadline.
contract MezoLendZap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant BTC = 0x7b7C000000000000000000000000000000000000;

    IMezoPoolsRouter public immutable router;
    address public immutable poolFactory;
    IERC20 public immutable musd;
    MarketRegistry public immutable registry;
    address public immutable mezo;

    event Swapped(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 musdOut, address to);
    event SwappedAndSupplied(
        address indexed user, address indexed pool, address tokenIn, uint256 amountIn, uint256 musdIn, uint256 shares, address receiver
    );
    event SwappedAndRepaid(
        address indexed user,
        address indexed pool,
        address indexed borrower,
        address tokenIn,
        uint256 amountIn,
        uint256 musdOut,
        uint256 repaid,
        uint256 refunded
    );

    error UnsupportedToken();
    error UnknownMarket();
    error InvalidValue();
    error ZeroAmount();
    error InsufficientOutput();

    constructor(IMezoPoolsRouter router_, address poolFactory_, IERC20 musd_, MarketRegistry registry_, address mezo_) {
        router = router_;
        poolFactory = poolFactory_;
        musd = musd_;
        registry = registry_;
        mezo = mezo_;
    }

    // ───────────────────────────── Quotes ─────────────────────────────

    /// @notice MUSD out for `amountIn` of `tokenIn` at current Mezo Pools reserves (before slippage).
    function quote(address tokenIn, uint256 amountIn) external view returns (uint256) {
        _checkToken(tokenIn);
        uint256[] memory amounts = router.getAmountsOut(amountIn, _route(tokenIn));
        return amounts[amounts.length - 1];
    }

    // ───────────────────────────── Actions ─────────────────────────────

    /// @notice Swap BTC or MEZO for MUSD, sent to `to`.
    function swapToMusd(
        address tokenIn,
        uint256 amountIn,
        uint256 minMusdOut,
        address to,
        uint256 deadline,
        PermitLib.Permit calldata permit
    ) external payable nonReentrant returns (uint256 musdOut) {
        _pull(tokenIn, amountIn, permit);
        musdOut = _swap(tokenIn, amountIn, minMusdOut, deadline);
        musd.safeTransfer(to, musdOut);
        emit Swapped(msg.sender, tokenIn, amountIn, musdOut, to);
    }

    /// @notice Swap BTC or MEZO for MUSD and supply it to a MezoLend market; pool shares go to `receiver`.
    function swapAndSupply(
        address tokenIn,
        uint256 amountIn,
        uint256 minMusdOut,
        address pool,
        address receiver,
        uint256 deadline,
        PermitLib.Permit calldata permit
    ) external payable nonReentrant returns (uint256 shares) {
        _checkPool(pool);
        _pull(tokenIn, amountIn, permit);
        uint256 musdOut = _swap(tokenIn, amountIn, minMusdOut, deadline);
        musd.forceApprove(pool, musdOut);
        shares = IERC4626(pool).deposit(musdOut, receiver);
        emit SwappedAndSupplied(msg.sender, pool, tokenIn, amountIn, musdOut, shares, receiver);
    }

    /// @notice Swap BTC or MEZO for MUSD and repay `borrower`'s loan in a MezoLend market. MUSD left over after
    ///         the debt is cleared is sent back to the caller.
    function swapAndRepay(
        address tokenIn,
        uint256 amountIn,
        uint256 minMusdOut,
        address pool,
        address borrower,
        uint256 deadline,
        PermitLib.Permit calldata permit
    ) external payable nonReentrant returns (uint256 repaid, uint256 refunded) {
        _checkPool(pool);
        _pull(tokenIn, amountIn, permit);
        uint256 musdOut = _swap(tokenIn, amountIn, minMusdOut, deadline);
        musd.forceApprove(pool, musdOut);
        repaid = IRepayablePool(pool).repay(borrower, musdOut);
        refunded = musdOut - repaid;
        if (refunded > 0) {
            musd.forceApprove(pool, 0);
            musd.safeTransfer(msg.sender, refunded);
        }
        emit SwappedAndRepaid(msg.sender, pool, borrower, tokenIn, amountIn, musdOut, repaid, refunded);
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _pull(address tokenIn, uint256 amountIn, PermitLib.Permit calldata permit) internal {
        _checkToken(tokenIn);
        if (amountIn == 0) revert ZeroAmount();
        if (msg.value > 0) {
            // native BTC: Mezo exposes the same balance through the BTC ERC-20 precompile
            if (tokenIn != BTC || msg.value != amountIn) revert InvalidValue();
            return;
        }
        PermitLib.tryPermit(tokenIn, msg.sender, address(this), permit);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
    }

    function _swap(address tokenIn, uint256 amountIn, uint256 minMusdOut, uint256 deadline)
        internal
        returns (uint256 musdOut)
    {
        uint256 before = musd.balanceOf(address(this));
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        router.swapExactTokensForTokens(amountIn, minMusdOut, _route(tokenIn), address(this), deadline);
        musdOut = musd.balanceOf(address(this)) - before;
        if (musdOut == 0 || musdOut < minMusdOut) revert InsufficientOutput();
    }

    function _route(address tokenIn) internal view returns (IMezoPoolsRouter.Route[] memory routes) {
        routes = new IMezoPoolsRouter.Route[](1);
        routes[0] = IMezoPoolsRouter.Route({from: tokenIn, to: address(musd), stable: false, factory: poolFactory});
    }

    function _checkToken(address tokenIn) internal view {
        if (tokenIn != BTC && tokenIn != mezo) revert UnsupportedToken();
    }

    function _checkPool(address pool) internal view {
        MarketRegistry.Market[] memory markets = registry.getMarkets();
        for (uint256 i; i < markets.length; ++i) {
            if (markets[i].pool == pool && markets[i].active) return;
        }
        revert UnknownMarket();
    }
}
