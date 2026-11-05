// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IBasket, BasketInit} from "./interfaces/IBasket.sol";
import {IBasketFactory} from "./interfaces/IBasketFactory.sol";
import {IBackingVault} from "./interfaces/IBackingVault.sol";
import {IComponentRegistry} from "./interfaces/IComponentRegistry.sol";

/// @title BasketFactory
/// @notice Validates parameters, deploys Basket clones (EIP-1167), registers them in the vault and stakes the
///         curator's $WIF. It is the source of truth for `isBasket`.
/// @dev The owner can only change `minCuratorStake` and pause creation (both affect future baskets only).
contract BasketFactory is IBasketFactory, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- errors
    error ZeroAddress();

    // ---------------------------------------------------------------- constants
    /// @inheritdoc IBasketFactory
    uint256 public constant override MIN_COMPONENTS = 2;
    /// @inheritdoc IBasketFactory
    uint256 public constant override MAX_COMPONENTS = 8;
    uint256 private constant MAX_NAME_BYTES = 32;
    uint256 private constant MAX_SYMBOL_BYTES = 11;

    // ---------------------------------------------------------------- immutables
    /// @inheritdoc IBasketFactory
    address public immutable override registry;
    /// @inheritdoc IBasketFactory
    address public immutable override harvester;
    /// @inheritdoc IBasketFactory
    address public immutable override vault;
    /// @inheritdoc IBasketFactory
    address public immutable override wif;
    /// @inheritdoc IBasketFactory
    address public immutable override implementation;

    // ---------------------------------------------------------------- storage
    /// @inheritdoc IBasketFactory
    mapping(address account => bool) public override isBasket;
    /// @inheritdoc IBasketFactory
    uint256 public override minCuratorStake;
    /// @inheritdoc IBasketFactory
    bool public override createPaused;
    address[] private _baskets;

    // ---------------------------------------------------------------- constructor
    constructor(
        address owner_,
        address registry_,
        address harvester_,
        address vault_,
        address wif_,
        address implementation_,
        uint256 minCuratorStake_
    ) Ownable(owner_) {
        if (
            registry_ == address(0) ||
            harvester_ == address(0) ||
            vault_ == address(0) ||
            wif_ == address(0) ||
            implementation_ == address(0)
        ) revert ZeroAddress();
        registry = registry_;
        harvester = harvester_;
        vault = vault_;
        wif = wif_;
        implementation = implementation_;
        minCuratorStake = minCuratorStake_;
        emit MinCuratorStakeSet(minCuratorStake_);
    }

    // ---------------------------------------------------------------- external
    /// @inheritdoc IBasketFactory
    /// @dev Validation order follows the error list of IBasketFactory. A zero stake is only possible when
    ///      `minCuratorStake == 0`, in which case the vault stake step is skipped (the vault rejects zero amounts).
    function createBasket(
        CreateParams calldata p,
        uint256 curatorStake
    ) external override nonReentrant returns (address basket) {
        if (createPaused) revert CreatePaused();
        _validate(p, curatorStake);

        // effects
        basket = Clones.clone(implementation);
        isBasket[basket] = true;
        _baskets.push(basket);

        // interactions: initialise first (the vault reads components()), then register, then stake
        _initBasket(basket, p);
        IBackingVault(vault).registerBasket(basket, msg.sender);
        if (curatorStake > 0) {
            IERC20 wifToken = IERC20(wif);
            wifToken.safeTransferFrom(msg.sender, address(this), curatorStake);
            wifToken.forceApprove(vault, curatorStake);
            IBackingVault(vault).stakeFor(basket, msg.sender, curatorStake);
            wifToken.forceApprove(vault, 0);
        }

        emit BasketCreated(basket, msg.sender, p.name, p.symbol, p.tokens, p.rawUnits, p.mode, curatorStake);
    }

    /// @inheritdoc IBasketFactory
    function setMinCuratorStake(uint256 amount) external override onlyOwner {
        minCuratorStake = amount;
        emit MinCuratorStakeSet(amount);
    }

    /// @inheritdoc IBasketFactory
    function setCreatePaused(bool paused) external override onlyOwner {
        createPaused = paused;
        emit CreatePausedSet(paused);
    }

    // ---------------------------------------------------------------- views
    /// @inheritdoc IBasketFactory
    function basketCount() external view override returns (uint256) {
        return _baskets.length;
    }

    /// @inheritdoc IBasketFactory
    function basketAt(uint256 index) external view override returns (address) {
        return _baskets[index];
    }

    // ---------------------------------------------------------------- internal
    function _initBasket(address basket, CreateParams calldata p) private {
        IBasket(basket).initialize(
            BasketInit({
                name: p.name,
                symbol: p.symbol,
                curator: msg.sender,
                tokens: p.tokens,
                rawUnits: p.rawUnits,
                mode: p.mode,
                harvester: harvester,
                wif: wif
            })
        );
    }

    function _validate(CreateParams calldata p, uint256 curatorStake) private view {
        uint256 n = p.tokens.length;
        if (n != p.rawUnits.length) revert BadLength();
        if (n < MIN_COMPONENTS) revert TooFewComponents();
        if (n > MAX_COMPONENTS) revert TooManyComponents();
        _validateComponents(p);
        uint256 nameLen = bytes(p.name).length;
        if (nameLen == 0 || nameLen > MAX_NAME_BYTES) revert BadName();
        uint256 symbolLen = bytes(p.symbol).length;
        if (symbolLen == 0 || symbolLen > MAX_SYMBOL_BYTES) revert BadSymbol();
        uint256 minStake = minCuratorStake;
        if (curatorStake < minStake) revert StakeTooLow(curatorStake, minStake);
    }

    function _validateComponents(CreateParams calldata p) private view {
        IComponentRegistry reg = IComponentRegistry(registry);
        uint256 n = p.tokens.length;
        for (uint256 i; i < n; ++i) {
            address token = p.tokens[i];
            if (i > 0 && token <= p.tokens[i - 1]) revert NotAscending();
            if (!reg.isEnabled(token)) revert ComponentDisabled(token);
            if (p.rawUnits[i] == 0) revert ZeroUnits(i);
        }
    }
}
