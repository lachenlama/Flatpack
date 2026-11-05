// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ForkBase} from "./RouterFork.t.sol";
import {DividendMode} from "../../src/interfaces/IBasket.sol";
import {IBackingVault} from "../../src/interfaces/IBackingVault.sol";
import {IAggregatorV3} from "../../src/interfaces/external/IExternal.sol";

/// @notice Full product flow on the pinned mainnet fork: create a basket (stake $WIF) -> buy with USDG -> harvest fees
///         (burn / vault queue) -> warp past an epoch -> Beat-SPY settlement -> backer and curator claims -> redeem.
contract EndToEndForkTest is ForkBase {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant SHARES = 30e18; // ~ $9k, so the fee is worth selling
    uint256 internal constant BUDGET = 12_000e6;

    /// @dev Replaces a Chainlink feed's answer with `answer * bps / 10000`, fresh as of now (the real feeds go stale
    ///      after the time warp).
    function _repriceFeed(address feed, uint256 bps) internal {
        (uint80 roundId, int256 answer, , , ) = IAggregatorV3(feed).latestRoundData();
        int256 nextAnswer = (answer * int256(bps)) / 10_000;
        vm.mockCall(
            feed,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(roundId + 1, nextAnswer, block.timestamp, block.timestamp, roundId + 1)
        );
    }

    function _warpToSettlement() internal {
        uint64 at = vault.nextSettleAt(address(basket));
        vm.warp(uint256(at) + 1);
    }

    function _rewardsRound(uint256 componentsBps, uint256 spyBps) internal returns (uint256 queuedB, uint256 queuedC) {
        IBackingVault.BasketState memory q = vault.basketState(address(basket));
        queuedB = q.queuedBackers;
        queuedC = q.queuedCurator;
        _warpToSettlement();
        _repriceFeed(NVDA_FEED, componentsBps);
        _repriceFeed(AAPL_FEED, componentsBps);
        _repriceFeed(MSFT_FEED, componentsBps);
        _repriceFeed(SPY_FEED, spyBps);
        vault.settle(address(basket));
    }

    function test_F_E2E_createBuyHarvestSettleClaim() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);

        // curator staked at creation; the basket is registered with a valid NAV snapshot
        IBackingVault.Position memory pos = vault.position(address(basket), curator);
        assertEq(pos.active, MIN_STAKE, "curator stake active");
        assertTrue(vault.curatorActive(address(basket)));

        // a backer joins (warming: only earns from the settle after)
        address backer = makeAddr("backer");
        _fund(WIF, backer, 500e18);
        vm.startPrank(backer);
        IERC20(WIF).approve(address(vault), 500e18);
        vault.stake(address(basket), 500e18);
        vm.stopPrank();

        // buy through the router, then harvest the fee shares into the vault queue
        _buy(SHARES, BUDGET, receiver, address(0));
        _assertRouterEmpty();
        uint256 deadBefore = IERC20(WIF).balanceOf(DEAD);
        vm.prank(owner);
        uint256 wifOut = harvester.harvestFees(address(basket), 0, block.timestamp + 1 hours);
        assertEq(IERC20(WIF).balanceOf(DEAD) - deadBefore, wifOut / 2, "50% burned");

        // settle after the epoch boundary with the basket beating SPY (+10% vs flat)
        (uint256 queuedB, uint256 queuedC) = _rewardsRound(11_000, 10_000);
        assertGt(queuedB, 0);
        assertGt(queuedC, 0);
        IBackingVault.BasketState memory s = vault.basketState(address(basket));
        assertEq(s.queuedBackers, 0, "queue drained");
        assertEq(s.queuedCurator, 0, "queue drained");
        assertEq(s.curatorClaimable, queuedC, "curator share released");

        // the curator (active from creation) earns the backer share; the warming backer was not active for this epoch
        uint256 wifVaultBefore = IERC20(WIF).balanceOf(address(vault));
        vm.prank(curator);
        uint256 curatorBackerShare = vault.claim(address(basket), curator);
        assertApproxEqAbs(curatorBackerShare, queuedB, 1e6, "sole active staker takes the backer share");
        vm.prank(curator);
        uint256 curatorShare = vault.claimCurator(address(basket), curator);
        assertEq(curatorShare, queuedC);
        assertEq(IERC20(WIF).balanceOf(curator), curatorBackerShare + curatorShare);
        assertEq(wifVaultBefore - IERC20(WIF).balanceOf(address(vault)), curatorBackerShare + curatorShare);
        // INV-5: the vault still covers all stakes
        assertGe(IERC20(WIF).balanceOf(address(vault)), MIN_STAKE + 500e18, "vault solvent");

        // the holder exits in kind: no router, oracle or keeper involved
        uint256 held = basket.balanceOf(receiver);
        vm.prank(receiver);
        basket.redeem(held, receiver);
        assertGt(IERC20(NVDA).balanceOf(receiver), 0);
        assertGt(IERC20(AAPL).balanceOf(receiver), 0);
        assertGt(IERC20(MSFT).balanceOf(receiver), 0);
        // the redeem fee went to the harvester: a second harvest works
        vm.prank(owner);
        assertGt(harvester.harvestFees(address(basket), 0, block.timestamp + 1 hours), 0);
        console.log("E2E WIF harvested (first):", wifOut);
    }

    function test_F_E2E_losingToSpyBurnsQueuedRewards() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        _buy(SHARES, BUDGET, receiver, address(0));
        vm.prank(owner);
        uint256 wifOut = harvester.harvestFees(address(basket), 0, block.timestamp + 1 hours);
        IBackingVault.BasketState memory q = vault.basketState(address(basket));
        uint256 queued = q.queuedBackers + q.queuedCurator;
        assertEq(queued, wifOut - wifOut / 2);

        uint256 deadBefore = IERC20(WIF).balanceOf(DEAD);
        _rewardsRound(9_000, 10_000); // basket -10% vs SPY flat
        assertEq(IERC20(WIF).balanceOf(DEAD) - deadBefore, queued, "everything queued is burned");
        IBackingVault.BasketState memory s = vault.basketState(address(basket));
        assertEq(s.curatorClaimable, 0);
    }
}
