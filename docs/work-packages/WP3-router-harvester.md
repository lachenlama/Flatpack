# WP3: FlatpackRouter, FeeHarvester and the swap libraries

**Status:** WP1 and WP2 are accepted (154 tests green). Build on them.

## Read first (in this order)
1. `docs/ENGINEERING-STANDARDS.md`
2. `docs/architecture/ARCHITECTURE.md` §5.1, §5.3, §5.4, §7 (INV-3, INV-6, INV-8) and §8 (callbacks)
3. `contracts/src/interfaces/IFlatpackRouter.sol` and `IFeeHarvester.sol` (**normative**). Also `IBasket.sol`, `IBackingVault.sol`, `IComponentRegistry.sol` and `external/IExternal.sol`.
4. ADR-0002, 0004 and 0005
5. `docs/TEST-PLAN.md`: the Router and Harvester section (F-R01..F-R04, F-H01..F-H05, F-E2E)
6. `config/mainnet-4663.json`: every address and the WIF/ETH v4 pool key
7. The merged WP1 and WP2 code (`Basket.sol`, `BasketFactory.sol`, `ComponentRegistry.sol`, `BackingVault.sol`), read-only

## You own
- `contracts/src/FlatpackRouter.sol`
- `contracts/src/FeeHarvester.sol`
- `contracts/src/libraries/UniswapV3Swapper.sol` (abstract): `_swapExactIn` and `_swapExactOut` against a pool resolved via `IUniswapV3Factory.getPool`. The callback is authenticated against the pool held in transient storage (`tstore` the expected pool before `swap`, check `msg.sender` in `uniswapV3SwapCallback`, then clear it). Pay the owed token in the callback. For exact-out, require the full amount out (`IncompleteFill`). Price limits: `MIN_SQRT_RATIO + 1` / `MAX_SQRT_RATIO − 1`.
- `contracts/src/libraries/UniswapV4WifSwapper.sol` (abstract): ETH→WIF exact-in through `IPoolManager.unlock` and `unlockCallback`, using `@uniswap/v4-core` types (`PoolKey`, `Currency`, `BalanceDelta`, `IHooks`). `swap` with `zeroForOne = true` (currency0 is native ETH). `settle` ETH with `poolManager.settle{value: amountIn}()`, and `take` WIF to `address(this)`. Only accept `unlockCallback` from the PoolManager while inside our own unlock (a transient flag).
- `contracts/test/fork/RouterFork.t.sol`, `HarvesterFork.t.sol` and `EndToEndFork.t.sol`. **Every test name contains `_F_`.** Each one starts with `vm.createSelectFork("robinhood", PINNED_BLOCK)`. Deploy the full system on the fork (registry seeded from `config/mainnet-4663.json`), and get tokens with `deal` (for USDG/WIF/Stock Tokens; if `deal` fails on a token, impersonate a holder with `vm.prank`).
- `contracts/test/unit/Router.t.sol` (spoofed-callback and expiry checks that need no fork)
- `docs/work-packages/WP3-REPORT.md`

## Implementation notes
- **Harvester swap path:** component → USDG (v3, `registry.component(token).v3Fee`), skipping USDG itself → WETH (v3 pool fee 100, address in config) → `WETH.withdraw` → ETH → WIF (v4 pool key from the constructor). The harvester needs `receive()`, restricted to WETH and the PoolManager.
- The pool's hook takes a cut of swap output (afterSwapReturnsDelta). Measure the **actual** WIF balance delta and never trust the returned delta alone. F-H05 logs the effective tax.
- `harvestFees` must redeem the fee shares via `IBasket.redeem` as the harvester (fee-exempt). It must also handle IOUs: if a component is paused, its leg becomes an IOU owed to the harvester. Skip it, and harvest it later through `claimIOU` (document this).
- **The vault pulls** (review R-2): before `vault.queueRewards(basket, backers, curator)`, `forceApprove(vault, backers + curator)`, then reset it to 0 afterwards. Do NOT transfer the $WIF to the vault directly.
- The basket calls `onFeeShares` and `onDividendSkim` from inside its own `nonReentrant` functions, so these handlers must only do accounting and must never call back into the basket (WP1 report).
- The split must satisfy INV-8 exactly: compute `burn` and `toReferrers` with floor rounding, and send the remainder to the vault. `backers = R * 3000 / 5000` and `curator = R - backers`.
- `quoteBuy` runs the real swap path and then `revert QuoteResult(usdgIn)`. It must be callable via `eth_call` by any address.
- Router: never hold balances between calls (INV-3), use exact approvals, and refund the unused USDG.

## Acceptance criteria
- The Definition of Done (coverage on owned `src/` files ≥ 90%. Fork tests count toward coverage when run with `npm run test:fork -- --coverage` if supported; otherwise report what you measured).
- Every F-* ID passes on a pinned mainnet fork. INV-3 and INV-8 are asserted in tests.
- The report includes measured gas for a 3-component buy and a full harvest, and the effective WIF hook tax.
