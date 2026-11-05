// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IComponentRegistry} from "./interfaces/IComponentRegistry.sol";
import {IUniswapV3Factory} from "./interfaces/external/IExternal.sol";

/// @title ComponentRegistry
/// @notice The allowlist of Stock Tokens a basket may hold, with each token's Chainlink feed and Uniswap v3 USDG
///         pool fee tier. It also stores the Beat-SPY benchmark token.
/// @dev Owner-managed (Ownable2Step). It holds no funds and has no power over existing baskets: disabling a component
///      only blocks new baskets (factory) and router buys. When a component is disabled its stored feed and fee tier
///      are KEPT, because the vault still needs the feed to value existing baskets (see WP1-REPORT, spec ambiguities).
contract ComponentRegistry is IComponentRegistry, Ownable2Step {
    // ---------------------------------------------------------------- constants
    uint24 private constant FEE_100 = 100;
    uint24 private constant FEE_500 = 500;
    uint24 private constant FEE_3000 = 3000;
    uint24 private constant FEE_10000 = 10_000;

    // ---------------------------------------------------------------- immutables
    /// @inheritdoc IComponentRegistry
    address public immutable override usdg;
    /// @inheritdoc IComponentRegistry
    address public immutable override v3Factory;

    // ---------------------------------------------------------------- storage
    /// @inheritdoc IComponentRegistry
    address public override benchmark;
    mapping(address token => Component) private _components;

    // ---------------------------------------------------------------- constructor
    /// @param owner_ initial owner (two-step transferable)
    /// @param usdg_ the USDG token that component pools are paired with
    /// @param v3Factory_ the Uniswap v3 factory used to verify pools exist
    constructor(address owner_, address usdg_, address v3Factory_) Ownable(owner_) {
        if (usdg_ == address(0) || v3Factory_ == address(0)) revert ZeroAddress();
        usdg = usdg_;
        v3Factory = v3Factory_;
    }

    // ---------------------------------------------------------------- external
    /// @inheritdoc IComponentRegistry
    function setComponent(address token, bool enabled, address priceFeed, uint24 v3Fee) external override onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        Component storage c = _components[token];
        if (enabled) {
            if (priceFeed == address(0)) revert ZeroAddress();
            if (!_validFee(v3Fee)) revert InvalidFeeTier(v3Fee);
            if (IUniswapV3Factory(v3Factory).getPool(token, usdg, v3Fee) == address(0)) {
                revert PoolNotFound(token, v3Fee);
            }
            c.enabled = true;
            c.priceFeed = priceFeed;
            c.v3Fee = v3Fee;
        } else {
            // keep the stored feed and fee tier so existing baskets can still be valued
            c.enabled = false;
        }
        emit ComponentSet(token, enabled, c.priceFeed, c.v3Fee);
    }

    /// @inheritdoc IComponentRegistry
    function setBenchmark(address token) external override onlyOwner {
        if (!_components[token].enabled) revert ComponentNotEnabled(token);
        benchmark = token;
        emit BenchmarkSet(token);
    }

    // ---------------------------------------------------------------- views
    /// @inheritdoc IComponentRegistry
    function component(address token) external view override returns (Component memory) {
        return _components[token];
    }

    /// @inheritdoc IComponentRegistry
    function isEnabled(address token) external view override returns (bool) {
        return _components[token].enabled;
    }

    // ---------------------------------------------------------------- internal
    function _validFee(uint24 fee) private pure returns (bool) {
        return fee == FEE_100 || fee == FEE_500 || fee == FEE_3000 || fee == FEE_10000;
    }
}
