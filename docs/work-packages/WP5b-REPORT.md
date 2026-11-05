# WP5b Report: Explore and Basket pages

Status: built and verified against the local rehearsal fork (port 8545, app on 3000, `NEXT_DIST_DIR=.next-b`). `npm run typecheck`, `npm test` (43 pass, 0 fail; 5 new tests are mine) and `NEXT_DIST_DIR=.next-b npm run build` are clean. All my processes (fork node, app, Edge) are killed (ports 3000/8545/9333/9334 confirmed down).

## What was built (only in my folders)
- `/explore`: `explore/page.tsx` (server), `ExploreView.tsx` (client), `data.ts` (holder count from `Transfer` logs), `holders.ts`, `explore.module.css`. Desktop = sortable `Table` (basket + ticker chips, vs SPY badge with icon + label, since launch + 7-point sparkline, TVL, $WIF backed, holders, mode badge). Mobile (<820px) = cards with a Sort-by select (vs SPY / $WIF backed / TVL / Newest). Empty state uses the spec copy ("No baskets yet. Assemble the first one and earn $WIF from every buy.").
- `/b/[address]`: `page.tsx` (server: header, charts data, holdings, epoch card, "$WIF from this basket", market status, legal line, og:image metadata) plus client panels `BuyPanel`, `RedeemPanel`, `PositionCard`, `BackingCard`, `ChartPanel`, `ShareBar`; pure logic in `states.ts`, `amount.ts`; `hooks.ts` (`useRefresh`, `useNow`).
- Every write goes through `TxButton`/`approveStep` (exact approvals): buy = (1) Approve USDG for `maxUsdgIn` (quote + slippage), (2) `router.buy`; redeem = `basket.redeem`; position = `claimWifDividend`, `claimIOU(token, me)`; backing = (1) Approve WIF exact (2) `vault.stake`, `requestUnstake`, `withdraw`, `claim`.
- `?ref=0x...` is read server-side (validated, checksummed) and passed as `referrer` unless it equals the connected account. Share bar: X intent (text + link `…/b/<addr>?ref=<connected>`) and "Copy referral link"; the card image is the page's `og:image` = `/api/og/<addr>`.

## §4.3 state table: how each was verified
| State | Implementation | Verified how |
|---|---|---|
| Markets closed / weekend | `isMarketClosed(session, oldestFeedUpdate, now)` (session flag or any feed older than 2h): "Markets closed. Prices as of {time}" in the status line + buy-quote warning "weekend AMM prices may differ" | Unit test (`states.test.ts`). Rendered live in its OPEN form ("Markets open, prices as of …") on the fork via curl/e2e. The closed copy was not seen rendered in a browser. |
| Trading halt on a component | `getMarketData().tokens[t].isTradingHalt` -> Buy disabled "{TICKER} halted… Redeeming still works"; redeem untouched | Unit test of `buyBlockReason`. Not exercised live (no halted token on the fork). |
| Component paused (issuer) | `ComponentInfo.paused` -> Buy disabled; redeem notice "{TICKER} will arrive as an IOU, claim it later." and "(IOU)" next to the previewRedeem amount | Unit tests (`buyBlockReason`, `iouNotice`). Not exercised live (no paused token on the fork). |
| Corporate action in progress | `pendingMultiplier` from the Robinhood assets feed -> banner "{TICKER} split/dividend processing" (page + buy panel) | Unit test of the copy. `oraclePaused()` does not exist in the ABIs, so only `pendingMultiplier` is used (see deviations). Not exercised live. |
| Pays $WIF basket | `ModeBadge` + "Dividends paid to holders in $WIF." + position card row "Pending $WIF dividends" with Claim | curl of the Dividend Demo page (badge, copy present). The Claim click was not driven (no dividend accrued). |
| Wrong network | `TxButton` (WP5a) shows "Switch to Robinhood Chain" | WP5a component, not re-tested by me. |
| No USDG | USDG balance 0 -> "Get USDG on Robinhood Chain ↗" (Uniswap swap + Robinhood Chain docs links) | Code only. Links are my best guess of the right targets (not checked live). |
| Warm-up stake | `position.warming > 0` -> "Earning from next settle (in {countdown})" | **E2E**: after Approve WIF + "Backing confirmed" the page showed "Earning from next settle (in 8d 5h). Warming: 100 $WIF." |
| Unstake cooldown | `pendingUnstake > 0` -> Countdown to `unlockAt`, Withdraw enabled only after it | Code only (a real cooldown is 7 days; not simulated). |
| Not a basket / bad address | `notFound()` (checked against `listBaskets`) | curl: `/b/0xnope` and `/b/0x…01` return 404. |
| Chain/RPC failure | EmptyState "Can't read this basket right now" / "Can't read baskets right now" | Code only. |
| No price history yet | Chart card says "Not enough price history since launch…" | Seen live (fresh rehearsal baskets). |

Other spec items: charts per §5 (`LineIndexChart`, indexed to 100, one axis, table toggle, "30d recipe (hypothetical)" toggle + note; `BarList` one hue); the 30-day recipe rendered live (Basket 81.8 vs SPY 94.4, labelled Hypothetical). Beat-SPY card: countdown to `nextSettleAt`, basket % vs SPY % since the last settle (from `BasketSummary.epoch`, which is `navOf` against the vault snapshot), `BeatBadge`, outcome copy ("level / beating / behind"). Copy rules: "Stock Tokens", "Robinhood Chain", no invest/returns/profit; "past performance, not a forecast"; backtest "hypothetical".

## Verification evidence
1. Fresh rehearsal: `RH_PORT=8545 tools/rehearse.sh --keep` (SKIP_STRETCH=1) printed `REHEARSAL OK` and `NEXT_PUBLIC_DEPLOYMENT=rehearsal NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545`; app built with `NEXT_PUBLIC_E2E=1 … NEXT_DIST_DIR=.next-b`, run with `next start -p 3000`.
2. curl: `/explore` 200 (both basket names, tickers, "vs SPY"); `/b/<AI Picks & Shovels>` and `/b/<Dividend Demo>` 200 with names, tickers (GOOGL…), "vs SPY", Holdings, hypothetical note, og:image; `?ref=` page shows "Referred by"; bad addresses 404.
3. **Headless viem e2e** `web/src/app/b/[address]/__e2e__/buy-e2e.ts` (WSL Node): funds #3 (USDG and WIF via impersonation), `quoteBuy` decoded from `QuoteResult` (100,336,756 base units), exact approve, router `buy` of 1 share (receives 0.997 shares after the 0.30% fee), then asserts the server-rendered `/b/<basket>`: holders 1 -> 2 and TVL $947.15 -> $1,047.15. `BUY E2E PASS`.
4. **UI click-through** `…/__e2e__/ui-e2e.ts` (Windows Node + headless Edge via `web/e2e/cdp.ts`, CDP port 9333), PASS twice: explore renders; basket page renders (disconnected position copy); Connect -> "Mock Connector" -> attestation modal accepted; 1 share -> quote "≈ 100.34 USDG"; ① "Approve USDG confirmed" ② "Buy confirmed" toasts; on-chain shares +0.997 exactly and the position card shows the new total (1.994, then 2.991 on the second run); then Approve WIF + "Backing confirmed" -> warm-up message; recipe toggle shows the hypothetical note. Screenshots were inspected (dark mode).

How to re-run: right after a fresh rehearsal (see the fork caveat below) run `node "src/app/b/[address]/__e2e__/buy-e2e.ts"` from `web/` in WSL (it funds and warms #3), then from Windows `CDP_PORT=9333 node.exe "src\app\b\[address]\__e2e__\ui-e2e.ts"` (APP_URL/RPC_URL default to localhost:3000 / 127.0.0.1:8545).

## Deviations, bugs found, honest notes
- **Fork state window (environment).** The upstream Robinhood RPC serves historical state only for a few minutes. After that, any NEW storage slot read on the fork (a fresh account's balance/allowance, the harvester's per-account slots) fails with "historical state … is not available". The e2e therefore must run within ~10 min of the fork block, and `buy-e2e.ts` warms (eth_call) the slots the UI will read for #3. Two earlier attempts failed purely for this reason. It does not affect a real chain.
- **Bug found and fixed while testing:** the buy deadline used the browser clock, but the rehearsal chain's clock is ahead of wall-clock (time-travel), giving `Expired()`. The deadline is now the latest block timestamp + 20 min (also correct against a skewed user clock). Cooldown/countdown UI still uses the browser clock (fine on a real chain).
- `oraclePaused()` is not in the ABIs, so "corporate action in progress" relies on Robinhood's `pendingMultiplier` only.
- Backer count ("14 backers") from the wireframe is not shown: it needs Staked event aggregation; total $WIF backed and warming are shown instead.
- Holder count is derived from `Transfer` logs (excludes the FeeHarvester, which holds fee shares), cached 60s, so a page can lag a buy by up to a minute. "Since launch" in Explore comes from `basketSeries(launch)` and shows "n/a" for baskets with under 2 history points (all fresh rehearsal baskets).
- Not verified: mobile layout and light mode (CSS written to the spec, not screenshotted), real extension wallets, wrong-network switch, a halted/paused/closed-market render, dividend/IOU/withdraw clicks, and Explore sorting by click. Slippage choices are fixed presets (0.5/1/3%), no custom input.
- The e2e prints ("hare/ettle") in the first passing runs lost the letter "s" because of an escaping bug in the log formatting; fixed in the file afterwards but not re-run (assertions were unaffected).
- Rehearsal bring-up from background shells is fragile in this environment (processes died when started with `setsid nohup … &` through `wsl.exe`); I ran it as a foreground job of a background tool call. I also temporarily created helper scripts under `tools/` and deleted them again.

## Candidates for the design system (kept local)
- `Seg` toggle (segmented button group, `basket.module.css .seg`) and slippage pill group.
- `Notice` banner (info/warn/critical left-border callout, `.notice`).
- Amount input with Max button and decimal parsing (`amount.ts` `parseAmount`).
- `Row` label/value line (`.row`) and a responsive table-to-cards pattern (Explore).
- A `useNow()` ticking hook and a `useRefresh()` (invalidate wagmi queries + `router.refresh()`) after a tx.
