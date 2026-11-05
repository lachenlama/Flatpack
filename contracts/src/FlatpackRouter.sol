// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IBasket} from "./interfaces/IBasket.sol";
import {IBasketFactory} from "./interfaces/IBasketFactory.sol";
import {IComponentRegistry} from "./interfaces/IComponentRegistry.sol";
import {IFlatpackRouter} from "./interfaces/IFlatpackRouter.sol";
import {IUniswapV3Factory} from "./interfaces/external/IExternal.sol";
import {UniswapV3Swapper} from "./libraries/UniswapV3Swapper.sol";

/// @title FlatpackRouter
/// @notice One-transaction USDG -> basket shares (ARCHITECTURE.md section 5.1). Stateless (INV-3): every call ends with
///         zero USDG and zero component balance, and the only storage is transient.
/// @dev Swaps directly against the token/USDG Uniswap v3 pool resolved from the registry fee tier (ADR-0005).
contract FlatpackRouter is IFlatpackRouter, UniswapV3Swapper, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @dev Unique transient-storage slot holding the caller's `maxUsdgIn` while a buy is in progress.
    bytes32 private constant MAX_IN_SLOT = 0x1f4b6d8a0c2e4f61835a7c9e1b3d5f7092a4c6e8b0d2f4a6c8e0b2d4f6a8c0e3;

    /// @inheritdoc IFlatpackRouter
    address public immutable override factory;
    /// @inheritdoc IFlatpackRouter
    address public immutable override registry;
    /// @inheritdoc IFlatpackRouter
    address public immutable override usdg;
    address private immutable _v3Factory;

    error ZeroAddress();

    constructor(address factory_, address registry_) {
        if (factory_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        factory = factory_;
        registry = registry_;
        usdg = IComponentRegistry(registry_).usdg();
        _v3Factory = IComponentRegistry(registry_).v3Factory();
    }

    // ---------------------------------------------------------------- external
    /// @inheritdoc IFlatpackRouter
    function buy(BuyParams calldata p) external override nonReentrant returns (uint256 sharesOut, uint256 usdgSpent) {
        if (block.timestamp > p.deadline) revert Expired();
        if (!IBasketFactory(factory).isBasket(p.basket)) revert NotBasket();

        IBasket basket = IBasket(p.basket);
        basket.sync();
        (address[] memory tokens, ) = basket.components();
        uint256[] memory amounts = basket.previewMint(p.shares);

        // pull the whole budget, then buy each component with exact-output swaps
        IERC20 usdgToken = IERC20(usdg);
        usdgToken.safeTransferFrom(msg.sender, address(this), p.maxUsdgIn);
        uint256 maxIn = p.maxUsdgIn;
        assembly {
            tstore(MAX_IN_SLOT, maxIn)
        }
        for (uint256 i; i < tokens.length; ++i) {
            usdgSpent += _buyComponent(tokens[i], amounts[i]);
        }
        assembly {
            tstore(MAX_IN_SLOT, 0)
        }
        if (usdgSpent > p.maxUsdgIn) revert ExcessiveInput(usdgSpent, p.maxUsdgIn);

        // mint with exact approvals, reset to 0 afterwards
        for (uint256 i; i < tokens.length; ++i) {
            IERC20(tokens[i]).forceApprove(p.basket, amounts[i]);
        }
        (sharesOut, ) = basket.mint(p.shares, p.receiver, p.referrer);
        for (uint256 i; i < tokens.length; ++i) {
            IERC20(tokens[i]).forceApprove(p.basket, 0);
        }

        // refund the unused budget
        uint256 refund = p.maxUsdgIn - usdgSpent;
        if (refund > 0) usdgToken.safeTransfer(msg.sender, refund);

        emit Bought(p.basket, msg.sender, p.receiver, p.referrer, p.shares, sharesOut, usdgSpent);
    }

    /// @inheritdoc IFlatpackRouter
    /// @dev Each hop is simulated on its pool (the callback reverts with the owed input), then this function reverts with
    ///      the total. It moves no tokens, so it is safe for any caller and needs no USDG.
    function quoteBuy(address basket, uint256 shares) external override nonReentrant {
        if (!IBasketFactory(factory).isBasket(basket)) revert NotBasket();
        IBasket b = IBasket(basket);
        b.sync();
        (address[] memory tokens, ) = b.components();
        uint256[] memory amounts = b.previewMint(shares);
        uint256 total;
        for (uint256 i; i < tokens.length; ++i) {
            if (!IComponentRegistry(registry).isEnabled(tokens[i])) revert ComponentDisabled(tokens[i]);
            address pool = _pool(tokens[i]);
            (uint256 amountIn, uint256 received) = _quoteExactOut(pool, usdg, tokens[i], amounts[i]);
            if (received != amounts[i]) revert IncompleteFill(tokens[i], received, amounts[i]);
            total += amountIn;
        }
        revert QuoteResult(total);
    }

    // ---------------------------------------------------------------- swapper hooks
    function _revertUnexpectedCallback() internal pure override {
        revert UnexpectedCallback();
    }

    function _revertInsufficientInput(uint256 owed, uint256 balance) internal view override {
        uint256 maxIn;
        assembly {
            maxIn := tload(MAX_IN_SLOT)
        }
        // spent so far = maxIn - balance; this hop would add `owed`
        revert ExcessiveInput(maxIn - balance + owed, maxIn);
    }

    // ---------------------------------------------------------------- internal
    /// @dev Buys exactly `amount` of `token` and returns the USDG spent. Reverts unless exactly `amount` arrived.
    function _buyComponent(address token, uint256 amount) private returns (uint256 spent) {
        if (!IComponentRegistry(registry).isEnabled(token)) revert ComponentDisabled(token);
        address pool = _pool(token);
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        (spent, ) = _swapExactOut(pool, usdg, token, amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;
        if (received != amount) revert IncompleteFill(token, received, amount);
    }

    function _pool(address token) private view returns (address pool) {
        uint24 fee = IComponentRegistry(registry).component(token).v3Fee;
        pool = IUniswapV3Factory(_v3Factory).getPool(usdg, token, fee);
        if (pool == address(0)) revert PoolNotFound(token);
    }
}
