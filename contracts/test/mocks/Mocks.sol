// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IAggregatorV3, IPyth} from "../../src/interfaces/IExternal.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";

/// @dev Stand-in for Mezo's BTC ERC-20 precompile (0x7b7c...0000): balances ARE native BTC balances.
///      Etched at the BTC address in tests; moves native balance with cheatcodes like the real precompile.
contract MockBtcPrecompile {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function balanceOf(address a) external view returns (uint256) {
        return a.balance;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "BTC: allowance");
        allowance[from][msg.sender] = a - value;
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal {
        require(from.balance >= value, "BTC: balance");
        VM.deal(from, from.balance - value);
        VM.deal(to, to.balance + value);
    }
}

/// @dev Mezo Pools router stand-in with a fixed MUSD price per input token.
contract MockPoolsRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    MockERC20 public immutable musd;
    mapping(address => uint256) public price; // MUSD per 1e18 of input

    constructor(MockERC20 musd_) {
        musd = musd_;
    }

    function setPrice(address token, uint256 p) external {
        price[token] = p;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) public view returns (uint256[] memory a) {
        require(routes.length == 1 && routes[0].to == address(musd), "route");
        a = new uint256[](2);
        a[0] = amountIn;
        a[1] = amountIn * price[routes[0].from] / 1e18;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory a) {
        require(block.timestamp <= deadline, "Router: EXPIRED");
        a = getAmountsOut(amountIn, routes);
        require(a[1] >= amountOutMin, "Router: INSUFFICIENT_OUTPUT_AMOUNT");
        require(IERC20(routes[0].from).transferFrom(msg.sender, address(this), amountIn), "pull");
        musd.mint(to, a[1]);
    }
}

/// @dev ERC-20 with EIP-2612 permit (domain name = token name, version "1"), like MUSD on Mezo.
contract MockERC20 is ERC20Permit {
    uint8 internal immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) ERC20Permit(n) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockAggregator is IAggregatorV3 {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public round;
    bool public shouldRevert;

    constructor(uint8 d, int256 a) {
        decimals = d;
        set(a);
    }

    function set(int256 a) public {
        answer = a;
        updatedAt = block.timestamp;
        round++;
    }

    function setUpdatedAt(uint256 t) external {
        updatedAt = t;
    }

    function setRevert(bool r) external {
        shouldRevert = r;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "feed down");
        return (round, answer, updatedAt, updatedAt, 0);
    }
}

contract MockPyth is IPyth {
    mapping(bytes32 => Price) internal _prices;

    function set(bytes32 id, int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        _prices[id] = Price(price, conf, expo, publishTime);
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        return _prices[id];
    }
}
