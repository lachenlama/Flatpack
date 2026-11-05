// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StockMath} from "../../src/libraries/StockMath.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {MockRegistryForVault} from "../mocks/MockRegistryForVault.sol";

/// @dev Exposes the internal library functions.
contract StockMathHarness {
    function readPrice(address feed, uint256 maxAge) external view returns (uint256, bool) {
        return StockMath.readPrice(feed, maxAge);
    }

    function unitNav(
        address[] memory tokens,
        uint256[] memory rawUnits,
        address registry,
        uint256 maxAge
    ) external view returns (uint256, bool) {
        return StockMath.unitNav(tokens, rawUnits, registry, maxAge);
    }
}

contract RevertingFeed {
    error Boom();

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert Boom();
    }
}

/// @dev Returns too little data (one word) for latestRoundData.
contract ShortReturnFeed {
    fallback() external {
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}

contract StockMathTest is Test {
    StockMathHarness internal h;
    MockRegistryForVault internal registry;
    uint256 internal constant MAX_AGE = 4 days;

    function setUp() public {
        vm.warp(1_800_000_000);
        h = new StockMathHarness();
        registry = new MockRegistryForVault();
    }

    function test_U_SM_validPrice() public {
        MockAggregator f = new MockAggregator(123e8);
        (uint256 p, bool ok) = h.readPrice(address(f), MAX_AGE);
        assertTrue(ok);
        assertEq(p, 123e8);
    }

    function test_U_SM_staleBoundary() public {
        MockAggregator f = new MockAggregator(1e8);
        f.set(1e8, block.timestamp - MAX_AGE);
        (, bool ok) = h.readPrice(address(f), MAX_AGE);
        assertTrue(ok);
        f.set(1e8, block.timestamp - MAX_AGE - 1);
        (uint256 p, bool ok2) = h.readPrice(address(f), MAX_AGE);
        assertFalse(ok2);
        assertEq(p, 0);
    }

    function test_U_SM_zeroAndNegativeAnswer() public {
        MockAggregator f = new MockAggregator(1e8);
        f.set(0, block.timestamp);
        (, bool ok) = h.readPrice(address(f), MAX_AGE);
        assertFalse(ok);
        f.set(-1, block.timestamp);
        (, ok) = h.readPrice(address(f), MAX_AGE);
        assertFalse(ok);
        f.set(type(int256).min, block.timestamp);
        (, ok) = h.readPrice(address(f), MAX_AGE);
        assertFalse(ok);
    }

    function test_U_SM_zeroUpdatedAt() public {
        MockAggregator f = new MockAggregator(1e8);
        f.set(1e8, 0);
        (, bool ok) = h.readPrice(address(f), type(uint256).max);
        assertFalse(ok);
    }

    function test_U_SM_futureUpdatedAt() public {
        MockAggregator f = new MockAggregator(1e8);
        f.set(1e8, block.timestamp + 1);
        (, bool ok) = h.readPrice(address(f), MAX_AGE);
        assertFalse(ok);
    }

    function test_U_SM_revertingFeedDoesNotRevert() public {
        RevertingFeed f = new RevertingFeed();
        (uint256 p, bool ok) = h.readPrice(address(f), MAX_AGE);
        assertFalse(ok);
        assertEq(p, 0);
    }

    function test_U_SM_shortReturnFeed() public {
        ShortReturnFeed f = new ShortReturnFeed();
        (, bool ok) = h.readPrice(address(f), MAX_AGE);
        assertFalse(ok);
    }

    function test_U_SM_zeroAddressAndEoaFeed() public view {
        (, bool ok) = h.readPrice(address(0), MAX_AGE);
        assertFalse(ok);
        (, ok) = h.readPrice(address(0xE0A), MAX_AGE);
        assertFalse(ok);
    }

    function _two() internal returns (address[] memory t, uint256[] memory u, MockAggregator fa, MockAggregator fb) {
        t = new address[](2);
        t[0] = address(0xA);
        t[1] = address(0xB);
        u = new uint256[](2);
        u[0] = 3e18;
        u[1] = 5e17;
        fa = new MockAggregator(200e8);
        fb = new MockAggregator(10e8);
        registry.setFeed(t[0], address(fa));
        registry.setFeed(t[1], address(fb));
    }

    function test_U_SM_multiTokenNav() public {
        (address[] memory t, uint256[] memory u, , ) = _two();
        (uint256 nav, bool ok) = h.unitNav(t, u, address(registry), MAX_AGE);
        assertTrue(ok);
        // 3 * 200 + 0.5 * 10 = 605 USD
        assertEq(nav, 605e18);
    }

    function test_U_SM_navInvalidIfAnyFeedInvalid() public {
        (address[] memory t, uint256[] memory u, , MockAggregator fb) = _two();
        fb.set(10e8, block.timestamp - 5 days);
        (uint256 nav, bool ok) = h.unitNav(t, u, address(registry), MAX_AGE);
        assertFalse(ok);
        assertEq(nav, 0);
    }

    function test_U_SM_navInvalidOnEmptyOrMismatch() public {
        address[] memory t = new address[](0);
        uint256[] memory u = new uint256[](0);
        (, bool ok) = h.unitNav(t, u, address(registry), MAX_AGE);
        assertFalse(ok);
        (address[] memory t2, , , ) = _two();
        (, ok) = h.unitNav(t2, u, address(registry), MAX_AGE);
        assertFalse(ok);
    }

    function test_U_SM_navUnsetFeedInvalid() public view {
        address[] memory t = new address[](1);
        t[0] = address(0xC);
        uint256[] memory u = new uint256[](1);
        u[0] = 1e18;
        (, bool ok) = h.unitNav(t, u, address(registry), MAX_AGE);
        assertFalse(ok);
    }

    function testFuzz_U_SM_navFormula(uint128 raw, uint64 price) public {
        vm.assume(price > 0);
        address[] memory t = new address[](1);
        t[0] = address(0xA);
        uint256[] memory u = new uint256[](1);
        u[0] = raw;
        MockAggregator f = new MockAggregator(int256(uint256(price)));
        registry.setFeed(t[0], address(f));
        (uint256 nav, bool ok) = h.unitNav(t, u, address(registry), MAX_AGE);
        assertTrue(ok);
        assertEq(nav, (uint256(raw) * uint256(price) * 1e10) / 1e18);
    }
}
