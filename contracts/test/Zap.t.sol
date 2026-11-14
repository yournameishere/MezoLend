// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {MezoLendZap, IMezoPoolsRouter} from "../src/MezoLendZap.sol";
import {PermitLib} from "../src/libraries/PermitLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20, MockBtcPrecompile, MockPoolsRouter} from "./mocks/Mocks.sol";

/// @notice Mezo Pools zap: faucet BTC or MEZO to MUSD, a supply position or a repaid loan in one transaction.
contract ZapTest is BaseTest {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    MockERC20 internal mezo;
    MockPoolsRouter internal router;
    MezoLendZap internal zap;
    address internal frank;
    uint256 internal frankKey;
    PermitLib.Permit internal none;

    function setUp() public override {
        super.setUp();
        vm.etch(BTC, address(new MockBtcPrecompile()).code);
        mezo = new MockERC20("MEZO", "MEZO", 18);
        router = new MockPoolsRouter(musd);
        router.setPrice(BTC, 78_000e18);
        router.setPrice(address(mezo), 0.44e18);
        zap = new MezoLendZap(
            IMezoPoolsRouter(address(router)), makeAddr("factory"), IERC20(address(musd)), registry, address(mezo)
        );
        (frank, frankKey) = makeAddrAndKey("frank");
        mezo.mint(frank, 10_000e18);
        vm.deal(frank, 1 ether);
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 20 minutes;
    }

    function _mezoPermit(uint256 value) internal view returns (PermitLib.Permit memory p) {
        p.value = value;
        p.deadline = _deadline();
        bytes32 h = keccak256(abi.encode(PERMIT_TYPEHASH, frank, address(zap), value, mezo.nonces(frank), p.deadline));
        (p.v, p.r, p.s) = vm.sign(frankKey, keccak256(abi.encodePacked("\x19\x01", mezo.DOMAIN_SEPARATOR(), h)));
    }

    function _assertZapEmpty() internal view {
        assertEq(musd.balanceOf(address(zap)), 0);
        assertEq(address(zap).balance, 0);
        assertEq(mezo.balanceOf(address(zap)), 0);
        assertEq(musd.allowance(address(zap), address(pool)), 0);
    }

    function test_QuoteMatchesRouter() public view {
        assertEq(zap.quote(BTC, 0.01 ether), 780e18);
        assertEq(zap.quote(address(mezo), 100e18), 44e18);
    }

    function test_SwapBtcForMusdWithoutApproval() public {
        vm.prank(frank);
        uint256 out = zap.swapToMusd{value: 0.01 ether}(BTC, 0.01 ether, 779e18, frank, _deadline(), none);
        assertEq(out, 780e18);
        assertEq(musd.balanceOf(frank), 780e18);
        assertEq(frank.balance, 0.99 ether);
        _assertZapEmpty();
    }

    function test_SwapAndSupplyBtcInOneTransaction() public {
        vm.prank(frank);
        uint256 shares =
            zap.swapAndSupply{value: 0.01 ether}(BTC, 0.01 ether, 0, address(pool), frank, _deadline(), none);
        assertGt(shares, 0);
        assertEq(pool.balanceOf(frank), shares);
        assertEq(pool.totalCash(), 780e18);
        assertEq(pool.supplyPrincipal(frank), 780e18);
        _assertZapEmpty();
    }

    function test_SwapAndSupplyMezoWithPermit() public {
        PermitLib.Permit memory p = _mezoPermit(1_000e18);
        vm.prank(frank);
        uint256 shares = zap.swapAndSupply(address(mezo), 1_000e18, 440e18, address(pool), frank, _deadline(), p);
        assertEq(pool.convertToAssets(shares), 440e18);
        assertEq(mezo.balanceOf(frank), 9_000e18);
        _assertZapEmpty();
    }

    function test_SwapAndRepayRefundsExcess() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 500e18); // debt 500.5
        uint256 musdBefore = musd.balanceOf(bob);
        vm.prank(bob);
        (uint256 repaid, uint256 refunded) =
            zap.swapAndRepay{value: 0.01 ether}(BTC, 0.01 ether, 0, address(pool), bob, _deadline(), none);
        assertEq(repaid, 500.5e18);
        assertEq(refunded, 780e18 - 500.5e18);
        assertEq(pool.borrowBalanceStored(bob), 0);
        assertEq(musd.balanceOf(bob) - musdBefore, refunded);
        _assertZapEmpty();
    }

    function test_AnyoneCanRepayPartiallyForABorrower() public {
        _supply(alice, 100_000e18);
        _depositBtc(bob, 1 ether);
        _borrow(bob, 10_000e18);
        vm.prank(frank);
        (uint256 repaid, uint256 refunded) =
            zap.swapAndRepay{value: 0.01 ether}(BTC, 0.01 ether, 0, address(pool), bob, _deadline(), none);
        assertEq(repaid, 780e18);
        assertEq(refunded, 0);
        assertEq(pool.borrowBalanceStored(bob), 10_010e18 - 780e18);
        _assertZapEmpty();
    }

    function test_RevertWhenOutputBelowMinimum() public {
        vm.prank(frank);
        vm.expectRevert("Router: INSUFFICIENT_OUTPUT_AMOUNT");
        zap.swapToMusd{value: 0.01 ether}(BTC, 0.01 ether, 781e18, frank, _deadline(), none);
    }

    function test_RevertAfterDeadline() public {
        uint256 d = block.timestamp - 1;
        vm.prank(frank);
        vm.expectRevert("Router: EXPIRED");
        zap.swapToMusd{value: 0.01 ether}(BTC, 0.01 ether, 0, frank, d, none);
    }

    function test_RevertUnknownMarket() public {
        address fakePool = makeAddr("fakePool");
        vm.prank(frank);
        vm.expectRevert(MezoLendZap.UnknownMarket.selector);
        zap.swapAndSupply{value: 0.01 ether}(BTC, 0.01 ether, 0, fakePool, frank, _deadline(), none);
    }

    function test_RevertInactiveMarket() public {
        vm.prank(admin);
        registry.setMarketActive(0, false);
        vm.prank(frank);
        vm.expectRevert(MezoLendZap.UnknownMarket.selector);
        zap.swapAndSupply{value: 0.01 ether}(BTC, 0.01 ether, 0, address(pool), frank, _deadline(), none);
    }

    function test_RevertUnsupportedToken() public {
        vm.expectRevert(MezoLendZap.UnsupportedToken.selector);
        zap.swapToMusd(address(musd), 1e18, 0, frank, _deadline(), none);
    }

    function test_RevertValueMismatch() public {
        vm.prank(frank);
        vm.expectRevert(MezoLendZap.InvalidValue.selector);
        zap.swapToMusd{value: 0.01 ether}(BTC, 0.02 ether, 0, frank, _deadline(), none);

        address mezoToken = address(mezo);
        vm.prank(frank);
        vm.expectRevert(MezoLendZap.InvalidValue.selector);
        zap.swapToMusd{value: 0.01 ether}(mezoToken, 0.01 ether, 0, frank, _deadline(), none);
    }

    function test_BtcAsErc20WithAllowance() public {
        vm.startPrank(frank);
        IERC20(BTC).approve(address(zap), 0.005 ether);
        uint256 out = zap.swapToMusd(BTC, 0.005 ether, 0, frank, _deadline(), none);
        vm.stopPrank();
        assertEq(out, 390e18);
        assertEq(frank.balance, 0.995 ether);
        _assertZapEmpty();
    }

    function testFuzz_ZapNeverKeepsFunds(uint96 amount) public {
        uint256 a = bound(amount, 1e12, 0.5 ether);
        vm.prank(frank);
        zap.swapAndSupply{value: a}(BTC, a, 0, address(pool), frank, _deadline(), none);
        _assertZapEmpty();
    }
}
