// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBackingVault} from "./interfaces/IBackingVault.sol";
import {IBasket} from "./interfaces/IBasket.sol";
import {IBasketFactory} from "./interfaces/IBasketFactory.sol";
import {IComponentRegistry} from "./interfaces/IComponentRegistry.sol";
import {StockMath} from "./libraries/StockMath.sol";

/// @title BackingVault
/// @notice Per-basket $WIF staking with weekly Beat-SPY settlement (ARCHITECTURE.md 5.5, ADR-0007, ADR-0008).
/// @dev Oracles gate REWARDS only. Principal (active and pending stake) is never touched by settle and can always
///      be withdrawn after the cooldown. INV-5: the vault's WIF balance is always >= all obligations
///      (active + pending + queued + curator claimable + unclaimed accrued backer rewards); rounding dust stays here.
contract BackingVault is IBackingVault, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants
    /// @inheritdoc IBackingVault
    uint64 public constant EPOCH_ANCHOR = 1794016800;
    /// @inheritdoc IBackingVault
    uint64 public constant EPOCH_LENGTH = 7 days;
    /// @inheritdoc IBackingVault
    uint64 public constant UNSTAKE_COOLDOWN = 7 days;
    /// @inheritdoc IBackingVault
    uint256 public constant MAX_PRICE_AGE = 4 days;
    /// @inheritdoc IBackingVault
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 private constant ACC_PRECISION = 1e18;

    // ------------------------------------------------------------------ immutables
    /// @notice The component registry (feeds and benchmark).
    IComponentRegistry public immutable registry;
    /// @notice The $WIF token.
    IERC20 public immutable wif;

    // ------------------------------------------------------------------ storage
    /// @notice The BasketFactory (one-time set).
    address public factory;
    /// @notice The FeeHarvester (one-time set).
    address public harvester;

    mapping(address basket => BasketState) private _states;
    mapping(address basket => mapping(address account => Position)) private _positions;
    /// @dev accWifPerStake right after the settle that produced settleCount == id (used to activate warming stake).
    mapping(address basket => mapping(uint64 settleId => uint256 acc)) private _accAtSettle;

    /// @dev In-memory settlement result (keeps settle() within the stack limit).
    struct Settlement {
        uint256 navNow;
        uint256 benchNow;
        uint256 navLast;
        uint256 benchLast;
        bool allValid;
        bool beat;
        uint256 relBackers;
        uint256 relCurator;
        uint256 burned;
    }

    /// @dev Thrown when a constructor, setter or registration argument is the zero address.
    error ZeroAddress();

    // ------------------------------------------------------------------ constructor
    /// @param owner_ the Ownable2Step owner (wires factory and harvester once)
    /// @param registry_ the IComponentRegistry
    /// @param wif_ the $WIF token
    constructor(address owner_, address registry_, address wif_) Ownable(owner_) {
        if (registry_ == address(0) || wif_ == address(0)) revert ZeroAddress();
        registry = IComponentRegistry(registry_);
        wif = IERC20(wif_);
    }

    // ------------------------------------------------------------------ modifiers
    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    modifier onlyHarvester() {
        if (msg.sender != harvester) revert OnlyHarvester();
        _;
    }

    modifier known(address basket) {
        if (_states[basket].curator == address(0)) revert UnknownBasket();
        _;
    }

    // ------------------------------------------------------------------ owner wiring
    /// @inheritdoc IBackingVault
    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @inheritdoc IBackingVault
    function setHarvester(address harvester_) external onlyOwner {
        if (harvester != address(0)) revert AlreadySet();
        if (harvester_ == address(0)) revert ZeroAddress();
        harvester = harvester_;
        emit HarvesterSet(harvester_);
    }

    // ------------------------------------------------------------------ factory
    /// @inheritdoc IBackingVault
    function registerBasket(address basket, address curator) external onlyFactory {
        if (basket == address(0) || curator == address(0)) revert ZeroAddress();
        BasketState storage s = _states[basket];
        if (s.curator != address(0)) revert AlreadyRegistered();

        (uint256 nav, bool navValid) = _nav(basket);
        (uint256 bench, bool benchValid) = _benchPrice();
        // an invalid snapshot is stored as 0; the next settle then burns and re-snapshots
        if (!navValid || !benchValid) {
            nav = 0;
            bench = 0;
        }
        s.curator = curator;
        s.navLast = nav;
        s.benchLast = bench;
        s.lastSettledAt = uint64(block.timestamp);
        emit BasketRegistered(basket, curator, nav, bench);
    }

    // ------------------------------------------------------------------ staking
    /// @inheritdoc IBackingVault
    function stakeFor(address basket, address account, uint256 amount) external nonReentrant known(basket) {
        _stake(basket, account, amount);
    }

    /// @inheritdoc IBackingVault
    function stake(address basket, uint256 amount) external nonReentrant known(basket) {
        _stake(basket, msg.sender, amount);
    }

    /// @inheritdoc IBackingVault
    /// @dev Takes from warming first, then active.
    function requestUnstake(address basket, uint256 amount) external nonReentrant known(basket) {
        if (amount == 0) revert ZeroAmount();
        Position storage p = _positions[basket][msg.sender];
        BasketState storage s = _states[basket];

        _touch(basket, s, p);
        if (amount > p.warming + p.active) revert InsufficientActive();
        uint256 fromWarming = Math.min(amount, p.warming);
        if (fromWarming != 0) {
            p.warming -= fromWarming;
            s.totalWarming -= fromWarming;
        }
        uint256 fromActive = amount - fromWarming;
        if (fromActive != 0) {
            p.active -= fromActive;
            s.totalActive -= fromActive;
        }
        p.pendingUnstake += amount;
        uint64 unlockAt = uint64(block.timestamp) + UNSTAKE_COOLDOWN;
        p.unlockAt = unlockAt;
        p.rewardDebt = _debt(p.active, s.accWifPerStake);
        emit UnstakeRequested(basket, msg.sender, amount, unlockAt);
    }

    /// @inheritdoc IBackingVault
    /// @dev Never depends on oracles, the harvester or settlement: principal is always recoverable after the cooldown.
    function withdraw(address basket) external nonReentrant returns (uint256 amount) {
        Position storage p = _positions[basket][msg.sender];
        amount = p.pendingUnstake;
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp < p.unlockAt) revert StillLocked(p.unlockAt);
        p.pendingUnstake = 0;
        p.unlockAt = 0;
        emit Withdrawn(basket, msg.sender, amount);
        wif.safeTransfer(msg.sender, amount);
    }

    // ------------------------------------------------------------------ rewards
    /// @inheritdoc IBackingVault
    function queueRewards(
        address basket,
        uint256 backers,
        uint256 curator
    ) external nonReentrant onlyHarvester known(basket) {
        BasketState storage s = _states[basket];
        s.queuedBackers += backers;
        s.queuedCurator += curator;
        emit RewardsQueued(basket, backers, curator);
        // pull last (CEI): the vault can never be under-funded by the caller
        wif.safeTransferFrom(msg.sender, address(this), backers + curator);
    }

    /// @inheritdoc IBackingVault
    function settle(address basket) external nonReentrant known(basket) {
        BasketState storage s = _states[basket];
        uint64 nextAt = _nextBoundaryAfter(s.lastSettledAt);
        if (block.timestamp < nextAt) revert TooEarly(nextAt);

        Settlement memory r = _evaluate(basket, s);
        _distribute(basket, s, r);
        _rollWarming(basket, s);

        // re-snapshot (an invalid read is stored as 0 so the next settle burns, see IBackingVault)
        s.navLast = r.allValid ? r.navNow : 0;
        s.benchLast = r.allValid ? r.benchNow : 0;
        s.lastSettledAt = uint64(block.timestamp);

        emit EpochSettled(
            basket,
            uint64(block.timestamp),
            r.navLast,
            r.navNow,
            r.benchLast,
            r.benchNow,
            r.beat,
            r.relBackers,
            r.relCurator,
            r.burned
        );
        if (r.burned != 0) wif.safeTransfer(DEAD, r.burned);
    }

    /// @inheritdoc IBackingVault
    function claim(address basket, address to) external nonReentrant known(basket) returns (uint256 amount) {
        BasketState storage s = _states[basket];
        Position storage p = _positions[basket][msg.sender];
        _touch(basket, s, p);
        amount = p.claimable;
        if (amount != 0) {
            p.claimable = 0;
            emit RewardsClaimed(basket, msg.sender, to, amount);
            wif.safeTransfer(to, amount);
        }
    }

    /// @inheritdoc IBackingVault
    function claimCurator(address basket, address to) external nonReentrant known(basket) returns (uint256 amount) {
        BasketState storage s = _states[basket];
        if (msg.sender != s.curator) revert NotCurator();
        amount = s.curatorClaimable;
        if (amount != 0) {
            s.curatorClaimable = 0;
            emit CuratorClaimed(basket, msg.sender, to, amount);
            wif.safeTransfer(to, amount);
        }
    }

    // ------------------------------------------------------------------ views
    /// @inheritdoc IBackingVault
    function basketState(address basket) external view returns (BasketState memory) {
        return _states[basket];
    }

    /// @inheritdoc IBackingVault
    /// @dev Returns the position as it would be after lazy warmup activation and accrual.
    function position(address basket, address account) external view returns (Position memory) {
        return _projected(basket, _states[basket], _positions[basket][account]);
    }

    /// @inheritdoc IBackingVault
    function pendingRewards(address basket, address account) external view returns (uint256) {
        Position memory q = _projected(basket, _states[basket], _positions[basket][account]);
        return q.claimable + _sat(Math.mulDiv(q.active, _states[basket].accWifPerStake, ACC_PRECISION), q.rewardDebt);
    }

    /// @inheritdoc IBackingVault
    function curatorActive(address basket) external view known(basket) returns (bool) {
        return _curatorActive(_states[basket].curator, basket);
    }

    /// @inheritdoc IBackingVault
    function nextSettleAt(address basket) external view known(basket) returns (uint64) {
        return _nextBoundaryAfter(_states[basket].lastSettledAt);
    }

    /// @inheritdoc IBackingVault
    function navOf(address basket) external view returns (uint256 nav, bool valid) {
        return _nav(basket);
    }

    // ------------------------------------------------------------------ internal
    function _stake(address basket, address account, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        BasketState storage s = _states[basket];
        Position storage p = _positions[basket][account];
        _touch(basket, s, p);
        // the factory's stake in the registration tx (createBasket) is active immediately
        bool immediate = msg.sender == factory && s.settleCount == 0 && block.timestamp == s.lastSettledAt;
        if (immediate) {
            p.active += amount;
            s.totalActive += amount;
            p.rewardDebt = _debt(p.active, s.accWifPerStake);
        } else {
            p.warming += amount;
            p.warmingSettleId = s.settleCount;
            s.totalWarming += amount;
        }
        emit Staked(basket, account, amount, !immediate);
        wif.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @dev Persists the projected position: accrues rewards and activates warming stake from earlier settles.
    function _touch(address basket, BasketState storage s, Position storage p) private {
        Position memory q = _projected(basket, s, p);
        p.active = q.active;
        p.warming = q.warming;
        p.claimable = q.claimable;
        p.rewardDebt = q.rewardDebt;
    }

    /// @dev Pure projection of a position at the current accumulator. Warming stake added before the latest settle
    ///      earns acc_now - accAtSettle[id + 1] (the accumulator right after the activating settle); active stake earns
    ///      acc_now - its debt. Then rewardDebt = ceil(active_new * acc_now) (R-3).
    function _projected(
        address basket,
        BasketState storage s,
        Position storage p
    ) private view returns (Position memory q) {
        q = p;
        uint256 acc = s.accWifPerStake;
        uint256 accrued = Math.mulDiv(q.active, acc, ACC_PRECISION);
        q.claimable += _sat(accrued, q.rewardDebt);
        if (q.warming != 0 && q.warmingSettleId < s.settleCount) {
            q.claimable += Math.mulDiv(q.warming, acc - _accAtSettle[basket][q.warmingSettleId + 1], ACC_PRECISION);
            q.active += q.warming;
            q.warming = 0;
        }
        q.rewardDebt = _debt(q.active, acc);
    }

    /// @dev Reward debt rounds UP (review R-3) so that per-account earnings, which are floor(active * acc) - debt, can
    ///      never sum to more than what settle() distributed. Principal and rewards share one  balance, so a
    ///      1-wei over-credit could otherwise make the last withdrawal revert.
    function _debt(uint256 active, uint256 acc) private pure returns (uint256) {
        return Math.mulDiv(active, acc, ACC_PRECISION, Math.Rounding.Ceil);
    }

    /// @dev Saturating subtraction: with a ceil-rounded debt, floor(active * acc) can be 1 wei below the debt.
    function _sat(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    /// @dev After distribution: record the accumulator for this settle id and activate all warming stake.
    function _rollWarming(address basket, BasketState storage s) private {
        uint64 id = s.settleCount + 1;
        s.settleCount = id;
        _accAtSettle[basket][id] = s.accWifPerStake;
        s.totalActive += s.totalWarming;
        s.totalWarming = 0;
    }

    /// @dev Reads oracles and decides whether the basket beat the benchmark.
    function _evaluate(address basket, BasketState storage s) private view returns (Settlement memory r) {
        bool navValid;
        bool benchValid;
        (r.navNow, navValid) = _nav(basket);
        (r.benchNow, benchValid) = _benchPrice();
        r.navLast = s.navLast;
        r.benchLast = s.benchLast;
        r.allValid = navValid && benchValid;
        r.beat = r.allValid && r.navLast != 0 && r.benchLast != 0 && _gt(r.navNow, r.benchLast, r.navLast, r.benchNow);
    }

    /// @dev Applies the settlement outcome to the queues, accumulator and curator balance (effects only).
    function _distribute(address basket, BasketState storage s, Settlement memory r) private {
        uint256 qBackers = s.queuedBackers;
        uint256 qCurator = s.queuedCurator;
        s.queuedBackers = 0;
        s.queuedCurator = 0;
        if (!r.beat) {
            r.burned = qBackers + qCurator;
            return;
        }
        uint256 totalActive = s.totalActive;
        if (totalActive == 0) {
            r.burned = qBackers;
        } else {
            r.relBackers = qBackers;
            s.accWifPerStake += Math.mulDiv(qBackers, ACC_PRECISION, totalActive);
        }
        if (_curatorActive(s.curator, basket)) {
            r.relCurator = qCurator;
            s.curatorClaimable += qCurator;
        } else {
            r.burned += qCurator;
        }
    }

    function _curatorActive(address curator, address basket) private view returns (bool) {
        return
            _projected(basket, _states[basket], _positions[basket][curator]).active >=
            IBasketFactory(factory).minCuratorStake();
    }

    function _nextBoundaryAfter(uint64 t) private pure returns (uint64) {
        if (t < EPOCH_ANCHOR) return EPOCH_ANCHOR;
        return EPOCH_ANCHOR + ((t - EPOCH_ANCHOR) / EPOCH_LENGTH + 1) * EPOCH_LENGTH;
    }

    /// @dev Unit-based NAV. A basket whose components() reverts or returns nothing is treated as invalid.
    function _nav(address basket) private view returns (uint256 nav, bool valid) {
        try IBasket(basket).components() returns (address[] memory tokens, uint256[] memory rawUnits) {
            return StockMath.unitNav(tokens, rawUnits, address(registry), MAX_PRICE_AGE);
        } catch {
            return (0, false);
        }
    }

    function _benchPrice() private view returns (uint256 price, bool valid) {
        address bench = registry.benchmark();
        if (bench == address(0)) return (0, false);
        return StockMath.readPrice(registry.component(bench).priceFeed, MAX_PRICE_AGE);
    }

    /// @dev a * b > c * d with full 512-bit precision (no overflow).
    function _gt(uint256 a, uint256 b, uint256 c, uint256 d) private pure returns (bool) {
        (uint256 h1, uint256 l1) = Math.mul512(a, b);
        (uint256 h2, uint256 l2) = Math.mul512(c, d);
        return h1 > h2 || (h1 == h2 && l1 > l2);
    }
}
