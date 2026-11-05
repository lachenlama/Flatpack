# WP5a: Web foundation (app shell, design system, wallet, data layer, geofence)

**WP5b and WP5c build pages on top of this. Your public APIs (components, hooks, readers) are their contract, so keep them small, typed and documented (JSDoc).**

## Read first
1. `docs/architecture/WP5-UX.md`: **binding**. All of it, but especially §3 (tokens), §4.8 (geofence), §5 (charts), §6 (architecture) and §7 (copy).
2. `shared/abi/index.ts`, `shared/units.ts`, `keeper/src/config.ts` (the deployment JSON shape), `keeper/src/read.ts` (a WORKING multicall snapshot you can model reads on), `config/mainnet-4663.json`
3. `contracts/src/interfaces/*.sol` (what each read and write means), `docs/runbooks/DEPLOY.md`, `tools/rehearse.sh`

## You own
- Everything under `web/` **except** `web/src/app/(pages)/explore`, `b/`, `assemble`, `me` and `flywheel` (WP5b and WP5c own those).
- Create these stub pages so WP5b and WP5c can start: `web/src/app/explore/page.tsx`, `b/[address]/page.tsx`, `assemble/page.tsx`, `me/page.tsx` and `flywheel/page.tsx`, each a placeholder `<h1>`.
- **You build fully:** `/` (Home), `/proof` and `/restricted`, plus `/api/baskets` (public JSON) and `/api/og/[address]` (share card via `next/og`).
- `tools/rehearse.sh`: **only** add a `--keep` flag. After the rehearsal succeeds, leave the fork node running and print `NEXT_PUBLIC_DEPLOYMENT=rehearsal NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545`. Without the flag, the behaviour is unchanged.
- `docs/work-packages/WP5a-REPORT.md`

## Build list
1. **Next config:** App Router, `src/` dir, strict TypeScript, and **imports from `../shared`** (set Turbopack `root` to the repo root and `transpilePackages` or `externalDir` as needed. Verify with a real import of `shared/abi`). If TypeScript 7 breaks `next build`, you may pin `typescript@~5.9` in `web/` (the only dependency change allowed).
2. **Design system** (`src/styles/tokens.css` plus CSS Modules): the exact tokens from §3 (light and dark, selected; OS default plus a toggle stored in localStorage using a `data-theme` attribute). Components in `src/components/ui/`: `Button` (ink primary, ghost), `Card`, `Chip` (ticker, mono), `Badge` (mode/status, **icon and label**), `StatTile`, `Amount` (formats bigint with decimals, mono tabular), `Address` (short plus copy plus Blockscout link), `Countdown`, `Tooltip`, `Skeleton`, `EmptyState`, `Modal`, `Toast` (provider plus hook), `Table`.
3. **Charts** in `src/components/charts/`: hand-built SVG, no library. `LineIndexChart` (series[], indexed to 100, direct end labels, a dashed variant, crosshair plus tooltip, a "view as table" toggle, `aria-label`), `BarList` (sorted, one hue, 2px gaps, 4px rounded data ends, labels), `Sparkline`. Follow §5 exactly.
4. **Layout:** a header (logo wordmark "FLATPACK" in mono caps, nav, the **burn counter** reading flywheel stats, theme toggle, Connect), a footer with the §7 disclaimer and a "Vote for Flatpack in the world is flat hackathon ↗" link (`https://worldisflat.fun/build`).
5. **Wallet:**
   - **Config:** `src/lib/wagmi.ts`, wagmi 3 with the Robinhood Chain (4663) chain from config. Connectors: injected with EIP-6963 multi-discovery, plus WalletConnect only if `NEXT_PUBLIC_WC_PROJECT_ID` is set.
   - **Connect UI:** `ConnectButton` lists the discovered wallets. On the wrong chain it shows "Switch to Robinhood Chain" (adds the chain if missing).
   - **Attestation:** `AttestationModal` on first connect (§4.8).
6. **Data layer** (`src/lib/`):
   - `chain.ts`, `deployment.ts` (loads `shared/deployments/${NEXT_PUBLIC_DEPLOYMENT}.json`, validated)
   - `reads/baskets.ts` (`listBaskets()` → summaries via multicall; `basketDetail(address)`)
   - `reads/vault.ts`, `reads/flywheel.ts` (totals from `FeesHarvested`, `EpochSettled`, `DividendsHarvested` and `Bought` logs via chunked `getLogs` from the deploy block)
   - `prices.ts` (server proxy of `api.robinhood.com/rhj/prices` and `/assets`, 15s cache. Market session and halt flags)
   - `history.ts` (Chainlink `getRoundData` walk-back to build a daily index series for a set of `rawUnits` vs SPY. `since` = basket creation, or 30 days for "recipe (hypothetical)". Cached 10 min. Unit-test the math with fixtures.)
   - `errors.ts` (every custom error name in `shared/abi` → plain English. Test that every ABI error has a mapping.)
   - `format.ts` (USDG 6 decimals vs 18, percentages, pts, time-to-epoch-end with the epoch anchor 1794016800 and 7 days)
7. **Write helper:** `src/components/tx/TxButton.tsx` plus a `useTx()` hook: simulate → write → wait → toast with the Blockscout link, decoded errors, a pending state, and a multi-step mode (① Approve ② Action) where each step is exact.
8. **Geofence:** `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`. Confirm in `node_modules/next`). Rule from §4.8. Unit-test the decision function.
9. **Pages:** Home (§4.1), Proof (§4.7: contracts table from the deployment, security bullets with ADR links to the GitHub repo URL from `NEXT_PUBLIC_REPO_URL`, test evidence, the transaction log from events), Restricted.
10. **API:** `/api/baskets` (JSON of `listBaskets()`, cached 15s), `/api/og/[address]` (1200×630: name, tickers, vs SPY, "$WIF burned", Flatpack wordmark).

## Running commands
```
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run-web.sh npm run build
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run-web.sh npm run typecheck
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run-web.sh npm test
```
**Integration check against real contracts:** run `tools/rehearse.sh --keep` in the background (detached, log to /tmp). Then run the app (`next build && next start` with the env above, detached) and `curl` `/`, `/proof`, `/api/baskets` and `/api/og/<basket>`. They must return 200 with real data (two demo baskets). **Always kill both processes at the end.** No mainnet writes, no git, no new dependencies (except the TypeScript pin).

## Acceptance criteria
- `npm run build`, `typecheck` and `test` are clean.
- Against the rehearsal node: `/api/baskets` lists 2 baskets with names, tokens and TVL. `/` shows nonzero burned $WIF after the rehearsal's harvest. `/proof` lists all 6 contracts. The OG image returns `image/png`.
- The geofence decision is unit-tested (blocked country → `/restricted`; `/proof` and `/api` stay reachable).
- No chart library, and no `any` in `src/lib`.
- Write `WP5a-REPORT.md` with **the public API list** (components, hooks and reader signatures) for WP5b and WP5c.
