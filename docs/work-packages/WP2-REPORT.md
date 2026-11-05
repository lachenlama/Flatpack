# WP2 Report: BackingVault and StockMath

## Built
- `contracts/src/BackingVault.sol` (`IBackingVault`, `Ownable2Step`, `ReentrancyGuardTransient`, SafeERC20, custom errors only)
- `contracts/src/libraries/StockMath.sol` (`readPrice`, `unitNav`)
- Mocks: `MockBasketForVault`, `MockFactoryForVault`, `MockRegistryForVault`
- Tests: `test/unit/BackingVault.t.sol` (51 tests incl. 1 fuzz), `test/unit/StockMath.t.sol` (13 incl. 1 fuzz), `test/invariant/VaultInvariant.t.sol` (handler + 3 invariants)

## Results
- `npm run build`: no errors, no warnings in owned files.
- WP2 tests: all pass (U-V01..U-V10, I-V01, StockMath). Full `npm test`: 91 passing, 1 failing, and the failure is WP1's `BasketTest.test_syncSkipsTokensWithRevertingOrZeroMultiplier` (`Basket.mint` ERC20InsufficientBalance). It is not in my files.
- `fmt:check`: my files are clean. The remaining warnings are WP1 files and `IBasket.sol` / `IFeeHarvester.sol` / `MockStockToken.sol` / `MockVault.sol`.
- Coverage (`npm run coverage`): `BackingVault.sol` 100% lines / 100% statements, `StockMath.sol` 100% / 100%.
- Invariant suite (256 runs x depth 64): handler does stake, requestUnstake, withdraw, queue, settle, claim, claimCurator, random warps (1h..21d), warp-to-boundary, and price moves (fresh, stale, zero, strong gain). Invariants: INV-5 solvency (`invariant_INV5_I_V01_vaultSolvent`: balance >= active + pending + queued + curatorClaimable + unclaimed accrued rewards), principal conservation, sum(active) == totalActive.

## Design notes
- `settle` is split into `_evaluate` / `_distribute` with a memory struct (stack-too-deep without via_ir).
- Beat test uses `Math.mul512` for an overflow-free 512-bit cross-multiplication.
- `readPrice` uses low-level `staticcall`, so a reverting feed, no-code feed, short or malformed return data all yield `(0,false)`. `components()` of the basket is wrapped in try/catch, so a broken basket is "invalid" (burn) and never blocks `settle`.
- `withdraw` has no dependency on oracles, harvester or factory.
- Rounding dust of `accWifPerStake` stays in the vault (covered by INV-5).

## Spec ambiguities / deviations (all chose the safe side)
1. "A basket registered with an invalid snapshot stores nav=0." I store BOTH `navLast=0` and `benchLast=0` if either nav or benchmark is invalid, and the same re-snapshot rule at settle (nav and bench both zeroed if either is invalid). The next settle then always burns. Event `EpochSettled` still reports the raw `navNow`/`benchNow` read (0 when that side was invalid).
2. `unitNav` returns invalid for an empty token list or mismatched array lengths (vacuous truth would otherwise give a "valid" 0 NAV).
3. Extra private error `ZeroAddress()` (declared in the contract, not the interface) for constructor / one-time setters / `registerBasket(0, _)` / `registerBasket(_, 0)`. A registered basket is identified by `curator != 0`.
4. `claim` / `claimCurator` with nothing owed return 0 and emit nothing (no revert). `claimCurator` reverts `NotCurator` for non-curator. `withdraw` with no pending stake reverts `ZeroAmount`.
5. `queueRewards` does not verify that the WIF actually arrived (the spec says it is already transferred; the harvester is trusted). A buggy harvester could cause under-collateralised obligations. The architect may want WP3 to guarantee this, or add a balance check.
6. `stakeFor` is permissionless (the payer is msg.sender, the credited account is arbitrary), as the interface says. Anyone can therefore credit a 1-wei stake to an account. This is harmless but means positions can be griefed with dust.
7. `curatorActive` / `nextSettleAt` revert `UnknownBasket` for an unregistered basket. `navOf` never reverts (invalid -> `(0,false)`).
8. A dust `qBackers` where `qBackers*1e18/totalActive == 0` is neither distributed nor burned; it stays in the vault as unclaimable dust.
9. `settle` calls `factory.minCuratorStake()` (trusted, one-time-set factory); if that call reverted, settle would revert, but never a withdrawal.

## For the architect to decide
- Whether the factory should call `registerBasket` after `initialize` (the vault snapshots NAV via `basket.components()`; an uninitialised clone gives nav=0 and the first settle burns). The WP1 factory brief says "Calls vault.registerBasket first", which may be ambiguous.
- Item 5 above (balance check in `queueRewards`).

## R-1/R-2 rework
- **R-1 warmup**: `stake`/`stakeFor` add to `warming` (`totalWarming`, `warmingSettleId = settleCount`), emitting `Staked(..., true)`. Exception: stake by the factory with `settleCount == 0 && block.timestamp == lastSettledAt` is active immediately (`Staked(..., false)`). `settle` distributes over `totalActive` first, then records `accAtSettle[basket][settleCount+1]`, moves `totalWarming` into `totalActive` and increments `settleCount`. Activation is lazy: `_projected` (used by `_touch` in stake/requestUnstake/claim and by the `position`/`pendingRewards` views) accrues the old active (`active*acc - debt`), credits the warmed part `warming*(acc - accAtSettle[id+1])`, sets `active += warming`, and `rewardDebt = active_new*acc`. `acc` is monotonic, so nothing underflows. `requestUnstake` takes warming first, then active. `curatorActive` uses the projected active, so current-epoch warming does not count. If `totalActive == 0` at a beat settle, backer rewards are burned even if `totalWarming > 0`.
- **R-2**: `queueRewards` now does `safeTransferFrom(msg.sender, vault, backers + curator)` after the state update and event. Test helpers and the invariant handler mint to the harvester and approve the vault.
- **Tests**: added U-V11..U-V15 (JIT attacker gets 0, warm then earn, lazy activation after several settles with a top-up, curator immediate stake and later top-up warming, unstake order, pull and revert without approval or balance). The existing tests were adjusted so stake is activated by a neutral settle (`_activate`) before rewards are queued. The invariant handler has a `stakeThenSettle` sequence; invariants are INV-5 solvency (now including warming), principal conservation, and sum(active) == totalActive AND sum(warming) == totalWarming.
- **Results**: full `npm test` 154 passing, 0 failing; `fmt:check` clean; coverage `BackingVault.sol` 100% / 100%, `StockMath.sol` 100% / 100%.
- **Notes**: (a) The accumulator uses floor rounding everywhere (standard MasterChef). Per-activation `rewardDebt` rounding can theoretically over-credit a position by 1 wei versus the exact value; this is covered in practice by the rounding dust left in the vault, but INV-5 has no formal margin when the dust is exactly 0. (b) A `stake()` call made by the factory address itself in the registration tx would also count as immediate (the condition checks only `msg.sender == factory`). (c) The old ambiguity item 7 (no balance check in `queueRewards`) is resolved by R-2.

## Architect review R-3 (applied by the architect)
Reward debt now rounds UP (`_debt`) and accrual subtraction saturates (`_sat`). Per-account earnings can therefore never exceed what settle() distributed, so the 1-wei over-credit noted in ambiguity 1 is eliminated and INV-5 holds strictly. 154/154 passing after the change.
