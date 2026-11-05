// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

/// @title UniswapV4WifSwapper
/// @notice Native ETH -> $WIF exact-input swaps on one fixed Uniswap v4 pool (currency0 = native ETH, currency1 = $WIF),
///         through `PoolManager.unlock` (ADR-0005).
/// @dev `unlockCallback` is only honoured from the PoolManager while this contract is inside its own `_swapEthForWif`
///      (a transient flag). The pool's hook may take a cut of the output, so callers must measure real balance deltas.
///      Callers must hold a reentrancy lock around every swap.
abstract contract UniswapV4WifSwapper is IUnlockCallback {
    /// @dev `unlockCallback` was not called by the PoolManager during our own unlock.
    error V4UnexpectedUnlock();
    /// @dev The pool did not consume the whole ETH input (price limit hit).
    error V4PartialFill(uint256 consumed, uint256 expected);
    /// @dev The pool key's currency0 is not native ETH.
    error V4KeyNotNative();

    /// @dev Lowest sqrt price allowed by Uniswap v4, plus one (TickMath.MIN_SQRT_PRICE + 1).
    uint160 internal constant V4_MIN_SQRT_PRICE_PLUS_ONE = 4295128740;
    /// @dev Unique transient-storage slot: 1 while inside our own `unlock`.
    bytes32 private constant UNLOCK_ACTIVE_SLOT = 0x6e1d2f4a8c0b3e5d7f9a1c3e5b7d9f0a2c4e6b8d0f1a3c5e7b9d1f3a5c7e9b02;

    /// @dev The Uniswap v4 PoolManager.
    IPoolManager internal immutable POOL_MANAGER;
    address private immutable _wifToken;
    uint24 private immutable _poolFee;
    int24 private immutable _poolTickSpacing;
    address private immutable _poolHooks;

    constructor(address poolManager_, PoolKey memory key) {
        if (Currency.unwrap(key.currency0) != address(0)) revert V4KeyNotNative();
        POOL_MANAGER = IPoolManager(poolManager_);
        _wifToken = Currency.unwrap(key.currency1);
        _poolFee = key.fee;
        _poolTickSpacing = key.tickSpacing;
        _poolHooks = address(key.hooks);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        bool active;
        assembly {
            active := tload(UNLOCK_ACTIVE_SLOT)
        }
        if (msg.sender != address(POOL_MANAGER) || !active) revert V4UnexpectedUnlock();

        uint256 ethIn = abi.decode(data, (uint256));
        PoolKey memory key = _key();
        BalanceDelta delta = POOL_MANAGER.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethIn),
                sqrtPriceLimitX96: V4_MIN_SQRT_PRICE_PLUS_ONE
            }),
            ""
        );

        int128 d0 = int128(delta.amount0());
        int128 d1 = int128(delta.amount1());
        uint256 paid = d0 < 0 ? uint256(uint128(-d0)) : 0;
        if (paid != ethIn) revert V4PartialFill(paid, ethIn);

        POOL_MANAGER.settle{value: paid}();
        if (d1 > 0) POOL_MANAGER.take(key.currency1, address(this), uint256(uint128(d1)));
        return "";
    }

    /// @dev Swaps exactly `ethIn` of native ETH held by this contract for $WIF, delivered to this contract.
    ///      The pool-reported output is NOT returned: measure the $WIF balance delta instead (hook cut).
    function _swapEthForWif(uint256 ethIn) internal {
        assembly {
            tstore(UNLOCK_ACTIVE_SLOT, 1)
        }
        POOL_MANAGER.unlock(abi.encode(ethIn));
        assembly {
            tstore(UNLOCK_ACTIVE_SLOT, 0)
        }
    }

    function _key() private view returns (PoolKey memory) {
        return
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(_wifToken),
                fee: _poolFee,
                tickSpacing: _poolTickSpacing,
                hooks: IHooks(_poolHooks)
            });
    }
}
