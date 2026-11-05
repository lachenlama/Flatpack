# WP4c report: deploy-day rehearsal on a local mainnet fork

Run it: `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/rehearse.sh` (about 5 minutes, ends with `REHEARSAL OK`).
Env knobs: `BUY_USDG` (per basket, default 1000), `MIN_HARVEST_WIF`, `RH_RPC_URL` (fork source), `SKIP_STRETCH=1`.
Full log of the run quoted below: `/tmp/rehearse-run2.log` (WSL); per-step logs in `/tmp/flatpack-rehearsal/`.

Result: **all 10 steps passed, including the stretch (dividend)**. Three integration bugs found (one of them would have blocked the keeper on mainnet), all fixed. The keeper's `read.ts`, `chain.ts`, `tick.ts` and `export-deployment.ts` ran against a real chain for the first time without needing any change in `keeper/src`.

The node is a throwaway Hardhat 3 `node --fork <mainnet RPC> --chain-id 4663` (fork head about block 106,955,2xx, 2026-11-05). The tx hashes below only exist on that ephemeral node and are kept as evidence of what ran.

## Step results

| # | Step | Result |
|---|---|---|
| 1 | Fork node | `eth_chainId` = `0x1237` (4663) with `--chain-id 4663`. Needed so that `deployment.chainId` (4663) passes the keeper's check and viem's wallet chain assertion. |
| 2 | Params + Ignition deploy | `params.ts --rehearsal` writes `ignition/parameters/rehearsal.json` (owner #0, keeper #1). Deployed with `--network rehearsal --deployment-id rehearsal`: 21 txs, all executed. Registry `0x1f72...1741`, Vault `0x0d6e...d764`, Harvester `0xc90C...3642`, Factory `0xFCc4...6EFAe`, Router `0x473A...5343`, Basket impl `0xD83C...4eD48`. |
| 3 | Smoke vs local node | **52/52 checks, 0 failures** (also asserts `harvester.keeper() == account #1`, which was wrong before bug 1 below). |
| 4 | Export | `shared/deployments/rehearsal.json` written; shape `{chainId: 4663, deployedAt, blockNumber: 106955246, addresses}` validated by the keeper's `validateDeployment` (the keeper loaded it in every tick). |
| 5 | Fund + baskets + buys | #0 funded with 3000 WIF (from the v4 PoolManager, tx `0x83a3...a78c`) and 5000 USDG (from the USDG/WETH v3 pool, tx `0x4658...50e0`). `demo-baskets.ts` via `hardhat run --network rehearsal` created AISHOVEL `0xB3cb...1343` (Reinvest) and DIVDEMO `0x75B2...9199` (PayInWif). Buys of 9.5 shares each via the router: AISHOVEL 954.57 USDG, no referrer, tx `0xa29e...2671`, 1,125,550 gas; DIVDEMO 951.58 USDG, referrer = account #2, tx `0x9a29...cdb032`, 833,020 gas. Each left 0.0285 fee shares pending at the harvester (30 bps of 9.5). |
| 6 | Keeper `--dry-run` (no key) | Planned `harvestFees` for both baskets, status `dry-run`, simulated **wifOut 2017.94 WIF** (AISHOVEL) and **2013.65 WIF** (DIVDEMO), minWifOut 1% lower. Keeper address came from `harvester.keeper()`. |
| 7 | Keeper real tick (key = account #1) | Both `harvestFees` executed: AISHOVEL tx `0x2d38...df05`, wifOut **2017.942684**; DIVDEMO tx `0xc027...e173`, wifOut **2013.424932** (slightly below its dry-run figure because the first harvest moved the pool; the keeper re-simulates per action). Asserted onchain, all PASS: FeesHarvested emitted; `0x..dEaD` WIF balance +2015.684 WIF = sum of both `burned` (1008.971 + 1006.712); vault `queuedBackers/queuedCurator` increased by exactly the event's backers/curator (605.383/403.589 and 483.222/322.148); burn + referrers + backers + curator == wifOut to the wei; harvester `pendingFeeShares == 0`; cycle 0 -> 1; AISHOVEL referral reserve 0, DIVDEMO `cycleInfo` referral WIF **201.342 WIF** (10%), `referralOf(#2)` claimable equals it. Harvester then holds exactly the 201.34 reserved referral WIF. |
| 8 | Time travel + settle | `evm_increaseTime` +113,106 s (31.4 h) to nextSettleAt 1794016800 + 60, mined. Keeper planned and executed `settle` for both (txs `0x59e6...e93f`, `0xe272...0389`). Both emitted `EpochSettled`, `lastSettledAt` advanced, `settleCount` +1. Outcome **BURN** on both: `beat=false` because NAV and benchmark were equal (frozen fork prices: navLast == navNow, benchLast == benchNow), so the queued 1008.97 / 805.37 WIF went to dEaD. Note this is the "not beaten" burn, not a stale-feed burn: after only 31 h the feeds were still within `MAX_PRICE_AGE`. |
| 9 | Stretch: dividend | **Found the slot.** AAPL is a beacon proxy; the implementation keeps `uiMultiplier` in an ERC-7201 struct at base `0x395525728d1d6f4af44d273368682dd92b28e7464d750ef3212d3cb7f5959d00`; the multiplier is the word at **`...5959d01`** (the next word holds an effective timestamp). `eth_createAccessList` is not supported by EDR; the helper scans PUSH32 constants of the implementation code instead. Bumped 1000566080061092436 -> 1001566646141153528 (+0.1%). Keeper tick 1: `sync` on DIVDEMO (tx `0x5774...acc`, 222,695 gas). Tick 2: `harvestDividends` (tx `0x70a9...d9c`, 451,274 gas, wifOut **334.437 WIF**). Asserted: `DividendsHarvested` emitted, harvester `pendingDividend(AAPL) == 0`, `lastMultipliers` includes the bumped value, holder #0 `pendingWifDividend` = **334.437 WIF**. |
| 10 | Idle tick | `actions: []`, exit 0 (idempotent). |

Cleanup: the node is killed by an `EXIT` trap; `pgrep` shows no leftover `hardhat node` after the run.

## Gas per keeper action (local fork, EDR, no L1 data fee)

| Action | Gas |
|---|---|
| harvestFees (AISHOVEL, 5 components) | 1,109,068 |
| harvestFees (DIVDEMO, 3 components, referral split) | 872,892 |
| settle | 254,750 / 187,822 |
| sync (1 skimming token) | 222,695 |
| harvestDividends | 451,274 |

Reference: DEPLOY.md assumed about 0.7M gas per harvest. Measured 0.87M to 1.11M for the two demo baskets, so budget about 1.2M gas per harvest (more with more components). At 0.0226 gwei that is still about 0.00003 ETH per harvest on the fork; mainnet L1 data cost is unmeasured.

## Bugs found and fixed

1. **`FORK_KEEPER` was not Hardhat account #1** (`contracts/scripts/params.ts`). The constant was `0x70997970C51812dc3A010C7d01b50e3d17c3F4B6`; account #1 is `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`. Consequence: `fork.json` (and therefore the WP4a fork test) deployed with a keeper nobody can sign for, so `harvestFees` could never be sent in the fork test. Fix: corrected the constant. `fork.json` regenerates on the next `params.ts` run. Root cause: hand-typed address, never signed with.
2. **`export-deployment.ts` did not emit the `Basket` key** the keeper requires (`ADDRESS_KEYS` in `keeper/src/config.ts`). Ignition's id is `BasketImplementation`, so `shared/deployments/4663.json` would have made the keeper abort with `addresses.Basket missing`. Fix: `cleanAddresses` adds `Basket` as an alias of `BasketImplementation` (both kept). The keeper never uses the value; a future cleanup could drop `Basket` from the keeper's required keys instead.
3. **Rehearsal could clobber the real deployment record.** A node started with `--chain-id 4663` makes Ignition write to `ignition/deployments/chain-4663/`, the path reserved for the mainnet journal, and `export-deployment.ts` could only write `shared/deployments/4663.json`. Fix: `export-deployment.ts` gained `--deployment-id <id>` and `--out <name>`; the rehearsal uses `--deployment-id rehearsal --out rehearsal`; `.gitignore` covers `contracts/ignition/deployments/rehearsal/`, `contracts/ignition/parameters/rehearsal.json`, `shared/deployments/rehearsal.json`. `params.ts --rehearsal` only writes `rehearsal.json` (a plain `params.ts` run also rewrites `mainnet.json` with zero addresses).

Other findings (no code change needed):
- Hardhat 3 `ignition deploy` asks "Confirm deploy to network ...?" on any non-simulated network and aborts with "unsettled top-level await" when stdin is closed. Scripts must pipe `y` (done in `rehearse.sh`). This also applies to the real `deploy:mainnet`: run it from a TTY.
- A freshly started forked EDR node with zero mined blocks rejects `eth_call` at `latest` ("No known hardfork for execution on historical block"). Irrelevant once any tx is mined (always true after a deploy), but a keeper pointed at a pristine fork will fail until a block exists.
- The dividend needs two keeper ticks by design: the first only `sync`s (it books the skim into `pendingDividend`), the second `harvestDividends`. If fee shares are pending the same tick runs `harvestFees` instead of `sync` (harvests sync themselves) and the dividend is harvested the tick after.

## Files added or changed
- `tools/rehearse.sh` (one command, wipes its own state, trap kills the node)
- `contracts/scripts/rehearsal/lib.ts`, `contracts/scripts/rehearsal/steps.ts` (fund, buy, snapshot, assert-*, warp, bump-dividend, gas). `lib.ts` refuses any RPC that is not 127.0.0.1/localhost.
- `contracts/hardhat.config.ts`: `rehearsal` http network (127.0.0.1:8545, chainId 4663) only.
- `contracts/scripts/params.ts` (bug 1, `--rehearsal`), `contracts/scripts/export-deployment.ts` (bugs 2, 3)
- `.gitignore`: three rehearsal paths.
- No change to `contracts/src/**` or `keeper/src/**`.

## Regression results after the fixes
- keeper: `npm test` 32/32, `npm run typecheck` clean.
- contracts: `npm test` 177 passing; `npx hardhat test nodejs` 2 passing (deploy + smoke 52/52, demo basket); `node --test ../shared/units.test.ts` 8 passing.

## Still unproven
- Anything on the real chain: L1 data fee for the keeper txs, real keystore flow, `--verify`, `ignition verify`, the Ignition journal of a real `chain-4663` run (the rehearsal journal was parsed by `export-deployment.ts` and worked, so the `TRANSACTION_CONFIRM` assumption holds).
- Settle outcomes other than burn: the release path needs a basket that beats the benchmark across an epoch; the fork has frozen prices. A stale-feed burn (more than 4 days) was not exercised either.
- `claimIOU` (needs a paused or failing component leg) and the low-gas guard were not exercised against a chain (unit-tested only).
- GitHub Actions workflow and secrets handling.
- The dividend was simulated by a storage write; real ERC-8056 multiplier updates (scheduled effective time) are only approximated.

## Architect review
- Accepted. All 3 integration fixes were reviewed and kept (the lookalike FORK_KEEPER address, the missing Basket key in the export, and the rehearsal journal isolation). fork.json was regenerated with the correct keeper.
- **R-5 (applied by the architect, keeper/src/plan.ts):** a multiplier change now plans sync and then harvestDividends in the SAME tick (the skim only exists after sync, so the snapshot could not see it). A split simply simulates to NothingToHarvest, which exec reports as skipped. The rehearsal re-run by the architect shows sync and harvestDividends in one tick, about 335.5 WIF paid, and REHEARSAL OK.
- DEPLOY.md updated: the measured keeper gas budget, and the TTY confirmation requirement for the mainnet deploy.
