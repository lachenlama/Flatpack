// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IBackingVault
/// @notice Per-basket $WIF staking ("back a basket"), weekly Beat-SPY settlement and reward accounting
///         (ARCHITECTURE.md section 5.5, ADR-0007).
/// @dev - Rewards for backers use a MasterChef-style accumulator per basket over ACTIVE stake (stake that is pending
///        unstake does not earn).
///      - The curator's own stake is a normal position (it earns as a backer). The curator ALSO receives the curator
///        share when curatorActive(basket) is true at settlement: the curator's active stake >= factory.minCuratorStake().
///      - NAV is unit-based: nav = sum(rawUnits_i * answer_i) * 1e10 / 1e18 (18-dec USD per 1e18 shares), read from
///        basket.components() and registry feeds. It ignores donations, so it can't be gamed.
///      - Epoch boundaries: EPOCH_ANCHOR + k * EPOCH_LENGTH. settle() is allowed once block.timestamp >= the first
///        boundary strictly after lastSettledAt.
///      - Settlement outcome: released only if every feed is valid AND navNow * benchLast > navLast * benchNow
///        (strictly beat). Otherwise all queued rewards are burned (sent to DEAD). In either case, re-snapshot.
///      - If released: backer queue -> accumulator (burned if totalActiveStake == 0); curator queue -> curator
///        claimable (burned if !curatorActive).
///      - A basket registered with an invalid snapshot (a stale feed) stores nav=0. The next settle then burns and re-snapshots.
///      - WARMUP (anti just-in-time staking, review finding R-1): weekend feeds are frozen, so a settle outcome is
///        predictable before it is called. New stake via stake()/stakeFor() therefore goes to `warming` and does NOT
///        earn until the basket's NEXT settle activates it. At settle, AFTER distributing the released rewards,
///        totalWarming moves to totalActive and settleCount++. Per-account activation is lazy: whenever a position is
///        touched (stake, requestUnstake, claim, views) and p.warmingSettleId < s.settleCount, warming becomes active
///        with rewardDebt based on accAtSettle[basket][p.warmingSettleId + 1] (the accumulator right after the
///        activating settle), so warmed stake earns from exactly the settle after it was added.
///        EXCEPTION: the factory's stakeFor during createBasket (same tx as registerBasket, i.e. settleCount == 0
///        and block.timestamp == lastSettledAt) is active immediately, so a new basket's curator is active in epoch 1.
///        requestUnstake may take from `warming` first, then `active`. Warming stake counts toward curatorActive: NO.
interface IBackingVault {
    struct Position {
        uint256 active; // earning stake
        uint256 warming; // added since the last settle, not earning yet (activates at the next settle)
        uint64 warmingSettleId; // s.settleCount when `warming` was last added
        uint256 pendingUnstake; // non-earning, withdrawable after unlockAt
        uint64 unlockAt;
        uint256 rewardDebt;
        uint256 claimable; // settled, unclaimed rewards
    }

    struct BasketState {
        address curator;
        uint256 totalActive;
        uint256 totalWarming;
        uint64 settleCount;
        uint256 queuedBackers;
        uint256 queuedCurator;
        uint256 curatorClaimable;
        uint256 accWifPerStake; // scaled by 1e18
        uint256 navLast; // 18-dec USD per 1e18 shares
        uint256 benchLast; // 8-dec benchmark price
        uint64 lastSettledAt;
    }

    event FactorySet(address factory);
    event HarvesterSet(address harvester);
    event BasketRegistered(address indexed basket, address indexed curator, uint256 nav, uint256 benchPrice);
    /// @param warming true if the stake is warming (earns from the next settle), false if immediately active
    event Staked(address indexed basket, address indexed account, uint256 amount, bool warming);
    event UnstakeRequested(address indexed basket, address indexed account, uint256 amount, uint64 unlockAt);
    event Withdrawn(address indexed basket, address indexed account, uint256 amount);
    event RewardsQueued(address indexed basket, uint256 backers, uint256 curator);
    event EpochSettled(
        address indexed basket,
        uint64 settledAt,
        uint256 navLast,
        uint256 navNow,
        uint256 benchLast,
        uint256 benchNow,
        bool beat,
        uint256 releasedBackers,
        uint256 releasedCurator,
        uint256 burned
    );
    event RewardsClaimed(address indexed basket, address indexed account, address to, uint256 amount);
    event CuratorClaimed(address indexed basket, address indexed curator, address to, uint256 amount);

    error OnlyFactory();
    error OnlyHarvester();
    error AlreadySet();
    error UnknownBasket();
    error AlreadyRegistered();
    error ZeroAmount();
    error InsufficientActive();
    error StillLocked(uint64 unlockAt);
    error TooEarly(uint64 nextSettleAt);
    error NotCurator();

    function EPOCH_ANCHOR() external pure returns (uint64); // 1794016800 = Sat 2026-11-07 02:00 UTC
    function EPOCH_LENGTH() external pure returns (uint64); // 7 days
    function UNSTAKE_COOLDOWN() external pure returns (uint64); // 7 days
    function MAX_PRICE_AGE() external pure returns (uint256); // 4 days
    function DEAD() external pure returns (address);

    /// @notice One-time wiring by the owner.
    function setFactory(address factory) external;
    function setHarvester(address harvester) external;

    /// @notice Factory only. Snapshots navLast and benchLast and sets lastSettledAt = block.timestamp.
    function registerBasket(address basket, address curator) external;

    /// @notice Pulls `amount` $WIF from msg.sender and credits `account`'s active stake on `basket`.
    function stakeFor(address basket, address account, uint256 amount) external;
    function stake(address basket, uint256 amount) external;
    /// @notice Moves stake (warming first, then active) -> pendingUnstake and resets unlockAt = now + UNSTAKE_COOLDOWN
    ///         (adding to an existing pending amount restarts the timer). Reverts InsufficientActive if
    ///         amount > warming + active.
    function requestUnstake(address basket, uint256 amount) external;
    function withdraw(address basket) external returns (uint256 amount);

    /// @notice Harvester only. PULLS backers + curator $WIF from msg.sender via safeTransferFrom (the harvester must
    ///         approve exactly that amount first), then adds to the queues for the current epoch (review finding R-2:
    ///         the vault can never be under-funded by a buggy caller).
    function queueRewards(address basket, uint256 backers, uint256 curator) external;

    /// @notice Permissionless. See the contract-level dev notes.
    function settle(address basket) external;

    function claim(address basket, address to) external returns (uint256 amount);
    function claimCurator(address basket, address to) external returns (uint256 amount);

    function basketState(address basket) external view returns (BasketState memory);
    function position(address basket, address account) external view returns (Position memory);
    function pendingRewards(address basket, address account) external view returns (uint256);
    function curatorActive(address basket) external view returns (bool);
    function nextSettleAt(address basket) external view returns (uint64);
    /// @notice The current unit-based NAV, or 0 if any feed is invalid. Used by the app.
    function navOf(address basket) external view returns (uint256 nav, bool valid);
}
