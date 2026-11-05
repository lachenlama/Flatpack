# WP5c: Assemble, Portfolio and Flywheel pages (the curator journey, claims and $WIF transparency)

**Blocked until WP5a is accepted. The rehearsal prints the per-port deployment id (for example `NEXT_PUBLIC_DEPLOYMENT=rehearsal-8547`). Always use what it prints. Runs in parallel with WP5b.** Build ONLY with WP5a's public API (`docs/work-packages/WP5a-REPORT.md`). If something you need is missing, write it inside your route folder and list it as a "design-system candidate". Never edit WP5a or WP5b files.

## Read first
1. `docs/architecture/WP5-UX.md`: §1, §3, **§4.4, §4.5 and §4.6 (binding)**, §5 and §7
2. `docs/work-packages/WP5a-REPORT.md`
3. `shared/units.ts` (`rawUnitsFor`: sorts by address, validates weights), `contracts/scripts/lib/demo.ts` (a WORKING createBasket flow: approve WIF to the **factory**, then `createBasket(params, stake)`)
4. `contracts/src/interfaces/IBasketFactory.sol` (validation errors to surface inline), `IComponentRegistry.sol`, `IFeeHarvester.sol` (`claimReferral` over CLOSED cycles, `referralOf`), `IBasket.sol`, `IBackingVault.sol`

## You own
- `web/src/app/assemble/**`, `web/src/app/me/**` and `web/src/app/flywheel/**`
- `docs/work-packages/WP5c-REPORT.md`

## Must deliver
- **Assemble** (§4.4), five numbered steps:
  - **Token picker:** only enabled registry components, with their feed freshness.
  - **Weights:** inputs plus a live `BarList` and a sum-to-100 check.
  - **Name and symbol:** with the banned-terms validation from §4.4, and the dividend mode.
  - **Preview:** a 30-day recipe backtest vs SPY via WP5a `history.ts` (labelled "hypothetical"), "one share ≈ $X", and the units table from `rawUnitsFor`.
  - **Stake and publish:** ① approve WIF to the factory, exactly `minCuratorStake` or more; ② `createBasket`. On success, redirect to `/b/[new]` with a share prompt. Map factory custom errors to the field they concern.
- **Portfolio `/me`** (§4.5): positions across all baskets, plus **Claim everything**. That's one card per source: dividends, backing rewards, curator, referral (iterate closed cycles with `referralOf`, then claim the cycles that have a claimable amount), and IOUs. Each card has a one-line "why you have this".
- **Flywheel `/flywheel`** (§4.6):
  - **Hero:** total $WIF burned.
  - **KPI tiles.**
  - **A flywheel diagram (SVG) with live numbers on its edges.**
  - **A feed of the latest 20 events** with transaction links.
  - Every tile has a "source" tooltip naming the event it sums.

## Verification
- `npm run build`, `typecheck` and `test` are clean. Unit-test the Assemble validation (weights, banned terms, symbol length) and the referral-cycle selection.
- **Against the rehearsal node (`RH_PORT=8547 tools/rehearse.sh --keep`, app on `next start -p 3001`, `NEXT_DIST_DIR=.next-c` for every build/start; WP5b uses 8545/3000/.next-b concurrently):**
  1. A headless viem script under `assemble/__e2e__/` creates a third basket exactly the way the UI would (same helper functions the page uses) as Hardhat account #4 (fund it with WIF via impersonation like the rehearsal does).
  2. It asserts `basketCount() == 3`.
  3. It `curl`s `/flywheel` (must contain the nonzero burned total) and `/me?address=<account #0>` (server-rendered positions, if you support the read-only query param).
  4. **UI click-through (required):** build with `NEXT_PUBLIC_E2E=1` and drive headless Edge/Chrome with `web/e2e/cdp.ts`. On `/assemble`: pick 3 tokens → weights → name → ① Approve WIF → ② Publish → assert the redirect to `/b/<new>`. On `/me`: the claim cards render, and one claim (for example dividends or referral after the rehearsal harvest) succeeds with a toast.
  5. Kill all processes.
