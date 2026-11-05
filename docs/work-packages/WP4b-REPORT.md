# WP4b Report: keeper bot

## Delivered
- `keeper/src`: `types.ts`, `config.ts`, `chain.ts`, `read.ts`, `plan.ts` (pure), `exec.ts`, `log.ts`, `tick.ts`
- `keeper/test`: `plan.test.ts`, `exec.test.ts`, `config.test.ts`; `keeper/tsconfig.json`
- `.github/workflows/keeper.yml`, `.github/workflows/ci.yml`
- `docs/runbooks/KEEPER.md`

## Results
- `npm test`: 32 tests, 32 pass (fixtures and fake clients only; no network).
- `npm run typecheck`: clean.
- Workflows are hand-checked only (no YAML linter available).

## Design notes and deviations
- `read.ts` uses one `basketCount` read plus three Multicall3 batches (basket list; per-basket; per-token), because components must be known before per-token calls. Failed calls skip that basket with a warning; missing `uiMultiplier()` means unchanged, missing `paused()` means not paused.
- `basketState` is not read: settle follows rule 5 exactly (`now >= nextSettleAt`).
- Rule order inside a basket is: sync, harvestDividends, claimIOU, harvestFees, settle. Low gas skips everything except sync and settle.
- `NothingToHarvest` and `NothingOwed` reverts are reported as `skipped` (WP4-DESIGN 3.4), not `failed`.
- Harvest sends re-simulate with the final `minWifOut` to build the request. `minWifOut == 0` skips the harvest.
- Dry-run without a key: the keeper address comes from `KEEPER_ADDRESS` or `FeeHarvester.keeper()` so `onlyKeeper` simulations pass. `RH_RPC_URL` is also accepted as an RPC fallback (the workflow maps the secret to `RPC_URL`).
- `exec.ts` signature is `execute(actions, {client, account, addresses}, cfg)`. `verbatimModuleSyntax` is not set in tsconfig because `shared/` has no package.json and is treated as CommonJS.
- Deployment JSON shape (validated in `config.ts`): `{chainId, deployedAt, blockNumber, addresses: {ComponentRegistry, FeeHarvester, BackingVault, Basket, BasketFactory, FlatpackRouter}}`.

## Owner must do by hand
- Generate the keeper wallet, fund it (~0.002 ETH), have the owner call `setKeeper`.
- Add secrets `KEEPER_PRIVATE_KEY` (and optionally `RH_RPC_URL`).
- Commit `shared/deployments/4663.json` after the mainnet deploy; the keeper fails fast without it.
- The runbook links `contracts/DEPLOY.md` (owned by WP4a); check that it exists.
- `ci.yml` assumes `contracts/package-lock.json` (present) and that `npm test` in contracts needs no extra toolchain download beyond `npm ci`.
