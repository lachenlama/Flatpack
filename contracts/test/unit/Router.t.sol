// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Basket} from "../../src/Basket.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {ComponentRegistry} from "../../src/ComponentRegistry.sol";
import {FlatpackRouter} from "../../src/FlatpackRouter.sol";
import {DividendMode} from "../../src/interfaces/IBasket.sol";
import {IBasketFactory} from "../../src/interfaces/IBasketFactory.sol";
import {IFlatpackRouter} from "../../src/interfaces/IFlatpackRouter.sol";
import {UniswapV3Swapper} from "../../src/libraries/UniswapV3Swapper.sol";
import {IUniswapV3SwapCallback} from "../../src/interfaces/external/IExternal.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockHarvester} from "../mocks/MockHarvester.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockV3Factory} from "../mocks/MockV3Factory.sol";
import {MockVault} from "../mocks/MockVault.sol";

/// @notice Uniswap v3 pool stand-in: exact-output swaps only, USDG in, at a fixed `rate` (USDG units per 1e18 token).
contract MockV3Pool {
    address public immutable token0;
    address public immutable token1;
    address public immutable usdg;
    uint256 public immutable rate;
    bool public skipCallback;
    bool public revertOther;
    uint256 public shortBy;

    error Other();
    error NotPaid();

    constructor(address usdg_, address token_, uint256 rate_) {
        usdg = usdg_;
        rate = rate_;
        (token0, token1) = usdg_ < token_ ? (usdg_, token_) : (token_, usdg_);
    }

    function setSkipCallback(bool v) external {
        skipCallback = v;
    }

    function setRevertOther(bool v) external {
        revertOther = v;
    }

    function setShortBy(uint256 v) external {
        shortBy = v;
    }

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160,
        bytes calldata data
    ) external returns (int256 a0, int256 a1) {
        if (revertOther) revert Other();
        uint256 out = uint256(-amountSpecified);
        address tokenOut = zeroForOne ? token1 : token0;
        address tokenIn = zeroForOne ? token0 : token1;
        uint256 bal = IERC20(tokenOut).balanceOf(address(this));
        if (out > bal) out = bal; // partial fill when the pool is shallow
        uint256 inAmt = (out * rate + 1e18 - 1) / 1e18;
        IERC20(tokenOut).transfer(recipient, out - shortBy);
        (a0, a1) = zeroForOne ? (int256(inAmt), -int256(out)) : (-int256(out), int256(inAmt));
        if (skipCallback) return (a0, a1);
        uint256 before = IERC20(tokenIn).balanceOf(address(this));
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(a0, a1, data);
        if (IERC20(tokenIn).balanceOf(address(this)) < before + inAmt) revert NotPaid();
    }
}

contract FakeCaller {
    function call(address target, bytes calldata data) external {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

contract RouterTest is Test {
    uint256 internal constant SHARES = 10e18;
    uint256 internal constant COST_A = 1000e6; // 10 tokens at 100 USDG
    uint256 internal constant COST_B = 1500e6; // 30 tokens at 50 USDG
    uint256 internal constant COST = COST_A + COST_B;

    ComponentRegistry internal reg;
    MockV3Factory internal v3;
    MockERC20 internal usdg;
    MockERC20 internal wif;
    MockVault internal vault;
    MockHarvester internal harv;
    BasketFactory internal factory;
    FlatpackRouter internal router;
    Basket internal basket;
    MockStockToken internal tokA;
    MockStockToken internal tokB;
    MockV3Pool internal poolA;
    MockV3Pool internal poolB;

    address internal owner = makeAddr("owner");
    address internal curator = makeAddr("curator");
    address internal buyer = makeAddr("buyer");
    address internal receiver = makeAddr("receiver");

    function setUp() public {
        usdg = new MockERC20("USDG", "USDG", 6);
        wif = new MockERC20("WIF", "WIF", 18);
        v3 = new MockV3Factory();
        reg = new ComponentRegistry(owner, address(usdg), address(v3));
        vault = new MockVault(address(wif));
        harv = new MockHarvester();
        factory = new BasketFactory(
            owner,
            address(reg),
            address(harv),
            address(vault),
            address(wif),
            address(new Basket()),
            0
        );
        router = new FlatpackRouter(address(factory), address(reg));

        MockStockToken x = new MockStockToken("A", "A");
        MockStockToken y = new MockStockToken("B", "B");
        (tokA, tokB) = address(x) < address(y) ? (x, y) : (y, x);
        poolA = new MockV3Pool(address(usdg), address(tokA), 100e6);
        poolB = new MockV3Pool(address(usdg), address(tokB), 50e6);
        MockAggregator feed = new MockAggregator(1e8);
        v3.setPool(address(usdg), address(tokA), 500, address(poolA));
        v3.setPool(address(usdg), address(tokB), 500, address(poolB));
        vm.startPrank(owner);
        reg.setComponent(address(tokA), true, address(feed), 500);
        reg.setComponent(address(tokB), true, address(feed), 500);
        vm.stopPrank();
        tokA.mint(address(poolA), 1_000_000e18);
        tokB.mint(address(poolB), 1_000_000e18);

        IBasketFactory.CreateParams memory p;
        p.name = "Two";
        p.symbol = "TWO";
        p.tokens = new address[](2);
        p.tokens[0] = address(tokA);
        p.tokens[1] = address(tokB);
        p.rawUnits = new uint256[](2);
        p.rawUnits[0] = 1e18;
        p.rawUnits[1] = 3e18;
        p.mode = DividendMode.Reinvest;
        vm.prank(curator);
        basket = Basket(factory.createBasket(p, 0));

        usdg.mint(buyer, 100_000e6);
        vm.prank(buyer);
        usdg.approve(address(router), type(uint256).max);
    }

    function _params(uint256 shares, uint256 maxIn) internal view returns (IFlatpackRouter.BuyParams memory) {
        return IFlatpackRouter.BuyParams(address(basket), shares, maxIn, receiver, address(0), block.timestamp + 1);
    }

    function _assertRouterEmpty() internal view {
        assertEq(usdg.balanceOf(address(router)), 0, "INV-3 usdg");
        assertEq(tokA.balanceOf(address(router)), 0, "INV-3 A");
        assertEq(tokB.balanceOf(address(router)), 0, "INV-3 B");
    }

    // ------------------------------------------------------------ constructor / getters
    function test_U_R00_constructorAndGetters() public {
        assertEq(router.factory(), address(factory));
        assertEq(router.registry(), address(reg));
        assertEq(router.usdg(), address(usdg));
        vm.expectRevert(FlatpackRouter.ZeroAddress.selector);
        new FlatpackRouter(address(0), address(reg));
        vm.expectRevert(FlatpackRouter.ZeroAddress.selector);
        new FlatpackRouter(address(factory), address(0));
    }

    // ------------------------------------------------------------ buy
    function test_U_R01_buyHappyPath() public {
        uint256 maxIn = COST + 777e6;
        uint256 fee = (SHARES * 30) / 10_000;
        vm.expectEmit(true, true, true, true, address(router));
        emit IFlatpackRouter.Bought(address(basket), buyer, receiver, address(0), SHARES, SHARES - fee, COST);
        vm.prank(buyer);
        (uint256 sharesOut, uint256 spent) = router.buy(_params(SHARES, maxIn));

        assertEq(sharesOut, SHARES - fee);
        assertEq(spent, COST);
        assertEq(basket.balanceOf(receiver), SHARES - fee);
        assertEq(basket.balanceOf(address(harv)), fee);
        assertEq(usdg.balanceOf(buyer), 100_000e6 - COST, "unused USDG refunded");
        assertEq(tokA.balanceOf(address(basket)), 10e18);
        assertEq(tokB.balanceOf(address(basket)), 30e18);
        assertEq(tokA.allowance(address(router), address(basket)), 0);
        assertEq(tokB.allowance(address(router), address(basket)), 0);
        _assertRouterEmpty();
    }

    function test_U_R01b_exactBudgetNoRefund() public {
        vm.prank(buyer);
        (, uint256 spent) = router.buy(_params(SHARES, COST));
        assertEq(spent, COST);
        assertEq(usdg.balanceOf(buyer), 100_000e6 - COST);
        _assertRouterEmpty();
    }

    function test_U_R02_expiredNotBasketExcessive() public {
        vm.startPrank(buyer);
        IFlatpackRouter.BuyParams memory p = _params(SHARES, COST);
        p.deadline = block.timestamp - 1;
        vm.expectRevert(IFlatpackRouter.Expired.selector);
        router.buy(p);

        p = _params(SHARES, COST);
        p.basket = address(0xBEEF);
        vm.expectRevert(IFlatpackRouter.NotBasket.selector);
        router.buy(p);

        // first hop already above the budget (balance check in the callback)
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.ExcessiveInput.selector, COST_A, 500e6));
        router.buy(_params(SHARES, 500e6));
        // second hop above the remaining budget
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.ExcessiveInput.selector, COST, COST - 1));
        router.buy(_params(SHARES, COST - 1));
        vm.stopPrank();
    }

    function test_U_R02b_finalSpentCheck() public {
        // a pool that quotes slightly more than it transfers cannot slip past the final budget check: here the
        // budget is fine for the pool callbacks but a donated balance does not extend it
        usdg.mint(address(router), 10_000e6);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.ExcessiveInput.selector, COST_A + COST_B, COST - 1));
        router.buy(_params(SHARES, COST - 1));
    }

    function test_U_R02c_disabledAndMissingPool() public {
        vm.prank(owner);
        reg.setComponent(address(tokB), false, address(0), 0);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.ComponentDisabled.selector, address(tokB)));
        router.buy(_params(SHARES, COST));

        // re-enable, then the pool disappears from the v3 factory
        MockAggregator feed = new MockAggregator(1e8);
        vm.prank(owner);
        reg.setComponent(address(tokB), true, address(feed), 500);
        v3.setPool(address(usdg), address(tokB), 500, address(0));
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.PoolNotFound.selector, address(tokB)));
        router.buy(_params(SHARES, COST));
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.PoolNotFound.selector, address(tokB)));
        router.quoteBuy(address(basket), SHARES);
    }

    function test_U_R02d_incompleteFill() public {
        // shallow pool: only 5 of the 30 tokens B available
        MockV3Pool shallow = new MockV3Pool(address(usdg), address(tokB), 50e6);
        tokB.mint(address(shallow), 5e18);
        v3.setPool(address(usdg), address(tokB), 500, address(shallow));
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.IncompleteFill.selector, address(tokB), 5e18, 30e18));
        router.buy(_params(SHARES, COST));
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.IncompleteFill.selector, address(tokB), 5e18, 30e18));
        router.quoteBuy(address(basket), SHARES);
    }

    function test_U_R02e_poolDeliversLessThanReported() public {
        poolA.setShortBy(1);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(IFlatpackRouter.IncompleteFill.selector, address(tokA), 10e18 - 1, 10e18)
        );
        router.buy(_params(SHARES, COST));
    }

    function test_U_R02f_poolWithWrongPairReverts() public {
        // the factory returns a pool that is not the (USDG, tokB) pair
        v3.setPool(address(usdg), address(tokB), 500, address(poolA));
        vm.prank(buyer);
        vm.expectRevert(UniswapV3Swapper.V3BadPair.selector);
        router.buy(_params(SHARES, COST));
        // pool whose token0 is neither side
        MockV3Pool other = new MockV3Pool(address(wif), address(tokB), 1e18);
        v3.setPool(address(usdg), address(tokB), 500, address(other));
        vm.prank(buyer);
        vm.expectRevert(UniswapV3Swapper.V3BadPair.selector);
        router.buy(_params(SHARES, COST));
    }

    function test_U_R02g_revertingPoolBubblesAndLeavesNothing() public {
        poolB.setRevertOther(true);
        vm.prank(buyer);
        vm.expectRevert(MockV3Pool.Other.selector);
        router.buy(_params(SHARES, COST));
        _assertRouterEmpty();
    }

    // ------------------------------------------------------------ callback authentication
    function test_U_R03_spoofedCallbacksRevert() public {
        bytes memory data = abi.encode(address(usdg));
        // an EOA
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(IFlatpackRouter.UnexpectedCallback.selector);
        router.uniswapV3SwapCallback(int256(1e6), -int256(1), data);
        // a contract pretending to be a pool
        FakeCaller fake = new FakeCaller();
        vm.expectRevert(IFlatpackRouter.UnexpectedCallback.selector);
        fake.call(
            address(router),
            abi.encodeCall(IUniswapV3SwapCallback.uniswapV3SwapCallback, (int256(1e6), -int256(1), data))
        );
        // a legitimate registered pool, but outside a swap in progress
        vm.prank(address(poolA));
        vm.expectRevert(IFlatpackRouter.UnexpectedCallback.selector);
        router.uniswapV3SwapCallback(int256(1e6), -int256(1), data);
        // zero address (no swap in progress means the stored pool is 0): cannot be impersonated
        vm.prank(address(0));
        vm.expectRevert(IFlatpackRouter.UnexpectedCallback.selector);
        router.uniswapV3SwapCallback(int256(1e6), -int256(1), data);
    }

    // ------------------------------------------------------------ quote
    function _quote(uint256 shares) internal returns (uint256 usdgIn) {
        (bool ok, bytes memory ret) = address(router).call(
            abi.encodeCall(IFlatpackRouter.quoteBuy, (address(basket), shares))
        );
        assertFalse(ok);
        require(ret.length == 36 && bytes4(ret) == IFlatpackRouter.QuoteResult.selector, "bad quote data");
        assembly {
            usdgIn := mload(add(ret, 0x24))
        }
    }

    function test_U_R04_quoteMatchesBuyAndNeedsNoUsdg() public {
        vm.prank(makeAddr("anyone")); // no USDG, no approvals
        uint256 quoted = _quote(SHARES);
        assertEq(quoted, COST);
        vm.prank(buyer);
        (, uint256 spent) = router.buy(_params(SHARES, quoted));
        assertEq(spent, quoted);
        // a second quote works (transient flags were cleaned up) and nothing moved
        assertEq(_quote(SHARES), COST);
        _assertRouterEmpty();

        vm.expectRevert(IFlatpackRouter.NotBasket.selector);
        router.quoteBuy(address(0xBEEF), SHARES);
    }

    function test_U_R04b_quoteAgainstMisbehavingPools() public {
        poolA.setSkipCallback(true);
        vm.expectRevert(UniswapV3Swapper.V3QuoteFailed.selector);
        router.quoteBuy(address(basket), SHARES);
        poolA.setSkipCallback(false);

        poolA.setRevertOther(true);
        vm.expectRevert(UniswapV3Swapper.V3QuoteFailed.selector);
        router.quoteBuy(address(basket), SHARES);
        poolA.setRevertOther(false);

        vm.prank(owner);
        reg.setComponent(address(tokA), false, address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.ComponentDisabled.selector, address(tokA)));
        router.quoteBuy(address(basket), SHARES);
    }
}
