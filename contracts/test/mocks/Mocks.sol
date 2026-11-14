// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAggregatorV3, IPyth} from "../../src/interfaces/IExternal.sol";

contract MockERC20 is ERC20 {
    uint8 internal immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
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
