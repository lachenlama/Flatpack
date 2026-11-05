# Runbook: deploy Flatpack to Robinhood Chain mainnet (4663)

Everything below runs from `contracts/`. In WSL, load Node 24 first (`nvm use 24`), or prefix every command with
`bash /home/bytemycode/wif/tools/run.sh`. Design: `docs/architecture/WP4-DESIGN.md` section 3.1, ADR-0011.

## 0. What gets deployed

`ignition/modules/Flatpack.ts` (one module, journaled, resumable):

1. Deploy ComponentRegistry, FeeHarvester (with the ETH/WIF v4 PoolKey), BackingVault, Basket implementation, BasketFactory, FlatpackRouter.
2. Wire: `vault.setFactory`, `vault.setHarvester`, `harvester.setFactory`, `harvester.setKeeper(keeper)`.
3. Seed: `registry.setComponent` x10 (NVDA, AAPL, SPY, QQQ, GOOGL, MSFT, AMZN, META, MU, TSLA), then `registry.setBenchmark(SPY)`.

21 transactions in total. The harvester's keeper defaults to the owner, so the module always sets the separate `keeper`.

## 1. Prerequisites

| Item | Detail |
|---|---|
| Deployer account | A fresh EOA. **It becomes the owner of Registry, Harvester, Vault and Factory** (Ownable2Step), and it must be the account Ignition sends from. |
| ETH on 4663 | Fork gas measured: **12,520,318 gas** for all 21 transactions. At `eth_gasPrice` = 22,589,824 wei (about 0.0226 gwei, read 2026-11-05) that is about **0.00028 ETH**. A mainnet `eth_estimateGas` for the Basket creation was about 0.15M gas above the fork, which suggests the Orbit L1 data component is small. **Fund 0.002 ETH minimum; 0.005 ETH is comfortable** (also covers the demo baskets and a few owner calls). |
| Keeper account | A second EOA (public address only is needed for the deploy). It is funded separately for harvests (about 0.7M gas each). The keeper key is the only key that goes to GitHub Actions. |
| WIF (demo baskets only) | `minCuratorStake` is 1000 WIF per basket (set in `scripts/params.ts`, `--min-stake`). Two demo baskets need 2000 WIF in the deployer wallet. |
| USDG (optional) | Only for `demo:baskets --buy <usdg>`. |
| RPC | `https://rpc.mainnet.chain.robinhood.com` is the default. For a flaky RPC set `RH_RPC_URL`. |

The owner key never goes on a server. Move ownership to a multisig after the event (`transferOwnership` + `acceptOwnership`, Ownable2Step).

## 2. Keystore (encrypted key storage, no plaintext `.env`)

```bash
npx hardhat keystore set DEPLOYER_PRIVATE_KEY     # paste the deployer private key, choose a password
npx hardhat keystore set RH_RPC_URL               # optional; otherwise the env var or the public RPC is used
```

`hardhat.config.ts` reads `DEPLOYER_PRIVATE_KEY` and `RH_RPC_URL` as configuration variables. Every `--network robinhood` command asks for the keystore password. Never use `keystore get` on a shared screen.

## 3. Generate the parameter files

```bash
node scripts/params.ts --owner <DEPLOYER_ADDRESS> --keeper <KEEPER_ADDRESS>
#   optional: --min-stake 1000     (WIF, whole tokens)
# or: npm run params -- --owner 0x... --keeper 0x...
```

Writes `ignition/parameters/fork.json` (owner/keeper = Hardhat dev accounts 0 and 1) and `ignition/parameters/mainnet.json`, both derived from `config/mainnet-4663.json`. Without `--owner/--keeper` the mainnet file has the **zero address** for both (the deploy then reverts in the Ownable constructor, so it fails safe). Check `mainnet.json` by eye: `owner` must equal the deployer address.

## 4. Fork rehearsal (free, mandatory before mainnet)

```bash
npx hardhat test nodejs          # alias: npm run deploy:fork-test
```

`test/ts/deploy.fork.test.ts` forks mainnet at the latest block, deploys the same module with `fork.json`, runs `smoke()` (52 checks, must be 0 failures), and creates the Reinvest demo basket (a WIF holder is impersonated for the stake). It prints the total deploy gas. Do not continue unless it passes.

The Solidity suite must stay green too: `npm test` (177 tests) and `npm run fmt:check`.

## 5. Mainnet deploy

```bash
npx hardhat ignition deploy ignition/modules/Flatpack.ts \
  --network robinhood --parameters ignition/parameters/mainnet.json --verify
# alias: npm run deploy:mainnet
```

- Ignition shows a plan, then sends the 21 transactions in order. The journal is in `ignition/deployments/chain-4663/`. **Commit that directory**: it is the deployment record (ADR-0011).
- `--verify` verifies on Blockscout at the end (config: `verify.blockscout` and `chainDescriptors[4663]` in `hardhat.config.ts`). If verification fails (explorer down), the deployment is still fine; use step 7.

## 6. Smoke check (reads only)

```bash
node scripts/smoke.ts                 # alias: npm run smoke:mainnet
#   defaults: --params ignition/parameters/mainnet.json
#             --addresses ignition/deployments/chain-4663/deployed_addresses.json
```

It uses plain viem (no deployer key, no keystore prompt). It checks: factory immutables, vault and harvester wiring, `harvester.keeper == keeper`, the four owners, the 10 components (enabled, feed, fee tier), `benchmark == SPY`, every Chainlink feed (answer > 0, 8 decimals, updated within 4 days) and the router's USDG. It exits 1 on any mismatch. Stock feeds are 24/5, so a weekend run may report old but still valid answers (the 4-day limit is the vault's `MAX_PRICE_AGE`).

## 7. Verify (only if `--verify` did not finish)

```bash
npx hardhat ignition verify chain-4663 --network robinhood
```

## 8. Export addresses for the keeper and the app

```bash
node scripts/export-deployment.ts      # alias: npm run export:deployment
```

Writes `shared/deployments/4663.json` = `{chainId, deployedAt, blockNumber, addresses}`. `blockNumber` is the first deploy block (start block for event indexing). Commit it. The keeper (WP4b) and the app (WP5) read this file.

## 9. Demo baskets

```bash
npx hardhat run scripts/demo-baskets.ts --network robinhood                 # create both
npx hardhat run scripts/demo-baskets.ts --network robinhood -- --buy 20     # also buy ~20 USDG of each
npx hardhat run scripts/demo-baskets.ts --network robinhood -- --only DIVDEMO
# alias: npm run demo:baskets -- --buy 20
```

Baskets come from `scripts/demo-baskets.json`: "AI Picks & Shovels" (Reinvest) and "Dividend Demo" (PayInWif, because AAPL pays on 2026-11-16). `rawUnits` come from live Chainlink prices (`shared/units.ts`, about $100 per share); the factory stakes 1000 WIF from the deployer per basket. `--buy` uses `quoteBuy` plus 1% slippage. The basket addresses are printed; keep them for the app.

## 10. Rotate the keeper (`setKeeper`)

The owner can swap the keeper at any time (for example after a key leak). The worst a leaked keeper can do is one bad-fill harvest (ADR-0004), bounded by `minWifOut`.

```bash
npx hardhat console --network robinhood
> const { viem } = await network.connect()   // or use any wallet that holds the owner key
> const h = await viem.getContractAt("FeeHarvester", "<harvester>")
> await h.write.setKeeper(["<new keeper>"])
> await h.read.keeper()
```

Then update `KEEPER_PRIVATE_KEY` in the GitHub Actions secrets, and re-run `params.ts --keeper <new>` plus the smoke check so the expected keeper matches.

## 11. Rollback and recovery

- **Interrupted deploy (RPC failure, out of gas, laptop closed):** re-run the exact same `ignition deploy` command. Ignition reads the journal and resumes at the first unfinished step; it never redeploys finished contracts. If a transaction is stuck, Ignition bumps fees on resume. If the sender ran out of ETH, top up and re-run.
- **A wrong parameter was journaled** (for example a bad fee tier): Ignition refuses to continue with changed arguments. Fix with an owner transaction when a setter exists (`registry.setComponent`, `harvester.setKeeper`). For the one-time setters (`setFactory`, `setHarvester`) and immutables there is no fix: deploy v2.
- **Deploy v2 alongside (ADR-0008):** contracts are not upgradeable, so a wrong or broken system is replaced, not patched. Use a new deployment id so the v1 journal stays untouched:
  `npx hardhat ignition deploy ignition/modules/Flatpack.ts --network robinhood --parameters ignition/parameters/mainnet.json --deployment-id chain-4663-v2`
  then `export-deployment` (adjust the path), point the keeper and the app at v2, and pause v1 creation with `factory.setCreatePaused(true)`. Existing v1 baskets keep working and stay redeemable; nothing is migrated.
- **Wipe a failed local attempt:** `--reset` deletes the journal state. Never use it on a deployment that already created onchain contracts you still need.

## 12. Owner checklist (manual steps)

1. Create the deployer and keeper EOAs; fund the deployer (>= 0.002 ETH), the keeper (a few cents of ETH), and the deployer with 2000 WIF for the demo.
2. `keystore set DEPLOYER_PRIVATE_KEY`.
3. `params.ts --owner --keeper`, fork rehearsal, deploy, smoke, export, commit `ignition/deployments/chain-4663/` and `shared/deployments/4663.json`.
4. Add `KEEPER_PRIVATE_KEY` (and optionally `RH_RPC_URL`) to the GitHub repository secrets.
5. Create the demo baskets; run the keeper once with `--dry-run`.
