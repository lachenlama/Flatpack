// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV3Pool, IUniswapV3SwapCallback} from "../interfaces/external/IExternal.sol";

/// @title UniswapV3Swapper
/// @notice Direct Uniswap v3 pool swaps with a transient-storage-authenticated callback (ADR-0005).
/// @dev The pool is `tstore`d immediately before `pool.swap`, checked and cleared in the callback. The input token is paid
///      from this contract's own balance inside the callback. Concrete contracts supply the revert hooks so that
///      their own interface errors are used. Callers must hold a reentrancy lock around every swap.
abstract contract UniswapV3Swapper is IUniswapV3SwapCallback {
    using SafeERC20 for IERC20;

    /// @dev Pool-reported outcome of a simulated hop, carried by the revert of {_quoteExactOut}.
    error V3SwapQuote(uint256 amountIn, uint256 amountOut);
    /// @dev The pool is not the (tokenIn, tokenOut) pair.
    error V3BadPair();
    /// @dev A quote hop failed in some way other than the expected quote revert.
    error V3QuoteFailed();

    /// @dev Lowest sqrt price allowed by Uniswap v3, plus one (TickMath.MIN_SQRT_RATIO + 1).
    uint160 internal constant V3_MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    /// @dev Highest sqrt price allowed by Uniswap v3, minus one (TickMath.MAX_SQRT_RATIO - 1).
    uint160 internal constant V3_MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    /// @dev Unique transient-storage slot: the pool of the swap in progress.
    bytes32 private constant EXPECTED_POOL_SLOT = 0x9c5a5e6a1a3b3a4f6a3b2f7c1d9c4e2b8a6d1f0e3c5b7a9d2e4f6081a3c5e7d8;
    /// @dev Unique transient-storage slot: 1 while a quote hop is simulated.
    bytes32 private constant QUOTE_MODE_SLOT = 0x3b8f1c0d5e7a9264b8d0f2e4a6c8e0b1d3f5a7c9e1b3d5f7092b4d6f8a0c2e41;

    // ---------------------------------------------------------------- hooks (must revert)
    /// @dev Called when the callback does not come from the pool of the swap in progress.
    function _revertUnexpectedCallback() internal view virtual;

    /// @dev Called when the input owed to the pool exceeds this contract's balance of the input token.
    function _revertInsufficientInput(uint256 owed, uint256 balance) internal view virtual;

    // ---------------------------------------------------------------- callback
    /// @inheritdoc IUniswapV3SwapCallback
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        address expected;
        assembly {
            expected := tload(EXPECTED_POOL_SLOT)
        }
        if (expected == address(0) || msg.sender != expected) _revertUnexpectedCallback();
        // single use: clear before paying
        assembly {
            tstore(EXPECTED_POOL_SLOT, 0)
        }

        address tokenIn = abi.decode(data, (address));
        uint256 owed;
        uint256 got;
        if (amount0Delta > 0) {
            owed = uint256(amount0Delta);
            got = amount1Delta < 0 ? uint256(-amount1Delta) : 0;
        } else {
            owed = uint256(amount1Delta);
            got = amount0Delta < 0 ? uint256(-amount0Delta) : 0;
        }

        bool quote;
        assembly {
            quote := tload(QUOTE_MODE_SLOT)
        }
        if (quote) revert V3SwapQuote(owed, got);

        uint256 bal = IERC20(tokenIn).balanceOf(address(this));
        if (owed > bal) _revertInsufficientInput(owed, bal);
        if (owed > 0) IERC20(tokenIn).safeTransfer(msg.sender, owed);
    }

    // ---------------------------------------------------------------- swaps
    /// @dev Exact-input swap `tokenIn -> tokenOut` on `pool`. Returns the amount of `tokenOut` the pool reports.
    function _swapExactIn(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        bool zeroForOne = _zeroForOne(pool, tokenIn, tokenOut);
        _arm(pool);
        (int256 a0, int256 a1) = IUniswapV3Pool(pool).swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? V3_MIN_SQRT_RATIO_PLUS_ONE : V3_MAX_SQRT_RATIO_MINUS_ONE,
            abi.encode(tokenIn)
        );
        amountOut = uint256(-(zeroForOne ? a1 : a0));
    }

    /// @dev Exact-output swap `tokenIn -> tokenOut` on `pool`. Returns the input paid and the output actually received
    ///      (callers must compare the latter with `amountOut` and revert on a partial fill).
    function _swapExactOut(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) internal returns (uint256 amountIn, uint256 received) {
        bool zeroForOne = _zeroForOne(pool, tokenIn, tokenOut);
        _arm(pool);
        (int256 a0, int256 a1) = IUniswapV3Pool(pool).swap(
            address(this),
            zeroForOne,
            -int256(amountOut),
            zeroForOne ? V3_MIN_SQRT_RATIO_PLUS_ONE : V3_MAX_SQRT_RATIO_MINUS_ONE,
            abi.encode(tokenIn)
        );
        (amountIn, received) = zeroForOne ? (uint256(a0), uint256(-a1)) : (uint256(a1), uint256(-a0));
    }

    /// @dev Simulates {_swapExactOut}: the callback reverts with the owed input, which is decoded here. Pool state is
    ///      untouched because the swap reverts. Needs no input balance.
    function _quoteExactOut(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) internal returns (uint256 amountIn, uint256 received) {
        bool zeroForOne = _zeroForOne(pool, tokenIn, tokenOut);
        _arm(pool);
        assembly {
            tstore(QUOTE_MODE_SLOT, 1)
        }
        try
            IUniswapV3Pool(pool).swap(
                address(this),
                zeroForOne,
                -int256(amountOut),
                zeroForOne ? V3_MIN_SQRT_RATIO_PLUS_ONE : V3_MAX_SQRT_RATIO_MINUS_ONE,
                abi.encode(tokenIn)
            )
        {
            revert V3QuoteFailed();
        } catch (bytes memory reason) {
            assembly {
                tstore(QUOTE_MODE_SLOT, 0)
                tstore(EXPECTED_POOL_SLOT, 0)
            }
            if (reason.length != 68 || bytes4(reason) != V3SwapQuote.selector) revert V3QuoteFailed();
            assembly {
                amountIn := mload(add(reason, 0x24))
                received := mload(add(reason, 0x44))
            }
        }
    }

    // ---------------------------------------------------------------- private
    function _arm(address pool) private {
        assembly {
            tstore(EXPECTED_POOL_SLOT, pool)
        }
    }

    function _zeroForOne(address pool, address tokenIn, address tokenOut) private view returns (bool) {
        address t0 = IUniswapV3Pool(pool).token0();
        // the pool must be exactly the (tokenIn, tokenOut) pair
        if (tokenIn == t0) return IUniswapV3Pool(pool).token1() == tokenOut ? true : _badPair();
        return (t0 == tokenOut && IUniswapV3Pool(pool).token1() == tokenIn) ? false : _badPair();
    }

    function _badPair() private pure returns (bool) {
        revert V3BadPair();
    }
}
