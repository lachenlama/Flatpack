// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Basket} from "../../src/Basket.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {ComponentRegistry} from "../../src/ComponentRegistry.sol";
import {IBasket, BasketInit, DividendMode} from "../../src/interfaces/IBasket.sol";
import {IBasketFactory} from "../../src/interfaces/IBasketFactory.sol";
import {MockV3Factory} from "../mocks/MockV3Factory.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {MockHarvester} from "../mocks/MockHarvester.sol";
import {MockVault} from "../mocks/MockVault.sol";

contract BasketFactoryTest is Test {
    uint256 internal constant MIN_STAKE = 1000e18;

    BasketFactory internal factory;
    ComponentRegistry internal reg;
    MockV3Factory internal v3;
    MockERC20 internal usdg;
    MockERC20 internal wif;
    MockVault internal vault;
    MockHarvester internal harv;
    Basket internal impl;
    MockStockToken[] internal toks;
    address[] internal addrs;

    address internal owner = makeAddr("owner");
    address internal curator = makeAddr("curator");
    address internal mallory = makeAddr("mallory");

    function setUp() public {
        usdg = new MockERC20("USDG", "USDG", 6);
        wif = new MockERC20("WIF", "WIF", 18);
        v3 = new MockV3Factory();
        reg = new ComponentRegistry(owner, address(usdg), address(v3));
        vault = new MockVault(address(wif));
        harv = new MockHarvester();
        impl = new Basket();
        factory = new BasketFactory(
            owner,
            address(reg),
            address(harv),
            address(vault),
            address(wif),
            address(impl),
            MIN_STAKE
        );

        MockAggregator feed = new MockAggregator(1e8);
        // 9 enabled tokens (so that the "too many" case is reachable), sorted ascending
        MockStockToken[] memory t = new MockStockToken[](9);
        for (uint256 i; i < 9; ++i) {
            t[i] = new MockStockToken("S", "S");
        }
        for (uint256 i; i < 9; ++i) {
            for (uint256 j; j + 1 < 9 - i; ++j) {
                if (address(t[j]) > address(t[j + 1])) (t[j], t[j + 1]) = (t[j + 1], t[j]);
            }
        }
        for (uint256 i; i < 9; ++i) {
            toks.push(t[i]);
            addrs.push(address(t[i]));
            v3.setPool(address(t[i]), address(usdg), 500, makeAddr(string.concat("pool", vm.toString(i))));
            vm.prank(owner);
            reg.setComponent(address(t[i]), true, address(feed), 500);
        }
        wif.mint(curator, 1_000_000e18);
        vm.prank(curator);
        wif.approve(address(factory), type(uint256).max);
    }

    function _params(uint256 n) internal view returns (IBasketFactory.CreateParams memory p) {
        p.name = "Mag Basket";
        p.symbol = "MAG";
        p.tokens = new address[](n);
        p.rawUnits = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            p.tokens[i] = addrs[i];
            p.rawUnits[i] = (i + 1) * 1e18;
        }
        p.mode = DividendMode.PayInWif;
    }

    function _create(IBasketFactory.CreateParams memory p, uint256 stake) internal returns (address) {
        vm.prank(curator);
        return factory.createBasket(p, stake);
    }

    // ------------------------------------------------------------------ constructor / views
    function test_constructorWiringAndZeroChecks() public {
        assertEq(factory.owner(), owner);
        assertEq(factory.registry(), address(reg));
        assertEq(factory.harvester(), address(harv));
        assertEq(factory.vault(), address(vault));
        assertEq(factory.wif(), address(wif));
        assertEq(factory.implementation(), address(impl));
        assertEq(factory.minCuratorStake(), MIN_STAKE);
        assertEq(factory.MIN_COMPONENTS(), 2);
        assertEq(factory.MAX_COMPONENTS(), 8);
        assertFalse(factory.createPaused());
        address z = address(0);
        address o = address(1);
        vm.expectRevert(BasketFactory.ZeroAddress.selector);
        new BasketFactory(owner, z, o, o, o, o, 0);
        vm.expectRevert(BasketFactory.ZeroAddress.selector);
        new BasketFactory(owner, o, z, o, o, o, 0);
        vm.expectRevert(BasketFactory.ZeroAddress.selector);
        new BasketFactory(owner, o, o, z, o, o, 0);
        vm.expectRevert(BasketFactory.ZeroAddress.selector);
        new BasketFactory(owner, o, o, o, z, o, 0);
        vm.expectRevert(BasketFactory.ZeroAddress.selector);
        new BasketFactory(owner, o, o, o, o, z, 0);
    }

    // ------------------------------------------------------------------ U-F01
    function test_U_F01_createBasketHappyPath() public {
        IBasketFactory.CreateParams memory p = _params(3);
        vm.expectEmit(false, true, false, true, address(factory));
        emit IBasketFactory.BasketCreated(
            address(0),
            curator,
            p.name,
            p.symbol,
            p.tokens,
            p.rawUnits,
            p.mode,
            MIN_STAKE
        );
        address b = _create(p, MIN_STAKE);

        assertTrue(factory.isBasket(b));
        assertEq(factory.basketCount(), 1);
        assertEq(factory.basketAt(0), b);
        assertFalse(factory.isBasket(address(impl)));

        IBasket basket = IBasket(b);
        assertEq(basket.factory(), address(factory));
        assertEq(basket.curator(), curator);
        assertEq(basket.harvester(), address(harv));
        assertEq(uint256(basket.mode()), uint256(DividendMode.PayInWif));
        (address[] memory t, uint256[] memory u) = basket.components();
        assertEq(t.length, 3);
        assertEq(t[2], addrs[2]);
        assertEq(u[1], 2e18);
        assertEq(Basket(b).name(), "Mag Basket");

        // vault wiring: registered after initialisation, then staked for the curator
        assertEq(vault.registerCalls(), 1);
        assertEq(vault.lastBasket(), b);
        assertEq(vault.lastCurator(), curator);
        assertEq(vault.componentCountAtRegister(), 3);
        assertEq(vault.stakeCalls(), 1);
        assertEq(vault.stakeBasket(), b);
        assertEq(vault.stakeAccount(), curator);
        assertEq(vault.stakeAmount(), MIN_STAKE);
        assertLt(vault.registerSeq(), vault.stakeSeq());
        assertEq(wif.balanceOf(address(vault)), MIN_STAKE);
        assertEq(wif.balanceOf(address(factory)), 0);
        assertEq(wif.allowance(address(factory), address(vault)), 0);
        assertEq(wif.balanceOf(curator), 1_000_000e18 - MIN_STAKE);
    }

    function test_createMultipleBaskets() public {
        address a = _create(_params(2), MIN_STAKE);
        address b = _create(_params(8), 5 * MIN_STAKE);
        assertTrue(a != b);
        assertEq(factory.basketCount(), 2);
        assertEq(factory.basketAt(1), b);
        assertEq(vault.staked(curator), 6 * MIN_STAKE);
    }

    function test_createWithZeroMinStakeSkipsStaking() public {
        vm.prank(owner);
        factory.setMinCuratorStake(0);
        address b = _create(_params(2), 0);
        assertTrue(factory.isBasket(b));
        assertEq(vault.registerCalls(), 1);
        assertEq(vault.stakeCalls(), 0);
    }

    function test_createRevertsWithoutWifApproval() public {
        vm.prank(curator);
        wif.approve(address(factory), 0);
        vm.prank(curator);
        vm.expectRevert();
        factory.createBasket(_params(2), MIN_STAKE);
    }

    // ------------------------------------------------------------------ U-F02
    function test_U_F02_revertsWhenCreationPaused() public {
        vm.prank(owner);
        factory.setCreatePaused(true);
        IBasketFactory.CreateParams memory p = _params(3);
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.CreatePaused.selector);
        factory.createBasket(p, MIN_STAKE);
    }

    function test_U_F02_revertsOnLengthMismatch() public {
        IBasketFactory.CreateParams memory p = _params(3);
        p.rawUnits = new uint256[](2);
        p.rawUnits[0] = 1;
        p.rawUnits[1] = 1;
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.BadLength.selector);
        factory.createBasket(p, MIN_STAKE);
    }

    function test_U_F02_revertsOnTooFew() public {
        IBasketFactory.CreateParams memory p = _params(1);
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.TooFewComponents.selector);
        factory.createBasket(p, MIN_STAKE);
        p = _params(0);
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.TooFewComponents.selector);
        factory.createBasket(p, MIN_STAKE);
    }

    function test_U_F02_revertsOnTooMany() public {
        IBasketFactory.CreateParams memory p = _params(9);
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.TooManyComponents.selector);
        factory.createBasket(p, MIN_STAKE);
    }

    function test_U_F02_revertsOnNotAscendingAndDuplicate() public {
        IBasketFactory.CreateParams memory p = _params(3);
        (p.tokens[0], p.tokens[1]) = (p.tokens[1], p.tokens[0]);
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.NotAscending.selector);
        factory.createBasket(p, MIN_STAKE);

        p = _params(3);
        p.tokens[1] = p.tokens[0];
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.NotAscending.selector);
        factory.createBasket(p, MIN_STAKE);
    }

    function test_U_F02_revertsOnDisabledComponent() public {
        vm.prank(owner);
        reg.setComponent(addrs[1], false, address(0), 0);
        IBasketFactory.CreateParams memory p = _params(3);
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(IBasketFactory.ComponentDisabled.selector, addrs[1]));
        factory.createBasket(p, MIN_STAKE);

        // an unknown token is disabled as well
        p = _params(2);
        p.tokens[1] = address(type(uint160).max);
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(IBasketFactory.ComponentDisabled.selector, address(type(uint160).max)));
        factory.createBasket(p, MIN_STAKE);
    }

    function test_U_F02_revertsOnZeroUnits() public {
        IBasketFactory.CreateParams memory p = _params(3);
        p.rawUnits[2] = 0;
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(IBasketFactory.ZeroUnits.selector, uint256(2)));
        factory.createBasket(p, MIN_STAKE);
    }

    function test_U_F02_revertsOnBadNameAndSymbol() public {
        IBasketFactory.CreateParams memory p = _params(3);
        p.name = "";
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.BadName.selector);
        factory.createBasket(p, MIN_STAKE);

        p.name = "123456789012345678901234567890123"; // 33 bytes
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.BadName.selector);
        factory.createBasket(p, MIN_STAKE);

        p = _params(3);
        p.symbol = "";
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.BadSymbol.selector);
        factory.createBasket(p, MIN_STAKE);

        p.symbol = "123456789012"; // 12 bytes
        vm.prank(curator);
        vm.expectRevert(IBasketFactory.BadSymbol.selector);
        factory.createBasket(p, MIN_STAKE);
    }

    function test_nameAndSymbolAtLimitsAreAccepted() public {
        IBasketFactory.CreateParams memory p = _params(2);
        p.name = "12345678901234567890123456789012"; // 32 bytes
        p.symbol = "12345678901"; // 11 bytes
        assertTrue(factory.isBasket(_create(p, MIN_STAKE)));
    }

    function test_U_F02_revertsOnStakeBelowMinimum() public {
        IBasketFactory.CreateParams memory p = _params(3);
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(IBasketFactory.StakeTooLow.selector, MIN_STAKE - 1, MIN_STAKE));
        factory.createBasket(p, MIN_STAKE - 1);
    }

    // ------------------------------------------------------------------ owner functions
    function test_ownerSettersEmitAndAreRestricted() public {
        vm.expectEmit(false, false, false, true, address(factory));
        emit IBasketFactory.MinCuratorStakeSet(5e18);
        vm.prank(owner);
        factory.setMinCuratorStake(5e18);
        assertEq(factory.minCuratorStake(), 5e18);

        vm.expectEmit(false, false, false, true, address(factory));
        emit IBasketFactory.CreatePausedSet(true);
        vm.prank(owner);
        factory.setCreatePaused(true);
        assertTrue(factory.createPaused());

        vm.startPrank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        factory.setMinCuratorStake(0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        factory.setCreatePaused(false);
        vm.stopPrank();
    }

    function test_pausingCreationDoesNotAffectExistingBaskets() public {
        address b = _create(_params(2), MIN_STAKE);
        vm.prank(owner);
        factory.setCreatePaused(true);
        assertTrue(factory.isBasket(b));
        IBasket(b).sync();
    }

    function test_basketAtOutOfRangeReverts() public {
        vm.expectRevert();
        factory.basketAt(0);
    }

    function test_clonedBasketCannotBeReinitialised() public {
        address b = _create(_params(2), MIN_STAKE);
        (address[] memory t, uint256[] memory u) = IBasket(b).components();
        vm.expectRevert(IBasket.AlreadyInitialized.selector);
        IBasket(b).initialize(_init(t, u));
    }

    function _init(address[] memory t, uint256[] memory u) internal view returns (BasketInit memory) {
        return
            BasketInit({
                name: "x",
                symbol: "x",
                curator: mallory,
                tokens: t,
                rawUnits: u,
                mode: DividendMode.Reinvest,
                harvester: mallory,
                wif: address(wif)
            });
    }
}
