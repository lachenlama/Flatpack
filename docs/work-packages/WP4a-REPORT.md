# WP4a report: deployment system

## Built
- `contracts/ignition/modules/Flatpack.ts`: 6 deploys + `vault.setFactory`, `vault.setHarvester`, `harvester.setFactory`, `harvester.setKeeper(keeper)`, `registry.setComponent` x10 (explicit ids `registry_setComponent_<SYM>`), `registry.setBenchmark`. PoolKey passed as an object. All steps chained with `after` so order is deterministic.
- `contracts/scripts/params.ts`: generates `ignition/parameters/fork.json` and `mainnet.json` from `config/mainnet-4663.json` (checksummed addresses, `"<n>n"` bigint for `minCuratorStake`, flat `<SYM>_token/_feed/_v3Fee` parameters). Also exports `LAUNCH_SYMBOLS`, used by the module. Flags `--owner --keeper --min-stake`.
- `contracts/scripts/lib/smoke.ts` (`smoke(client, addresses, expected)`, read-only, 52 checks), `scripts/smoke.ts` (CLI), `scripts/export-deployment.ts`, `scripts/demo-baskets.ts` + `demo-baskets.json`, `scripts/lib/demo.ts` (shared create/stake/buy logic).
- `shared/units.ts` + `shared/units.test.ts` (8 tests).
- `contracts/test/ts/deploy.fork.test.ts`, `docs/runbooks/DEPLOY.md`.
- `hardhat.config.ts`: only `chainDescriptors[4663]` (Blockscout) and `verify` (Blockscout on, others off). `package.json`: only scripts (`params`, `deploy:fork-test`, `deploy:mainnet`, `smoke:mainnet`, `export:deployment`, `demo:baskets`).

## Results
- `npx hardhat test nodejs`: 2 passing (fork deploy + smoke 52/52, 0 failures; Reinvest demo basket created, `basketCount() == 1`). Fork at latest block.
- `node --test ../shared/units.test.ts`: 8 passing.
- `npm test`: 177 passing. `npm run fmt:check`: clean. `npm run build`: ok.
- Type-check (ad hoc `tsc --strict`) is clean except for `never` types on the Ignition result in the test, which appear only because the ad hoc run lacked the generated artifact typings.

## Gas and cost
- Full deploy + wiring + seeding: **12,520,318 gas** over 21 transactions (EDR fork, no L1 data fee modelled).
- `eth_gasPrice` on mainnet 2026-11-05: 22,589,824 wei (about 0.0226 gwei) -> **about 0.00028 ETH**. A mainnet `eth_estimateGas` for the Basket creation (2.57M) suggests the L1 component adds little. Recommended funding: 0.002 ETH minimum, 0.005 ETH comfortable.

## Deviations
1. `smoke:mainnet` runs `node scripts/smoke.ts` (plain viem) rather than `hardhat run ... --network robinhood`, so a read-only check does not need the deployer keystore password. It also works with `hardhat run` semantics unchanged (it does not use the Hardhat network).
2. Added `contracts/scripts/lib/demo.ts` (not in the ownership list) so the fork test and the CLI share one implementation.
3. Used `network.getOrCreate()` (the `connect()` API is deprecated in this Hardhat version).
4. Registry components are fixed in the module (the 10 launch symbols) and passed as flat parameters, because Ignition parameters cannot be iterated at module build time. Adding a component means adding it to `LAUNCH_SYMBOLS` (it is also exposed in `smoke.ts` as `SMOKE_SYMBOLS`; keep both in sync).
5. Without `--owner/--keeper`, `mainnet.json` contains zero addresses (deploy fails safe in the Ownable constructor); the owner must regenerate it.
6. The stake for demo baskets goes through `factory.createBasket(p, minCuratorStake)` (the factory stakes for the curator), so the script approves WIF to the factory, not to the vault.

## Not verified here
- Mainnet deploy, `--verify` against Blockscout and `ignition verify` (cannot run on a fork), the keystore flow, and `export-deployment.ts` against a real journal (an in-memory fork does not write `ignition/deployments`). The journal parsing follows ignition-core's `TRANSACTION_CONFIRM` message type; check the output once after the real deploy.
- `demo-baskets --buy` (router buy path) is implemented but not exercised by the test; the Solidity fork tests cover the router.

## Blockers
None.

## Manual steps for the owner
See section 12 of `docs/runbooks/DEPLOY.md`: fund deployer/keeper, keystore, `params.ts --owner --keeper`, rehearse, deploy, smoke, export, commit the deployment record, set GitHub secrets, run the demo baskets (2000 WIF needed).
