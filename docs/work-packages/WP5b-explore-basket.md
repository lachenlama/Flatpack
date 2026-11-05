# WP5b: Explore and Basket pages (the investor and backer journeys)

**Blocked until WP5a is accepted. The rehearsal prints the per-port deployment id (for example `NEXT_PUBLIC_DEPLOYMENT=rehearsal-8547`). Always use what it prints.** Build ONLY with WP5a's public API (`docs/work-packages/WP5a-REPORT.md`). If something you need is missing, write a minimal local component inside your route folder and list it in your report as "candidate for the design system". Never edit WP5a files.

## Read first
1. `docs/architecture/WP5-UX.md`: §1 (judges and personas), §3, **§4.2 and §4.3 (binding, including the state table)**, §5 and §7
2. `docs/work-packages/WP5a-REPORT.md` (the public API)
3. `contracts/src/interfaces/IFlatpackRouter.sol` (buy and quoteBuy), `IBasket.sol` (redeem, claimIOU, claimWifDividend, previewRedeem), `IBackingVault.sol` (stake, requestUnstake, withdraw, claim, position, nextSettleAt, navOf, and the WARMUP rules)

## You own
- `web/src/app/explore/**` and `web/src/app/b/[address]/**` (page, route-local components, tests)
- `docs/work-packages/WP5b-REPORT.md`

## Must deliver
- **Explore** (§4.2): sortable leaderboard, with a table on desktop and cards on mobile, a sparkline, vs-SPY status with icon and label, the mode badge, and the empty state.
- **Basket** (§4.3):
  - **Charts:** NAV vs SPY (since launch, plus the 30-day recipe marked "hypothetical") and the holdings `BarList`.
  - **Buy panel:** `quoteBuy` decoded through `QuoteResult`, a slippage setting, ① exact approve ② buy, and an optional `?ref=0x…` referrer read from the URL and passed to `buy`.
  - **Redeem in kind panel:** with the paused-component IOU notice.
  - **Position card:** shares, value, pending $WIF dividends (claim) and IOUs (claim).
  - **Beat-SPY epoch card:** countdown to `nextSettleAt`, live basket vs SPY since the last settle (from `navOf` against the `EpochSettled` snapshot).
  - **Backing card:** stake, warm-up messaging, request unstake, cooldown countdown, withdraw and claim.
  - **"$WIF from this basket" card:** totals plus recent harvests with transaction links.
  - **Market status line.**
  - **Share button:** an X intent with `/api/og/[address]` and a referral link containing the connected address.
  - **Every state in the §4.3 state table.**
- Each write goes through WP5a's `TxButton`/`useTx` with decoded errors.

## Verification
- `npm run build`, `typecheck` and `test` are clean.
- **Against the rehearsal node:**
  1. Start `RH_PORT=8545 tools/rehearse.sh --keep` in the background (app on port 3000, `NEXT_DIST_DIR=.next-b` for every build/start) and run the app with the env it prints.
  2. Run a **headless end-to-end with viem** (a node script under your route folder's `__e2e__/`) that buys 1 share of a demo basket through the router as Hardhat account #3 and confirms that `/b/<basket>` server-renders the new holder count and TVL.
  3. `curl` Explore and both basket pages: they must return 200 and contain the basket names, tickers and "vs SPY".
  4. **UI click-through (required):** build the app with `NEXT_PUBLIC_E2E=1` (the test-only mock wallet, local RPC only) and drive headless Edge/Chrome with `web/e2e/cdp.ts`. On `/b/<basket>`: connect → enter 1 share → ① Approve → ② Buy → assert the success toast and the position card showing shares. Then back with WIF (account #3 needs WIF via impersonation) → assert the warm-up message.
  5. Kill all processes.
- In the report, list each §4.3 state and how you verified it (unit test with fixtures, or e2e).
