// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Basket} from "../../src/Basket.sol";
import {IBasket, BasketInit, DividendMode} from "../../src/interfaces/IBasket.sol";
import {IScaledUIAmount} from "../../src/interfaces/external/IExternal.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockHarvester} from "../mocks/MockHarvester.sol";

/// @notice Shared deployment helpers for the Basket test suites. This test contract plays the factory.
abstract contract BasketFixture is Test {
    uint256 internal constant WAD = 1e18;

    Basket internal impl;
    Basket internal basket;
    MockHarvester internal harv;
    MockERC20 internal wif;
    MockStockToken[] internal toks;
    address[] internal tokAddrs;
    uint256[] internal units;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function _deploySupport() internal {
        impl = new Basket();
        harv = new MockHarvester();
        wif = new MockERC20("WIF", "WIF", 18);
    }

    function _newTokens(uint256 n) internal returns (MockStockToken[] memory t) {
        t = new MockStockToken[](n);
        for (uint256 i; i < n; ++i) {
            t[i] = new MockStockToken("Stock", "STK");
        }
        for (uint256 i; i < n; ++i) {
            for (uint256 j; j + 1 < n - i; ++j) {
                if (address(t[j]) > address(t[j + 1])) (t[j], t[j + 1]) = (t[j + 1], t[j]);
            }
        }
    }

    /// @dev deploys `n` tokens with irregular units (so that ceil/floor are exercised) and a basket in `mode`
    function _setUp(DividendMode mode, uint256 n) internal {
        _deploySupport();
        uint256[] memory u = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            u[i] = WAD + i * 333_333_333_333_333_337 + 7;
        }
        _setUpWith(mode, u);
    }

    function _setUpWith(DividendMode mode, uint256[] memory u) internal {
        if (address(impl) == address(0)) _deploySupport();
        delete toks;
        delete tokAddrs;
        delete units;
        MockStockToken[] memory t = _newTokens(u.length);
        for (uint256 i; i < u.length; ++i) {
            toks.push(t[i]);
            tokAddrs.push(address(t[i]));
            units.push(u[i]);
        }
        basket = _clone(mode);
    }

    function _clone(DividendMode mode) internal returns (Basket b) {
        b = Basket(Clones.clone(address(impl)));
        b.initialize(
            BasketInit({
                name: "Test Basket",
                symbol: "TBSK",
                curator: alice,
                tokens: tokAddrs,
                rawUnits: units,
                mode: mode,
                harvester: address(harv),
                wif: address(wif)
            })
        );
    }

    /// @dev funds `who` with the exact component amounts and mints `shares` gross shares (no referrer)
    function _mintAs(address who, uint256 shares) internal returns (uint256 sharesOut) {
        return _mintAsWithRef(who, shares, address(0));
    }

    function _mintAsWithRef(address who, uint256 shares, address ref) internal returns (uint256 sharesOut) {
        uint256[] memory amts = basket.previewMint(shares);
        vm.startPrank(who);
        for (uint256 i; i < amts.length; ++i) {
            toks[i].mint(who, amts[i]);
            toks[i].approve(address(basket), type(uint256).max);
        }
        (sharesOut, ) = basket.mint(shares, who, ref);
        vm.stopPrank();
    }

    function _ceilDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return (a * b + c - 1) / c;
    }

    function _assertInv1() internal view {
        uint256 supply = basket.totalSupply();
        (, uint256[] memory u) = basket.components();
        uint256[] memory eff = basket.effectiveBalances();
        for (uint256 i; i < u.length; ++i) {
            assertGe(eff[i] * WAD, u[i] * supply, "INV-1");
        }
    }
}

contract BasketTest is BasketFixture {
    event Minted(
        address indexed caller,
        address indexed receiver,
        address indexed referrer,
        uint256 shares,
        uint256 feeShares,
        uint256[] amountsIn
    );
    event IOURecorded(address indexed account, address indexed token, uint256 amount);
    event IOUClaimed(address indexed account, address indexed token, address to, uint256 amount);
    event MultiplierSynced(
        address indexed token,
        uint256 oldMultiplier,
        uint256 newMultiplier,
        bool dividend,
        uint256 newRawUnits,
        uint256 skimmed
    );

    function setUp() public {
        _setUp(DividendMode.Reinvest, 3);
    }

    // ------------------------------------------------------------------ metadata
    function test_basketMetadataAndConstants() public view {
        assertEq(basket.name(), "Test Basket");
        assertEq(basket.symbol(), "TBSK");
        assertEq(basket.decimals(), 18);
        assertEq(basket.factory(), address(this));
        assertEq(basket.curator(), alice);
        assertEq(basket.harvester(), address(harv));
        assertEq(uint256(basket.mode()), uint256(DividendMode.Reinvest));
        assertEq(basket.FEE_BPS(), 30);
        assertEq(basket.REFERRAL_SHARE_BPS(), 1000);
        assertEq(basket.MAX_DIVIDEND_STEP(), 1.03e18);
        assertEq(basket.MIN_MINT_SHARES(), 1e12);
        (address[] memory t, uint256[] memory u) = basket.components();
        assertEq(t.length, 3);
        assertEq(u[1], units[1]);
        uint256[] memory lm = basket.lastMultipliers();
        assertEq(lm[0], WAD);
    }

    // ------------------------------------------------------------------ U-B01
    function test_U_B01_mintPullsCeilAndSplitsFee() public {
        uint256 shares = 1e18 + 123;
        uint256[] memory expected = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            expected[i] = _ceilDiv(units[i], shares, WAD);
        }
        uint256 fee = (shares * 30) / 10_000;
        for (uint256 i; i < 3; ++i) {
            toks[i].mint(alice, expected[i]);
            vm.prank(alice);
            toks[i].approve(address(basket), expected[i]);
        }
        vm.expectEmit(true, true, true, true, address(basket));
        emit Minted(alice, alice, bob, shares, fee, expected);
        vm.prank(alice);
        (uint256 out, uint256[] memory amts) = basket.mint(shares, alice, bob);

        assertEq(out, shares - fee);
        assertEq(basket.balanceOf(alice), shares - fee);
        assertEq(basket.balanceOf(address(harv)), fee);
        assertEq(basket.totalSupply(), shares);
        for (uint256 i; i < 3; ++i) {
            assertEq(amts[i], expected[i], "amount");
            assertEq(toks[i].balanceOf(address(basket)), expected[i]);
            assertEq(toks[i].balanceOf(alice), 0);
        }
        assertEq(harv.feeCallCount(), 1);
        (address b, address ref, uint256 s) = harv.feeCalls(0);
        assertEq(b, address(basket));
        assertEq(ref, bob);
        assertEq(s, fee);
        _assertInv1();
    }

    function test_U_B01_mintToOtherReceiver() public {
        uint256[] memory amts = basket.previewMint(2e18);
        for (uint256 i; i < 3; ++i) {
            toks[i].mint(alice, amts[i]);
            vm.prank(alice);
            toks[i].approve(address(basket), amts[i]);
        }
        vm.prank(alice);
        basket.mint(2e18, bob, address(0));
        assertEq(basket.balanceOf(bob), 2e18 - (2e18 * 30) / 10_000);
        assertEq(basket.balanceOf(alice), 0);
    }

    // ------------------------------------------------------------------ U-B02
    function test_U_B02_redeemFloorsProRataAndChargesFeeShares() public {
        _mintAs(alice, 10e18 + 17);
        uint256 supplyBefore = basket.totalSupply();
        uint256 redeemShares = 4e18 + 3;
        uint256 fee = (redeemShares * 30) / 10_000;
        uint256 net = redeemShares - fee;
        uint256[] memory eff = basket.effectiveBalances();
        uint256 harvBefore = basket.balanceOf(address(harv));

        uint256[] memory preview = basket.previewRedeem(redeemShares, alice);
        vm.prank(alice);
        uint256[] memory outs = basket.redeem(redeemShares, bob);

        for (uint256 i; i < 3; ++i) {
            uint256 want = (eff[i] * net) / supplyBefore;
            assertEq(outs[i], want, "out");
            assertEq(preview[i], want, "preview");
            assertEq(toks[i].balanceOf(bob), want);
            assertEq(toks[i].balanceOf(address(basket)), eff[i] - want);
        }
        assertEq(basket.balanceOf(address(harv)), harvBefore + fee);
        assertEq(basket.totalSupply(), supplyBefore - net);
        assertEq(harv.feeCallCount(), 2);
        (, address ref, uint256 s) = harv.feeCalls(1);
        assertEq(ref, address(0));
        assertEq(s, fee);
        _assertInv1();
    }

    function test_redeemRevertsOnBadInputs() public {
        _mintAs(alice, 1e18);
        vm.startPrank(alice);
        vm.expectRevert(IBasket.ZeroShares.selector);
        basket.redeem(0, alice);
        vm.expectRevert(IBasket.ZeroAddress.selector);
        basket.redeem(1e18, address(0));
        vm.expectRevert(); // more than owned
        basket.redeem(5e18, alice);
        vm.stopPrank();
    }

    function test_redeemEverythingLeavesFeeShares() public {
        uint256 out = _mintAs(alice, 5e18);
        vm.prank(alice);
        basket.redeem(out, alice);
        // fee shares of mint plus redeem remain, backed by the dust left behind
        assertEq(basket.balanceOf(alice), 0);
        assertGt(basket.balanceOf(address(harv)), 0);
        _assertInv1();
    }

    // ------------------------------------------------------------------ U-B03
    function test_U_B03_redeemPausedLegBecomesIOU() public {
        uint256 out = _mintAs(alice, 10e18);
        toks[1].setPaused(true);
        uint256[] memory eff = basket.effectiveBalances();
        uint256 supplyBefore = basket.totalSupply();
        uint256 net = out - (out * 30) / 10_000;

        vm.expectEmit(true, true, false, true, address(basket));
        emit IOURecorded(bob, address(toks[1]), (eff[1] * net) / supplyBefore);
        vm.prank(alice);
        uint256[] memory outs = basket.redeem(out, bob);

        uint256 owed1 = (eff[1] * net) / supplyBefore;
        assertEq(outs[1], owed1);
        assertEq(toks[0].balanceOf(bob), outs[0]);
        assertEq(toks[2].balanceOf(bob), outs[2]);
        assertEq(toks[1].balanceOf(bob), 0);
        assertEq(basket.owed(bob, address(toks[1])), owed1);
        assertEq(basket.totalOwed(address(toks[1])), owed1);
        // the IOU is excluded from the effective balance
        assertEq(basket.effectiveBalances()[1], eff[1] - owed1);
        _assertInv1();

        // cannot claim while paused (the transfer reverts)
        vm.prank(bob);
        vm.expectRevert();
        basket.claimIOU(address(toks[1]), bob);

        toks[1].setPaused(false);
        vm.expectEmit(true, true, false, true, address(basket));
        emit IOUClaimed(bob, address(toks[1]), carol, owed1);
        vm.prank(bob);
        uint256 claimed = basket.claimIOU(address(toks[1]), carol);
        assertEq(claimed, owed1);
        assertEq(toks[1].balanceOf(carol), owed1);
        assertEq(basket.owed(bob, address(toks[1])), 0);
        assertEq(basket.totalOwed(address(toks[1])), 0);

        vm.prank(bob);
        vm.expectRevert(IBasket.NothingOwed.selector);
        basket.claimIOU(address(toks[1]), bob);
    }

    function test_claimIOURevertsOnZeroTo() public {
        vm.prank(bob);
        vm.expectRevert(IBasket.ZeroAddress.selector);
        basket.claimIOU(address(toks[0]), address(0));
    }

    // ------------------------------------------------------------------ U-B04
    function test_U_B04_redeemFalseReturnLegBecomesIOU() public {
        uint256 out = _mintAs(alice, 10e18);
        toks[2].setReturnFalse(true);
        vm.prank(alice);
        uint256[] memory outs = basket.redeem(out, alice);
        assertEq(basket.owed(alice, address(toks[2])), outs[2]);
        assertEq(toks[2].balanceOf(alice), 0);
        assertEq(toks[0].balanceOf(alice), outs[0]);
        assertEq(basket.totalOwed(address(toks[2])), outs[2]);
        assertLe(basket.totalOwed(address(toks[2])), toks[2].balanceOf(address(basket)));
        _assertInv1();
    }

    function test_redeemRevertingTransferLegIsIOU() public {
        uint256 out = _mintAs(alice, 10e18);
        vm.mockCallRevert(address(toks[0]), abi.encodeWithSelector(MockStockToken.transfer.selector), "x");
        vm.prank(alice);
        uint256[] memory outs = basket.redeem(out, alice);
        assertEq(basket.owed(alice, address(toks[0])), outs[0]);
        assertEq(toks[0].balanceOf(alice), 0);
    }

    // ------------------------------------------------------------------ U-B05
    function test_U_B05_harvesterMintAndRedeemAreFeeExempt() public {
        uint256 shares = 3e18;
        uint256[] memory amts = basket.previewMint(shares);
        for (uint256 i; i < 3; ++i) {
            toks[i].mint(address(harv), amts[i]);
            harv.approve(address(toks[i]), address(basket), amts[i]);
        }
        harv.exec(address(basket), abi.encodeCall(IBasket.mint, (shares, address(harv), address(0))));
        assertEq(basket.balanceOf(address(harv)), shares, "no mint fee");
        assertEq(harv.feeCallCount(), 0, "no callback");

        uint256[] memory preview = basket.previewRedeem(shares, address(harv));
        bytes memory ret = harv.exec(address(basket), abi.encodeCall(IBasket.redeem, (shares, address(harv))));
        uint256[] memory outs = abi.decode(ret, (uint256[]));
        assertEq(basket.balanceOf(address(harv)), 0);
        assertEq(harv.feeCallCount(), 0);
        assertEq(basket.totalSupply(), 0);
        for (uint256 i; i < 3; ++i) {
            assertEq(outs[i], amts[i]);
            assertEq(preview[i], amts[i]);
            assertEq(toks[i].balanceOf(address(harv)), amts[i]);
        }
    }

    function test_mintRevertsIfHarvesterCallbackReverts() public {
        harv.setRevertOnFee(true);
        uint256[] memory amts = basket.previewMint(1e18);
        for (uint256 i; i < 3; ++i) {
            toks[i].mint(alice, amts[i]);
            vm.prank(alice);
            toks[i].approve(address(basket), amts[i]);
        }
        vm.prank(alice);
        vm.expectRevert(MockHarvester.Boom.selector);
        basket.mint(1e18, alice, address(0));
    }

    // ------------------------------------------------------------------ U-B06
    function test_U_B06_donationRaisesRedeemButNotMintAmounts() public {
        uint256 out = _mintAs(alice, 10e18);
        uint256[] memory before = basket.previewMint(1e18);
        toks[0].mint(address(basket), 5e18); // donation
        uint256[] memory afterDon = basket.previewMint(1e18);
        for (uint256 i; i < 3; ++i) {
            assertEq(before[i], afterDon[i]);
        }
        uint256 supplyBefore = basket.totalSupply();
        uint256 eff0 = basket.effectiveBalances()[0];
        uint256 net = out - (out * 30) / 10_000;
        vm.prank(alice);
        uint256[] memory outs = basket.redeem(out, alice);
        assertEq(outs[0], (eff0 * net) / supplyBefore);
        // alice receives more than she deposited of token 0
        assertGt(outs[0], _ceilDiv(units[0], 10e18, WAD));
        _assertInv1();
    }

    // ------------------------------------------------------------------ U-B07
    function test_U_B07_mintGuards() public {
        vm.expectRevert(IBasket.ZeroShares.selector);
        basket.mint(0, alice, address(0));
        vm.expectRevert(abi.encodeWithSelector(IBasket.BelowMinimumMint.selector, 1e12 - 1, 1e12));
        basket.mint(1e12 - 1, alice, address(0));
        vm.expectRevert(IBasket.ZeroAddress.selector);
        basket.mint(1e18, address(0), address(0));
    }

    function test_mintMinimumSucceeds() public {
        uint256 out = _mintAs(alice, 1e12);
        assertEq(out, 1e12 - (1e12 * 30) / 10_000);
        _assertInv1();
    }

    function test_mintRevertsWhenComponentPaused() public {
        toks[0].setPaused(true);
        uint256[] memory amts = basket.previewMint(1e18);
        for (uint256 i; i < 3; ++i) {
            toks[i].mint(alice, amts[i]);
            vm.prank(alice);
            toks[i].approve(address(basket), amts[i]);
        }
        vm.prank(alice);
        vm.expectRevert();
        basket.mint(1e18, alice, address(0));
    }

    // ------------------------------------------------------------------ U-B08
    function test_U_B08_reinvestMultiplierChangeOnlyRebaselines() public {
        _mintAs(alice, 10e18);
        uint256[] memory eff = basket.effectiveBalances();
        toks[0].setMultiplier(1.005e18);
        vm.expectEmit(true, false, false, true, address(basket));
        emit MultiplierSynced(address(toks[0]), WAD, 1.005e18, false, units[0], 0);
        basket.sync();
        (, uint256[] memory u) = basket.components();
        assertEq(u[0], units[0]);
        assertEq(basket.lastMultipliers()[0], 1.005e18);
        assertEq(basket.effectiveBalances()[0], eff[0]);
        assertEq(harv.skimCallCount(), 0);
        // idempotent
        basket.sync();
        assertEq(basket.lastMultipliers()[0], 1.005e18);
    }

    // ------------------------------------------------------------------ views / guards
    function test_previewRedeemZeroSupplyAndHarvesterOwner() public view {
        uint256[] memory outs = basket.previewRedeem(1e18, alice);
        assertEq(outs.length, 3);
        assertEq(outs[0], 0);
    }

    function test_syncSkipsTokensWithRevertingOrZeroMultiplier() public {
        _mintAs(alice, 1e18);
        vm.mockCallRevert(address(toks[0]), abi.encodeWithSelector(IScaledUIAmount.uiMultiplier.selector), "x");
        vm.mockCall(address(toks[1]), abi.encodeWithSelector(IScaledUIAmount.uiMultiplier.selector), abi.encode(0));
        basket.sync();
        assertEq(basket.lastMultipliers()[0], WAD);
        assertEq(basket.lastMultipliers()[1], WAD);
        // redeem still works
        uint256 bal = basket.balanceOf(alice);
        vm.prank(alice);
        basket.redeem(bal, alice);
    }

    function test_transfersWorkInReinvestMode() public {
        uint256 out = _mintAs(alice, 1e18);
        vm.prank(alice);
        basket.transfer(bob, out);
        assertEq(basket.balanceOf(bob), out);
        assertEq(basket.pendingWifDividend(bob), 0);
    }

    // ------------------------------------------------------------------ U-B15
    function test_U_B15_initializeOnlyOnce() public {
        BasketInit memory init = BasketInit({
            name: "x",
            symbol: "x",
            curator: alice,
            tokens: tokAddrs,
            rawUnits: units,
            mode: DividendMode.Reinvest,
            harvester: address(harv),
            wif: address(wif)
        });
        vm.expectRevert(IBasket.AlreadyInitialized.selector);
        basket.initialize(init);
        // the implementation can never be initialised
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(init);
    }

    function test_initializeRejectsZeroAddresses() public {
        Basket b = Basket(Clones.clone(address(impl)));
        BasketInit memory init = BasketInit({
            name: "x",
            symbol: "x",
            curator: address(0),
            tokens: tokAddrs,
            rawUnits: units,
            mode: DividendMode.Reinvest,
            harvester: address(harv),
            wif: address(wif)
        });
        vm.expectRevert(IBasket.ZeroAddress.selector);
        b.initialize(init);
    }

    // ------------------------------------------------------------------ Z-B01
    function testFuzz_Z_B01_roundTripNeverProfitsAndKeepsBacking(
        uint256 shares,
        uint256 u0,
        uint256 u1,
        uint256 u2
    ) public {
        shares = bound(shares, 1e12, 1e30);
        uint256[] memory u = new uint256[](3);
        u[0] = bound(u0, 1, 1e24);
        u[1] = bound(u1, 1, 1e24);
        u[2] = bound(u2, 1, 1e24);
        _setUpWith(DividendMode.Reinvest, u);

        uint256[] memory amts = basket.previewMint(shares);
        uint256 out = _mintAs(alice, shares);
        // a second, unrelated holder to make the redeem non-trivial
        _mintAs(bob, shares / 2 + 1e12);
        _assertInv1();

        vm.prank(alice);
        uint256[] memory outs = basket.redeem(out, alice);
        for (uint256 i; i < 3; ++i) {
            assertLe(outs[i], amts[i], "profit from round trip");
            assertEq(toks[i].balanceOf(alice), outs[i]);
        }
        _assertInv1();
    }

    function testFuzz_Z_B01_partialRedeemKeepsBacking(uint256 shares, uint256 frac) public {
        shares = bound(shares, 1e12, 1e30);
        frac = bound(frac, 1, 1e4);
        uint256 out = _mintAs(alice, shares);
        uint256 r = (out * frac) / 1e4;
        if (r == 0) r = 1;
        vm.prank(alice);
        basket.redeem(r, bob);
        _assertInv1();
    }

    // ------------------------------------------------------------------ gas
    function test_U_GAS_mintRedeem3And8() public {
        _gas(3);
        _gas(8);
    }

    function _gas(uint256 n) internal {
        _setUp(DividendMode.Reinvest, n);
        // first mint (warm-up: storage slots of balances are cold/zero) and a second mint/redeem by a funded holder
        _mintAs(bob, 5e18);
        uint256 shares = 1e18;
        uint256[] memory amts = basket.previewMint(shares);
        vm.startPrank(alice);
        for (uint256 i; i < n; ++i) {
            toks[i].mint(alice, amts[i]);
            toks[i].approve(address(basket), type(uint256).max);
        }
        uint256 g = gasleft();
        (uint256 out, ) = basket.mint(shares, alice, address(0));
        uint256 mintGas = g - gasleft();
        g = gasleft();
        basket.redeem(out, alice);
        uint256 redeemGas = g - gasleft();
        vm.stopPrank();
        console.log("components", n);
        console.log("  mint gas  ", mintGas);
        console.log("  redeem gas", redeemGas);
    }
}
