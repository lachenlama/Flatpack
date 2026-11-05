# WP2: BackingVault and StockMath

## Read first (in this order)
1. `docs/ENGINEERING-STANDARDS.md` (binding)
2. `docs/architecture/ARCHITECTURE.md` §5.5, §6, §7 (INV-5) and §8 (feed validation)
3. `contracts/src/interfaces/IBackingVault.sol`. **This is the normative spec. Read the contract-level @dev block carefully.**
4. Also read `IBasket.sol` (you call `components()`), `IBasketFactory.sol` (`isBasket` and `minCuratorStake`) and `IComponentRegistry.sol` (`component().priceFeed` and `benchmark()`)
5. ADR-0007 and ADR-0008
6. `docs/TEST-PLAN.md`: the BackingVault section
7. `docs/work-packages/README.md`: the constructor and wiring contract

## You own (create and edit ONLY these)
- `contracts/src/BackingVault.sol`
- `contracts/src/libraries/StockMath.sol`
- `contracts/test/mocks/MockBasketForVault.sol` (returns settable `components()`)
- `contracts/test/mocks/MockFactoryForVault.sol` (settable `isBasket` and `minCuratorStake`, and can call `registerBasket` and `stakeFor`)
- `contracts/test/mocks/MockRegistryForVault.sol` (settable `component()` and `benchmark()`)
- `contracts/test/unit/BackingVault.t.sol`, `StockMath.t.sol`
- `contracts/test/invariant/VaultInvariant.t.sol` (plus a handler)
- `docs/work-packages/WP2-REPORT.md`

Read-only for you: everything else. **Another agent is building Basket, Factory and Registry in parallel.** Use only the interfaces and your own mocks. Never import `Basket.sol` or `BasketFactory.sol`. If the full build breaks because of *their* files, wait about a minute and retry (up to 5 times). Never edit their files.

## StockMath (an internal library)
```solidity
function readPrice(address feed, uint256 maxAge) internal view returns (uint256 price8, bool valid);
// valid = answer > 0 && updatedAt != 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= maxAge
// Must not revert on a reverting feed: wrap latestRoundData in try/catch and return (0, false).
function unitNav(address[] memory tokens, uint256[] memory rawUnits, address registry, uint256 maxAge)
    internal view returns (uint256 nav18, bool valid);
// nav18 = sum(rawUnits_i * price8_i * 1e10 / 1e18). Uses Math.mulDiv. valid only if every feed is valid.
```

## Implementation notes
- `Ownable2Step` and `ReentrancyGuardTransient`. `setFactory` and `setHarvester` are owner-only and one-time (`AlreadySet`).
- **Epoch math:** `nextBoundaryAfter(t) = EPOCH_ANCHOR + ((t - EPOCH_ANCHOR) / EPOCH_LENGTH + 1) * EPOCH_LENGTH` for `t >= EPOCH_ANCHOR`, and `EPOCH_ANCHOR` itself for `t < EPOCH_ANCHOR`. `nextSettleAt = nextBoundaryAfter(lastSettledAt)`.
- **Accumulator:** update `rewardDebt` and `claimable` before every change to `active` (stake, requestUnstake). Released backer rewards: `accWifPerStake += released * 1e18 / totalActive`. Keep the rounding dust in the vault (it's still covered by INV-5 because the balance is ≥ obligations).
- **Settle** must handle `navLast == 0` (invalid at registration), `benchLast == 0`, and an invalid feed: in all of these, burn and re-snapshot.
- **Beat test:** `navNow * benchLast > navLast * benchNow` (cross-multiplied, strictly greater, mulDiv-safe).
- **curatorActive** = the curator's `active` stake ≥ `IBasketFactory(factory).minCuratorStake()`.
- Burns are `safeTransfer(DEAD, amount)`, where `DEAD = 0x000000000000000000000000000000000000dEaD`.
- `queueRewards`: `msg.sender == harvester`, and the basket must be registered.

## Acceptance criteria
- The Definition of Done in ENGINEERING-STANDARDS (coverage ≥ 95% on `BackingVault.sol` and `StockMath.sol`).
- Every TEST-PLAN ID in **U-V01..U-V10 and I-V01** is implemented and passing, plus StockMath unit tests (stale, zero, negative, reverting feed, future `updatedAt`, multi-token NAV).
- The invariant suite asserts INV-5 with random `vm.warp` across epoch boundaries.
- Write `docs/work-packages/WP2-REPORT.md` (same format as WP1).
