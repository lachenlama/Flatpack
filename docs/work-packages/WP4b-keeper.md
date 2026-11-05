# WP4b: Keeper bot (stateless, Node 24 and viem) plus the GitHub Actions cron

## Read first
1. `docs/architecture/WP4-DESIGN.md` (**binding**: §1 K-1..K-3, §3.3, §3.4)
2. `docs/adr/0012-stateless-keeper-on-actions-cron.md` and `0004-keeper-gated-harvest.md`
3. `contracts/src/interfaces/IFeeHarvester.sol`, `IBasket.sol`, `IBackingVault.sol` and `IBasketFactory.sol`, plus the public `FeeHarvester.claimIOU(basket, token)` in `contracts/src/FeeHarvester.sol` (not in the interface)
4. `shared/abi/*.ts`: generated typed ABIs (`as const`). Import them from `../../shared/abi/index.ts`. They include the custom errors, so viem can decode reverts.
5. `config/mainnet-4663.json` (`multicall3`, `rpc`, `chainId`)

## You own
- `keeper/src/config.ts`: parses env and CLI and validates it. `RPC_URL` (default from config), `KEEPER_PRIVATE_KEY` (required unless `--dry-run`), `DEPLOYMENT` (path to `shared/deployments/<chainId>.json`, default `../shared/deployments/4663.json`), `MIN_HARVEST_WIF` (wei, default `350000000000000000000`, about $0.50), `SLIPPAGE_BPS` (default 100, max 1000), `MIN_ETH` (default `0.0002` ETH), `DEADLINE_SECS` (300). The key must **never** be logged.
- `keeper/src/chain.ts`: defines the Robinhood Chain viem `Chain` (id 4663, Multicall3 address from config) and the clients. Transport retries 3× with backoff.
- `keeper/src/read.ts`: `snapshot(client, addresses): Promise<Snapshot>`. Read as few multicalls as possible (step 1: factory basket list; step 2: everything per basket). Fields are listed in WP4-DESIGN §3.3.
- `keeper/src/plan.ts`: **pure** `plan(snapshot, cfg): Action[]`. Rules 1–6 from §3.3, in that exact order per basket, with IOU claims before HarvestFees. `Action` is a discriminated union (`{kind: "sync" | "harvestDividends" | "harvestFees" | "claimIOU" | "settle", basket, token?}`).
- `keeper/src/exec.ts`: `execute(actions, clients, cfg): Promise<Result[]>`. Harvests: `simulateContract` with `minWifOut = 1n` → `wifOut`. If `harvestFees` and `wifOut < MIN_HARVEST_WIF`, skip with `status: "below-threshold"`. Otherwise send with `minWifOut = wifOut * (10000n - slippage) / 10000n` and `deadline = block.timestamp + DEADLINE_SECS`. Send sequentially and wait for each receipt. Isolate each action in its own try/catch. Decode custom errors (viem `BaseError.walk` / `ContractFunctionRevertedError`). Dry-run simulates but never sends.
- `keeper/src/log.ts`: JSON lines to stdout, plus a markdown summary appended to `$GITHUB_STEP_SUMMARY` when that variable is set.
- `keeper/src/tick.ts`: CLI entry. Flags: `--dry-run` and `--once` (the default). Exits 1 if any action failed.
- `keeper/test/plan.test.ts`: table-driven node:test with a fixture snapshot builder. One case per rule, plus ordering, the low-gas guard, a paused-token IOU being skipped, and no actions when idle.
- `keeper/test/exec.test.ts`: with a **fake client** object implementing only `simulateContract`, `writeContract`, `waitForTransactionReceipt` and `getBlock`. Covers the `minWifOut` haircut math, the threshold skip, failure isolation (the 2nd action reverts and the 3rd still runs), dry-run never writing, and custom-error decoding.
- `keeper/test/config.test.ts`
- `keeper/tsconfig.json`: `noEmit`, `strict`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `module`/`moduleResolution` `nodenext`, `target es2023`, including `../shared/**/*.ts`
- `.github/workflows/keeper.yml`: `schedule: */15 * * * *` plus `workflow_dispatch` (with a `dry_run` boolean input), `concurrency: {group: keeper, cancel-in-progress: false}`, `timeout-minutes: 10`. Steps: checkout, setup-node 24 with npm cache on `keeper/package-lock.json`, `npm ci` in keeper, `npm run keeper`. Env from the secrets `KEEPER_PRIVATE_KEY` and `RH_RPC_URL` (optional). Least-privilege `permissions: contents: read`. Pin the actions to major versions.
- `.github/workflows/ci.yml`: on push and PR. Runs keeper `npm test` and `npm run typecheck`, and contracts `npm ci && npm test`.
- `docs/runbooks/KEEPER.md`: generating a fresh keeper wallet (`cast`-free: a one-line node/viem command), funding it, `setKeeper` (link to DEPLOY.md), adding the secrets, a manual dry run, reading the logs, rotation, and pausing (disable the workflow).

Everything else is read-only. **Another agent is building WP4a (Ignition, scripts, `shared/units.ts`) in parallel.** `shared/deployments/4663.json` won't exist until a mainnet deploy, so your tests must use fixtures and fakes only.

## Running commands
```
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run-keeper.sh npm test
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run-keeper.sh npm run typecheck
```
- Node 24 runs `.ts` natively (type stripping): use `.ts` import extensions, and no enums, namespaces or parameter properties.
- viem, typescript and @types/node are installed. **No other dependencies.** No git. Don't send any transactions to a real network. A read-only `--dry-run` against mainnet RPC is allowed **only** if you create a temporary deployment fixture. It's optional.

## Acceptance criteria
- `npm test` and `npm run typecheck` pass in `keeper/`.
- The planner is pure (it doesn't import viem clients), and every rule has a test.
- The `minWifOut` math uses bigint only, and is tested at the boundaries (slippage 0 and 1000 bps).
- The workflow YAML is valid and the secrets are never echoed.
- Write `docs/work-packages/WP4b-REPORT.md`.
