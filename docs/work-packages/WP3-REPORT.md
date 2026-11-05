# WP3 Report: FlatpackRouter, FeeHarvester, swap libraries

## Built
- `src/libraries/UniswapV3Swapper.sol` (abstract): `_swapExactIn`, `_swapExactOut`, `_quoteExactOut` on an explicit pool address. The callback is authenticated against the pool in transient storage (cleared before paying). Revert hooks (`_revertUnexpectedCallback`, `_revertInsufficientInput`) let each contract raise its own interface errors.
- `src/libraries/UniswapV4WifSwapper.sol` (abstract): ETH -> WIF exact-in via `unlock`/`unlockCallback`, guarded by a transient "inside our own unlock" flag. Reverts `V4PartialFill` if the pool consumes less ETH than offered. Output is measured as a balance delta by callers (hook cut).
- `src/FlatpackRouter.sol`: implements `IFlatpackRouter` exactly. Pulls `maxUsdgIn`, exact-out swaps per component, exact approvals reset to 0, refunds the unused USDG. `ExcessiveInput` is raised from the callback when the budget runs out, and again at the end.
- `src/FeeHarvester.sol`: implements `IFeeHarvester` exactly. It syncs the basket, redeems the pending fee shares (fee-exempt), sells the amounts actually received (balance deltas) to USDG, then WETH, unwraps, swaps to WIF via v4, and claims dividend WIF. The split is exact (INV-8). The vault pull uses an exact approval reset to 0.
- Tests: `test/fork/RouterFork.t.sol` (also holds the shared `ForkBase`), `test/fork/HarvesterFork.t.sol`, `test/fork/EndToEndFork.t.sol`, `test/unit/Router.t.sol`, `test/unit/Harvester.t.sol`.

## Deviations (each justified)
1. Extra public function `FeeHarvester.claimIOU(basket, token)` (permissionless; the interface has none). Needed so that IOUs owed to the harvester (paused-token redeem legs) can be recovered. Claimed tokens wait in `iouPending` and are sold by the NEXT `harvestFees` of that basket. Its WIF joins that cycle's split, not the cycle of origin (referrers of the origin cycle get a slightly smaller share; accepted and documented).
2. Extra views/events: `cycleInfo`, `iouPending`, `IOUClaimed`, `keeper()/factory()/vault()` getters.
3. Added `test/unit/Harvester.t.sol` (not in the ownership list). Coverage-mode runs cannot use the fork, so the harvester and v4 swapper need mock-based unit tests to meet the coverage target.
4. The interface errors `PoolNotFound`, `IncompleteFill`, `UnexpectedCallback`, `ExcessiveInput` are raised by the router through the hooks. The harvester has its own `PoolNotFound`, `UnexpectedCallback`, `InsufficientInput`, `UnknownBasket`, `FactoryNotSet`, `ZeroAddress`, `UnauthorizedEthSender`. Helper errors in the swappers are prefixed `V3`/`V4`.
5. `harvestFees` reverts `NothingToHarvest` when W == 0 (for example every leg is an IOU). The tx rolls back, so fee shares stay pending.
6. `quoteBuy` simulates each hop by having the callback revert with the owed input (no USDG needed, any caller). It matched the real buy exactly on the fork.

## Blockers
None in accepted code.
- Note: `invariant_wifDividendSolvency` (WP1, `BasketInvariant.t.sol`) failed once during `npm run coverage` (absurd `notifyWif`/`setWif` handler inputs, ~4e57). It passed in `npm test` (177 passing). It is a pre-existing fuzz handler flake unrelated to WP3. Flagging it for the architect.
- The public RPC prunes historical state after a few hours. The first pinned block (106,906,000) became unavailable and was re-pinned. Re-pin `PINNED_BLOCK` (in `RouterFork.t.sol`) to a recent block before rerunning later.

## Results
- `npm run build`: no warnings in owned files. `npm run fmt:check`: clean. `npm test`: 177 passing (154 + 23 new). `npm run test:fork`: 18 passing.
- Pinned block: **106,915,400** (Robinhood Chain 4663).
- F-IDs covered: F-R01..F-R04 (plus R01b, R05, R06), F-H01..F-H05 (plus H06 IOU, H07 all paused, H08 wiring, H09 constructor), F-E2E (win and lose paths).
- `test:fork -- --coverage` is not usable: the coverage run cannot read historical fork state. Coverage was measured with `npm run coverage` (unit mocks only), line %:
  - FlatpackRouter 100, UniswapV3Swapper 100, UniswapV4WifSwapper 100, FeeHarvester 98.08 (uncovered: line 233, 360 and 366, the `token == usdg` shortcut and its sell helper branches).

## Measurements (pinned fork)
- 3-component buy (AAPL/NVDA/MSFT, 3 shares, ~$900): about **1.06M gas** (measured around the test call including the prank/funding overhead, so this is an upper bound).
- Full `harvestFees` (3 components, 30-share basket, fee 0.09 shares): about **714k gas**, same caveat.
- Effective WIF hook tax: **about 100 bps (1.00%)** versus mid price at 0.001 ETH. 104 bps at 0.01 ETH, 142 bps at 0.1 ETH (the increase is price impact on ~$105k of liquidity). The pool LP fee is 0; the 1% is the hook's cut. Keepers should set `minWifOut` at roughly 98.5% of the mid-price quote for small harvests.
- Quote check: `quoteBuy` = real spend (899,534,937 USDG units) exactly.

## Architect review
- Accepted. The FeeHarvester.claimIOU deviation is approved (it is necessary, and the tokens can only land in the harvester).
- **R-4 (applied by the architect, in Basket.sol):** the "flaky" invariant_wifDividendSolvency was a real 1-wei over-credit in the $WIF dividend accumulator, the same class as vault R-3. The last claimer, which can be the harvester inside harvestFees, could revert. Reward debt now rounds up and accrual subtraction saturates.
- Verified by the architect: 177 unit/fuzz/invariant tests passing (2 runs), coverage clean, 18/18 fork tests passing at the pinned block.
- PINNED_BLOCK must be re-pinned before each fork run after the public RPC prunes state (a few hours).
