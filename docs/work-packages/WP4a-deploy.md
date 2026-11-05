# WP4a: Deployment (Ignition), smoke checks, shared units, demo baskets

## Read first
1. `docs/architecture/WP4-DESIGN.md` (**binding**: §1 D-1..D-7, §3.1, §3.2)
2. `docs/adr/0011-ignition-deploy-rehearsed-on-fork.md`, `0008`, `0004`
3. `docs/ENGINEERING-STANDARDS.md` (the Solidity parts don't apply. For TypeScript: strict types, no `any`, small pure functions, JSDoc on exports)
4. `contracts/hardhat.config.ts`, `config/mainnet-4663.json`, and every `contracts/src/*.sol` constructor and owner setter
5. `contracts/test/fork/RouterFork.t.sol` (`ForkBase`): a **working reference for the exact deploy and wiring order**, including the PoolKey argument and the registry seeding
6. `shared/abi/*.ts` (generated typed ABIs: use them, don't regenerate unless you change the export script)

## You own
- `contracts/ignition/modules/Flatpack.ts`
- `contracts/ignition/parameters/fork.json` and `mainnet.json` (generated) and `contracts/scripts/params.ts` (the generator, reading `config/mainnet-4663.json`)
- `contracts/scripts/lib/smoke.ts` (an exported `async function smoke(viemPublicClient, addresses, expected): Promise<SmokeReport>` that only reads) and `contracts/scripts/smoke.ts` (CLI: `npx hardhat run scripts/smoke.ts --network robinhood`)
- `contracts/scripts/export-deployment.ts`: writes `shared/deployments/<chainId>.json` from Ignition's `ignition/deployments/chain-<id>/deployed_addresses.json`, plus the deploy block number
- `contracts/scripts/demo-baskets.ts`: creates demo baskets from a JSON spec (name, symbol, weights, mode, target share price in USD). It computes `rawUnits` with `shared/units.ts` from **live Chainlink prices**, approves and stakes the WIF, and optionally `--buy <usdg>` through the router using `quoteBuy` plus 1% slippage. It prints the basket addresses.
- `contracts/scripts/demo-baskets.json`: two baskets. "AI Picks & Shovels" (NVDA 30, MSFT 25, GOOGL 20, META 15, MU 10; Reinvest) and "Dividend Demo" (AAPL 50, MSFT 30, SPY 20; **PayInWif**, because AAPL pays $0.27 on 2026-11-16).
- `shared/units.ts` and `shared/units.test.ts` (node:test). `rawUnitsFor({tokens, weightsBps, pricesUsd8, targetShareUsd18})` returns `{tokens, rawUnits}` **sorted ascending by address**. It must throw if the weights don't sum to 10000, a price is ≤ 0, or there are duplicates. Round half-up and never return 0 units. Test the edge cases and assert the reconstructed share value is within 0.01% of the target.
- `contracts/test/ts/deploy.fork.test.ts` (node:test through Hardhat: `npx hardhat test nodejs`). It connects to `robinhoodFork`, deploys `Flatpack.ts` with `ignition.deploy`, runs `smoke()` and asserts zero failures, then runs the demo-basket creation for the Reinvest basket (impersonate a WIF holder for the stake: the v4 PoolManager holds WIF) and asserts `factory.basketCount() == 1`. **Fork at latest** (no pinned block).
- `contracts/hardhat.config.ts`: **only** add the `chainDescriptors` entry for 4663 (Blockscout at `https://robinhoodchain.blockscout.com`, API `/api`) and the verify config. Don't touch anything else.
- `contracts/package.json`: **only** the `scripts` section. Add `deploy:fork-test`, `deploy:mainnet`, `smoke:mainnet`, `export:deployment`, `params` and `demo:baskets`.
- `docs/runbooks/DEPLOY.md`: a step-by-step mainnet runbook. Prerequisites (funded deployer: give the exact ETH estimate from the fork gas usage), keystore setup, generating params, the fork rehearsal, the mainnet deploy, smoke, verify, export, demo baskets, `setKeeper` rotation, rollback ("Ignition resume", and "deploy v2 alongside" per ADR-0008).

Everything else is read-only. **Another agent is building `keeper/` and `.github/` in parallel. Don't touch them.**

## Running commands
```
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npm run build
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npx hardhat test nodejs
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh node --test ../shared/units.test.ts
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npm test     # Solidity suite must stay green
```
- Node 24 runs `.ts` natively (type stripping): use `.ts` import extensions, and no enums, namespaces or parameter properties.
- Do NOT run anything against the `robinhood` (mainnet) network, and don't create or store any private key. The owner deploys to mainnet by following your runbook.
- No new npm dependencies (the toolbox already includes ignition-viem, verify, keystore, the node test runner and network-helpers). No git.

## Acceptance criteria
- `npx hardhat test nodejs` passes. The fork deploy and smoke report 0 failures, and the demo basket is created on the fork.
- `node --test ../shared/units.test.ts` passes.
- `npm test` (Solidity, 177) stays green and `npm run fmt:check` stays clean.
- Gas: report total gas for the full deploy and seeding on the fork, and the ETH cost at the current gas price (`eth_gasPrice`).
- Write `docs/work-packages/WP4a-REPORT.md` (built, deviations, gas, anything the owner must do by hand).
