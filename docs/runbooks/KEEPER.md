# Keeper runbook

The keeper is a stateless bot (`keeper/`, Node 24, viem). Every 15 minutes a GitHub Actions run snapshots the chain, plans actions with a pure planner, simulates each one and sends it. See ADR-0012 and `docs/architecture/WP4-DESIGN.md`. A missed run is safe: fees wait for the next one.

## 1. Generate a fresh keeper wallet

Run from `keeper/` (Node 24). The key prints once; copy it straight into the GitHub secret and nowhere else.

```
node -e "import('viem/accounts').then(({generatePrivateKey,privateKeyToAccount})=>{const k=generatePrivateKey();console.log('KEY    ',k);console.log('ADDRESS',privateKeyToAccount(k).address)})"
```

Use a dedicated wallet that holds only gas ETH. It can never move user funds (ADR-0004); the worst case is one bad harvest fill.

## 2. Fund it

Send about 0.002 ETH on Robinhood Chain (4663) to the ADDRESS. A harvest costs about 0.7M gas, around $0.03. Below `MIN_ETH` (0.0002 ETH) the keeper logs `LOW_GAS` and only does `sync` and `settle`.

## 3. Authorise it onchain

The owner calls `FeeHarvester.setKeeper(ADDRESS)`. This is part of the deploy; see `docs/runbooks/DEPLOY.md` (WP4a). Verify with `cast`-free read: `FeeHarvester.keeper()` on the explorer must equal ADDRESS, otherwise every harvest reverts with `OnlyKeeper`.

## 4. Add the secrets

Repo, Settings, Secrets and variables, Actions:

- `KEEPER_PRIVATE_KEY`: the `KEY` value (required).
- `RH_RPC_URL`: a private RPC URL (optional; the public `https://rpc.mainnet.chain.robinhood.com` is the default).

The workflow passes them only through `env`; they are never echoed. Also commit `shared/deployments/4663.json` (created by the deploy export) because the keeper reads the contract addresses from it:

```
{ "chainId": 4663, "deployedAt": "<ISO time>", "blockNumber": 123,
  "addresses": { "ComponentRegistry": "0x..", "FeeHarvester": "0x..", "BackingVault": "0x..",
                 "Basket": "0x..", "BasketFactory": "0x..", "FlatpackRouter": "0x.." } }
```

## 5. Manual dry run

In GitHub: Actions, keeper, Run workflow, tick `dry_run`. It plans and simulates but never sends.

Locally (no key needed; the keeper address is read from `FeeHarvester.keeper()` so simulations pass `onlyKeeper`):

```
cd keeper && npm ci && npm run dry-run
```

Optional env: `RPC_URL`, `KEEPER_ADDRESS`, `DEPLOYMENT`, `MIN_HARVEST_WIF` (wei, default 350e18), `SLIPPAGE_BPS` (default 100, max 1000), `MIN_ETH` (default 0.0002), `DEADLINE_SECS` (default 300). A real local tick: `KEEPER_PRIVATE_KEY=0x.. npm run keeper -- --once`.

## 6. Reading the logs

Stdout is one JSON line per event: `{ts, basket, action, status, txHash?, wifOut?, minWifOut?, reason?, error?}`. The run page also has a markdown summary table.

Statuses: `ok` (sent and mined), `dry-run`, `below-threshold` (fee harvest worth less than `MIN_HARVEST_WIF`, retried next tick), `skipped` (nothing to harvest, or `minWifOut` would be 0), `failed` (error is the decoded custom error, e.g. `InsufficientWifOut(out, minimum)` or `OnlyKeeper()`). The process exits 1 if any action failed, so the run shows red. `{"msg":"LOW_GAS"}` means refill the wallet.

## 7. Rotation

1. Generate a new wallet (step 1) and fund it.
2. Owner calls `FeeHarvester.setKeeper(NEW_ADDRESS)`.
3. Replace the `KEEPER_PRIVATE_KEY` secret.
4. Sweep the remaining ETH from the old wallet. If the old key leaked, do step 2 first.

## 8. Pausing

Actions, keeper, "..." menu, Disable workflow (or `setKeeper` to an unusable address to stop harvests onchain). Fees and dividends accumulate safely; re-enable and trigger a manual run to catch up. Scheduled workflows are also disabled automatically after 60 days of repo inactivity.
