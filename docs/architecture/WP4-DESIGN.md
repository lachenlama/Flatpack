# WP4 System Design: Deployment and Keeper

| | |
|---|---|
| **Status** | Accepted for build (2026-11-05) |
| **Scope** | (a) Deploying the accepted contracts to Robinhood Chain mainnet (4663), with seeding and verification. (b) An offchain keeper that drives `sync`, `harvestFees`, `harvestDividends`, `claimIOU` and `settle`. |
| **Inputs** | `ARCHITECTURE.md`, `contracts/src/interfaces/*.sol`, `config/mainnet-4663.json`, ADR-0004 (keeper-gated harvest) |
| **Decisions** | ADR-0011 (deployment with Ignition, rehearsed on a fork) and ADR-0012 (a stateless keeper on a GitHub Actions cron) |

---

## 1. Requirements

### Functional
| ID | Requirement |
|---|---|
| D-1 | Deploy Registry → Harvester → Vault → Basket implementation → Factory → Router, wire the one-time setters, set the keeper, seed the 10 launch components, and set SPY as the benchmark. All from one command. |
| D-2 | **Rehearse exactly the same deployment for $0** on a local EDR fork of mainnet before spending real gas. |
| D-3 | Re-running is safe: an interrupted deploy resumes and doesn't redeploy. |
| D-4 | Verify the contracts on Blockscout so judges can read the source. |
| D-5 | After deployment, a smoke check asserts every wiring invariant using reads only. |
| D-6 | Export addresses and typed ABIs once, for the keeper (WP4b) and the app (WP5). |
| D-7 | A script that creates demo baskets (weights → `rawUnits` from Chainlink prices) and optionally buys a first share. |
| K-1 | Each tick, for every basket: sync on a multiplier change, harvest dividends when skims are pending, harvest fees above a value threshold, claim any IOUs the basket owes the harvester, and settle when `nextSettleAt` has passed. |
| K-2 | `minWifOut` = the **simulated** output × (1 − slippage). Never 0. The simulation includes the measured hook tax of about 1% (WP3). |
| K-3 | Dry-run mode prints the plan without sending any transaction. |

### Non-functional
| Concern | Target | Notes |
|---|---|---|
| Availability | Ticks every 15 min until the final on **Nov 16** | Missing ticks is safe (ADR-0004): fees wait, nothing is lost |
| Latency | A dividend is paid in $WIF within about 30 min of the multiplier change | Judges watch the AAPL dividend on Nov 16 |
| Cost | Under $1 total of keeper gas for the event | Gas is about 0.02 gwei, and a harvest costs about 0.7M gas, or about $0.03 |
| Security | The keeper key can't move user funds. The owner key is never on a server. | ADR-0004 and ADR-0008 |
| Ops | No server to run. Free. | GitHub Actions |

### Constraints
- One builder and two days. **The owner has no funds today:** every step must be provable on a fork first, and mainnet needs only about $3–5.
- Hardhat 3 toolchain, Node 24 (which runs `.ts` natively through type stripping, so the keeper needs no build step). viem.

## 2. High-level design

```
                 ┌──────────────── contracts/ (Hardhat 3) ────────────────┐
 config/mainnet  │ ignition/modules/Flatpack.ts   (D-1, D-3)              │
 -4663.json ────►│ ignition/parameters/{fork,mainnet}.json                │
                 │ scripts/smoke.ts        (D-5, reads only)              │
                 │ scripts/export.ts       (D-6) ──► shared/deployments/  │
                 │ scripts/demo-baskets.ts (D-7)                          │
                 └───────────────┬────────────────────────────────────────┘
                                 │ addresses + ABIs (generated, committed)
                                 ▼
 shared/  abi/*.ts (as const), deployments/<chainId>.json, units.ts (weights→rawUnits, shared with the WP5 app)
                                 │
                                 ▼
 keeper/ (Node 24, viem, no build)                       GitHub Actions cron */15
   read.ts    multicall snapshot of every basket  ◄───── .github/workflows/keeper.yml
   plan.ts    PURE: snapshot → Action[]                   (secret: KEEPER_PRIVATE_KEY)
   exec.ts    simulate → send → wait, one at a time
   tick.ts    CLI: --dry-run | --once
```

**The core idea is that the keeper is stateless.** Each tick rebuilds the full picture from the chain, so there is no database, no cursor, and nothing to corrupt. A missed or failed tick is simply redone by the next one.

## 3. Deep dive

### 3.1 Deployment (Ignition)
- **Module** `Flatpack.ts` with parameters `owner`, `keeper`, `minCuratorStake` and every external address. The parameter files are generated from `config/mainnet-4663.json` by `scripts/params.ts`, so there's a single source of truth.
- The `PoolKey` constructor argument is passed as an object `{currency0, currency1, fee, tickSpacing, hooks}`.
- **Calls** in dependency order: `vault.setFactory`, `vault.setHarvester`, `harvester.setFactory`, `harvester.setKeeper`, then `registry.setComponent` ×10 (one Ignition `m.call` per component, with an explicit `id`), then `registry.setBenchmark(SPY)`.
- **Networks:** `robinhoodFork` (EDR fork, chain 4663 simulated) for D-2, and `robinhood` (http) for mainnet. Keys come from **hardhat-keystore** (`npx hardhat keystore set DEPLOYER_PRIVATE_KEY`, encrypted on disk), never from a plaintext `.env`.
- **Verification:** hardhat-verify against Blockscout. Hardhat 3 needs a `chainDescriptors` entry for 4663 with `blockExplorers.blockscout` (`https://robinhoodchain.blockscout.com`, API `/api`).
- **Smoke (D-5)** asserts:
  - `factory.registry/harvester/vault/wif/implementation` and `vault.factory/harvester` match;
  - `harvester.keeper == keeper param` and `harvester.factory`;
  - the 10 components are enabled with the right feeds and fee tiers, and `benchmark == SPY`;
  - every feed returns a fresh price;
  - the owner of each Ownable contract is as expected;
  - the router's `usdg`.

  It exits non-zero on any mismatch.

### 3.2 Shared artifacts (D-6)
- `shared/abi/<Contract>.ts`: `export const basketAbi = [...] as const` for the 6 contracts plus a minimal ERC20, Chainlink and ERC-8056 interface. Generated from `contracts/artifacts` by `scripts/export.ts`.
- `shared/deployments/<chainId>.json`: `{chainId, deployedAt, blockNumber, addresses: {...}}` from Ignition's `deployed_addresses.json`, plus the start block for event indexing.
- `shared/units.ts`: `rawUnitsFor(weightsBps, pricesUsd8, targetSharePriceUsd)`. It computes `rawUnits_i = targetUsd × weight_i / price_i` scaled to 18 decimals per 1e18 shares, and returns tokens sorted ascending by address (the factory requires this). It has pure-function tests.

### 3.3 Keeper
**Snapshot (read.ts):** a single `multicall` per tick (Multicall3 is at the config address; verify that it exists, or use viem's `multicall` with `multicallAddress`). For each basket it reads:
`components()`, `lastMultipliers()`, each component's `uiMultiplier()` and `paused()`, `harvester.pendingFeeShares(b)`, `harvester.pendingDividend(b, token)` for each token, `basket.owed(harvester, token)` for each token, `vault.nextSettleAt(b)` and `basketState(b)` (to skip settling a basket with nothing queued and no change), plus the block timestamp and the keeper's ETH balance.

**Plan (plan.ts), a pure function with these rules, in this order:**
1. `uiMultiplier != lastMultiplier` for any component → **Sync(b)**. Skip it if a harvest for the same basket is planned in this tick, because the harvests call `sync()` themselves.
2. `Σ pendingDividend > 0` → **HarvestDividends(b)**.
3. `pendingFeeShares > 0` and the simulated `wifOut` ≥ `MIN_HARVEST_WIF` (an env var, default worth about $0.50) → **HarvestFees(b)**.
4. `owed(harvester, token) > 0` and the token isn't paused → **ClaimIOU(b, token)**, before HarvestFees so the claimed tokens are sold in the same tick.
5. `now ≥ nextSettleAt(b)` → **Settle(b)**. This is permissionless. Settling a basket with an empty queue still re-snapshots NAV, which is cheap and keeps epochs aligned.
6. Global guard: if the keeper's ETH balance is below `MIN_ETH`, plan only Settle and Sync, and log `LOW_GAS`.

**Execute (exec.ts):**
- For harvests, `simulateContract` with `minWifOut = 1` to get `wifOut`, then send with `minWifOut = wifOut × (10000 − SLIPPAGE_BPS) / 10000` (default 100 bps) and `deadline = now + 300`.
- Send sequentially and await each receipt, which avoids any nonce races.
- Each action runs in its own try/catch. A revert is logged with its decoded custom error (viem decodes against the ABI), and the tick continues.
- The exit code is 1 if any action failed, so the Actions run shows red.

**Logging:** one JSON line per event: `{ts, basket, action, status, txHash?, wifOut?, error?}`, plus a final summary table in `$GITHUB_STEP_SUMMARY`.

**Hosting:** a GitHub Actions schedule `*/15 * * * *` (GitHub may delay this by a few minutes, which is acceptable) plus `workflow_dispatch` for manual runs. Secrets: `KEEPER_PRIVATE_KEY` and `RH_RPC_URL` (optional, defaulting to public). `concurrency: keeper` prevents overlapping ticks.

### 3.4 Error handling and failure modes
| Failure | Behaviour |
|---|---|
| RPC error or rate limit | viem retries (3×, backoff). If the tick still fails, the next tick redoes it. |
| Harvest simulation reverts (`NothingToHarvest`, a paused component) | Skip and log, retry next tick |
| A sandwich between simulate and send | `minWifOut` reverts the transaction, so funds are safe and it's retried next tick (ADR-0004) |
| The keeper key leaks | The worst case is a bad fill on a single harvest. The owner calls `setKeeper` to rotate it. |
| Actions is disabled or delayed | Fees accumulate safely. Run manually with `workflow_dispatch` or locally with `npm run keeper`. |

## 4. Scale and reliability
- Load: at most 20 baskets and 10 components during the hackathon, so the snapshot is one multicall of about 300 calls and a tick has fewer than 10 transactions. That's far below any limit.
- If the number of baskets grows past about 200, split the multicall into batches and track a `lastHarvestAt` per basket to stagger the work. This is noted for later.

## 5. Trade-offs
| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Deploy tool | Ignition | A hand-written viem script | Resumable and idempotent (D-3), and the module itself documents the deploy order |
| Keeper hosting | GitHub Actions cron | A VPS or Vercel cron | Free, no server, logs built in. A 15-minute granularity is enough for weekly epochs and dividends. |
| Keeper state | Stateless | A database of last runs | Nothing to corrupt. Every decision comes from the chain. |
| `minWifOut` | Simulate then haircut | A TWAP or offchain price | It includes the hook tax exactly. There's no WIF oracle (ADR-0004). |
| Keeper runtime | Node 24 type stripping | tsc build or tsx | Zero build steps and no extra dependencies |

## 6. What we'd revisit after the hackathon
- Move the owner to a multisig. Use several keepers or a Gelato/Chainlink Automation task.
- Run the indexer as a service (WP5 reads events directly for now).
- A MEV-aware harvest (a private RPC, if Robinhood Chain ever offers one).
