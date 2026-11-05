// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAggregatorV3} from "../interfaces/external/IExternal.sol";
import {IComponentRegistry} from "../interfaces/IComponentRegistry.sol";

/// @title StockMath
/// @notice Oracle reads and unit-based NAV helpers (ADR-0007). Reads never revert because of a bad feed:
///         a bad feed yields `valid == false` so callers can fail safe (burn rewards) instead of blocking.
library StockMath {
    /// @dev Chainlink stock feeds have 8 decimals. NAV is 18-decimal USD: raw(18) * price(8) * 1e10 / 1e18 = raw * price / 1e8.
    uint256 internal constant PRICE_UNIT = 1e8;
    /// @dev Size of the ABI-encoded `latestRoundData` return (5 words).
    uint256 private constant ROUND_DATA_LENGTH = 160;

    /// @notice Reads a feed's latest price without ever reverting.
    /// @dev valid = answer > 0 && updatedAt != 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= maxAge.
    ///      Uses a low-level staticcall so a reverting feed, a non-contract feed or malformed return data all
    ///      yield (0, false).
    /// @param feed the AggregatorV3 address (may be zero or a non-contract)
    /// @param maxAge the maximum accepted age in seconds
    /// @return price8 the 8-decimal price (0 if invalid)
    /// @return valid whether the price passed every check
    function readPrice(address feed, uint256 maxAge) internal view returns (uint256 price8, bool valid) {
        if (feed.code.length == 0) return (0, false);
        (bool ok, bytes memory ret) = feed.staticcall(abi.encodeCall(IAggregatorV3.latestRoundData, ()));
        if (!ok || ret.length < ROUND_DATA_LENGTH) return (0, false);
        (, int256 answer, , uint256 updatedAt, ) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxAge) {
            return (0, false);
        }
        return (uint256(answer), true);
    }

    /// @notice Unit-based NAV: sum(rawUnits_i * price8_i * 1e10 / 1e18), i.e. 18-dec USD per 1e18 shares.
    /// @dev valid only if there is at least one token, the arrays match, and every feed is valid.
    ///      When invalid, nav18 is 0.
    /// @param tokens the basket components
    /// @param rawUnits raw token amount per 1e18 shares
    /// @param registry the IComponentRegistry used to look up each feed
    /// @param maxAge the maximum accepted feed age in seconds
    /// @return nav18 the NAV (0 if invalid)
    /// @return valid whether every feed was valid
    function unitNav(
        address[] memory tokens,
        uint256[] memory rawUnits,
        address registry,
        uint256 maxAge
    ) internal view returns (uint256 nav18, bool valid) {
        uint256 n = tokens.length;
        if (n == 0 || n != rawUnits.length) return (0, false);
        for (uint256 i; i < n; ++i) {
            address feed = IComponentRegistry(registry).component(tokens[i]).priceFeed;
            (uint256 price, bool ok) = readPrice(feed, maxAge);
            if (!ok) return (0, false);
            nav18 += Math.mulDiv(rawUnits[i], price, PRICE_UNIT);
        }
        return (nav18, true);
    }
}
