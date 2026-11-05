// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasketFixture} from "./Basket.t.sol";
import {IBasket, DividendMode} from "../../src/interfaces/IBasket.sol";

/// @notice Multiplier sync / dividend skim (U-B09..U-B12) and the $WIF dividend accumulator (U-B13, U-B14).
contract BasketDividendsTest is BasketFixture {
    event MultiplierSynced(
        address indexed token,
        uint256 oldMultiplier,
        uint256 newMultiplier,
        bool dividend,
        uint256 newRawUnits,
        uint256 skimmed
    );
    event WifDividendNotified(uint256 amount, uint256 accWifPerShare);
    event WifDividendClaimed(address indexed account, address indexed to, uint256 amount);

    function setUp() public {
        _setUp(DividendMode.PayInWif, 3);
    }

    function _notify(uint256 amount) internal {
        wif.mint(address(harv), amount);
        harv.exec(address(wif), abi.encodeCall(wif.transfer, (address(basket), amount)));
        harv.exec(address(basket), abi.encodeCall(IBasket.notifyWifDividend, (amount)));
    }

    // ------------------------------------------------------------------ U-B09
    function test_U_B09_dividendShrinksUnitsAndSkimsExcess() public {
        _mintAs(alice, 10e18);
        uint256 supply = basket.totalSupply();
        uint256 eff0 = basket.effectiveBalances()[0];
        uint256 m = 1.005e18;
        uint256 newUnits = _ceilDiv(units[0], WAD, m);
        uint256 needed = _ceilDiv(newUnits, supply, WAD);
        uint256 excess = eff0 - needed;
        assertGt(excess, 0);

        toks[0].setMultiplier(m);
        vm.expectEmit(true, false, false, true, address(basket));
        emit MultiplierSynced(address(toks[0]), WAD, m, true, newUnits, excess);
        basket.sync();

        (, uint256[] memory u) = basket.components();
        assertEq(u[0], newUnits);
        assertEq(u[1], units[1]);
        assertEq(basket.lastMultipliers()[0], m);
        assertEq(toks[0].balanceOf(address(harv)), excess);
        assertEq(harv.skimCallCount(), 1);
        (address b, address t, uint256 a) = harv.skimCalls(0);
        assertEq(b, address(basket));
        assertEq(t, address(toks[0]));
        assertEq(a, excess);
        assertEq(basket.effectiveBalances()[0], needed);
        _assertInv1();

        // idempotent, and mint now uses the new units
        basket.sync();
        assertEq(harv.skimCallCount(), 1);
        assertEq(basket.previewMint(WAD)[0], newUnits);
    }

    function test_dividendWithZeroSupplyAdjustsUnitsWithoutSkim() public {
        toks[0].mint(address(basket), 1e18); // donation only, supply is zero
        toks[0].setMultiplier(1.01e18);
        basket.sync();
        (, uint256[] memory u) = basket.components();
        assertEq(u[0], _ceilDiv(units[0], WAD, 1.01e18));
        assertEq(harv.skimCallCount(), 0);
        assertEq(toks[0].balanceOf(address(harv)), 0);
    }

    function test_dividendSkimFailureDoesNotBlockSyncOrRedeem() public {
        uint256 out = _mintAs(alice, 10e18);
        toks[0].setMultiplier(1.01e18);
        toks[0].setPaused(true);
        basket.sync(); // trySafeTransfer fails, the excess stays in the basket
        assertEq(harv.skimCallCount(), 0);
        assertEq(basket.lastMultipliers()[0], 1.01e18);
        _assertInv1();
        vm.prank(alice);
        basket.redeem(out, alice); // paused leg becomes an IOU, the rest pays
        assertGt(basket.owed(alice, address(toks[0])), 0);
    }

    function test_dividendSkimsDonationToo() public {
        _mintAs(alice, 10e18);
        toks[1].mint(address(basket), 7e18);
        toks[1].setMultiplier(1.001e18);
        basket.sync();
        // the donation plus the dividend excess both go to the harvester
        assertGt(toks[1].balanceOf(address(harv)), 7e18);
        _assertInv1();
    }

    // ------------------------------------------------------------------ U-B10
    function test_U_B10_splitDoesNotSkim() public {
        _mintAs(alice, 10e18);
        toks[0].setMultiplier(3e18);
        basket.sync();
        (, uint256[] memory u) = basket.components();
        assertEq(u[0], units[0]);
        assertEq(basket.lastMultipliers()[0], 3e18);
        assertEq(harv.skimCallCount(), 0);
        _assertInv1();
    }

    // ------------------------------------------------------------------ U-B11
    function test_U_B11_exactlyThreePercentSkims() public {
        _mintAs(alice, 10e18);
        toks[0].setMultiplier(1.03e18);
        basket.sync();
        assertEq(harv.skimCallCount(), 1);
        (, uint256[] memory u) = basket.components();
        assertEq(u[0], _ceilDiv(units[0], WAD, 1.03e18));
        _assertInv1();
    }

    function test_U_B11_aboveThreePercentDoesNotSkim() public {
        _mintAs(alice, 10e18);
        toks[0].setMultiplier(1.030001e18);
        basket.sync();
        assertEq(harv.skimCallCount(), 0);
        (, uint256[] memory u) = basket.components();
        assertEq(u[0], units[0]);
        assertEq(basket.lastMultipliers()[0], 1.030001e18);
    }

    function test_dividendStepIsRelativeToLastMultiplier() public {
        _mintAs(alice, 10e18);
        toks[0].setMultiplier(2e18); // split
        basket.sync();
        toks[0].setMultiplier(2.02e18); // +1% on top of 2.0: a dividend
        basket.sync();
        assertEq(harv.skimCallCount(), 1);
    }

    // ------------------------------------------------------------------ U-B12
    function test_U_B12_decreaseDoesNotSkim() public {
        _mintAs(alice, 10e18);
        toks[0].setMultiplier(0.99e18);
        basket.sync();
        assertEq(harv.skimCallCount(), 0);
        (, uint256[] memory u) = basket.components();
        assertEq(u[0], units[0]);
        assertEq(basket.lastMultipliers()[0], 0.99e18);
    }

    function test_mintAndRedeemSyncFirst() public {
        _mintAs(alice, 10e18);
        toks[0].setMultiplier(1.01e18);
        _mintAs(bob, 1e18); // mint triggers the sync
        assertEq(harv.skimCallCount(), 1);
        toks[1].setMultiplier(1.01e18);
        uint256 bal = basket.balanceOf(bob);
        vm.prank(bob);
        basket.redeem(bal, bob); // redeem triggers the sync
        assertEq(harv.skimCallCount(), 2);
        _assertInv1();
    }

    // ------------------------------------------------------------------ U-B13
    function test_U_B13_accumulatorSplitsBetweenHoldersAndFollowsTransfers() public {
        uint256 a = _mintAs(alice, 10e18); // 9.97e18
        uint256 b = _mintAs(bob, 30e18); // 29.91e18
        uint256 hv = basket.balanceOf(address(harv)); // 0.12e18
        assertEq(basket.totalSupply(), 40e18);

        wif.mint(address(harv), 100e18);
        harv.exec(address(wif), abi.encodeCall(wif.transfer, (address(basket), 100e18)));
        vm.expectEmit(false, false, false, true, address(basket));
        emit WifDividendNotified(100e18, 2.5e18);
        harv.exec(address(basket), abi.encodeCall(IBasket.notifyWifDividend, (100e18)));
        assertEq(basket.pendingWifDividend(alice), (a * 25) / 10);
        assertEq(basket.pendingWifDividend(bob), (b * 25) / 10);
        assertEq(basket.pendingWifDividend(address(harv)), (hv * 25) / 10);
        uint256 pa = basket.pendingWifDividend(alice);
        uint256 pb = basket.pendingWifDividend(bob);

        // transfer settles both sides first: nothing moves with the shares
        vm.prank(alice);
        basket.transfer(bob, 4e18);
        assertEq(basket.pendingWifDividend(alice), pa);
        assertEq(basket.pendingWifDividend(bob), pb);

        // a new dividend follows the new balances
        _notify(40e18); // +1e18 per share
        assertEq(basket.pendingWifDividend(alice), pa + (a - 4e18));
        assertEq(basket.pendingWifDividend(bob), pb + b + 4e18);

        // a late minter earns nothing from past dividends
        uint256 c = _mintAs(carol, 2e18);
        assertEq(basket.pendingWifDividend(carol), 0);
        assertEq(basket.balanceOf(carol), c);

        // claims
        uint256 expA = pa + (a - 4e18);
        vm.expectEmit(true, true, false, true, address(basket));
        emit WifDividendClaimed(alice, carol, expA);
        vm.prank(alice);
        uint256 got = basket.claimWifDividend(carol);
        assertEq(got, expA);
        assertEq(wif.balanceOf(carol), expA);
        assertEq(basket.pendingWifDividend(alice), 0);
        vm.prank(alice);
        assertEq(basket.claimWifDividend(carol), 0); // nothing left, no revert

        vm.prank(bob);
        assertEq(basket.claimWifDividend(bob), pb + b + 4e18);

        // a full redeem keeps (and later pays) the pending amount
        _notify(10e18);
        uint256 pc = basket.pendingWifDividend(carol);
        assertGt(pc, 0);
        vm.prank(carol);
        basket.redeem(c, carol);
        assertEq(basket.pendingWifDividend(carol), pc);
        vm.prank(carol);
        assertEq(basket.claimWifDividend(carol), pc);

        // the harvester (fee-share holder) claims through the same path
        uint256 ph = basket.pendingWifDividend(address(harv));
        assertGt(ph, 0);
        harv.exec(address(basket), abi.encodeCall(IBasket.claimWifDividend, (address(harv))));
        assertEq(wif.balanceOf(address(harv)), ph);

        // solvency: the basket still holds at least what is pending
        uint256 pending =
            basket.pendingWifDividend(alice) +
                basket.pendingWifDividend(bob) +
                basket.pendingWifDividend(carol) +
                basket.pendingWifDividend(address(harv));
        assertLe(pending, wif.balanceOf(address(basket)));
    }

    function test_claimWifDividendZeroToReverts() public {
        vm.expectRevert(IBasket.ZeroAddress.selector);
        basket.claimWifDividend(address(0));
    }

    function test_selfTransferKeepsPendingIntact() public {
        uint256 a = _mintAs(alice, 10e18);
        _notify(10e18);
        uint256 p = basket.pendingWifDividend(alice);
        vm.prank(alice);
        basket.transfer(alice, a);
        assertEq(basket.pendingWifDividend(alice), p);
    }

    // ------------------------------------------------------------------ U-B14
    function test_U_B14_notifyGuards() public {
        // zero supply
        vm.expectRevert(IBasket.NoSupply.selector);
        harv.exec(address(basket), abi.encodeCall(IBasket.notifyWifDividend, (1e18)));
        _mintAs(alice, 1e18);
        // not the harvester
        vm.prank(alice);
        vm.expectRevert(IBasket.OnlyHarvester.selector);
        basket.notifyWifDividend(1e18);
    }

    function test_U_B14_notifyRevertsInReinvestMode() public {
        _setUp(DividendMode.Reinvest, 3);
        _mintAs(alice, 1e18);
        vm.expectRevert(IBasket.NotPayInWif.selector);
        harv.exec(address(basket), abi.encodeCall(IBasket.notifyWifDividend, (1e18)));
        // claim is a harmless no-op
        vm.prank(alice);
        assertEq(basket.claimWifDividend(alice), 0);
    }
}
