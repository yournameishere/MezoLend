// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {PermitLib} from "../src/libraries/PermitLib.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// @notice EIP-2612 flows: every action that pulls MUSD works in one transaction with a signature.
contract PermitTest is BaseTest {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    address internal dave;
    uint256 internal daveKey;
    address internal erin;
    uint256 internal erinKey;

    function setUp() public override {
        super.setUp();
        (dave, daveKey) = makeAddrAndKey("dave");
        (erin, erinKey) = makeAddrAndKey("erin");
        musd.mint(dave, 100_000e18);
        musd.mint(erin, 10_000e18);
        vm.deal(erin, 10 ether);
    }

    function _permit(uint256 key, address owner, address spender, uint256 value)
        internal
        view
        returns (PermitLib.Permit memory p)
    {
        p.value = value;
        p.deadline = block.timestamp + 1 hours;
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, musd.nonces(owner), p.deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        (p.v, p.r, p.s) = vm.sign(key, digest);
    }

    function _erinBorrows() internal {
        _supply(alice, 100_000e18);
        vm.prank(erin);
        bm.depositAndBorrow{value: 1 ether}(BTC, 1 ether, 20_000e18);
    }

    function test_DepositWithPermitInOneTransaction() public {
        assertEq(musd.allowance(dave, address(pool)), 0);
        PermitLib.Permit memory p = _permit(daveKey, dave, address(pool), 5_000e18);
        vm.prank(dave);
        uint256 shares = pool.depositWithPermit(5_000e18, dave, p);
        assertGt(shares, 0);
        assertEq(pool.balanceOf(dave), shares);
        assertEq(pool.totalCash(), 5_000e18);
        assertEq(musd.allowance(dave, address(pool)), 0);
    }

    function test_PermitFrontRunDoesNotBlockDeposit() public {
        PermitLib.Permit memory p = _permit(daveKey, dave, address(pool), 1_000e18);
        // someone copies the signature from the mempool and submits it first
        musd.permit(dave, address(pool), p.value, p.deadline, p.v, p.r, p.s);
        vm.prank(dave);
        pool.depositWithPermit(1_000e18, dave, p);
        assertEq(pool.totalCash(), 1_000e18);
    }

    function test_InvalidPermitReverts() public {
        PermitLib.Permit memory p = _permit(erinKey, dave, address(pool), 1_000e18); // signed by the wrong key
        vm.prank(dave);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(pool), 0, 1_000e18)
        );
        pool.depositWithPermit(1_000e18, dave, p);
    }

    function test_NoPermitFallsBackToAllowance() public {
        PermitLib.Permit memory none;
        vm.prank(alice); // alice approved the pool in setUp
        pool.depositWithPermit(1_000e18, alice, none);
        assertEq(pool.totalCash(), 1_000e18);
    }

    function test_RepayInFullWithPermit() public {
        _erinBorrows();
        vm.warp(block.timestamp + 30 days);
        uint256 debt = pool.borrowBalanceCurrent(erin);
        PermitLib.Permit memory p = _permit(erinKey, erin, address(pool), debt + debt / 1000);
        vm.prank(erin);
        uint256 repaid = pool.repayWithPermit(erin, type(uint256).max, p);
        assertEq(repaid, debt);
        assertEq(pool.borrowBalanceStored(erin), 0);
    }

    function test_RepayAndWithdrawWithPermit() public {
        _erinBorrows();
        vm.warp(block.timestamp + 7 days);
        uint256 debt = pool.borrowBalanceCurrent(erin);
        PermitLib.Permit memory p = _permit(erinKey, erin, address(pool), debt + 1e18);
        uint256 btcBefore = erin.balance;
        vm.prank(erin);
        bm.repayAndWithdrawWithPermit(type(uint256).max, BTC, type(uint256).max, p);
        assertEq(pool.borrowBalanceStored(erin), 0);
        assertEq(erin.balance - btcBefore, 1 ether);
        assertEq(bm.accountCount(), 0);
    }

    function test_LiquidateWithPermit() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 48_000e18);
        _setPrice(59_000e18);

        uint256 maxRepay = pool.borrowBalanceCurrent(bob) / 2;
        PermitLib.Permit memory p = _permit(daveKey, dave, address(pool), maxRepay + 1e18);
        vm.prank(dave);
        (uint256 repaid, uint256 seized) = lm.liquidateWithPermit(bob, BTC, type(uint256).max, 0, p);
        assertEq(repaid, maxRepay);
        assertEq(dave.balance, seized);
    }
}
