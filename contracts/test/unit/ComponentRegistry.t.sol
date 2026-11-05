// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ComponentRegistry} from "../../src/ComponentRegistry.sol";
import {IComponentRegistry} from "../../src/interfaces/IComponentRegistry.sol";
import {MockV3Factory} from "../mocks/MockV3Factory.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";

contract ComponentRegistryTest is Test {
    event ComponentSet(address indexed token, bool enabled, address priceFeed, uint24 v3Fee);
    event BenchmarkSet(address indexed token);

    ComponentRegistry internal reg;
    MockV3Factory internal v3;
    MockERC20 internal usdg;
    MockStockToken internal nvda;
    MockAggregator internal feed;
    address internal owner = makeAddr("owner");
    address internal mallory = makeAddr("mallory");
    address internal pool = makeAddr("pool");

    function setUp() public {
        usdg = new MockERC20("USDG", "USDG", 6);
        v3 = new MockV3Factory();
        reg = new ComponentRegistry(owner, address(usdg), address(v3));
        nvda = new MockStockToken("NVDA", "NVDA");
        feed = new MockAggregator(1e8);
        v3.setPool(address(nvda), address(usdg), 500, pool);
    }

    function test_constructorSetsImmutablesAndRejectsZero() public {
        assertEq(reg.owner(), owner);
        assertEq(reg.usdg(), address(usdg));
        assertEq(reg.v3Factory(), address(v3));
        assertEq(reg.benchmark(), address(0));
        vm.expectRevert(IComponentRegistry.ZeroAddress.selector);
        new ComponentRegistry(owner, address(0), address(v3));
        vm.expectRevert(IComponentRegistry.ZeroAddress.selector);
        new ComponentRegistry(owner, address(usdg), address(0));
    }

    function test_U_F03_enableStoresComponentAndEmits() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit ComponentSet(address(nvda), true, address(feed), 500);
        vm.prank(owner);
        reg.setComponent(address(nvda), true, address(feed), 500);
        IComponentRegistry.Component memory c = reg.component(address(nvda));
        assertTrue(c.enabled);
        assertEq(c.priceFeed, address(feed));
        assertEq(c.v3Fee, 500);
        assertTrue(reg.isEnabled(address(nvda)));
    }

    function test_U_F03_onlyOwnerCanCallSetters() public {
        vm.startPrank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        reg.setComponent(address(nvda), true, address(feed), 500);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        reg.setBenchmark(address(nvda));
        vm.stopPrank();
    }

    function test_U_F03_enableRequiresFeedFeeAndPool() public {
        vm.startPrank(owner);
        vm.expectRevert(IComponentRegistry.ZeroAddress.selector);
        reg.setComponent(address(nvda), true, address(0), 500);
        vm.expectRevert(IComponentRegistry.ZeroAddress.selector);
        reg.setComponent(address(0), true, address(feed), 500);
        vm.expectRevert(abi.encodeWithSelector(IComponentRegistry.InvalidFeeTier.selector, uint24(2500)));
        reg.setComponent(address(nvda), true, address(feed), 2500);
        // valid tier, but no pool at that tier
        vm.expectRevert(abi.encodeWithSelector(IComponentRegistry.PoolNotFound.selector, address(nvda), uint24(3000)));
        reg.setComponent(address(nvda), true, address(feed), 3000);
        vm.stopPrank();
        assertFalse(reg.isEnabled(address(nvda)));
    }

    function test_U_F03_allFourFeeTiersAreAccepted() public {
        uint24[4] memory tiers = [uint24(100), 500, 3000, 10_000];
        vm.startPrank(owner);
        for (uint256 i; i < 4; ++i) {
            MockStockToken t = new MockStockToken("T", "T");
            v3.setPool(address(t), address(usdg), tiers[i], pool);
            reg.setComponent(address(t), true, address(feed), tiers[i]);
            assertEq(reg.component(address(t)).v3Fee, tiers[i]);
        }
        vm.stopPrank();
    }

    function test_disableKeepsFeedAndFeeForExistingBaskets() public {
        vm.startPrank(owner);
        reg.setComponent(address(nvda), true, address(feed), 500);
        vm.expectEmit(true, false, false, true, address(reg));
        emit ComponentSet(address(nvda), false, address(feed), 500);
        reg.setComponent(address(nvda), false, address(0), 0);
        vm.stopPrank();
        IComponentRegistry.Component memory c = reg.component(address(nvda));
        assertFalse(c.enabled);
        assertEq(c.priceFeed, address(feed));
        assertEq(c.v3Fee, 500);
        assertFalse(reg.isEnabled(address(nvda)));
    }

    function test_disableUnknownTokenIsHarmless() public {
        vm.prank(owner);
        reg.setComponent(address(nvda), false, address(0), 0);
        assertFalse(reg.isEnabled(address(nvda)));
        vm.prank(owner);
        vm.expectRevert(IComponentRegistry.ZeroAddress.selector);
        reg.setComponent(address(0), false, address(0), 0);
    }

    function test_U_F03_benchmarkRequiresEnabledComponent() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(IComponentRegistry.ComponentNotEnabled.selector, address(nvda)));
        reg.setBenchmark(address(nvda));
        reg.setComponent(address(nvda), true, address(feed), 500);
        vm.expectEmit(true, false, false, true, address(reg));
        emit BenchmarkSet(address(nvda));
        reg.setBenchmark(address(nvda));
        vm.stopPrank();
        assertEq(reg.benchmark(), address(nvda));
    }

    function test_ownershipIsTwoStep() public {
        vm.prank(owner);
        reg.transferOwnership(mallory);
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), mallory);
        vm.prank(mallory);
        reg.acceptOwnership();
        assertEq(reg.owner(), mallory);
    }
}
