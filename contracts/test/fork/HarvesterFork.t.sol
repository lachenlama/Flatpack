// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ForkBase} from "./RouterFork.t.sol";
import {FeeHarvester} from "../../src/FeeHarvester.sol";
import {DividendMode} from "../../src/interfaces/IBasket.sol";
import {IFeeHarvester} from "../../src/interfaces/IFeeHarvester.sol";
import {IBackingVault} from "../../src/interfaces/IBackingVault.sol";
import {IScaledUIAmount} from "../../src/interfaces/external/IExternal.sol";
import {UniswapV4WifSwapper} from "../../src/libraries/UniswapV4WifSwapper.sol";

/// @notice Exposes the v4 swapper on its own so the hook tax can be measured at several sizes.
contract V4Probe is UniswapV4WifSwapper {
    constructor(address pm, PoolKey memory key) UniswapV4WifSwapper(pm, key) {}

    function swapAll() external payable {
        _swapEthForWif(msg.value);
    }

    receive() external payable {}
}

contract HarvesterForkTest is ForkBase {
    using StateLibrary for IPoolManager;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant BIG = 30e18; // ~ $9k buy, so the 0.3% fee (~ $27) is worth selling
    uint256 internal constant FEE_A = (20e18 * 30) / 10_000; // fee shares of the 20-share buy
    uint256 internal constant FEE_B = (10e18 * 30) / 10_000; // fee shares of the 10-share buy

    // ------------------------------------------------------------ helpers
    function _harvest() internal returns (uint256) {
        vm.prank(owner);
        return harvester.harvestFees(address(basket), 0, block.timestamp + 1 hours);
    }

    function _wifBal(address a) internal view returns (uint256) {
        return IERC20(WIF).balanceOf(a);
    }

    function _assertHarvesterSwept() internal view {
        assertEq(IERC20(USDG).balanceOf(address(harvester)), 0, "usdg left");
        assertEq(IERC20(WETH).balanceOf(address(harvester)), 0, "weth left");
        assertEq(IERC20(AAPL).balanceOf(address(harvester)), 0, "aapl left");
        assertEq(IERC20(NVDA).balanceOf(address(harvester)), 0, "nvda left");
        assertEq(IERC20(MSFT).balanceOf(address(harvester)), 0, "msft left");
        assertEq(address(harvester).balance, 0, "eth left");
    }

    // ------------------------------------------------------------ F-H01
    function test_F_H01_harvestFeesEndToEnd() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        _buy(BIG, 12_000e6, receiver, address(0));

        uint256 fee = (BIG * 30) / 10_000;
        assertEq(harvester.pendingFeeShares(address(basket)), fee);
        assertEq(harvester.currentCycle(address(basket)), 0);

        uint256 deadBefore = _wifBal(DEAD);
        uint256 vaultBefore = _wifBal(address(vault));
        uint256 harvBefore = _wifBal(address(harvester));

        uint256 gasBefore = gasleft();
        uint256 wifOut = _harvest();
        console.log("harvestFees gas:", gasBefore - gasleft());
        console.log("WIF out (1e18):", wifOut);
        assertGt(wifOut, 0);

        // INV-8: burn + toReferrers + backers + curator == W, exact to the wei
        IBackingVault.BasketState memory s = vault.basketState(address(basket));
        uint256 burned = _wifBal(DEAD) - deadBefore;
        uint256 toVault = _wifBal(address(vault)) - vaultBefore;
        uint256 toReferrers = _wifBal(address(harvester)) - harvBefore;
        assertEq(burned, (wifOut * 5000) / 10_000, "DEAD gets 50%");
        assertEq(toReferrers, 0, "no referrers");
        assertEq(s.queuedBackers + s.queuedCurator, toVault, "vault queue == vault delta");
        assertEq(burned + toReferrers + s.queuedBackers + s.queuedCurator, wifOut, "INV-8");
        assertEq(s.queuedBackers, ((wifOut - burned) * 3000) / 5000, "backers 30");
        assertEq(s.queuedCurator, wifOut - burned - s.queuedBackers, "curator 20");

        // state
        assertEq(harvester.pendingFeeShares(address(basket)), 0);
        assertEq(harvester.currentCycle(address(basket)), 1);
        assertEq(basket.balanceOf(address(harvester)), 0, "fee shares redeemed");
        assertEq(IERC20(WIF).allowance(address(harvester), address(vault)), 0, "approval reset");
        _assertHarvesterSwept();

        // nothing more to harvest
        vm.prank(owner);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector);
        harvester.harvestFees(address(basket), 0, block.timestamp + 1);
    }

    // ------------------------------------------------------------ F-H02
    function test_F_H02_minWifOutAndKeeperOnly() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        _buy(BIG, 12_000e6, receiver, address(0));

        vm.startPrank(owner);
        vm.expectPartialRevert(IFeeHarvester.InsufficientWifOut.selector);
        harvester.harvestFees(address(basket), type(uint256).max, block.timestamp + 1 hours);
        vm.expectRevert(IFeeHarvester.Expired.selector);
        harvester.harvestFees(address(basket), 0, block.timestamp - 1);
        vm.stopPrank();

        // a failed harvest left the state untouched
        assertEq(harvester.pendingFeeShares(address(basket)), (BIG * 30) / 10_000);
        assertEq(harvester.currentCycle(address(basket)), 0);

        address mallory = makeAddr("mallory");
        vm.startPrank(mallory);
        vm.expectRevert(IFeeHarvester.OnlyKeeper.selector);
        harvester.harvestFees(address(basket), 0, block.timestamp + 1 hours);
        vm.expectRevert(IFeeHarvester.OnlyKeeper.selector);
        harvester.harvestDividends(address(basket), 0, block.timestamp + 1 hours);
        vm.stopPrank();

        // unknown basket
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(FeeHarvester.UnknownBasket.selector, mallory));
        harvester.harvestFees(mallory, 0, block.timestamp + 1 hours);

        // keeper rotation
        vm.prank(owner);
        harvester.setKeeper(mallory);
        vm.prank(mallory);
        assertGt(harvester.harvestFees(address(basket), 0, block.timestamp + 1 hours), 0);
    }

    // ------------------------------------------------------------ F-H03
    function test_F_H03_referralCycle() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        address refA = makeAddr("refA");
        address refB = makeAddr("refB");
        _buy(20e18, 8_000e6, receiver, refA);
        _buy(10e18, 4_000e6, receiver, refB);

        {
            (uint256 sharesA, uint256 claimA0, bool doneA0) = harvester.referralOf(address(basket), 0, refA);
            assertEq(sharesA, (FEE_A * 1000) / 10_000);
            assertEq(claimA0, 0, "open cycle has no claimable amount");
            assertFalse(doneA0);
        }

        // an open cycle cannot be claimed
        uint256[] memory cycles = new uint256[](1);
        vm.prank(refA);
        vm.expectRevert(abi.encodeWithSelector(IFeeHarvester.CycleNotClosed.selector, 0));
        harvester.claimReferral(address(basket), cycles, refA);

        uint256 toReferrers = Math.mulDiv(_harvest(), ((FEE_A + FEE_B) * 1000) / 10_000, FEE_A + FEE_B);
        // INV-6: the harvester holds the unclaimed referral WIF
        assertEq(_wifBal(address(harvester)), toReferrers, "harvester keeps the referrer share");
        _claimBoth(refA, refB, toReferrers, cycles);

        // double claim
        vm.prank(refA);
        vm.expectRevert(abi.encodeWithSelector(IFeeHarvester.AlreadyClaimed.selector, 0));
        harvester.claimReferral(address(basket), cycles, refA);
        (, , bool doneA) = harvester.referralOf(address(basket), 0, refA);
        assertTrue(doneA);

        // zero recipient
        vm.prank(refB);
        vm.expectRevert(FeeHarvester.ZeroAddress.selector);
        harvester.claimReferral(address(basket), cycles, address(0));

        // a stranger with no referral gets nothing
        vm.prank(makeAddr("stranger"));
        assertEq(harvester.claimReferral(address(basket), cycles, makeAddr("stranger")), 0);
        (uint256 feeSharesC0, uint256 refSharesC0, uint256 refWifC0) = harvester.cycleInfo(address(basket), 0);
        assertEq(feeSharesC0, FEE_A + FEE_B);
        assertEq(refSharesC0, ((FEE_A + FEE_B) * 1000) / 10_000);
        assertEq(refWifC0, toReferrers);
    }

    function _claimBoth(address refA, address refB, uint256 toReferrers, uint256[] memory cycles) private {
        uint256 totalRef = ((FEE_A + FEE_B) * 1000) / 10_000;
        (, uint256 claimA, ) = harvester.referralOf(address(basket), 0, refA);
        (, uint256 claimB, ) = harvester.referralOf(address(basket), 0, refB);
        assertEq(claimA, Math.mulDiv(toReferrers, (FEE_A * 1000) / 10_000, totalRef));
        assertEq(claimB, Math.mulDiv(toReferrers, (FEE_B * 1000) / 10_000, totalRef));
        assertLe(claimA + claimB, toReferrers, "no over-claim");
        assertGt(claimA, claimB, "A referred twice the volume");

        address payoutA = makeAddr("payoutA");
        vm.prank(refA);
        assertEq(harvester.claimReferral(address(basket), cycles, payoutA), claimA);
        assertEq(_wifBal(payoutA), claimA);
        vm.prank(refB);
        assertEq(harvester.claimReferral(address(basket), cycles, refB), claimB);
        assertEq(_wifBal(refB), claimB);
        assertLe(_wifBal(address(harvester)), 1, "at most 1 wei of rounding dust remains");
    }

    // ------------------------------------------------------------ F-H04
    function test_F_H04_harvestDividends() public {
        _forkAndDeploy();
        _createBasket(DividendMode.PayInWif);
        _buy(BIG, 12_000e6, receiver, address(0));

        // simulate a +0.5% cash dividend on AAPL (the Stock Token's own multiplier is mocked; transfers are real)
        uint256 last = IScaledUIAmount(AAPL).uiMultiplier();
        vm.mockCall(
            AAPL,
            abi.encodeWithSelector(IScaledUIAmount.uiMultiplier.selector),
            abi.encode((last * 1005) / 1000)
        );
        basket.sync();
        uint256 skim = harvester.pendingDividend(address(basket), AAPL);
        console.log("AAPL skim (raw):", skim);
        assertGt(skim, 0, "skim booked");
        assertEq(IERC20(AAPL).balanceOf(address(harvester)), skim);

        uint256 wifOut;
        vm.prank(owner);
        wifOut = harvester.harvestDividends(address(basket), 0, block.timestamp + 1 hours);
        assertGt(wifOut, 0);
        assertEq(harvester.pendingDividend(address(basket), AAPL), 0);
        assertEq(IERC20(WIF).balanceOf(address(basket)), wifOut, "WIF moved to the basket");
        _assertHarvesterSwept();

        // holders accrue pro rata: receiver + harvester (fee shares) cover everything but rounding dust
        uint256 pendingR = basket.pendingWifDividend(receiver);
        uint256 pendingH = basket.pendingWifDividend(address(harvester));
        assertGt(pendingR, 0);
        assertLe(pendingR + pendingH, wifOut);
        assertGe(pendingR + pendingH + 1e6, wifOut, "all dividend accounted for");

        vm.prank(receiver);
        uint256 claimed = basket.claimWifDividend(receiver);
        assertEq(claimed, pendingR);
        assertEq(IERC20(WIF).balanceOf(receiver), pendingR);

        // nothing left to harvest
        vm.prank(owner);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector);
        harvester.harvestDividends(address(basket), 0, block.timestamp + 1);

        // the fee harvest also claims the harvester's own dividend share into W
        uint256 wifFee = _harvest();
        assertGe(wifFee, pendingH, "fee harvest includes dividends accrued by fee shares");
    }

    // ------------------------------------------------------------ F-H05
    function test_F_H05_measureWifHookTax() public {
        _forkAndDeploy();
        V4Probe probe = new V4Probe(POOL_MANAGER, _wifKey());
        IPoolManager pm = IPoolManager(POOL_MANAGER);
        PoolId pid = _wifKey().toId();

        uint256[3] memory sizes = [uint256(0.001 ether), 0.01 ether, 0.1 ether];
        for (uint256 i; i < sizes.length; ++i) {
            uint256 snap = vm.snapshotState();
            (uint160 sqrtP, , , ) = pm.getSlot0(pid);
            // mid price: WIF per ETH = (sqrtP / 2^96)^2
            uint256 priceX96 = Math.mulDiv(sqrtP, sqrtP, 1 << 96);
            uint256 expected = Math.mulDiv(sizes[i], priceX96, 1 << 96);
            vm.deal(address(this), sizes[i]);
            uint256 before = IERC20(WIF).balanceOf(address(probe));
            probe.swapAll{value: sizes[i]}();
            uint256 got = IERC20(WIF).balanceOf(address(probe)) - before;
            assertGt(got, 0);
            assertLt(got, expected, "output below mid price");
            uint256 shortfallBps = ((expected - got) * 10_000) / expected;
            console.log("ETH in (wei):", sizes[i]);
            console.log("WIF out (mid-price):", expected);
            console.log("WIF out (actual)   :", got);
            console.log("effective shortfall vs mid (bps):", shortfallBps);
            vm.revertToState(snap);
        }
    }

    // ------------------------------------------------------------ F-H06 (IOUs)
    function test_F_H06_pausedLegBecomesIouAndIsHarvestedLater() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        _buy(BIG, 12_000e6, receiver, address(0));

        // AAPL "paused": the redeem leg to the harvester fails and becomes an IOU
        vm.mockCallRevert(AAPL, abi.encodeWithSelector(IERC20.transfer.selector, address(harvester)), "paused");
        uint256 wifOut1 = _harvest();
        assertGt(wifOut1, 0, "other legs were sold");
        uint256 iou = basket.owed(address(harvester), AAPL);
        assertGt(iou, 0, "IOU recorded for the harvester");
        assertEq(IERC20(AAPL).balanceOf(address(harvester)), 0);

        // unpaused: anyone can pull the IOU into the harvester, where it waits for the next harvest
        vm.clearMockedCalls();
        assertEq(harvester.claimIOU(address(basket), AAPL), iou);
        assertEq(harvester.iouPending(address(basket), AAPL), iou);
        assertEq(basket.owed(address(harvester), AAPL), 0);

        // more fees arrive; the next harvest sells the carried IOU tokens too
        _buy(BIG, 12_000e6, receiver, address(0));
        uint256 wifOut2 = _harvest();
        assertGt(wifOut2, 0);
        assertEq(harvester.iouPending(address(basket), AAPL), 0);
        _assertHarvesterSwept();

        // claiming with nothing owed bubbles the basket's error
        vm.expectRevert();
        harvester.claimIOU(address(basket), AAPL);
        vm.expectRevert(abi.encodeWithSelector(FeeHarvester.UnknownBasket.selector, receiver));
        harvester.claimIOU(receiver, AAPL);
    }

    function test_F_H07_allLegsPausedReverts() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        _buy(BIG, 12_000e6, receiver, address(0));
        vm.mockCallRevert(AAPL, abi.encodeWithSelector(IERC20.transfer.selector, address(harvester)), "paused");
        vm.mockCallRevert(NVDA, abi.encodeWithSelector(IERC20.transfer.selector, address(harvester)), "paused");
        vm.mockCallRevert(MSFT, abi.encodeWithSelector(IERC20.transfer.selector, address(harvester)), "paused");
        vm.prank(owner);
        vm.expectRevert(IFeeHarvester.NothingToHarvest.selector);
        harvester.harvestFees(address(basket), 0, block.timestamp + 1 hours);
        // rolled back: the fee shares are still pending
        assertEq(harvester.pendingFeeShares(address(basket)), (BIG * 30) / 10_000);
    }

    // ------------------------------------------------------------ access control and wiring
    function test_F_H08_wiringAndAccessControl() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        address mallory = makeAddr("mallory");

        // callbacks only from baskets
        vm.startPrank(mallory);
        vm.expectRevert(IFeeHarvester.OnlyBasket.selector);
        harvester.onFeeShares(address(0), 1);
        vm.expectRevert(IFeeHarvester.OnlyBasket.selector);
        harvester.onDividendSkim(AAPL, 1);
        vm.stopPrank();

        // setFactory is one-shot and owner-only
        vm.prank(owner);
        vm.expectRevert(IFeeHarvester.FactoryAlreadySet.selector);
        harvester.setFactory(address(factory));
        vm.prank(mallory);
        vm.expectRevert();
        harvester.setFactory(address(factory));
        assertEq(harvester.vault(), address(vault));
        assertEq(harvester.factory(), address(factory));

        // receive() only from WETH / PoolManager
        vm.deal(mallory, 1 ether);
        vm.prank(mallory);
        (bool ok, ) = address(harvester).call{value: 1}("");
        assertFalse(ok, "EOA cannot send ETH");

        // the v4 unlock callback only from the PoolManager, and only inside our own unlock
        vm.prank(mallory);
        vm.expectRevert(UniswapV4WifSwapper.V4UnexpectedUnlock.selector);
        harvester.unlockCallback(abi.encode(uint256(1)));
        vm.prank(POOL_MANAGER);
        vm.expectRevert(UniswapV4WifSwapper.V4UnexpectedUnlock.selector);
        harvester.unlockCallback(abi.encode(uint256(1)));

        // zero-address guards
        vm.startPrank(owner);
        vm.expectRevert(FeeHarvester.ZeroAddress.selector);
        harvester.setKeeper(address(0));
        vm.stopPrank();
    }

    function test_F_H09_constructorGuardsAndConstants() public {
        _forkAndDeploy();
        PoolKey memory k = _wifKey();
        vm.expectRevert(FeeHarvester.ZeroAddress.selector);
        new FeeHarvester(owner, address(0), USDG, WETH, WIF, USDG_WETH_POOL, POOL_MANAGER, k);
        // non-native currency0 is rejected
        k.currency0 = k.currency1;
        vm.expectRevert(UniswapV4WifSwapper.V4KeyNotNative.selector);
        new FeeHarvester(owner, address(registry), USDG, WETH, WIF, USDG_WETH_POOL, POOL_MANAGER, k);

        assertEq(harvester.BURN_BPS(), 5000);
        assertEq(harvester.BACKER_BPS(), 3000);
        assertEq(harvester.CURATOR_BPS(), 2000);
        assertEq(harvester.REFERRAL_SHARE_BPS(), 1000);
        assertEq(harvester.DEAD(), DEAD);
        assertEq(harvester.keeper(), owner);
    }
}
