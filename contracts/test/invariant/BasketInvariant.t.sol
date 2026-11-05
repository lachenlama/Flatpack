// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Basket} from "../../src/Basket.sol";
import {IBasket, BasketInit, DividendMode} from "../../src/interfaces/IBasket.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockHarvester} from "../mocks/MockHarvester.sol";

/// @notice Drives the basket with random, bounded actions. Reverts that are caused by the environment (a paused
///         component on mint, or the caller's own bad input) are swallowed. A REDEEM that is valid by construction
///         and still reverts is recorded in `redeemFailures` (INV-7).
contract BasketHandler is Test {
    Basket public basket;
    MockHarvester public harv;
    MockStockToken[] public toks;
    address[] public actors;

    uint256 public redeemFailures;
    uint256 public mints;
    uint256 public redeems;
    uint256 public iouRecorded;
    uint256 public skims;

    constructor(Basket basket_, MockHarvester harv_, MockStockToken[] memory toks_, address[] memory actors_) {
        basket = basket_;
        harv = harv_;
        for (uint256 i; i < toks_.length; ++i) {
            toks.push(toks_[i]);
        }
        actors = actors_;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _tok(uint256 seed) internal view returns (MockStockToken) {
        return toks[seed % toks.length];
    }

    function mint(uint256 actorSeed, uint256 shares) external {
        address a = _actor(actorSeed);
        shares = bound(shares, 1e12, 1e24);
        // sync first so that previewMint uses the up-to-date units (the router does the same)
        try basket.sync() {} catch {}
        uint256[] memory amts = basket.previewMint(shares);
        vm.startPrank(a);
        for (uint256 i; i < toks.length; ++i) {
            toks[i].mint(a, amts[i]);
            toks[i].approve(address(basket), type(uint256).max);
        }
        try basket.mint(shares, a, address(0)) {
            mints++;
        } catch {}
        vm.stopPrank();
    }

    function redeem(uint256 actorSeed, uint256 recvSeed, uint256 shares) external {
        address a = _actor(actorSeed);
        uint256 bal = basket.balanceOf(a);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        address recv = _actor(recvSeed);
        vm.prank(a);
        try basket.redeem(shares, recv) {
            redeems++;
        } catch {
            redeemFailures++;
        }
    }

    function transferShares(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address a = _actor(fromSeed);
        uint256 bal = basket.balanceOf(a);
        if (bal == 0) return;
        vm.prank(a);
        basket.transfer(_actor(toSeed), bound(amount, 0, bal));
    }

    function donate(uint256 tokSeed, uint256 amount) external {
        _tok(tokSeed).mint(address(basket), bound(amount, 1, 1e24));
    }

    function setPaused(uint256 tokSeed, bool p) external {
        _tok(tokSeed).setPaused(p);
    }

    function setReturnFalse(uint256 tokSeed, bool r) external {
        _tok(tokSeed).setReturnFalse(r);
    }

    /// @dev multiplier * (1 + bps/10000), bps in [1, 300]: a dividend-sized step
    function bumpDividend(uint256 tokSeed, uint256 bps) external {
        MockStockToken t = _tok(tokSeed);
        bps = bound(bps, 1, 300);
        t.setMultiplier((t.uiMultiplier() * (10_000 + bps)) / 10_000);
    }

    /// @dev a split-sized step: x2..x5, or a reverse split down to 1/5 (floored at 1e6 to avoid dust multipliers)
    function bumpSplit(uint256 tokSeed, uint256 factor, bool reverse) external {
        MockStockToken t = _tok(tokSeed);
        factor = bound(factor, 2, 5);
        uint256 m = t.uiMultiplier();
        if (reverse) {
            if (m / factor < 1e6) return;
            t.setMultiplier(m / factor);
        } else {
            if (m > type(uint128).max) return;
            t.setMultiplier(m * factor);
        }
    }

    function sync() external {
        try basket.sync() {} catch {}
    }

    function claimIOU(uint256 actorSeed, uint256 tokSeed) external {
        address a = _actor(actorSeed);
        address t = address(_tok(tokSeed));
        if (basket.owed(a, t) == 0) return;
        vm.prank(a);
        try basket.claimIOU(t, a) {} catch {}
    }

    function claimWif(uint256 actorSeed) external {
        address a = _actor(actorSeed);
        vm.prank(a);
        try basket.claimWifDividend(a) {} catch {}
    }

    function notifyWif(uint256 amount) external {
        if (basket.mode() != DividendMode.PayInWif || basket.totalSupply() == 0) return;
        amount = bound(amount, 1, 1e24);
        MockERC20 wif = MockERC20(basketWif());
        wif.mint(address(basket), amount);
        harv.exec(address(basket), abi.encodeCall(IBasket.notifyWifDividend, (amount)));
    }

    address internal _wifAddr;

    function setWif(address w) external {
        _wifAddr = w;
    }

    function basketWif() public view returns (address) {
        return _wifAddr;
    }
}

abstract contract BasketInvariantBase is Test {
    Basket internal basket;
    MockHarvester internal harv;
    MockERC20 internal wif;
    MockStockToken[] internal toks;
    BasketHandler internal handler;
    address[] internal actors;

    function _build(DividendMode mode) internal {
        harv = new MockHarvester();
        wif = new MockERC20("WIF", "WIF", 18);
        MockStockToken[] memory t = new MockStockToken[](3);
        for (uint256 i; i < 3; ++i) {
            t[i] = new MockStockToken("S", "S");
        }
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j + 1 < 3 - i; ++j) {
                if (address(t[j]) > address(t[j + 1])) (t[j], t[j + 1]) = (t[j + 1], t[j]);
            }
        }
        address[] memory addrs = new address[](3);
        uint256[] memory u = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            toks.push(t[i]);
            addrs[i] = address(t[i]);
            u[i] = 1e18 + i * 777_777_777_777_777_773 + 5;
        }
        basket = Basket(Clones.clone(address(new Basket())));
        basket.initialize(
            BasketInit({
                name: "Inv",
                symbol: "INV",
                curator: address(this),
                tokens: addrs,
                rawUnits: u,
                mode: mode,
                harvester: address(harv),
                wif: address(wif)
            })
        );
        actors.push(makeAddr("a0"));
        actors.push(makeAddr("a1"));
        actors.push(makeAddr("a2"));
        actors.push(address(harv));
        handler = new BasketHandler(basket, harv, t, actors);
        handler.setWif(address(wif));
        targetContract(address(handler));
    }

    /// @dev INV-1: effBal * 1e18 >= rawUnits * totalSupply for every component
    function invariant_INV1_fullBacking() public view {
        (, uint256[] memory u) = basket.components();
        uint256[] memory eff = basket.effectiveBalances();
        uint256 supply = basket.totalSupply();
        for (uint256 i; i < u.length; ++i) {
            assertGe(eff[i] * 1e18, u[i] * supply, "INV-1");
        }
    }

    /// @dev INV-2: sum of owed == totalOwed <= balance
    function invariant_INV2_iouSolvency() public view {
        for (uint256 i; i < toks.length; ++i) {
            address t = address(toks[i]);
            uint256 sum;
            for (uint256 j; j < actors.length; ++j) {
                sum += basket.owed(actors[j], t);
            }
            assertEq(sum, basket.totalOwed(t), "sum(owed) != totalOwed");
            assertLe(basket.totalOwed(t), toks[i].balanceOf(address(basket)), "totalOwed > balance");
        }
    }

    /// @dev INV-7: a redeem that is valid by construction never reverts, whatever the components do
    function invariant_INV7_redeemLiveness() public view {
        assertEq(handler.redeemFailures(), 0, "redeem reverted");
    }

    /// @dev supply bookkeeping: shares held by the known actors add up to the total supply
    function invariant_supplyEqualsSumOfBalances() public view {
        uint256 sum;
        for (uint256 j; j < actors.length; ++j) {
            sum += basket.balanceOf(actors[j]);
        }
        assertEq(sum, basket.totalSupply());
    }
}

contract BasketInvariantReinvestTest is BasketInvariantBase {
    function setUp() public {
        _build(DividendMode.Reinvest);
    }
}

contract BasketInvariantPayInWifTest is BasketInvariantBase {
    function setUp() public {
        _build(DividendMode.PayInWif);
    }

    /// @dev the basket's $WIF always covers what holders can claim
    function invariant_wifDividendSolvency() public view {
        uint256 pending;
        for (uint256 j; j < actors.length; ++j) {
            pending += basket.pendingWifDividend(actors[j]);
        }
        assertLe(pending, wif.balanceOf(address(basket)), "pending WIF exceeds balance");
    }
}
