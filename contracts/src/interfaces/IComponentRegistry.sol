// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IComponentRegistry
/// @notice The allowlist of Stock Tokens a basket may hold, with each token's price feed and Uniswap v3 USDG pool fee tier.
/// @dev Owner-managed with Ownable2Step. It has NO power over funds. Disabling a component blocks only NEW baskets
///      (factory) and router buys. Existing baskets keep working and redeem is unaffected.
interface IComponentRegistry {
    struct Component {
        bool enabled;
        address priceFeed; // Chainlink AggregatorV3, 8 decimals. Must be non-zero to enable.
        uint24 v3Fee; // fee tier of the token/USDG Uniswap v3 pool used for routing (100, 500, 3000 or 10000)
    }

    event ComponentSet(address indexed token, bool enabled, address priceFeed, uint24 v3Fee);
    event BenchmarkSet(address indexed token);

    error ZeroAddress();
    error InvalidFeeTier(uint24 fee);
    /// @dev Thrown by setComponent if enabling a token whose USDG pool does not exist at `v3Fee` on the configured factory.
    error PoolNotFound(address token, uint24 fee);
    error ComponentNotEnabled(address token);

    /// @notice Owner only. Enables or updates a component. To disable, pass enabled=false (feed and fee may be zero).
    /// @dev When enabling: priceFeed != 0, v3Fee is in {100,500,3000,10000}, and v3Factory.getPool(token, USDG, fee) != 0.
    function setComponent(address token, bool enabled, address priceFeed, uint24 v3Fee) external;

    /// @notice Owner only. The benchmark for Beat-SPY settlement. It must be an enabled component.
    function setBenchmark(address token) external;

    function component(address token) external view returns (Component memory);
    function isEnabled(address token) external view returns (bool);
    function benchmark() external view returns (address);
    function usdg() external view returns (address);
    function v3Factory() external view returns (address);
}
