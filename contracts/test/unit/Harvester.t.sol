// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Basket} from "../../src/Basket.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {ComponentRegistry} from "../../src/ComponentRegistry.sol";
import {FeeHarvester} from "../../src/FeeHarvester.sol";
import {DividendMode} from "../../src/interfaces/IBasket.sol";
import {IBasketFactory} from "../../src/interfaces/IBasketFactory.sol";
import {IFeeHarvester} from "../../src/interfaces/IFeeHarvester.sol";
import {IUniswapV3SwapCallback} from "../../src/interfaces/external/IExternal.sol";
import {UniswapV4WifSwapper} from "../../src/libraries/UniswapV4WifSwapper.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockV3Factory} from "../mocks/MockV3Factory.sol";

/// @notice WETH9 stand-in: withdraw pays with `transfer` (2300 gas stipend), like the original WETH9.
contract MockWETH is MockERC20 {
    constructor() MockERC20("WETH", "WETH", 18) {}

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
    }

    receive() external payable {}
}

/// @notice v3 pool stand-in supporting exact-input swaps at a fixed rate: out = in * num / den.
contract MockInPool {
    address public immutable token0;
    address public immutable token1;
    address public immutable tokenIn;
    uint256 public immutable num;
    uint256 public immutable den;
    uint256 public extraOwed;

    constructor(address tokenIn_, address tokenOut_, uint256 num_, uint256 den_) {
        tokenIn = tokenIn_;
        num = num_;
        den = den_;
        (token0, token1) = tokenIn_ < tokenOut_ ? (tokenIn_, tokenOut_) : (tokenOut_, tokenIn_);
    }

    function setExtraOwed(uint256 v) external {
        extraOwed = v;
    }

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160,
        bytes calldata data
    ) external returns (int256 a0, int256 a1) {
        uint256 inAmt = uint256(amountSpecified);
        uint256 out = (inAmt * num) / den;
        address tIn = zeroForOne ? token0 : token1;
        address tOut = zeroForOne ? token1 : token0;
        IERC20(tOut).transfer(recipient, out);
        int256 owed = int256(inAmt + extraOwed);
        (a0, a1) = zeroForOne ? (owed, -int256(out)) : (-int256(out), owed);
        uint256 before = IERC20(tIn).balanceOf(address(this));
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(a0, a1, data);
        require(IERC20(tIn).balanceOf(address(this)) >= before + inAmt, "unpaid");
    }
}

/// @notice Uniswap v4 PoolManager stand-in for the ETH -> WIF pool with a hook cut of `taxBps` on the output.
contract MockPoolManager {
    IERC20 public immutable wif;
    uint256 public immutable wifPerEth; // 1e18-scaled
    uint256 public taxBps;
    bool public partial_;
    uint256 public settled;

    constructor(address wif_, uint256 wifPerEth_, uint256 taxBps_) {
        wif = IERC20(wif_);
        wifPerEth = wifPerEth_;
        taxBps = taxBps_;
    }

    function setPartial(bool v) external {
        partial_ = v;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory, SwapParams memory params, bytes calldata) external view returns (BalanceDelta) {
        require(params.zeroForOne, "dir");
        uint256 ethIn = uint256(-params.amountSpecified);
        uint256 consumed = partial_ ? ethIn / 2 : ethIn;
        uint256 out = (((consumed * wifPerEth) / 1e18) * (10_000 - taxBps)) / 10_000;
        return toBalanceDelta(-int128(int256(consumed)), int128(int256(out)));
    }

    function settle() external payable returns (uint256) {
        settled += msg.value;
        return msg.value;
    }

    function take(Currency, address to, uint256 amount) external {
        wif.transfer(to, amount);
    }
}

/// @notice Records queueRewards (pulling the $WIF like the real vault) and tolerates registration calls.
contract VaultSink {
    IERC20 public immutable wif;
    uint256 public backers;
    uint256 public curator;
    uint256 public calls;

    constructor(address wif_) {
        wif = IERC20(wif_);
    }

    function registerBasket(address, address) external {}

    function stakeFor(address, address, uint256) external {}

    function queueRewards(address, uint256 b, uint256 c) external {
        wif.transferFrom(msg.sender, address(this), b + c);
        backers += b;
        curator += c;
        calls++;
    }
}

contract HarvesterTest is Test {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant SHARES = 100e18;
    uint256 internal constant FEE = (SHARES * 30) / 10_000; // 0.3e18 fee shares
    // redeeming the fee shares pays 0.3 A (100 USDG each) + 0.9 B (50 USDG each) = 75 USDG
    // 75 USDG -> 0.0375 WETH (5e8 WETH wei per USDG unit) -> 37.5 WIF at 1000 WIF/ETH -> 1% hook cut
    uint256 internal constant WIF_OUT = 37.125e18;

    MockERC20 internal usdg;
    MockERC20 internal wif;
    MockWETH internal weth;
    MockV3Factory internal v3;
    ComponentRegistry internal reg;
    MockStockToken internal tokA;
    MockStockToken internal tokB;
    MockInPool internal poolA;
    MockInPool internal poolB;
    MockInPool internal poolUW;
    MockPoolManager internal pm;
    VaultSink internal sink;
    FeeHarvester internal harv;
    BasketFactory internal factory;
    Basket internal basket;

    address internal owner = makeAddr("owner");
    address internal curator = makeAddr("curator");
    address internal minter = makeAddr("minter");
    address internal holder = makeAddr("holder");
    address internal ref = makeAddr("ref");
    address internal ref2 = makeAddr("ref2");

    function setUp() public {
        usdg = new MockERC20("USDG", "USDG", 6);
        wif = new MockERC20("WIF", "WIF", 18);
        weth = new MockWETH();
        v3 = new MockV3Factory();
        reg = new ComponentRegistry(owner, address(usdg), address(v3));
        sink = new VaultSink(address(wif));

        MockStockToken x = new MockStockToken("A", "A");
        MockStockToken y = new MockStockToken("B", "B");
        (tokA, tokB) = address(x) < address(y) ? (x, y) : (y, x);
        poolA = new MockInPool(address(tokA), address(usdg), 100e6, 1e18);
        poolB = new MockInPool(address(tokB), address(usdg), 50e6, 1e18);
        poolUW = new MockInPool(address(usdg), address(weth), 5e8, 1);
        pm = new MockPoolManager(address(wif), 1000e18, 100);
        usdg.mint(address(poolA), 1e15);
        usdg.mint(address(poolB), 1e15);
        weth.mint(address(poolUW), 1e24);
        vm.deal(address(weth), 1_000 ether);
        wif.mint(address(pm), 1e30);

        v3.setPool(address(tokA), address(usdg), 500, address(poolA));
        v3.setPool(address(tokB), address(usdg), 3000, address(poolB));
        MockAggregator feed = new MockAggregator(1e8);
        vm.startPrank(owner);
        reg.setComponent(address(tokA), true, address(feed), 500);
        reg.setComponent(address(tokB), true, address(feed), 3000);
        harv = new FeeHarvester(
            owner,
            address(reg),
            address(usdg),
            address(weth),
            address(wif),
            address(poolUW),
            address(pm),
            _key()
        );
        factory = new BasketFactory(
            owner,
            address(reg),
            address(harv),
            address(sink),
            address(wif),
            address(new Basket()),
            0
        );
        harv.setFactory(address(factory));
        vm.stopPrank();
        basket = _newBasket(DividendMode.Reinvest);
    }

    function _key() internal returns (PoolKey memory) {
        return
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(address(wif)),
                fee: 0,
                tickSpacing: 200,
                hooks: IHooks(makeAddr("hook"))
            });
    }

    function _newBasket(DividendMode mode) internal returns (Basket b) {
        IBasketFactory.CreateParams memory p;
        p.name = "Two";
        p.symbol = "TWO";
        p.tokens = new address[](2);
        p.tokens[0] = address(tokA);
        p.tokens[1] = address(tokB);
        p.rawUnits = new uint256[](2);
        p.rawUnits[0] = 1e18;
        p.rawUnits[1] = 3e18;
        p.mode = mode;
        vm.prank(curator);
        b = Basket(factory.createBasket(p, 0));
    }

    function _mint(Basket b, uint256 shares, address to, address referrer) internal {
        tokA.mint(minter, (shares * 1e18) / 1e18);
        tokB.mint(minter, (shares * 3e18) / 1e18);
        vm.startPrank(minter);
        tokA.approve(address(b), type(uint256).max);
        tokB.approve(address(b), type(uint256).max);
        b.mint(shares, to, referrer);
        vm.stopPrank();
    }

    function _harvest(Basket b) internal returns (uint256) {
        vm.prank(owner);
        return harv.harvestFees(address(b), 0, block.timestamp + 1);
    }

    function _emptyCheck() internal view {
        assertEq(usdg.balanceOf(address(harv)), 0);
        assertEq(weth.balanceOf(address(harv)), 0);
        assertEq(tokA.balanceOf(address(harv)), 0);
        assertEq(tokB.balanceOf(address(harv)), 0);
        assertEq(address(harv).balance, 0);
    }

    // ------------------------------------------------------------ harvest + split
    function test_U_H01_harvestSplitExact() public {
        _mint(basket, SHARES, holder, ref);
        assertEq(harv.pendingFeeShares(address(basket)), FEE);

        uint256 wifOut = _harvest(basket);
        assertEq(wifOut, WIF_OUT, "real swap path numbers");

        uint256 toRef = (wifOut * ((FEE * 1000) / 10_000)) / FEE; // 10% of W
        uint256 burn = wifOut / 2;
        uint256 rest = wifOut - burn - toRef;
        uint256 backers = (rest * 3000) / 5000;
        assertEq(wif.balanceOf(DEAD), burn, "burn");
        assertEq(sink.backers(), backers, "backers");
        assertEq(sink.curator(), rest - backers, "curator");
        assertEq(wif.balanceOf(address(harv)), toRef, "referrers");
        // INV-8
        assertEq(wif.balanceOf(DEAD) + sink.backers() + sink.curator() + wif.balanceOf(address(harv)), wifOut);
        assertEq(wif.allowance(address(harv), address(sink)), 0, "approval reset");
        assertEq(harv.currentCycle(address(basket)), 1);
        assertEq(harv.pendingFeeShares(address(basket)), 0);
        _emptyCheck();

        // referral claim (INV-6) and views
        (uint256 refShares, uint256 claimable, bool claimed) = harv.referralOf(address(basket), 0, ref);
        assertEq(refShares, (FEE * 1000) / 10_000);
        assertEq(claimable, toRef);
        assertFalse(claimed);
        uint256[] memory cycles = new uint256[](1);
        vm.prank(ref);
        assertEq(harv.claimReferral(address(basket), cycles, ref), toRef);
        vm.prank(ref);
        vm.expectRevert(abi.encodeWithSelector(IFeeHarvester.AlreadyClaimed.selector, 0));
        harv.claimReferral(address(basket), cycles, ref);
        cycles[0] = 1;
        vm.prank(ref);
        vm.expectRevert(abi.encodeWithSelector(IFeeHarvester.CycleNotClosed.selector, 1));
        harv.claimReferral(address(basket), cycles, ref);
        vm.prank(ref);
        vm.expectRevert(FeeHarvester.ZeroAddress.selector);
        harv.claimReferral(address(basket), cycles, address(0));
        (, uint256 openClaim, ) = harv.referralOf(address(basket), 1, ref);
        assertEq(openClaim, 0);
    }

    function test_U_H01b_noReferrerAndTwoReferrers() public {
        _mint(basket, 60e18, holder, ref);
        _mint(basket, 40e18, holder, ref2);
        _mint(basket, 50e18, holder, address(0));
        uint256 wifOut = _harvest(basket);
        uint256 totalFee = (150e18 * 30) / 10_000;
        uint256 totalRef = ((60e18 * 30) / 10_000 + (40e18 * 30) / 10_000) / 10;
        uint256 toRef = (wifOut * totalRef) / totalFee;
        assertEq(wif.balanceOf(address(harv)), toRef);
        (, uint256 c1, ) = harv.referralOf(address(basket), 0, ref);
        (, uint256 c2, ) = harv.referralOf(address(basket), 0, ref2);
        assertLe(c1 + c2, toRef);
        assertGe(c1 + c2 + 1, toRef);
        assertEq(wif.balanceOf(DEAD) + sink.backers() + sink.curator() + toRef, wifOut, "INV-8");
        (uint256 f, uint256 r, uint256 w) = harv.cycleInfo(address(basket), 0);
        assertEq(f, totalFee);
        assertEq(r, totalRef);
        assertEq(w, toRef);
    }

    function test_U_H02_guards() public {
        _mint(basket, SHARES, holder, address(0));
        address mallory = makeAddr("mallory");
        vm.startPrank(mallory);
        vm.expectRevert(IFeeHarvester.OnlyKeeper.selector);
        harv.harvestFees(address(basket), 0, block.timestamp + 1);
        vm.expectRevert(IFeeHarvester.OnlyKeeper.selector);
        harv.harvestDividends(address(basket), 0, block.timestamp + 1);
        vm.expectRevert(IFeeHarvester.OnlyBasket.selector);
        harv.onFeeShares(address(0), 1);
        vm.expectRevert(IFeeHarvester.OnlyBasket.selector);
        harv.onDividendSkim(address(tokA), 1);
        vm.stopPrank();

        vm.startPrank(owner);
        vm.expectRevert(IFeeHarvester.Expired.selector);
        harv.harvestFees(address(basket), 0, block.timestamp - 1);
        vm.expectRevert(IFeeHarvester.Expired.selector);
        harv.harvestDividends(address(basket), 0, block.timestamp - 1);
        vm.expectRevert(abi.encodeWithSelector(IFeeHarvester.InsufficientWifOut.selector, WIF_OUT, WIF_OUT + 1));
        harv.harvestFees(address(basket), WIF_OUT + 1, block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(FeeHarvester.UnknownBasket.selector, mallory));
        harv.harvestFees(mallory, 0, block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(FeeHarvester.UnknownBasket.selector, mallory));
        harv.harvestDividends(mallory, 0, block.timestamp + 1);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector);
        harv.harvestDividends(address(basket), 0, block.timestamp + 1);
        harv.setKeeper(mallory);
        vm.expectRevert(IFeeHarvester.OnlyKeeper.selector);
        harv.harvestFees(address(basket), 0, block.timestamp + 1);
        vm.stopPrank();
        vm.prank(mallory);
        assertEq(harv.harvestFees(address(basket), 0, block.timestamp + 1), WIF_OUT);
        vm.prank(mallory);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector);
        harv.harvestFees(address(basket), 0, block.timestamp + 1);
    }

    function test_U_H03_wiringAndReceive() public {
        vm.startPrank(owner);
        vm.expectRevert(IFeeHarvester.FactoryAlreadySet.selector);
        harv.setFactory(address(factory));
        vm.expectRevert(FeeHarvester.ZeroAddress.selector);
        harv.setKeeper(address(0));
        vm.stopPrank();
        assertEq(harv.vault(), address(sink));
        assertEq(harv.keeper(), owner);
        assertEq(harv.BURN_BPS(), 5000);
        assertEq(harv.BACKER_BPS(), 3000);
        assertEq(harv.CURATOR_BPS(), 2000);
        assertEq(harv.REFERRAL_SHARE_BPS(), 1000);
        assertEq(harv.DEAD(), DEAD);

        // fresh harvester with no factory
        vm.startPrank(owner);
        FeeHarvester fresh = new FeeHarvester(
            owner,
            address(reg),
            address(usdg),
            address(weth),
            address(wif),
            address(poolUW),
            address(pm),
            _key()
        );
        vm.expectRevert(FeeHarvester.ZeroAddress.selector);
        fresh.setFactory(address(0));
        vm.expectRevert(FeeHarvester.FactoryNotSet.selector);
        fresh.harvestFees(address(basket), 0, block.timestamp + 1);
        vm.stopPrank();
        vm.prank(address(basket));
        vm.expectRevert(IFeeHarvester.OnlyBasket.selector);
        fresh.onFeeShares(address(0), 1);

        // receive(): only WETH and the PoolManager
        vm.deal(address(this), 3);
        (bool ok, ) = address(harv).call{value: 1}("");
        assertFalse(ok);
        vm.deal(address(pm), 1);
        vm.prank(address(pm));
        (ok, ) = address(harv).call{value: 1}("");
        assertTrue(ok);
        vm.deal(address(weth), 1);
        vm.prank(address(weth));
        (ok, ) = address(harv).call{value: 1}("");
        assertTrue(ok);

        // constructor guards
        vm.expectRevert(FeeHarvester.ZeroAddress.selector);
        new FeeHarvester(
            owner,
            address(0),
            address(usdg),
            address(weth),
            address(wif),
            address(poolUW),
            address(pm),
            _key()
        );
        PoolKey memory k = _key();
        k.currency0 = k.currency1;
        vm.expectRevert(UniswapV4WifSwapper.V4KeyNotNative.selector);
        new FeeHarvester(
            owner,
            address(reg),
            address(usdg),
            address(weth),
            address(wif),
            address(poolUW),
            address(pm),
            k
        );
    }

    function test_U_H04_callbacksAuthenticated() public {
        bytes memory data = abi.encode(address(usdg));
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(FeeHarvester.UnexpectedCallback.selector);
        harv.uniswapV3SwapCallback(1, -1, data);
        vm.prank(address(poolA));
        vm.expectRevert(FeeHarvester.UnexpectedCallback.selector);
        harv.uniswapV3SwapCallback(1, -1, data);

        vm.prank(makeAddr("mallory"));
        vm.expectRevert(UniswapV4WifSwapper.V4UnexpectedUnlock.selector);
        harv.unlockCallback(abi.encode(uint256(1)));
        // the PoolManager itself, but not inside our own unlock
        vm.prank(address(pm));
        vm.expectRevert(UniswapV4WifSwapper.V4UnexpectedUnlock.selector);
        harv.unlockCallback(abi.encode(uint256(1)));
    }

    function test_U_H05_poolMisbehaviour() public {
        _mint(basket, SHARES, holder, address(0));
        // a pool that demands more input than the harvester holds
        poolA.setExtraOwed(1e30);
        vm.prank(owner);
        vm.expectPartialRevert(FeeHarvester.InsufficientInput.selector);
        harv.harvestFees(address(basket), 0, block.timestamp + 1);
        poolA.setExtraOwed(0);

        // the v4 pool consumes only part of the ETH
        pm.setPartial(true);
        vm.prank(owner);
        vm.expectPartialRevert(UniswapV4WifSwapper.V4PartialFill.selector);
        harv.harvestFees(address(basket), 0, block.timestamp + 1);
        pm.setPartial(false);

        // a component whose v3 pool vanished
        v3.setPool(address(tokA), address(usdg), 500, address(0));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(FeeHarvester.PoolNotFound.selector, address(tokA)));
        harv.harvestFees(address(basket), 0, block.timestamp + 1);
        v3.setPool(address(tokA), address(usdg), 500, address(poolA));

        // all failures rolled back: the state is intact and a clean harvest succeeds
        assertEq(harv.pendingFeeShares(address(basket)), FEE);
        assertEq(_harvest(basket), WIF_OUT);
    }

    // ------------------------------------------------------------ IOUs
    function test_U_H06_pausedLegIsIouThenClaimedAndSoldNextHarvest() public {
        _mint(basket, SHARES, holder, address(0));
        tokA.setPaused(true);
        uint256 wif1 = _harvest(basket);
        // only B was sold: 0.9 B -> 45 USDG -> 0.0225 ETH -> 22.5 WIF -> 1% cut
        assertEq(wif1, 22.275e18);
        uint256 iou = basket.owed(address(harv), address(tokA));
        assertEq(iou, 0.3e18);

        tokA.setPaused(false);
        assertEq(harv.claimIOU(address(basket), address(tokA)), iou);
        assertEq(harv.iouPending(address(basket), address(tokA)), iou);
        vm.expectRevert(); // nothing owed any more
        harv.claimIOU(address(basket), address(tokA));
        vm.expectRevert(abi.encodeWithSelector(FeeHarvester.UnknownBasket.selector, holder));
        harv.claimIOU(holder, address(tokA));

        _mint(basket, SHARES, holder, address(0));
        uint256 wif2 = _harvest(basket);
        // new fee: 0.3 A + 0.9 B again, plus the carried 0.3 A -> 0.6 A + 0.9 B = 60 + 45 USDG... check via parts
        // (the pool is 1:1 on every unit, so the output scales linearly with the USDG total of 105)
        assertEq(wif2, (uint256(105e6) * 5e8 * 1000 * 99) / 100);
        assertEq(harv.iouPending(address(basket), address(tokA)), 0);
        _emptyCheck();
    }

    function test_U_H07_allLegsFailingReverts() public {
        _mint(basket, SHARES, holder, address(0));
        tokA.setPaused(true);
        tokB.setPaused(true);
        vm.prank(owner);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector);
        harv.harvestFees(address(basket), 0, block.timestamp + 1);
        assertEq(harv.pendingFeeShares(address(basket)), FEE, "rolled back");
    }

    // ------------------------------------------------------------ dividends
    function test_U_H08_harvestDividends() public {
        Basket b = _newBasket(DividendMode.PayInWif);
        _mint(b, SHARES, holder, address(0));

        tokA.setMultiplier(1.01e18);
        b.sync();
        uint256 skim = harv.pendingDividend(address(b), address(tokA));
        assertGt(skim, 0);
        assertEq(tokA.balanceOf(address(harv)), skim);
        // a second skim of the same token adds to the same pending bucket
        tokA.setMultiplier(1.02e18);
        b.sync();
        uint256 skim2 = harv.pendingDividend(address(b), address(tokA));
        assertGt(skim2, skim);

        vm.prank(owner);
        uint256 wifOut = harv.harvestDividends(address(b), 0, block.timestamp + 1);
        // skim * 100 USDG / 1e18 -> * 5e8 -> * 1000 WIF/ETH -> 1% cut
        assertEq(wifOut, ((((skim2 * 100e6) / 1e18) * 5e8 * 1000) * 99) / 100);
        assertEq(wif.balanceOf(address(b)), wifOut);
        assertEq(harv.pendingDividend(address(b), address(tokA)), 0);
        assertGt(b.pendingWifDividend(holder), 0);
        _emptyCheck();

        vm.prank(owner);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector);
        harv.harvestDividends(address(b), 0, block.timestamp + 1);

        // the fee harvest also claims the dividend the harvester's own fee shares accrued
        uint256 pendingH = b.pendingWifDividend(address(harv));
        assertGt(pendingH, 0);
        uint256 w = _harvest(b);
        assertGe(w, pendingH);
        // minWifOut applies to dividends too
        tokA.setMultiplier(1.03e18);
        b.sync();
        vm.prank(owner);
        vm.expectPartialRevert(IFeeHarvester.InsufficientWifOut.selector);
        harv.harvestDividends(address(b), type(uint256).max, block.timestamp + 1);
    }

    function test_U_H09_zeroOutputUsdgDustIsLeftNotSwapped() public {
        // a dust amount that yields 0 WETH must not revert the harvest
        MockInPool dust = new MockInPool(address(usdg), address(weth), 1, 1e18);
        weth.mint(address(dust), 1e24);
        vm.prank(owner);
        FeeHarvester h2 = new FeeHarvester(
            owner,
            address(reg),
            address(usdg),
            address(weth),
            address(wif),
            address(dust),
            address(pm),
            _key()
        );
        // a component-less direct call path is not exposed; exercise through a full harvest instead
        BasketFactory f2 = new BasketFactory(
            owner,
            address(reg),
            address(h2),
            address(sink),
            address(wif),
            address(new Basket()),
            0
        );
        vm.prank(owner);
        h2.setFactory(address(f2));
        IBasketFactory.CreateParams memory p;
        p.name = "D";
        p.symbol = "D";
        p.tokens = new address[](2);
        p.tokens[0] = address(tokA);
        p.tokens[1] = address(tokB);
        p.rawUnits = new uint256[](2);
        p.rawUnits[0] = 1e18;
        p.rawUnits[1] = 3e18;
        vm.prank(curator);
        Basket b2 = Basket(f2.createBasket(p, 0));
        _mint(b2, SHARES, holder, address(0));
        vm.prank(owner);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector); // 0 WETH out -> 0 WIF -> nothing harvested
        h2.harvestFees(address(b2), 0, block.timestamp + 1);
    }
}
