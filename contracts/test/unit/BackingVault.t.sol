// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BackingVault} from "../../src/BackingVault.sol";
import {IBackingVault} from "../../src/interfaces/IBackingVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {MockBasketForVault} from "../mocks/MockBasketForVault.sol";
import {MockFactoryForVault} from "../mocks/MockFactoryForVault.sol";
import {MockRegistryForVault} from "../mocks/MockRegistryForVault.sol";

contract BackingVaultTest is Test {
    uint64 internal constant ANCHOR = 1794016800;
    uint64 internal constant WEEK = 7 days;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    BackingVault internal vault;
    MockERC20 internal wif;
    MockRegistryForVault internal registry;
    MockFactoryForVault internal factory;
    MockBasketForVault internal basket;
    MockAggregator internal feedA;
    MockAggregator internal feedB;
    MockAggregator internal feedSpy;
    address internal tokA = address(0xA11);
    address internal tokB = address(0xB22);
    address internal tokSpy = address(0x5B1);

    address internal owner = address(0x0111);
    address internal harvester = address(0xFA12);
    address internal curator = address(0xC0DE);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0);

    uint256 internal constant MIN_STAKE = 1_000e18;

    function setUp() public {
        vm.warp(ANCHOR - 1 days);
        wif = new MockERC20("WIF", "WIF", 18);
        registry = new MockRegistryForVault();
        factory = new MockFactoryForVault();
        factory.setMinCuratorStake(MIN_STAKE);
        vault = new BackingVault(owner, address(registry), address(wif));
        vm.startPrank(owner);
        vault.setFactory(address(factory));
        vault.setHarvester(harvester);
        vm.stopPrank();
        vm.prank(harvester);
        wif.approve(address(vault), type(uint256).max);

        feedA = new MockAggregator(100e8);
        feedB = new MockAggregator(50e8);
        feedSpy = new MockAggregator(500e8);
        registry.setFeed(tokA, address(feedA));
        registry.setFeed(tokB, address(feedB));
        registry.setFeed(tokSpy, address(feedSpy));
        registry.setBenchmark(tokSpy);

        basket = new MockBasketForVault();
        address[] memory t = new address[](2);
        t[0] = tokA;
        t[1] = tokB;
        uint256[] memory u = new uint256[](2);
        u[0] = 1e18;
        u[1] = 2e18;
        basket.setComponents(t, u);

        factory.registerBasket(vault, address(basket), curator);
    }

    // ------------------------------------------------------------------ helpers
    function _refresh(uint256 a, uint256 b, uint256 spy) internal {
        feedA.set(int256(a), block.timestamp);
        feedB.set(int256(b), block.timestamp);
        feedSpy.set(int256(spy), block.timestamp);
    }

    function _stakeAs(address who, uint256 amount) internal {
        wif.mint(who, amount);
        vm.startPrank(who);
        wif.approve(address(vault), amount);
        vault.stake(address(basket), amount);
        vm.stopPrank();
    }

    function _queue(uint256 backers, uint256 cur) internal {
        wif.mint(harvester, backers + cur);
        vm.prank(harvester);
        vault.queueRewards(address(basket), backers, cur);
    }

    function _toBoundary() internal {
        vm.warp(vault.nextSettleAt(address(basket)));
    }

    /// @dev Neutral settle (flat prices, nothing queued): activates all warming stake.
    function _activate() internal {
        _toBoundary();
        _refresh(100e8, 50e8, 500e8);
        vault.settle(address(basket));
    }

    function _beatSetup() internal {
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, 100e18);
        _stakeAs(bob, 300e18);
        _activate();
        _queue(1000e18, 500e18);
    }

    // ------------------------------------------------------------------ registration / views
    function test_U_V02_registerSnapshot() public view {
        IBackingVault.BasketState memory s = vault.basketState(address(basket));
        assertEq(s.curator, curator);
        assertEq(s.navLast, 200e18);
        assertEq(s.benchLast, 500e8);
        assertEq(s.lastSettledAt, ANCHOR - 1 days);
        assertEq(vault.nextSettleAt(address(basket)), ANCHOR);
    }

    function test_U_V02_registerWithStaleFeedStoresZero() public {
        MockBasketForVault b2 = new MockBasketForVault();
        address[] memory t = new address[](1);
        t[0] = tokA;
        uint256[] memory u = new uint256[](1);
        u[0] = 1e18;
        b2.setComponents(t, u);
        feedA.set(100e8, block.timestamp - 5 days);
        factory.registerBasket(vault, address(b2), curator);
        IBackingVault.BasketState memory s = vault.basketState(address(b2));
        assertEq(s.navLast, 0);
        assertEq(s.benchLast, 0);
    }

    function test_U_V02_registerWithRevertingComponentsStoresZero() public {
        MockBasketForVault b2 = new MockBasketForVault();
        b2.setShouldRevert(true);
        factory.registerBasket(vault, address(b2), curator);
        assertEq(vault.basketState(address(b2)).navLast, 0);
        (uint256 nav, bool valid) = vault.navOf(address(b2));
        assertEq(nav, 0);
        assertFalse(valid);
    }

    function test_U_V02_registerWithoutBenchmarkStoresZero() public {
        registry.setBenchmark(address(0));
        MockBasketForVault b2 = new MockBasketForVault();
        address[] memory t = new address[](1);
        t[0] = tokA;
        uint256[] memory u = new uint256[](1);
        u[0] = 1e18;
        b2.setComponents(t, u);
        factory.registerBasket(vault, address(b2), curator);
        assertEq(vault.basketState(address(b2)).navLast, 0);
        assertEq(vault.basketState(address(b2)).benchLast, 0);
    }

    function test_U_V02_nextSettleAtEpochMath() public {
        // before the anchor
        assertEq(vault.nextSettleAt(address(basket)), ANCHOR);
        // exactly on the anchor -> anchor + 1 week
        vm.warp(ANCHOR);
        _refresh(100e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(vault.nextSettleAt(address(basket)), ANCHOR + WEEK);
        // mid-epoch settle -> next boundary after
        vm.warp(ANCHOR + WEEK + 3 days);
        _refresh(100e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(vault.nextSettleAt(address(basket)), ANCHOR + 2 * WEEK);
    }

    function test_U_V02_constants() public view {
        assertEq(vault.EPOCH_ANCHOR(), 1794016800);
        assertEq(vault.EPOCH_LENGTH(), 7 days);
        assertEq(vault.UNSTAKE_COOLDOWN(), 7 days);
        assertEq(vault.MAX_PRICE_AGE(), 4 days);
        assertEq(vault.DEAD(), DEAD);
    }

    function test_U_V02_unknownBasketReverts() public {
        address nope = address(0xDEAD1);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.settle(nope);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.stake(nope, 1);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.stakeFor(nope, alice, 1);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.requestUnstake(nope, 1);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.claim(nope, alice);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.claimCurator(nope, alice);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.nextSettleAt(nope);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.curatorActive(nope);
        vm.prank(harvester);
        vm.expectRevert(IBackingVault.UnknownBasket.selector);
        vault.queueRewards(nope, 1, 1);
    }

    // ------------------------------------------------------------------ U-V01 staking
    function test_U_V01_stakeRequestWithdraw() public {
        _stakeAs(alice, 100e18);
        assertEq(vault.position(address(basket), alice).warming, 100e18);
        assertEq(vault.position(address(basket), alice).active, 0);
        assertEq(vault.basketState(address(basket)).totalWarming, 100e18);
        assertEq(wif.balanceOf(address(vault)), 100e18);

        vm.prank(alice);
        vault.requestUnstake(address(basket), 40e18);
        IBackingVault.Position memory p = vault.position(address(basket), alice);
        assertEq(p.warming, 60e18);
        assertEq(p.pendingUnstake, 40e18);
        assertEq(p.unlockAt, block.timestamp + 7 days);
        assertEq(vault.basketState(address(basket)).totalWarming, 60e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBackingVault.StillLocked.selector, p.unlockAt));
        vault.withdraw(address(basket));

        vm.warp(p.unlockAt - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBackingVault.StillLocked.selector, p.unlockAt));
        vault.withdraw(address(basket));

        vm.warp(p.unlockAt);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IBackingVault.Withdrawn(address(basket), alice, 40e18);
        vm.prank(alice);
        uint256 out = vault.withdraw(address(basket));
        assertEq(out, 40e18);
        assertEq(wif.balanceOf(alice), 40e18);
        assertEq(vault.position(address(basket), alice).pendingUnstake, 0);

        vm.prank(alice);
        vm.expectRevert(IBackingVault.ZeroAmount.selector);
        vault.withdraw(address(basket));
    }

    function test_U_V01_secondRequestRestartsTimer() public {
        _stakeAs(alice, 100e18);
        vm.prank(alice);
        vault.requestUnstake(address(basket), 10e18);
        vm.warp(block.timestamp + 5 days);
        vm.prank(alice);
        vault.requestUnstake(address(basket), 10e18);
        IBackingVault.Position memory p = vault.position(address(basket), alice);
        assertEq(p.pendingUnstake, 20e18);
        assertEq(p.unlockAt, block.timestamp + 7 days);
        vm.warp(block.timestamp + 6 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBackingVault.StillLocked.selector, p.unlockAt));
        vault.withdraw(address(basket));
    }

    function test_U_V01_pendingUnstakeDoesNotEarn() public {
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, 100e18);
        _stakeAs(bob, 100e18);
        vm.prank(bob);
        vault.requestUnstake(address(basket), 100e18);
        _activate();
        _queue(1000e18, 0);
        _refresh(120e8, 50e8, 500e8);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        // bob has no active stake, so alice and the curator share the backers' reward
        assertEq(vault.pendingRewards(address(basket), bob), 0);
        uint256 total = vault.pendingRewards(address(basket), alice) + vault.pendingRewards(address(basket), curator);
        assertApproxEqAbs(total, 1000e18, 1e4);
    }

    function test_U_V01_unstakeErrors() public {
        _stakeAs(alice, 10e18);
        vm.startPrank(alice);
        vm.expectRevert(IBackingVault.ZeroAmount.selector);
        vault.requestUnstake(address(basket), 0);
        vm.expectRevert(IBackingVault.InsufficientActive.selector);
        vault.requestUnstake(address(basket), 11e18);
        vm.expectRevert(IBackingVault.ZeroAmount.selector);
        vault.stake(address(basket), 0);
        vm.stopPrank();
    }

    function test_U_V01_stakeForCreditsAccountAndPullsFromCaller() public {
        wif.mint(alice, 50e18);
        vm.prank(alice);
        wif.approve(address(factory), 50e18);
        factory.stakeFor(vault, wif, address(basket), curator, alice, 50e18);
        assertEq(vault.position(address(basket), curator).active, 50e18);
        assertEq(wif.balanceOf(alice), 0);
        assertEq(wif.balanceOf(address(vault)), 50e18);
    }

    function test_U_V01_withdrawWorksWithBrokenOraclesAndNoHarvester() public {
        _stakeAs(alice, 100e18);
        vm.prank(alice);
        vault.requestUnstake(address(basket), 100e18);
        feedA.set(-1, 0);
        feedSpy.set(0, 0);
        registry.setBenchmark(address(0xBAD));
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        assertEq(vault.withdraw(address(basket)), 100e18);
    }

    function test_U_V01_newStakerGetsNoWindfall() public {
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, 100e18);
        _activate();
        _queue(1000e18, 0);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        _stakeAs(bob, 100e18);
        assertEq(vault.pendingRewards(address(basket), bob), 0);
        assertGt(vault.pendingRewards(address(basket), alice), 0);
    }

    // ------------------------------------------------------------------ U-V02 timing
    function test_U_V02_settleTooEarlyThenOnce() public {
        vm.warp(ANCHOR - 1);
        vm.expectRevert(abi.encodeWithSelector(IBackingVault.TooEarly.selector, ANCHOR));
        vault.settle(address(basket));

        vm.warp(ANCHOR);
        _refresh(100e8, 50e8, 500e8);
        vault.settle(address(basket));

        vm.expectRevert(abi.encodeWithSelector(IBackingVault.TooEarly.selector, ANCHOR + WEEK));
        vault.settle(address(basket));
        vm.warp(ANCHOR + WEEK - 1);
        vm.expectRevert(abi.encodeWithSelector(IBackingVault.TooEarly.selector, ANCHOR + WEEK));
        vault.settle(address(basket));
    }

    // ------------------------------------------------------------------ U-V03 beat
    function test_U_V03_beatReleasesRewards() public {
        _beatSetup();
        _toBoundary();
        _refresh(110e8, 50e8, 500e8); // nav 200 -> 210, SPY flat

        vm.expectEmit(true, false, false, true, address(vault));
        emit IBackingVault.EpochSettled(
            address(basket),
            ANCHOR + WEEK,
            200e18,
            210e18,
            500e8,
            500e8,
            true,
            1000e18,
            500e18,
            0
        );
        vault.settle(address(basket));

        IBackingVault.BasketState memory s = vault.basketState(address(basket));
        assertEq(s.queuedBackers, 0);
        assertEq(s.queuedCurator, 0);
        assertEq(s.curatorClaimable, 500e18);
        assertEq(s.navLast, 210e18);
        assertEq(s.benchLast, 500e8);
        assertEq(s.lastSettledAt, ANCHOR + WEEK);
        assertEq(wif.balanceOf(DEAD), 0);

        // stakes: curator 1000, alice 100, bob 300 -> total 1400
        assertApproxEqAbs(vault.pendingRewards(address(basket), alice), uint256(1000e18 * 100) / 1400, uint256(1e3));
        assertApproxEqAbs(vault.pendingRewards(address(basket), bob), uint256(1000e18 * 300) / 1400, uint256(1e3));
        assertApproxEqAbs(vault.pendingRewards(address(basket), curator), uint256(1000e18 * 1000) / 1400, uint256(1e3));

        vm.prank(alice);
        uint256 got = vault.claim(address(basket), alice);
        assertApproxEqAbs(got, uint256(1000e18 * 100) / 1400, uint256(1e3));
        assertEq(wif.balanceOf(alice), got);
        assertEq(vault.pendingRewards(address(basket), alice), 0);

        vm.prank(curator);
        assertEq(vault.claimCurator(address(basket), address(0xBEEF)), 500e18);
        assertEq(wif.balanceOf(address(0xBEEF)), 500e18);
        assertEq(vault.basketState(address(basket)).curatorClaimable, 0);
    }

    function test_U_V03_beatWhenBenchmarkFalls() public {
        _beatSetup();
        _toBoundary();
        _refresh(100e8, 50e8, 400e8); // nav flat, SPY down
        vault.settle(address(basket));
        assertEq(vault.basketState(address(basket)).curatorClaimable, 500e18);
    }

    function test_U_V03_claimZeroReturnsZero() public {
        _stakeAs(alice, 1e18);
        vm.prank(alice);
        assertEq(vault.claim(address(basket), alice), 0);
        vm.prank(curator);
        assertEq(vault.claimCurator(address(basket), curator), 0);
    }

    function test_U_V03_claimCuratorOnlyCurator() public {
        vm.prank(alice);
        vm.expectRevert(IBackingVault.NotCurator.selector);
        vault.claimCurator(address(basket), alice);
    }

    function test_U_V03_unstakeAfterRewardKeepsAccrued() public {
        _beatSetup();
        _toBoundary();
        _refresh(110e8, 50e8, 500e8);
        vault.settle(address(basket));
        uint256 before = vault.pendingRewards(address(basket), bob);
        vm.prank(bob);
        vault.requestUnstake(address(basket), 300e18);
        assertEq(vault.pendingRewards(address(basket), bob), before);
        vm.prank(bob);
        assertEq(vault.claim(address(basket), bob), before);
    }

    // ------------------------------------------------------------------ U-V04 lose / tie
    function test_U_V04_loseBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(90e8, 50e8, 500e8);
        vm.expectEmit(true, false, false, true, address(vault));
        emit IBackingVault.EpochSettled(
            address(basket),
            ANCHOR + WEEK,
            200e18,
            190e18,
            500e8,
            500e8,
            false,
            0,
            0,
            1500e18
        );
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
        assertEq(vault.basketState(address(basket)).curatorClaimable, 0);
        assertEq(vault.pendingRewards(address(basket), alice), 0);
        // re-snapshot to the new (lower) NAV
        assertEq(vault.basketState(address(basket)).navLast, 190e18);
    }

    function test_U_V04_tieBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(100e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
        assertEq(vault.basketState(address(basket)).curatorClaimable, 0);
    }

    function test_U_V04_proportionalTieBurns() public {
        // both double: navNow*benchLast == navLast*benchNow -> not strictly greater
        _beatSetup();
        _toBoundary();
        _refresh(200e8, 100e8, 1000e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V04_burnsOnlyQueuedNotStake() public {
        _beatSetup();
        _toBoundary();
        _refresh(90e8, 50e8, 500e8);
        uint256 balBefore = wif.balanceOf(address(vault));
        vault.settle(address(basket));
        assertEq(wif.balanceOf(address(vault)), balBefore - 1500e18);
        assertEq(vault.basketState(address(basket)).totalActive, 1400e18);
    }

    // ------------------------------------------------------------------ U-V05 oracle failures
    function test_U_V05_staleFeedBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        feedA.set(120e8, block.timestamp - 4 days - 1);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
        assertEq(vault.basketState(address(basket)).curatorClaimable, 0);
        // invalid reading is re-snapshotted as zero
        assertEq(vault.basketState(address(basket)).navLast, 0);
        assertEq(vault.basketState(address(basket)).benchLast, 0);
    }

    function test_U_V05_ageExactlyMaxIsValid() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        feedA.set(120e8, block.timestamp - 4 days);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 0);
    }

    function test_U_V05_zeroAnswerBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        feedB.set(0, block.timestamp);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V05_negativeAnswerBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        feedSpy.set(-5, block.timestamp);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V05_invalidBenchmarkFeedBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        feedSpy.set(500e8, block.timestamp - 5 days);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V05_noBenchmarkBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        registry.setBenchmark(address(0));
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V05_revertingBasketComponentsBurns() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        basket.setShouldRevert(true);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V05_burnedThenRecoversNextEpoch() public {
        _beatSetup();
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        feedA.set(0, block.timestamp);
        vault.settle(address(basket)); // burn; snapshot nav = 0
        // next epoch: feeds fine, but navLast == 0 -> still burns, and re-snapshots validly
        _queue(100e18, 100e18);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18 + 200e18);
        assertEq(vault.basketState(address(basket)).navLast, 220e18);
        // third epoch: snapshot valid -> can beat
        _queue(100e18, 100e18);
        _toBoundary();
        _refresh(150e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1700e18);
        assertEq(vault.basketState(address(basket)).curatorClaimable, 100e18);
    }

    function test_U_V05_zeroBenchLastBurns() public {
        // register while the benchmark feed is invalid -> benchLast = 0
        feedSpy.set(0, block.timestamp);
        MockBasketForVault b2 = new MockBasketForVault();
        address[] memory t = new address[](1);
        t[0] = tokA;
        uint256[] memory u = new uint256[](1);
        u[0] = 1e18;
        b2.setComponents(t, u);
        factory.registerBasket(vault, address(b2), curator);
        assertEq(vault.basketState(address(b2)).benchLast, 0);
        wif.mint(harvester, 10e18);
        vm.prank(harvester);
        vault.queueRewards(address(b2), 5e18, 5e18);
        _toBoundary();
        _refresh(300e8, 50e8, 500e8);
        vault.settle(address(b2));
        assertEq(wif.balanceOf(DEAD), 10e18);
    }

    // ------------------------------------------------------------------ U-V06 / U-V07
    function test_U_V06_noActiveStakeBurnsBackerShare() public {
        _queue(1000e18, 500e18);
        // curator has no stake either -> curator share is burned too (not active)
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V06_noActiveStakeButCurator() public {
        // only the curator stakes, then fully unstakes -> totalActive = 0, and the curator is inactive
        _stakeAs(curator, MIN_STAKE);
        vm.prank(curator);
        vault.requestUnstake(address(basket), MIN_STAKE);
        _queue(1000e18, 500e18);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1500e18);
    }

    function test_U_V06_backerBurnedButCuratorPaid() public {
        // curator stake exactly at the minimum counts as active; backer share burned when totalActive == 0
        // (cannot have curator active with totalActive == 0), so use minCuratorStake = 0
        factory.setMinCuratorStake(0);
        _queue(1000e18, 500e18);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1000e18);
        assertEq(vault.basketState(address(basket)).curatorClaimable, 500e18);
    }

    function test_U_V07_curatorBelowMinBurnsCuratorShare() public {
        _stakeAs(curator, MIN_STAKE - 1);
        _stakeAs(alice, 100e18);
        _activate();
        assertFalse(vault.curatorActive(address(basket)));
        _queue(1000e18, 500e18);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 500e18);
        assertEq(vault.basketState(address(basket)).curatorClaimable, 0);
        // curator still earns as a backer
        assertGt(vault.pendingRewards(address(basket), curator), 0);
    }

    function test_U_V07_curatorExactlyAtMinIsActive() public {
        _stakeAs(curator, MIN_STAKE);
        assertFalse(vault.curatorActive(address(basket))); // warming does not count
        _activate();
        assertTrue(vault.curatorActive(address(basket)));
        // raising the factory minimum later deactivates
        factory.setMinCuratorStake(MIN_STAKE + 1);
        assertFalse(vault.curatorActive(address(basket)));
    }

    function test_U_V07_unstakingBelowMinDeactivates() public {
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, 100e18);
        _activate();
        vm.prank(curator);
        vault.requestUnstake(address(basket), 1);
        _queue(0, 500e18);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 500e18);
    }

    // ------------------------------------------------------------------ U-V08 donation proof
    function test_U_V08_donationDoesNotChangeNavReal() public {
        MockERC20a a = new MockERC20a();
        MockERC20a b = new MockERC20a();
        registry.setFeed(address(a), address(feedA));
        registry.setFeed(address(b), address(feedB));
        MockBasketForVault b2 = new MockBasketForVault();
        address[] memory t = new address[](2);
        t[0] = address(a);
        t[1] = address(b);
        uint256[] memory u = new uint256[](2);
        u[0] = 1e18;
        u[1] = 2e18;
        b2.setComponents(t, u);
        (uint256 navBefore, ) = vault.navOf(address(b2));
        a.mint(address(b2), 1_000_000e18);
        b.mint(address(b2), 1_000_000e18);
        (uint256 navAfter, bool valid) = vault.navOf(address(b2));
        assertTrue(valid);
        assertEq(navAfter, navBefore);
        assertEq(navAfter, 200e18);
    }

    function test_U_V08_navOfInvalidIsZero() public {
        feedB.set(50e8, block.timestamp - 10 days);
        (uint256 nav, bool valid) = vault.navOf(address(basket));
        assertEq(nav, 0);
        assertFalse(valid);
    }

    // ------------------------------------------------------------------ U-V09 missed epochs
    function test_U_V09_multipleMissedEpochsOneSettle() public {
        _beatSetup();
        vm.warp(ANCHOR + 5 * WEEK + 123);
        _refresh(110e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(vault.basketState(address(basket)).curatorClaimable, 500e18);
        assertEq(vault.basketState(address(basket)).lastSettledAt, ANCHOR + 5 * WEEK + 123);
        assertEq(vault.nextSettleAt(address(basket)), ANCHOR + 6 * WEEK);
        vm.expectRevert(abi.encodeWithSelector(IBackingVault.TooEarly.selector, ANCHOR + 6 * WEEK));
        vault.settle(address(basket));
    }

    // ------------------------------------------------------------------ U-V10 access control
    function test_U_V10_onlyFactoryRegisters() public {
        vm.expectRevert(IBackingVault.OnlyFactory.selector);
        vault.registerBasket(address(0x1234), curator);
        vm.prank(owner);
        vm.expectRevert(IBackingVault.OnlyFactory.selector);
        vault.registerBasket(address(0x1234), curator);
    }

    function test_U_V10_registerErrors() public {
        vm.expectRevert(IBackingVault.AlreadyRegistered.selector);
        factory.registerBasket(vault, address(basket), alice);
        vm.expectRevert(BackingVault.ZeroAddress.selector);
        factory.registerBasket(vault, address(0), alice);
        vm.expectRevert(BackingVault.ZeroAddress.selector);
        factory.registerBasket(vault, address(0x77), address(0));
    }

    function test_U_V10_onlyHarvesterQueues() public {
        vm.expectRevert(IBackingVault.OnlyHarvester.selector);
        vault.queueRewards(address(basket), 1, 1);
        vm.prank(owner);
        vm.expectRevert(IBackingVault.OnlyHarvester.selector);
        vault.queueRewards(address(basket), 1, 1);
    }

    function test_U_V10_queueEmitsAndAccumulates() public {
        wif.mint(harvester, 100);
        vm.expectEmit(true, false, false, true, address(vault));
        emit IBackingVault.RewardsQueued(address(basket), 3, 4);
        vm.prank(harvester);
        vault.queueRewards(address(basket), 3, 4);
        vm.prank(harvester);
        vault.queueRewards(address(basket), 1, 1);
        IBackingVault.BasketState memory s = vault.basketState(address(basket));
        assertEq(s.queuedBackers, 4);
        assertEq(s.queuedCurator, 5);
    }

    function test_U_V10_settersOnlyOwnerAndOnce() public {
        BackingVault v = new BackingVault(owner, address(registry), address(wif));
        vm.expectRevert();
        v.setFactory(address(factory));
        vm.expectRevert();
        v.setHarvester(harvester);

        vm.startPrank(owner);
        vm.expectRevert(BackingVault.ZeroAddress.selector);
        v.setFactory(address(0));
        vm.expectRevert(BackingVault.ZeroAddress.selector);
        v.setHarvester(address(0));

        vm.expectEmit(false, false, false, true, address(v));
        emit IBackingVault.FactorySet(address(factory));
        v.setFactory(address(factory));
        vm.expectEmit(false, false, false, true, address(v));
        emit IBackingVault.HarvesterSet(harvester);
        v.setHarvester(harvester);

        vm.expectRevert(IBackingVault.AlreadySet.selector);
        v.setFactory(address(0x1));
        vm.expectRevert(IBackingVault.AlreadySet.selector);
        v.setHarvester(address(0x1));
        vm.stopPrank();
        assertEq(v.factory(), address(factory));
        assertEq(v.harvester(), harvester);
    }

    function test_U_V10_ownable2Step() public {
        vm.prank(owner);
        vault.transferOwnership(alice);
        assertEq(vault.owner(), owner);
        vm.prank(alice);
        vault.acceptOwnership();
        assertEq(vault.owner(), alice);
    }

    function test_U_V10_constructorRejectsZero() public {
        vm.expectRevert(BackingVault.ZeroAddress.selector);
        new BackingVault(owner, address(0), address(wif));
        vm.expectRevert(BackingVault.ZeroAddress.selector);
        new BackingVault(owner, address(registry), address(0));
    }

    function test_U_V10_factoryUnsetBlocksRegister() public {
        BackingVault v = new BackingVault(owner, address(registry), address(wif));
        vm.expectRevert(IBackingVault.OnlyFactory.selector);
        v.registerBasket(address(basket), curator);
    }

    // ------------------------------------------------------------------ warmup (R-1) and pulled rewards (R-2)
    function test_U_V11_jitStakeEarnsNothingAtNextSettle() public {
        // honest staker + curator stake at epoch start; they warm and activate at settle 1
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, 100e18);
        _activate(); // settle 1 at ANCHOR
        assertEq(vault.position(address(basket), alice).active, 100e18);
        assertEq(vault.position(address(basket), alice).warming, 0);

        _queue(1000e18, 0);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        // attacker sees the (frozen-feed) outcome and stakes right before settle 2
        _stakeAs(bob, 1_000_000e18);
        vault.settle(address(basket));

        assertEq(vault.pendingRewards(address(basket), bob), 0);
        uint256 honest = vault.pendingRewards(address(basket), alice) + vault.pendingRewards(address(basket), curator);
        assertApproxEqAbs(honest, 1000e18, uint256(1e4));
        vm.prank(bob);
        assertEq(vault.claim(address(basket), bob), 0);
        // principal is intact and the attacker stake is now active (earns from the next settle)
        assertEq(vault.position(address(basket), bob).active, 1_000_000e18);
    }

    function test_U_V12_warmingActivatesAtNextSettleAndEarnsAfter() public {
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, 100e18);
        _activate();
        // bob warms in epoch 2, activates at settle 2 (which pays only the old active set)
        _stakeAs(bob, 100e18);
        IBackingVault.Position memory p = vault.position(address(basket), bob);
        assertEq(p.warming, 100e18);
        assertEq(p.active, 0);
        _queue(1100e18, 0);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(vault.pendingRewards(address(basket), bob), 0);
        p = vault.position(address(basket), bob);
        assertEq(p.warming, 0);
        assertEq(p.active, 100e18);
        assertEq(vault.basketState(address(basket)).totalActive, MIN_STAKE + 200e18);
        assertEq(vault.basketState(address(basket)).totalWarming, 0);
        assertEq(vault.basketState(address(basket)).settleCount, 2);

        // settle 3 pays bob pro rata: total active = 1000 + 100 + 100 = 1200, queue 1200 -> bob gets 100
        _queue(1200e18, 0);
        _toBoundary();
        _refresh(140e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertApproxEqAbs(vault.pendingRewards(address(basket), bob), 100e18, uint256(1e4));
        vm.prank(bob);
        uint256 got = vault.claim(address(basket), bob);
        assertApproxEqAbs(got, 100e18, uint256(1e4));
        assertEq(vault.pendingRewards(address(basket), bob), 0);
    }

    function test_U_V12_lazyActivationAfterManySettlesWithTopUp() public {
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, 100e18);
        _activate();
        _stakeAs(bob, 100e18); // warms with id 1
        _queue(1000e18, 0);
        _toBoundary();
        _refresh(120e8, 50e8, 500e8);
        vault.settle(address(basket)); // settle 2: bob activates
        _queue(1200e18, 0);
        _toBoundary();
        _refresh(140e8, 50e8, 500e8);
        vault.settle(address(basket)); // settle 3: bob earns 1200 * 100 / 1200 = 100
        // bob never touched the position; a top-up activates the old warming and accrues, the new stake warms
        uint256 view1 = vault.pendingRewards(address(basket), bob);
        _stakeAs(bob, 50e18);
        IBackingVault.Position memory p = vault.position(address(basket), bob);
        assertEq(p.active, 100e18);
        assertEq(p.warming, 50e18);
        assertEq(p.claimable, view1);
        assertApproxEqAbs(view1, 100e18, uint256(1e4));
    }

    function _registerB2WithImmediateStake() internal returns (MockBasketForVault b2) {
        b2 = new MockBasketForVault();
        address[] memory t = new address[](1);
        t[0] = tokA;
        uint256[] memory u = new uint256[](1);
        u[0] = 1e18;
        b2.setComponents(t, u);
        // the factory registers and stakes for the curator in the same tx
        factory.registerBasket(vault, address(b2), curator);
        wif.mint(curator, MIN_STAKE);
        vm.prank(curator);
        wif.approve(address(factory), MIN_STAKE);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IBackingVault.Staked(address(b2), curator, MIN_STAKE, false);
        factory.stakeFor(vault, wif, address(b2), curator, curator, MIN_STAKE);
    }

    function test_U_V13_curatorInitialStakeActiveImmediately() public {
        MockBasketForVault b2 = _registerB2WithImmediateStake();
        IBackingVault.Position memory p = vault.position(address(b2), curator);
        assertEq(p.active, MIN_STAKE);
        assertEq(p.warming, 0);
        assertEq(vault.basketState(address(b2)).totalActive, MIN_STAKE);
        assertTrue(vault.curatorActive(address(b2)));

        // a later factory stakeFor (a different timestamp) warms
        vm.warp(block.timestamp + 1);
        wif.mint(curator, 5e18);
        vm.prank(curator);
        wif.approve(address(factory), 5e18);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IBackingVault.Staked(address(b2), curator, 5e18, true);
        factory.stakeFor(vault, wif, address(b2), curator, curator, 5e18);
        assertEq(vault.position(address(b2), curator).warming, 5e18);

        // a curator top-up through stake() also warms
        wif.mint(curator, 7e18);
        vm.startPrank(curator);
        wif.approve(address(vault), 7e18);
        vault.stake(address(b2), 7e18);
        vm.stopPrank();
        assertEq(vault.position(address(b2), curator).warming, 12e18);
        assertEq(vault.position(address(b2), curator).active, MIN_STAKE);
    }

    function test_U_V13_curatorImmediateStakeEarnsInEpochOne() public {
        MockBasketForVault b2 = _registerB2WithImmediateStake();
        wif.mint(harvester, 300e18);
        vm.prank(harvester);
        vault.queueRewards(address(b2), 100e18, 200e18);
        vm.warp(ANCHOR);
        _refresh(150e8, 50e8, 500e8);
        vault.settle(address(b2));
        assertEq(vault.basketState(address(b2)).curatorClaimable, 200e18);
        assertApproxEqAbs(vault.pendingRewards(address(b2), curator), 100e18, uint256(1e4));
    }

    function test_U_V14_unstakeTakesWarmingFirst() public {
        _stakeAs(alice, 100e18);
        _activate(); // 100 active
        _stakeAs(alice, 50e18); // 50 warming
        vm.prank(alice);
        vault.requestUnstake(address(basket), 30e18);
        IBackingVault.Position memory p = vault.position(address(basket), alice);
        assertEq(p.warming, 20e18);
        assertEq(p.active, 100e18);
        assertEq(p.pendingUnstake, 30e18);
        assertEq(vault.basketState(address(basket)).totalWarming, 20e18);
        assertEq(vault.basketState(address(basket)).totalActive, 100e18);

        // spills into active once warming is exhausted
        vm.prank(alice);
        vault.requestUnstake(address(basket), 60e18);
        p = vault.position(address(basket), alice);
        assertEq(p.warming, 0);
        assertEq(p.active, 60e18);
        assertEq(p.pendingUnstake, 90e18);
        assertEq(vault.basketState(address(basket)).totalWarming, 0);
        assertEq(vault.basketState(address(basket)).totalActive, 60e18);

        // total (warming + active) is the cap
        vm.prank(alice);
        vm.expectRevert(IBackingVault.InsufficientActive.selector);
        vault.requestUnstake(address(basket), 61e18);
    }

    function test_U_V14_warmingUnstakeThenWithdraw() public {
        _stakeAs(alice, 10e18);
        vm.prank(alice);
        vault.requestUnstake(address(basket), 10e18);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        assertEq(vault.withdraw(address(basket)), 10e18);
        // nothing left to activate at the next settle
        _activate();
        assertEq(vault.basketState(address(basket)).totalActive, 0);
    }

    function test_U_V14_onlyWarmingStakeMeansBackerShareBurned() public {
        // totalActive == 0 with totalWarming > 0 at a beat settle: backer rewards are burned
        _stakeAs(alice, 100e18);
        _queue(1000e18, 0);
        _toBoundary();
        _refresh(150e8, 50e8, 500e8);
        vault.settle(address(basket));
        assertEq(wif.balanceOf(DEAD), 1000e18);
        assertEq(vault.pendingRewards(address(basket), alice), 0);
        assertEq(vault.basketState(address(basket)).totalActive, 100e18);
    }

    function test_U_V15_queueRewardsPullsWif() public {
        wif.mint(harvester, 300e18);
        uint256 vBefore = wif.balanceOf(address(vault));
        vm.prank(harvester);
        vault.queueRewards(address(basket), 100e18, 200e18);
        assertEq(wif.balanceOf(address(vault)), vBefore + 300e18);
        assertEq(wif.balanceOf(harvester), 0);
    }

    function test_U_V15_queueRewardsRevertsWithoutApprovalOrBalance() public {
        address h2 = address(0xFA13);
        BackingVault v = new BackingVault(owner, address(registry), address(wif));
        vm.startPrank(owner);
        v.setFactory(address(factory));
        v.setHarvester(h2);
        vm.stopPrank();
        MockBasketForVault b2 = new MockBasketForVault();
        vm.prank(address(factory));
        v.registerBasket(address(b2), curator);
        wif.mint(h2, 10e18);
        // no approval
        vm.prank(h2);
        vm.expectRevert();
        v.queueRewards(address(b2), 5e18, 5e18);
        // approval but insufficient balance
        vm.startPrank(h2);
        wif.approve(address(v), type(uint256).max);
        vm.expectRevert();
        v.queueRewards(address(b2), 10e18, 1);
        vm.stopPrank();
        assertEq(v.basketState(address(b2)).queuedBackers, 0);
    }

    // ------------------------------------------------------------------ fuzz
    function testFuzz_U_V03_rewardsConserved(uint96 sa, uint96 sb, uint96 qb, uint96 qc) public {
        uint256 stakeA = bound(sa, 1e6, 1e27);
        uint256 stakeB = bound(sb, 1e6, 1e27);
        uint256 backers = bound(qb, 0, 1e27);
        uint256 cur = bound(qc, 0, 1e27);
        _stakeAs(curator, MIN_STAKE);
        _stakeAs(alice, stakeA);
        _stakeAs(bob, stakeB);
        _activate();
        _queue(backers, cur);
        _toBoundary();
        _refresh(150e8, 50e8, 500e8);
        vault.settle(address(basket));

        vm.prank(alice);
        uint256 a = vault.claim(address(basket), alice);
        vm.prank(bob);
        uint256 b = vault.claim(address(basket), bob);
        vm.prank(curator);
        uint256 c = vault.claim(address(basket), curator);
        vm.prank(curator);
        uint256 cc = vault.claimCurator(address(basket), curator);

        assertLe(a + b + c, backers);
        assertEq(cc, cur);
        // vault still holds all principal
        assertGe(wif.balanceOf(address(vault)), MIN_STAKE + stakeA + stakeB);
    }
}

/// @dev Plain token used to show donations don't move NAV.
contract MockERC20a is MockERC20 {
    constructor() MockERC20("T", "T", 18) {}
}
