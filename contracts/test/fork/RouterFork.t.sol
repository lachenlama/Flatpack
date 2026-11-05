// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Basket} from "../../src/Basket.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {BackingVault} from "../../src/BackingVault.sol";
import {ComponentRegistry} from "../../src/ComponentRegistry.sol";
import {FeeHarvester} from "../../src/FeeHarvester.sol";
import {FlatpackRouter} from "../../src/FlatpackRouter.sol";
import {DividendMode} from "../../src/interfaces/IBasket.sol";
import {IBasketFactory} from "../../src/interfaces/IBasketFactory.sol";
import {IFlatpackRouter} from "../../src/interfaces/IFlatpackRouter.sol";
import {IAggregatorV3} from "../../src/interfaces/external/IExternal.sol";

/// @notice Shared fixture for the fork tests: the full Flatpack system deployed on a pinned Robinhood Chain mainnet fork,
///         wired to the REAL Uniswap v3 / v4 pools and Chainlink feeds. Addresses are copied from
///         config/mainnet-4663.json (parsed at runtime so mixed/lower-case spellings need no checksum).
abstract contract ForkBase is Test {
    /// @dev Pinned Robinhood Chain (4663) block shared by every fork test so the RPC state is cached.
    uint256 internal constant PINNED_BLOCK = 106_915_400;

    // config/mainnet-4663.json
    address internal USDG;
    address internal WETH;
    address internal WIF;
    address internal V3_FACTORY;
    address internal USDG_WETH_POOL;
    address internal POOL_MANAGER;
    address internal HOOK;
    address internal AAPL;
    address internal NVDA;
    address internal MSFT;
    address internal SPY;
    address internal AAPL_FEED;
    address internal NVDA_FEED;
    address internal MSFT_FEED;
    address internal SPY_FEED;

    uint256 internal constant MIN_STAKE = 1_000e18;
    uint256 internal constant USD_PER_COMPONENT = 100; // each component is worth ~$100 per 1e18 basket shares

    ComponentRegistry internal registry;
    FeeHarvester internal harvester;
    BackingVault internal vault;
    BasketFactory internal factory;
    FlatpackRouter internal router;
    Basket internal basket;

    address internal owner = makeAddr("owner");
    address internal curator = makeAddr("curator");
    address internal buyer = makeAddr("buyer");
    address internal receiver = makeAddr("receiver");

    function _loadConfig() private {
        USDG = vm.parseAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
        WETH = vm.parseAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
        WIF = vm.parseAddress("0x5173b8eA6923c2d40267890D45C46a3480954773");
        V3_FACTORY = vm.parseAddress("0x1f7d7550b1b028f7571e69a784071f0205fd2efa");
        USDG_WETH_POOL = vm.parseAddress("0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca");
        POOL_MANAGER = vm.parseAddress("0x8366a39cc670b4001a1121b8f6a443a643e40951");
        HOOK = vm.parseAddress("0xe5e702641ea86f4ae6cc3cdaed2b886f976be044");
        NVDA = vm.parseAddress("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
        AAPL = vm.parseAddress("0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9");
        MSFT = vm.parseAddress("0xe93237C50D904957Cf27E7B1133b510C669c2e74");
        SPY = vm.parseAddress("0x117cc2133c37B721F49dE2A7a74833232B3B4C0C");
        NVDA_FEED = vm.parseAddress("0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15");
        AAPL_FEED = vm.parseAddress("0x6B22A786bAa607d76728168703a39Ea9C99f2cD0");
        MSFT_FEED = vm.parseAddress("0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E");
        SPY_FEED = vm.parseAddress("0x319724394D3A0e3669269846abE664Cd621f9f6A");
    }

    function _wifKey() internal view returns (PoolKey memory) {
        return
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(WIF),
                fee: 0,
                tickSpacing: 200,
                hooks: IHooks(HOOK)
            });
    }

    /// @dev Selects the pinned fork and deploys the whole system (registry seeded from config). Call first in every test.
    function _forkAndDeploy() internal {
        vm.createSelectFork("robinhood", PINNED_BLOCK);
        _loadConfig();

        vm.startPrank(owner);
        registry = new ComponentRegistry(owner, USDG, V3_FACTORY);
        registry.setComponent(NVDA, true, NVDA_FEED, 500);
        registry.setComponent(AAPL, true, AAPL_FEED, 500);
        registry.setComponent(MSFT, true, MSFT_FEED, 3000);
        registry.setComponent(SPY, true, SPY_FEED, 500);
        registry.setBenchmark(SPY);

        harvester = new FeeHarvester(
            owner,
            address(registry),
            USDG,
            WETH,
            WIF,
            USDG_WETH_POOL,
            POOL_MANAGER,
            _wifKey()
        );
        vault = new BackingVault(owner, address(registry), WIF);
        Basket impl = new Basket();
        factory = new BasketFactory(
            owner,
            address(registry),
            address(harvester),
            address(vault),
            WIF,
            address(impl),
            MIN_STAKE
        );
        harvester.setFactory(address(factory));
        vault.setFactory(address(factory));
        vault.setHarvester(address(harvester));
        router = new FlatpackRouter(address(factory), address(registry));
        vm.stopPrank();
    }

    /// @dev Sets `to`'s balance of `token` (storage write via forge-std `deal`).
    function _fund(address token, address to, uint256 amount) internal {
        deal(token, to, amount);
        assertEq(IERC20(token).balanceOf(to), amount, "deal failed");
    }

    /// @dev Creates the AAPL + NVDA + MSFT basket (ascending by address) worth about $300 per 1e18 shares.
    function _createBasket(DividendMode mode) internal returns (Basket b) {
        IBasketFactory.CreateParams memory p;
        p.name = "Mag Three";
        p.symbol = "MAG3";
        p.tokens = new address[](3);
        p.tokens[0] = AAPL;
        p.tokens[1] = NVDA;
        p.tokens[2] = MSFT;
        require(AAPL < NVDA && NVDA < MSFT, "order");
        p.rawUnits = new uint256[](3);
        p.rawUnits[0] = _unitsFor(AAPL_FEED);
        p.rawUnits[1] = _unitsFor(NVDA_FEED);
        p.rawUnits[2] = _unitsFor(MSFT_FEED);
        p.mode = mode;

        _fund(WIF, curator, MIN_STAKE);
        vm.startPrank(curator);
        IERC20(WIF).approve(address(factory), MIN_STAKE);
        b = Basket(factory.createBasket(p, MIN_STAKE));
        vm.stopPrank();
        basket = b;
    }

    function _unitsFor(address feed) internal view returns (uint256) {
        (, int256 answer, , , ) = IAggregatorV3(feed).latestRoundData();
        return (USD_PER_COMPONENT * 1e8 * 1e18) / uint256(answer);
    }

    function _nav18() internal view returns (uint256 nav) {
        (uint256 n, ) = vault.navOf(address(basket));
        return n;
    }

    /// @dev Buys `shares` for `buyer`, giving `maxIn` budget. Returns (sharesOut, spent).
    function _buy(
        uint256 shares,
        uint256 maxIn,
        address receiver_,
        address referrer
    ) internal returns (uint256 sharesOut, uint256 spent) {
        _fund(USDG, buyer, maxIn);
        vm.startPrank(buyer);
        IERC20(USDG).approve(address(router), maxIn);
        (sharesOut, spent) = router.buy(
            IFlatpackRouter.BuyParams({
                basket: address(basket),
                shares: shares,
                maxUsdgIn: maxIn,
                receiver: receiver_,
                referrer: referrer,
                deadline: block.timestamp + 1 hours
            })
        );
        vm.stopPrank();
    }

    /// @dev INV-3: the router holds nothing.
    function _assertRouterEmpty() internal view {
        assertEq(IERC20(USDG).balanceOf(address(router)), 0, "INV-3 usdg");
        assertEq(IERC20(AAPL).balanceOf(address(router)), 0, "INV-3 aapl");
        assertEq(IERC20(NVDA).balanceOf(address(router)), 0, "INV-3 nvda");
        assertEq(IERC20(MSFT).balanceOf(address(router)), 0, "INV-3 msft");
        assertEq(address(router).balance, 0, "INV-3 eth");
    }
}

contract FakePool {
    address public immutable target;

    constructor(address target_) {
        target = target_;
    }

    function poke() external {
        (bool ok, bytes memory ret) = target.call(
            abi.encodeWithSignature(
                "uniswapV3SwapCallback(int256,int256,bytes)",
                int256(1),
                int256(-1),
                abi.encode(address(0))
            )
        );
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

contract RouterForkTest is ForkBase {
    uint256 internal constant SHARES = 3e18; // ~ $900
    uint256 internal constant BUDGET = 1_500e6; // generous USDG budget, the rest is refunded

    function test_F_R01_buyThreeComponents() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);

        uint256 navPerShare = _nav18();
        console.log("NAV per 1e18 shares (1e18 USD):", navPerShare);

        uint256 gasBefore = gasleft();
        (uint256 sharesOut, uint256 spent) = _buy(SHARES, BUDGET, receiver, address(0));
        uint256 gasUsed = gasBefore - gasleft();
        console.log("3-component buy gas:", gasUsed);
        console.log("USDG spent (6 dec):", spent);

        uint256 fee = (SHARES * 30) / 10_000;
        assertEq(sharesOut, SHARES - fee, "sharesOut");
        assertEq(basket.balanceOf(receiver), SHARES - fee, "receiver shares");
        assertEq(basket.balanceOf(address(harvester)), fee, "harvester fee shares");
        assertEq(harvester.pendingFeeShares(address(basket)), fee, "pending fee");

        // refund and accounting
        assertGt(spent, 0);
        assertLe(spent, BUDGET);
        assertEq(IERC20(USDG).balanceOf(buyer), BUDGET - spent, "refund");

        // the basket holds exactly the previewed amounts
        uint256[] memory eff = basket.effectiveBalances();
        (, uint256[] memory units) = basket.components();
        for (uint256 i; i < 3; ++i) {
            assertEq(eff[i], (units[i] * SHARES + 1e18 - 1) / 1e18, "component amount");
        }

        // sanity: paid within 10% of the oracle value of the shares (~ $300 x 3)
        uint256 oracleUsd6 = (navPerShare * SHARES) / 1e18 / 1e12;
        assertGt(spent, (oracleUsd6 * 90) / 100, "spent too low");
        assertLt(spent, (oracleUsd6 * 110) / 100, "spent too high");

        _assertRouterEmpty();
        // approvals reset
        assertEq(IERC20(AAPL).allowance(address(router), address(basket)), 0);
        assertEq(IERC20(NVDA).allowance(address(router), address(basket)), 0);
        assertEq(IERC20(MSFT).allowance(address(router), address(basket)), 0);
    }

    function test_F_R01b_buyWithReferrerAndDisabledComponent() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        address ref = makeAddr("ref");
        _buy(SHARES, BUDGET, receiver, ref);
        (uint256 refShares, , ) = harvester.referralOf(address(basket), 0, ref);
        assertEq(refShares, (((SHARES * 30) / 10_000) * 1000) / 10_000, "referral shares");

        // disabling a component blocks router buys
        vm.prank(owner);
        registry.setComponent(NVDA, false, address(0), 0);
        _fund(USDG, buyer, BUDGET);
        vm.startPrank(buyer);
        IERC20(USDG).approve(address(router), BUDGET);
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.ComponentDisabled.selector, NVDA));
        router.buy(
            IFlatpackRouter.BuyParams(address(basket), SHARES, BUDGET, receiver, address(0), block.timestamp + 1)
        );
        // an unknown basket is rejected
        vm.expectRevert(IFlatpackRouter.NotBasket.selector);
        router.buy(
            IFlatpackRouter.BuyParams(address(0xBEEF), SHARES, BUDGET, receiver, address(0), block.timestamp + 1)
        );
        vm.stopPrank();
    }

    function test_F_R02_maxInTooLowAndExpired() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);

        // measure the true cost with the quote, then ask for one wei less
        uint256 cost = _quote(SHARES);
        _fund(USDG, buyer, BUDGET);
        vm.startPrank(buyer);
        IERC20(USDG).approve(address(router), BUDGET);

        // tiny budget: the first hop already exceeds it
        vm.expectPartialRevert(IFlatpackRouter.ExcessiveInput.selector);
        router.buy(IFlatpackRouter.BuyParams(address(basket), SHARES, 1e6, receiver, address(0), block.timestamp + 1));

        // budget one below the real cost (last hop or final check trips)
        vm.expectPartialRevert(IFlatpackRouter.ExcessiveInput.selector);
        router.buy(
            IFlatpackRouter.BuyParams(address(basket), SHARES, cost - 1, receiver, address(0), block.timestamp + 1)
        );

        // expired deadline
        vm.expectRevert(IFlatpackRouter.Expired.selector);
        router.buy(
            IFlatpackRouter.BuyParams(address(basket), SHARES, BUDGET, receiver, address(0), block.timestamp - 1)
        );
        vm.stopPrank();

        // the exact quoted budget succeeds and leaves nothing behind
        (, uint256 spent) = _buy(SHARES, cost, receiver, address(0));
        assertEq(spent, cost, "exact budget");
        _assertRouterEmpty();
    }

    function test_F_R03_spoofedCallbackReverts() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        bytes memory data = abi.encode(USDG);

        // from an EOA
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(IFlatpackRouter.UnexpectedCallback.selector);
        router.uniswapV3SwapCallback(int256(1e6), -int256(1), data);

        // from a fake pool contract
        FakePool fake = new FakePool(address(router));
        vm.expectRevert(IFlatpackRouter.UnexpectedCallback.selector);
        fake.poke();

        // from a real, registered pool outside a swap
        address realPool = vm.parseAddress("0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3"); // NVDA/USDG 0.05%
        vm.prank(realPool);
        vm.expectRevert(IFlatpackRouter.UnexpectedCallback.selector);
        router.uniswapV3SwapCallback(int256(1e6), -int256(1), data);

        // the harvester's callback is guarded the same way
        vm.prank(realPool);
        vm.expectRevert(FeeHarvester.UnexpectedCallback.selector);
        harvester.uniswapV3SwapCallback(int256(1e6), -int256(1), data);
    }

    function test_F_R04_quoteMatchesBuy() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);

        uint256 quoted = _quote(SHARES);
        (, uint256 spent) = _buy(SHARES, BUDGET, receiver, address(0));
        console.log("quoted:", quoted);
        console.log("spent :", spent);
        uint256 diff = quoted > spent ? quoted - spent : spent - quoted;
        assertLe(diff * 1000, spent, "quote within 0.1%");
        _assertRouterEmpty();

        // callable by anyone with no USDG, and unknown baskets are rejected
        vm.prank(makeAddr("anyone"));
        vm.expectRevert(IFlatpackRouter.NotBasket.selector);
        router.quoteBuy(address(0xBEEF), SHARES);
    }

    function test_F_R05_quoteRevertsOnDisabledComponent() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        vm.prank(owner);
        registry.setComponent(MSFT, false, address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(IFlatpackRouter.ComponentDisabled.selector, MSFT));
        router.quoteBuy(address(basket), SHARES);
    }

    function test_F_R06_incompleteFillOnHugeSize() public {
        _forkAndDeploy();
        _createBasket(DividendMode.Reinvest);
        // 100k shares (~ $30M) exceeds the pool depth: the quote reports the partial fill
        vm.expectPartialRevert(IFlatpackRouter.IncompleteFill.selector);
        router.quoteBuy(address(basket), 100_000e18);

        _fund(USDG, buyer, 100_000_000e6);
        vm.startPrank(buyer);
        IERC20(USDG).approve(address(router), 100_000_000e6);
        // the exhausted pool demands far more than the budget before the partial fill can surface
        vm.expectPartialRevert(IFlatpackRouter.ExcessiveInput.selector);
        router.buy(
            IFlatpackRouter.BuyParams(
                address(basket),
                100_000e18,
                100_000_000e6,
                receiver,
                address(0),
                block.timestamp + 1
            )
        );
        vm.stopPrank();
    }

    function _quote(uint256 shares) internal returns (uint256 usdgIn) {
        (bool ok, bytes memory ret) = address(router).call(
            abi.encodeCall(IFlatpackRouter.quoteBuy, (address(basket), shares))
        );
        assertFalse(ok, "quote must revert");
        require(ret.length == 36 && bytes4(ret) == IFlatpackRouter.QuoteResult.selector, "bad quote data");
        assembly {
            usdgIn := mload(add(ret, 0x24))
        }
    }
}
