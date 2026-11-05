# WP5a Report: web foundation

Status: acceptance criteria met (see Verification). TypeScript 7 works with `next build`; no dependency changes.

## Verification (exact)
- `npm run build`, `npm run typecheck`: clean. `npm test`: 26 pass, 0 fail (format, errors, history math, deployment, geofence, prices).
- `NEXT_DIST_DIR=.next-test npm run build` works (dir deleted afterwards). Default `npm run build` works with no deployment file and no RPC (all pages are dynamic).
- Rehearsal: `tools/rehearse.sh --keep` printed `REHEARSAL OK` and `NEXT_PUBLIC_DEPLOYMENT=rehearsal NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545`. App built with those env vars and run with `next start -p 3000`. curl results:
  - `/` 200 text/html; shows **3,837 $WIF burned**, 727 $WIF to curators, TVL $1,893.83, 2 baskets, 2 top-basket cards.
  - `/proof` 200; all 6 contracts listed (BasketFactory, FlatpackRouter, BackingVault, FeeHarvester, ComponentRegistry, BasketImplementation); transaction log shows first basket, first buy, first fee harvest and first burn with tx links.
  - `/api/baskets` 200 application/json; `count: 2` ("AI Picks & Shovels" GOOGL/META/NVDA/MSFT/MU, TVL 947.15; "Dividend Demo" SPY/AAPL/MSFT, TVL 946.68; 1000 $WIF backed each).
  - `/api/og/0xB3cbA81d4ce278661E26E2107936A014efc31343` 200 `image/png`, 1200 x 630.
  - `/explore`, `/b/x` (stubs), `/restricted`, `/styleguide` 200.
  - Geofence over HTTP: `x-vercel-ip-country: US` on `/` and `/explore` returns the Restricted page; `/proof` and `/api/baskets` stay 200 with the US header; `DE` is unaffected.
- Visual check: Edge headless screenshots of `/` and `/styleguide` (dark mode via OS) looked correct.
- Both processes (rehearsal node, next start) were killed; ports 8545 and 3000 confirmed down.

## Deviations / honest notes
- The wallet write path (connect, two-step TxButton, toasts, receipts) IS verified in a real headless Edge with the test-only mock wallet (see the R-6/R-7/R-8 addendum at the end). Real extension wallets (MetaMask/Rabby) and chain switching were not exercised.
- Chart interaction (crosshair, table toggle) is not browser-tested; static SSR output and screenshot verified.
- `history.ts` Chainlink round bisection is unit-tested against fixtures only; `loadIndexSeries` was not run against the node (no consumer yet; `basketSeries` is ready for WP5b).
- On the rehearsal fork, a `symbol()` call on a Stock Token makes EDR fail an entire Multicall3 aggregate ("Missing or invalid parameters"), so tickers come from `config/mainnet-4663.json` and `symbol()` is only called for tokens outside the launch universe.
- US session / market status is clock-based (ET hours, no exchange holidays) plus Robinhood `isTradingHalt`; the `rhj/prices` and `/assets` shapes were read from the live API.
- Verified badge on /proof comes from Blockscout `/api/v2/smart-contracts/<addr>`; shows "Unknown" on the local fork. Test counts on /proof are static text taken from WP1-WP4 reports.
- `NEXT_PUBLIC_*` values (including the deployment JSON, inlined by `next.config.ts`) are **build-time**: set them before `next build`.
- `Table` takes render functions, so it must be used from a client component (see `src/app/styleguide/DemoTable.tsx`).
- Beat badge shows a neutral "level" when |pts| < 0.05 (right after a settle both are 0.0).

## Changes outside web/ (as agreed)
- `tools/rehearse.sh`: `--keep` flag (leaves node running after success, prints the env line); `RH_PORT` (default 8545) used for the node port, the RPC URL and `OUT` dir (`/tmp/flatpack-rehearsal-<port>` when not 8545); node cleanup now kills only the node on that port (was a global `pkill hardhat node`, which would kill a parallel rehearsal). Default behaviour is unchanged. Exports `REHEARSAL_RPC` and `RH_PORT` to child scripts.
- `contracts/scripts/rehearsal/lib.ts`: default RPC is `http://127.0.0.1:${RH_PORT ?? 8545}` (`REHEARSAL_RPC` still overrides).
- `contracts/hardhat.config.ts`: the `rehearsal` network URL reads `RH_PORT` too (needed by the demo-baskets and ignition steps; one line).
- `.gitignore`: `.next*/` and `tsconfig.tsbuildinfo`.
- **Parallel rehearsals (R-6)**: when `RH_PORT != 8545` every artifact is per-port: Ignition id `rehearsal-<port>`, `contracts/ignition/parameters/rehearsal-<port>.json`, `shared/deployments/rehearsal-<port>.json`; `--keep` prints `NEXT_PUBLIC_DEPLOYMENT=rehearsal-<port>`. Port 8545 keeps the old names. `contracts/scripts/params.ts` gained `--name <id>`. `.gitignore` covers `rehearsal*`. Verified by running 8545 and 8547 concurrently: both `REHEARSAL OK`, distinct files. `NEXT_PUBLIC_DEPLOYMENT` accepts any file name in `shared/deployments/`.
- **Ports / dist dirs**: `next start -p 3000` / `-p 3001`; `NEXT_DIST_DIR=.next-b` / `.next-c` (`distDir: process.env.NEXT_DIST_DIR || ".next"`). Next rewrites `tsconfig.json` `include` for new dist dirs; harmless (`.next*/types` globs are already present).

## Env vars
| Var | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_DEPLOYMENT` | `4663` | file in `shared/deployments/` (`4663` or `rehearsal`), inlined at build |
| `NEXT_PUBLIC_RPC_URL` | `config/mainnet-4663.json` rpc | RPC for server reads, wagmi and the add-chain prompt |
| `NEXT_PUBLIC_E2E` | unset | `1` enables the TEST-ONLY mock wallet and `/e2e` page; throws unless the RPC is local (never set in production) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | OG/share origin |
| `NEXT_PUBLIC_REPO_URL` | `https://github.com/OWNER/flatpack` | ADR links on /proof (set the real URL) |
| `NEXT_DIST_DIR` | `.next` | build output dir |
Run against the rehearsal: `NEXT_PUBLIC_DEPLOYMENT=rehearsal NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_DIST_DIR=.next-b npm run build && ... npx next start -p 3000`.

Import rule: use relative imports WITH the `.ts/.tsx` extension everywhere in `src/lib` (so `node --test` can run tests). Pages are `force-dynamic` (root layout); readers cache in-process (15s / 60s).

---

# PUBLIC API (for WP5b and WP5c)

All paths relative to `web/src`. `/styleguide` renders every component with fixtures.

## Pages / routes owned by WP5a
`/` Home, `/proof`, `/restricted`, `/styleguide` (dev), `/api/baskets` (JSON, bigint as strings), `/api/og/[address]` (PNG). Stubs for WP5b/c: `app/explore/page.tsx`, `app/b/[address]/page.tsx`, `app/assemble/page.tsx`, `app/me/page.tsx`, `app/flywheel/page.tsx` (each a placeholder `<h1>`; replace the body). Layout, header (burn counter), footer and providers come from `app/layout.tsx`.

## Design tokens
`styles/tokens.css` CSS variables: `--paper --paper-2 --ink --ink-2 --rule --series-1 --series-2 --good --critical --warning --font-sans --font-mono --space-1..7 --radius --radius-lg --maxw`. Utility classes in `globals.css`: `.container .muted .num .mono .visually-hidden`. `--series-*` for charts only.

## UI components (`components/ui/index.ts`)
- `Button({variant?: "primary"|"ghost", size?: "md"|"sm", loading?, ...buttonAttrs})`, `ButtonLink({href, variant?, size?})` (external hrefs open a new tab)
- `Card({title?, as?, ...})`
- `Chip({children})`, `TickerChips({tickers: string[], max?})`
- `Badge({tone?: "good"|"critical"|"warning"|"neutral", icon?, children})` (icon + label always), `ModeBadge({mode: "Reinvest"|"PayInWif"})`, `BeatBadge({pts: number, label: string})` (▲ beating / ▼ behind / ● level)
- `StatTile({label, value, sub?, source?})` (source = tooltip)
- `Amount({value: bigint, decimals, symbol?, maxFraction?, minFraction?, compact?})`
- `Address({address, full?, noCopy?, noLink?})` client: short + copy + Blockscout
- `Countdown({to: unixSec, done?})` client
- `Tooltip({content, children})`, `InfoTip({content})`
- `Skeleton({width?, height?})`, `EmptyState({title, children?, action?})`
- `Modal({open, onClose?, title, dismissable?, children})`
- `ToastProvider` (already mounted), `useToast(): (t: {kind?: "success"|"error"|"info", title, description?, href?, linkLabel?, durationMs?}) => void`
- `Table<T>({columns: Column<T>[], rows, rowKey, caption?, defaultSort?, defaultDir?})` client; `Column = {key, header, cell(row), sortValue?(row), numeric?}`. Needs a client-component caller.
- Also `components/BasketCard.tsx`: `BasketCard({basket: BasketSummary})` (server-friendly, links to `/b/[address]`).

## Charts (`components/charts/index.ts`, no library)
- `LineIndexChart({times: number[] /*unix s*/, series: {id, label, tone: "series-1"|"series-2", dashed?, values: (number|null)[]}[], ariaLabel, height?, note?})` client. Values already indexed to 100. Direct end labels, crosshair + tooltip (gap in pts), arrow-key reading, legend, "View as table" toggle. Basket = `series-1` solid, SPY = `series-2` dashed.
- `BarList({items: {key, label, value, display, sub?, detail?}[], sorted?, ariaLabel?})` server-friendly.
- `Sparkline({values: number[], width?, height?, lastLabel?, ariaLabel?})` server-friendly.

## Wallet and tx (client)
- `components/wallet/ConnectButton.tsx`: `ConnectButton()`, `SwitchChainButton({size?})`, `useWalletState(): {address?, isConnected, chainId?, onWrongChain}`.
- `components/wallet/AttestationModal.tsx`: `AttestationModal({open, onAccept, onDecline})`, `AttestationGate()` (mounted in Providers), `useAttested()`.
- `components/tx/index.ts`: `TxButton({steps: TxStep[], children?, disabled?, disabledReason?, variant?, size?, onSuccess?(hash)})`; `useTx({onSuccess?}) => {phase, stepIndex, completed, hash?, error?, pending, run(steps): Promise<boolean>, reset()}`; `approveStep({token, spender, amount, symbol}): TxStep` (exact amount, auto-skipped if allowance is enough); `TxStep = {id, label, call: TxCall | (ctx) => TxCall, skip?(ctx), successTitle?}`; `TxCall = {address, abi, functionName, args?, value?}`; `TxContext = {account, publicClient}`. Flow: simulate, wallet, wait, toast with Blockscout link, decoded errors. Multi-step shows ① ② with ✓.
- wagmi 3 hooks to use directly: `useConnection`, `useReadContract(s)`, `useBalance`, `usePublicClient`. Config: `lib/wagmi.ts` `wagmiConfig` (chain 4663, EIP-6963, injected only).

## lib (server and client safe unless noted)
- `chain.ts`: `NETWORK` (chainId, explorer, multicall3, `usdg`, `wif` {address, decimals}, weth, benchmark), `LAUNCH_UNIVERSE` (ticker -> {token, feed, v3Fee}), `TICKER_BY_TOKEN`, `RPC_URL`, `robinhoodChain`, `getPublicClient()`, `explorerTx(hash)`, `explorerAddress(a)`, `SITE_URL`, `REPO_URL`.
- `deployment.ts`: `getDeployment(): Deployment` ({chainId, deployedAt, blockNumber, addresses: Record<ContractName, Address>}), `hasDeployment()`, `DEPLOYMENT_NAME`, `CONTRACT_NAMES`, `validateDeployment`, `parseDeployment`.
- `format.ts`: `formatAmount(v: bigint, decimals, {maxFraction?, minFraction?, compact?})`, `formatUsdg`, `formatWif`, `formatShares`, `formatUsd(n, {compact?, fraction?})`, `formatPercent(n, {digits?, ratio?, sign?})`, `formatPts(n)`, `formatDuration(sec)`, `epochEnd(nowSec)`, `timeToEpochEnd(nowSec)`, `formatUtc(sec, withDate?)`, `shortAddress`, `indexTo100`, `usd18ToNumber`, constants `USDG_DECIMALS=6, SHARE_DECIMALS=18, WIF_DECIMALS=18, EPOCH_ANCHOR=1794016800, EPOCH_LENGTH=604800`.
- `errors.ts`: `describeError(err: unknown): string` (use for any caught viem/wagmi error), `describeErrorData(hex)`, `messageForError(name, args?)`, `quoteFromError(err): bigint | undefined`, `ERROR_MESSAGES`, `ALL_ERRORS_ABI`.
- `quote.ts`: `quoteBuyUsdg(basket, shares: bigint, account?): Promise<bigint>` (decodes `QuoteResult`; USDG 6 decimals, before slippage), `withSlippage(usdgIn, slippageBps): bigint` (= `maxUsdgIn`).
- `erc20.ts`: `erc20Abi` (balanceOf, allowance, approve, symbol, decimals).
- `prices.ts` (server): `getMarketData(): Promise<MarketData>` = `{ok, session: "open"|"extended"|"closed", asOf?, tokens: Record<TICKER, {ticker, addresses, price?, isTradingHalt, multiplier?, pendingMultiplier, status?, generatedAt?}>}`, cached 15s, never throws. `usSession(nowMs)`.
- `history.ts`: `loadIndexSeries(client, {feeds, rawUnits, benchFeed, sinceSec, nowSec}): Promise<IndexPoint[]>` ({t, basket, spy} indexed to 100), `bisectRounds`, `buildIndexSeries`, `sampleTimes`, `feedPricesAt`.
- `geofence.ts`: `decideGeofence(country, pathname)`, `BLOCKED_COUNTRIES`, `isExemptPath`. `proxy.ts` applies it.
- `cache.ts`: `cached(key, ttlMs, loader)` in-process TTL cache with stale-on-error.
- `serialize.ts`: `toJson(value, space?)`, `bigintReplacer`.

## Readers (`lib/reads/*`, server-side; types in `reads/types.ts`)
- `baskets.ts`: `listBaskets(): Promise<BasketSummary[]>` (cached 15s; factory order, 5 multicall round trips); `basketDetail(address: string): Promise<BasketDetail | undefined>` (adds `createdAt`, `createdBlock`, `benchPriceUsd`, `benchFeed`).
  - `BasketSummary`: `{address, name, symbol, curator, mode: "Reinvest"|"PayInWif", totalSupply: bigint, navPerShareUsd, navValid, tvlUsd, components: ComponentInfo[], tickers, wifBacked: bigint, nextSettleAt, lastSettledAt, settleCount, epoch: {basketPct, benchPct, beatPts, beating} | null}`.
  - `ComponentInfo`: `{token, ticker, rawUnits: bigint, unitsPerShare, feed, priceUsd?, feedUpdatedAt?, uiMultiplier: bigint, paused, weightPct}`.
- `vault.ts`: `vaultState(basket): Promise<VaultState | undefined>`, `vaultPosition(basket, account): Promise<VaultPosition>` ({active, warming, pendingUnstake, unlockAt, claimable}). Uncached.
- `flywheel.ts`: `flywheelStats(): Promise<FlywheelStats>` ({burnedWif, burnedAtHarvest, burnedAtSettle, wifBought, toCurators, toBackers, toReferrers, dividendsPaid, releasedBackers, releasedCurator, buyVolumeUsdg, buyCount, harvestCount, settleCount, basketCount, tvlUsd, recent: FlywheelEvent[20]}); never throws (zeros on failure). `FlywheelEvent = {kind: "harvest"|"dividends"|"settle", basket, blockNumber, transactionHash, timestamp, wif, burned?, beat?}`.
- `events.ts`: `getEventLogs(address, abi, eventName, args?, fromBlock?)` (chunked at 9M blocks, 60s cache), typed `feesHarvestedLogs(basket?)`, `dividendsHarvestedLogs`, `epochSettledLogs`, `boughtLogs`, `basketCreatedLogs`, `blockTimestamps(blocks)`, `getBasketCreation(basket)`.
- `series.ts`: `basketSeries(address, "launch"|"recipe"): Promise<{range, hypothetical, points: IndexPoint[]} | undefined>` (10 min cache; "recipe" = same units over 30 days, mark it hypothetical).
- `proof.ts`: `milestoneTransactions()`, `oracleRows()`, `contractVerified(address)`.
- Not provided (build in WP5b/c as needed): holder counts, per-account token balances/claimables other than `vaultPosition` (read `basket.pendingWifDividend`, `owed`, `harvester.referralOf` with wagmi/multicall).

## Known gaps WP5b/c should expect
- Server readers need `getDeployment()` at build time; with no deployment they throw `DeploymentError` (home/proof degrade gracefully; others should too).
- `BeatBadge` and `epoch` use the vault's last snapshot; a basket that never settled has `settleCount: 0` and `epoch` based on registration snapshot.

---

# R-6 / R-7 / R-8 addendum

- **R-7**: the relay-wallet connector, its import and its env handling were removed from `lib/wagmi.ts`. Injected (EIP-6963 multi-discovery) only.
- **R-8 mock wallet**: `NEXT_PUBLIC_E2E=1` adds wagmi's `mock` connector (Hardhat account #3, address only; the local node signs) and enables the `/e2e` test page (404 otherwise). `lib/e2e.ts` `e2eEnabled(rpcUrl, flag, hostname?)` THROWS when the flag is set with a non-local RPC (not 127.0.0.1/localhost) or a non-localhost origin, so it cannot ship in a real build (unit-tested). Never set it in production.
- **E2E driver (public, reusable)**: `web/e2e/cdp.ts` (dependency-free CDP over Node 24 `fetch`/`WebSocket`; Chrome or Edge): `launchBrowser({exe?, port?, headless?, args?})`, `Browser.newPage(url?)`, `Browser.close()`, `Page.{goto, eval, waitFor, waitForText, clickText(selector, text), click, type, text, screenshot, logs}`, `rpc(url, method, params)`, `sleep`. `web/e2e/tx-e2e.ts` is the worked example and `web/e2e/README.md` has the run steps. Run the driver with **Windows Node** (`node.exe`; Edge is auto-detected) because WSL has no browser; the app and node on WSL localhost are reachable from Windows. Driver files must avoid TS parameter properties/enums (Node strip-only mode). Mock connect UI: `clickText("button","Connect")`, then `clickText("dialog button","Mock Connector")`.
- **Verified (real headless Edge; rehearsal node on 8545; app built with `NEXT_PUBLIC_E2E=1 NEXT_PUBLIC_DEPLOYMENT=rehearsal NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_DIST_DIR=.next-e2e`)**: `/e2e` loaded; Connect then "Mock Connector" connected `0x90F7...b906`; the two-step `TxButton` ran approve USDG (exact 1,234,567 base units, to the router) then `basket.sync()`; toasts "Approve USDG confirmed" and "Sync basket confirmed" appeared; the node shows `allowance(account, router) = 1234567` and two receipts with status 0x1 from #3. Output ended `E2E PASS (2 confirmed transaction(s) ...)`. Re-running skips the approve step (allowance already sufficient, by design).
- Account #3 has ETH on the fork but no USDG/WIF: flows needing tokens must fund it first (transfer from #0; the node has the Hardhat accounts unlocked).
- Env table: `NEXT_PUBLIC_E2E` (test only) added, `NEXT_PUBLIC_WC_PROJECT_ID` removed.
