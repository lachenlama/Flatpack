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

/// @dev Drives random stake, unstake, withdraw, queue, settle, claim, price moves and time warps across epoch boundaries.
contract VaultHandler is Test {
    uint64 internal constant ANCHOR = 1794016800;

    BackingVault public vault;
    MockERC20 public wif;
    MockFactoryForVault public factory;
    MockAggregator public feedA;
    MockAggregator public feedSpy;
    address public harvester;
    address public curator;

    address[] public baskets;
    address[] public actors;

    // ghost accounting
    uint256 public ghostStaked;
    uint256 public ghostWithdrawn;
    uint256 public ghostQueued;
    uint256 public ghostClaimed;
    uint256 public settles;
    uint256 public beats;

    constructor(
        BackingVault vault_,
        MockERC20 wif_,
        MockFactoryForVault factory_,
        MockAggregator feedA_,
        MockAggregator feedSpy_,
        address harvester_,
        address curator_,
        address[] memory baskets_
    ) {
        vault = vault_;
        wif = wif_;
        factory = factory_;
        feedA = feedA_;
        feedSpy = feedSpy_;
        harvester = harvester_;
        curator = curator_;
        baskets = baskets_;
        vm.prank(harvester_);
        wif_.approve(address(vault_), type(uint256).max);
        actors.push(address(0x1001));
        actors.push(address(0x1002));
        actors.push(address(0x1003));
        actors.push(curator_);
    }

    function basketCount() external view returns (uint256) {
        return baskets.length;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _b(uint256 seed) internal view returns (address) {
        return baskets[seed % baskets.length];
    }

    function _a(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function stake(uint256 bSeed, uint256 aSeed, uint256 amount) external {
        amount = bound(amount, 1, 1e24);
        address who = _a(aSeed);
        wif.mint(who, amount);
        vm.startPrank(who);
        wif.approve(address(vault), amount);
        vault.stake(_b(bSeed), amount);
        vm.stopPrank();
        ghostStaked += amount;
    }

    function requestUnstake(uint256 bSeed, uint256 aSeed, uint256 amount) external {
        address b = _b(bSeed);
        address who = _a(aSeed);
        uint256 active = vault.position(b, who).active;
        if (active == 0) return;
        amount = bound(amount, 1, active);
        vm.prank(who);
        vault.requestUnstake(b, amount);
    }

    function withdraw(uint256 bSeed, uint256 aSeed) external {
        address b = _b(bSeed);
        address who = _a(aSeed);
        IBackingVault.Position memory p = vault.position(b, who);
        if (p.pendingUnstake == 0 || block.timestamp < p.unlockAt) return;
        vm.prank(who);
        ghostWithdrawn += vault.withdraw(b);
    }

    function queue(uint256 bSeed, uint256 backers, uint256 cur) external {
        backers = bound(backers, 0, 1e24);
        cur = bound(cur, 0, 1e24);
        wif.mint(harvester, backers + cur);
        vm.prank(harvester);
        vault.queueRewards(_b(bSeed), backers, cur);
        ghostQueued += backers + cur;
    }

    function settle(uint256 bSeed) external {
        address b = _b(bSeed);
        if (block.timestamp < vault.nextSettleAt(b)) return;
        vault.settle(b);
        settles++;
    }

    function claim(uint256 bSeed, uint256 aSeed) external {
        address who = _a(aSeed);
        vm.prank(who);
        ghostClaimed += vault.claim(_b(bSeed), who);
    }

    function claimCurator(uint256 bSeed) external {
        vm.prank(curator);
        ghostClaimed += vault.claimCurator(_b(bSeed), curator);
    }

    /// @dev Just-in-time sequence: warp to the boundary, stake, then settle in the same block.
    function stakeThenSettle(uint256 bSeed, uint256 aSeed, uint256 amount) external {
        address b = _b(bSeed);
        uint256 t = vault.nextSettleAt(b);
        if (t > block.timestamp) vm.warp(t);
        amount = bound(amount, 1, 1e24);
        address who = _a(aSeed);
        wif.mint(who, amount);
        vm.startPrank(who);
        wif.approve(address(vault), amount);
        vault.stake(b, amount);
        vm.stopPrank();
        ghostStaked += amount;
        vault.settle(b);
        settles++;
    }

    /// @dev Random move across epoch boundaries (up to ~3 weeks).
    function warp(uint256 dt) external {
        dt = bound(dt, 1 hours, 21 days);
        vm.warp(block.timestamp + dt);
    }

    /// @dev Warps exactly to just past the next boundary of a basket.
    function warpToBoundary(uint256 bSeed, uint256 extra) external {
        uint256 t = vault.nextSettleAt(_b(bSeed)) + bound(extra, 0, 2 days);
        if (t > block.timestamp) vm.warp(t);
    }

    /// @dev Moves prices; sometimes leaves the feed stale or invalid.
    function movePrices(uint256 a, uint256 spy, uint256 mode) external {
        a = bound(a, 1, 1000) * 1e8;
        spy = bound(spy, 1, 1000) * 1e8;
        uint256 m = mode % 4;
        if (m == 0) {
            feedA.set(int256(a), block.timestamp);
            feedSpy.set(int256(spy), block.timestamp);
        } else if (m == 1) {
            feedA.set(int256(a), block.timestamp - 5 days); // stale
            feedSpy.set(int256(spy), block.timestamp);
        } else if (m == 2) {
            feedA.set(0, block.timestamp); // invalid answer
            feedSpy.set(int256(spy), block.timestamp);
        } else {
            feedA.set(int256(a) * 2, block.timestamp); // strong gain
            feedSpy.set(int256(spy), block.timestamp);
        }
    }
}

contract VaultInvariantTest is Test {
    uint64 internal constant ANCHOR = 1794016800;

    BackingVault internal vault;
    MockERC20 internal wif;
    VaultHandler internal handler;
    address[] internal baskets;

    function setUp() public {
        vm.warp(ANCHOR - 2 days);
        wif = new MockERC20("WIF", "WIF", 18);
        MockRegistryForVault registry = new MockRegistryForVault();
        MockFactoryForVault factory = new MockFactoryForVault();
        factory.setMinCuratorStake(500e18);
        address owner = address(0x0111);
        address harvester = address(0xFA12);
        address curator = address(0xC0DE);
        vault = new BackingVault(owner, address(registry), address(wif));
        vm.startPrank(owner);
        vault.setFactory(address(factory));
        vault.setHarvester(harvester);
        vm.stopPrank();

        MockAggregator feedA = new MockAggregator(100e8);
        MockAggregator feedSpy = new MockAggregator(500e8);
        registry.setFeed(address(0xA11), address(feedA));
        registry.setFeed(address(0x5B1), address(feedSpy));
        registry.setBenchmark(address(0x5B1));

        for (uint256 i; i < 2; ++i) {
            MockBasketForVault b = new MockBasketForVault();
            address[] memory t = new address[](1);
            t[0] = address(0xA11);
            uint256[] memory u = new uint256[](1);
            u[0] = 1e18;
            b.setComponents(t, u);
            factory.registerBasket(vault, address(b), curator);
            baskets.push(address(b));
        }

        handler = new VaultHandler(vault, wif, factory, feedA, feedSpy, harvester, curator, baskets);
        targetContract(address(handler));
    }

    /// @dev INV-5: the vault always holds enough WIF for every obligation.
    function invariant_INV5_I_V01_vaultSolvent() public view {
        uint256 obligations;
        for (uint256 i; i < baskets.length; ++i) {
            IBackingVault.BasketState memory s = vault.basketState(baskets[i]);
            obligations += s.totalActive + s.totalWarming + s.queuedBackers + s.queuedCurator + s.curatorClaimable;
            for (uint256 j; j < handler.actorCount(); ++j) {
                address a = handler.actors(j);
                obligations += vault.position(baskets[i], a).pendingUnstake + vault.pendingRewards(baskets[i], a);
            }
        }
        assertGe(wif.balanceOf(address(vault)), obligations);
    }

    /// @dev Principal accounting: everything ever staked is either active, pending or withdrawn.
    function invariant_INV5_principalConserved() public view {
        uint256 held;
        for (uint256 i; i < baskets.length; ++i) {
            held += vault.basketState(baskets[i]).totalActive + vault.basketState(baskets[i]).totalWarming;
            for (uint256 j; j < handler.actorCount(); ++j) {
                held += vault.position(baskets[i], handler.actors(j)).pendingUnstake;
            }
        }
        assertEq(handler.ghostStaked(), held + handler.ghostWithdrawn());
    }

    /// @dev Sum of per-account active (and warming) stake equals totalActive (and totalWarming).
    function invariant_INV5_activeAndWarmingSumsMatch() public view {
        for (uint256 i; i < baskets.length; ++i) {
            uint256 sumActive;
            uint256 sumWarming;
            for (uint256 j; j < handler.actorCount(); ++j) {
                IBackingVault.Position memory p = vault.position(baskets[i], handler.actors(j));
                sumActive += p.active;
                sumWarming += p.warming;
            }
            assertEq(sumActive, vault.basketState(baskets[i]).totalActive);
            assertEq(sumWarming, vault.basketState(baskets[i]).totalWarming);
        }
    }
}
