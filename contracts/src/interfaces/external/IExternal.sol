// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice ERC-8056 Scaled UI Amount, as implemented by Robinhood Stock Tokens.
/// @dev Raw balances never change on corporate actions. Only the multiplier does.
///      underlying shares = raw * uiMultiplier() / 1e18
interface IScaledUIAmount {
    /// @return The current multiplier, 18 decimals (1e18 == 1.0).
    function uiMultiplier() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
}

/// @notice Stock Tokens are pausable (verified onchain for NVDA on 2026-11-05).
interface IPausableToken {
    function paused() external view returns (bool);
}

/// @notice Chainlink AggregatorV3. Stock feeds have 8 decimals, update 24/5, and already include the multiplier.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @notice Minimal Uniswap v3 surface used for direct pool swaps (ADR-0005).
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}
