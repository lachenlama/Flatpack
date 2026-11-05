# WP1 Report: ComponentRegistry, Basket, BasketFactory

## Status
All acceptance criteria met. `npm run build` is clean (only the OZ transient-storage warning from `TransientSlot.sol`). `npm run fmt:check` passes. `npm test` passes for the whole suite: **144 passing, 0 failing**. WP1's share is 77 tests (68 unit and fuzz, 9 invariant). Fuzz runs 1000 and invariants run 256 runs x depth 64.

## What was built
- `src/ComponentRegistry.sol`: `Ownable2Step` allowlist (feed, v3 fee tier) and benchmark.
- `src/Basket.sol`: `Initializable + ERC20Upgradeable + ReentrancyGuardTransient + IBasket`. Fee in shares, pro-rata redeem with `trySafeTransfer` IOU legs, multiplier sync and dividend skim, $WIF reward accumulator (`_update` override).
- `src/BasketFactory.sol`: `Clones.clone`, validation in the order of the interface error list, then `initialize`, `vault.registerBasket`, stake pull, `forceApprove`, `stakeFor`, approval reset.
- Mocks: `MockV3Factory`, `MockHarvester` (records callbacks and acts as the harvester through `exec`), `MockVault`.
- Tests: `unit/ComponentRegistry.t.sol`, `unit/Basket.t.sol` (it also holds the shared `BasketFixture`, which `BasketDividends.t.sol` imports), `unit/BasketDividends.t.sol`, `unit/BasketFactory.t.sol`, `invariant/BasketInvariant.t.sol` (the handler is in the same file).

## TEST-PLAN coverage
U-B01..U-B15, Z-B01, I-B01 (INV-1, INV-2, INV-7 in both Reinvest and PayInWif modes, plus a supply-sum check and, for PayInWif, a $WIF dividend solvency check), U-F01..U-F03. All are implemented and pass.
The invariant handler does mint, redeem, share transfer, donate, pause, return-false, dividend-sized bumps (+1..300 bps), split-sized bumps (x2..x5 and reverse), sync, claimIOU, claimWifDividend and notifyWif.
Extra tests cover:
- a skim that fails on a paused token
- a zero-supply sync
- a `uiMultiplier()` that reverts or returns 0
- a dividend step relative to the last multiplier
- a self-transfer
- constructor zero-address checks
- Ownable2Step
- name and symbol length limits
- a zero-min-stake create

## Coverage (`npm run coverage`)
| File | Lines | Statements/Branches |
|---|---|---|
| src/Basket.sol | 100.00% | 100.00% |
| src/BasketFactory.sol | 100.00% | 100.00% |
| src/ComponentRegistry.sol | 100.00% | 100.00% |

(The table has three columns: lines, statements, branches. The tool printed 100 / 100 / "-" for all three files.)

## Gas (`test_U_GAS_mintRedeem3And8`, `gasleft()` deltas, Reinvest mode, non-first holder)
| Components | mint | redeem |
|---|---|---|
| 3 | 105,934 | 150,271 |
| 8 | 144,217 | 299,659 |

These figures include `sync()` (one `uiMultiplier` read per component), the `onFeeShares` call to the mock harvester, and the fee-share transfer on redeem.

## Spec ambiguities and decisions
1. **Registry disable keeps feed and fee.** The NatSpec says "To disable, pass enabled=false (feed and fee may be zero)". `setComponent(token, false, ...)` only flips `enabled`, ignores the passed feed and fee, and emits the stored values. Zeroing them would break the vault's NAV for existing baskets that hold the token, since the vault reads `registry.component(token).priceFeed`. Architect: confirm.
2. **`sync` is fail-safe.** The ARCHITECTURE line "`Every mint/redeem calls sync() first`" (IBasket) would let one token break redeem if `uiMultiplier()` reverts. Decisions:
   - A `uiMultiplier()` that reverts (try/catch) or returns 0 is skipped for that token.
   - A skim transfer that fails (for example a paused token) uses `trySafeTransfer`. The units are still adjusted and `skimmed = 0` is emitted. The excess stays in the basket and is shared with holders, and the next skim sweeps it up.
   - `onFeeShares` and `onDividendSkim` revert-propagate, because the harvester is trusted infrastructure. A reverting harvester would therefore block mint and redeem. Architect: confirm this is acceptable, or the callback could be wrapped in try/catch.
3. **`claimWifDividend` returns 0 instead of reverting when nothing is pending.** The interface defines no error for it, and the harvester needs to claim unconditionally in `harvestFees`.
4. **`factory` is the initialised flag.** `initialize` on a clone reverts `AlreadyInitialized` (the NatSpec error). On the implementation (`_disableInitializers`) it reverts with OZ `InvalidInitialization`.
5. **Zero stake.** `createBasket` with `curatorStake == 0` (only possible if `minCuratorStake == 0`) skips the pull and `stakeFor`. The vault rejects zero amounts and the interface says nothing about this case.
6. **Initialize validation.** `BasketInit` curator, harvester and wif must be non-zero (`ZeroAddress`). Array shapes are trusted to the factory (the clone's `initialize` can be called by anyone on a fresh clone, but only factory-made clones are `isBasket`).
7. **`effBal` saturates at 0** (`balance < totalOwed` returns 0 instead of underflowing), so an exotic balance reduction can never block exits.
8. **Factory validation order.** The array checks run per index in one pass (ascending, then enabled, then non-zero units), after the length checks and before name, symbol and stake.
9. **Referrer is forwarded as given.** There is no check that it differs from the receiver or caller, since the NatSpec leaves the referral policy to the harvester.

## Deviations
No interface was changed.
**Process slip:** I ran the repo-wide `npm run fmt` once (instead of Prettier on my own files). It rewrote the formatting (whitespace only) of files I do not own. The ones printed without "(unchanged)" were `src/interfaces/IFeeHarvester.sol`, `test/mocks/MockStockToken.sol` and a few others in WP2's tree. The tool printed those names, but I have no git here to diff, so the architect should check `git diff` on them and revert any non-owned file if unwanted. Afterwards I ran Prettier only on my own files, and `fmt:check` passes for the whole tree.

## Open items for the architect
- Decide items 1 and 2 above.
- WP3 note: the harvester must hold the `FeeHarvester` address passed to the factory and must implement `onFeeShares` and `onDividendSkim`. Both are called from inside `nonReentrant` basket functions, so the harvester must not call back into the same basket within them.
