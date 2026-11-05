// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DividendMode} from "./IBasket.sol";

/// @title IBasketFactory
/// @notice Validates parameters, deploys Basket clones (EIP-1167, OZ Clones), registers them in the vault, and stakes
///         the curator's $WIF.
interface IBasketFactory {
    struct CreateParams {
        string name; // 1..32 bytes
        string symbol; // 1..11 bytes
        address[] tokens; // 2..8, strictly ascending by address, each registry.isEnabled
        uint256[] rawUnits; // same length, each > 0
        DividendMode mode;
    }

    event BasketCreated(
        address indexed basket,
        address indexed curator,
        string name,
        string symbol,
        address[] tokens,
        uint256[] rawUnits,
        DividendMode mode,
        uint256 curatorStake
    );
    event MinCuratorStakeSet(uint256 amount);
    event CreatePausedSet(bool paused);

    error CreatePaused();
    error BadLength();
    error TooFewComponents();
    error TooManyComponents();
    error NotAscending(); // also catches duplicates
    error ComponentDisabled(address token);
    error ZeroUnits(uint256 index);
    error BadName();
    error BadSymbol();
    error StakeTooLow(uint256 provided, uint256 minimum);

    /// @notice msg.sender becomes the curator. Pulls `curatorStake` $WIF from msg.sender (it needs an approval to the
    ///         factory) and stakes it in the vault for msg.sender via vault.stakeFor.
    /// @dev Order: clone -> basket.initialize -> vault.registerBasket (it snapshots NAV from basket.components(), so it
    ///      MUST come after initialize) -> pull stake -> vault.stakeFor.
    function createBasket(CreateParams calldata p, uint256 curatorStake) external returns (address basket);

    function isBasket(address account) external view returns (bool);
    function basketCount() external view returns (uint256);
    function basketAt(uint256 index) external view returns (address);

    function minCuratorStake() external view returns (uint256);
    function createPaused() external view returns (bool);
    /// @notice Owner only. Affects future baskets and the vault's curatorActive check.
    function setMinCuratorStake(uint256 amount) external;
    /// @notice Owner only. Pauses createBasket ONLY. It never affects existing baskets.
    function setCreatePaused(bool paused) external;

    function registry() external view returns (address);
    function harvester() external view returns (address);
    function vault() external view returns (address);
    function wif() external view returns (address);
    function implementation() external view returns (address);

    function MIN_COMPONENTS() external pure returns (uint256); // 2
    function MAX_COMPONENTS() external pure returns (uint256); // 8
}
