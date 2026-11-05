# Test Plan

Every edge case in FLATPACK-PLAN §7 and every invariant in ARCHITECTURE §7 maps to at least one test. Test IDs go in the test function name, e.g. `test_U_B03_redeemPausedLegBecomesIOU`.

| Layer | Location | Tooling | Runs in CI | Network |
|---|---|---|---|---|
All tests are **Hardhat 3 Solidity tests**: Foundry-compatible, forge-std `Test`, `vm` cheatcodes. TypeScript and viem are used only for deploy and keeper scripts.

| Layer | Location | Tooling | Default `npm test` | Network |
|---|---|---|---|---|
| Unit (U) | `contracts/test/unit/` | forge-std `Test`, mocks in `test/mocks/` | yes | none |
| Fuzz (Z) | same files, `testFuzz_` prefix | Hardhat fuzzing, 1,000 runs (`test.solidity.fuzz.runs`) | yes | none |
| Invariant (I) | `contracts/test/invariant/` | `invariant_*` functions with handler contracts, 256 runs × depth 64 | yes | none |
| Fork (F) | `contracts/test/fork/` | `vm.createSelectFork("robinhood", PINNED_BLOCK)` (the RPC alias is configured in `hardhat.config.ts`) | **no**: run with `npm run test:fork` | mainnet 4663 |

**Naming is used for filtering:** every fork test function name contains `_F_` (e.g. `test_F_R01_buyThreeComponents`), and no other test name may contain `_F_`. `npm test` runs `--grep-exclude _F_`.

## Mocks (shared, in `contracts/test/mocks/`)
- `MockStockToken`: an ERC-20 with 18 decimals plus `uiMultiplier()` (settable), `balanceOfUI`, `paused()`, and `setPaused(bool)`, which makes `transfer` and `transferFrom` revert. It also has `setReturnFalse(bool)` to simulate a non-reverting failure.
- `MockAggregator`: settable `answer`, `updatedAt`, 8 decimals.
- `MockERC20`: a plain token with configurable decimals (USDG = 6, WIF = 18).
- `MockHarvester` and `MockVault`: record calls, for isolating Basket and Factory tests.

## Required cases

### Basket (WP1)
| ID | Case | Covers |
|---|---|---|
| U-B01 | mint pulls `ceil` amounts. The receiver gets `shares − fee` and the harvester gets the fee. `onFeeShares` is called with the referrer. | E8, INV-4 |
| U-B02 | Redeem pays `floor` pro rata, and the fee goes to the harvester as shares | E8, INV-4 |
| U-B03 | **Redeem with one component paused**: the other legs pay out and the paused leg becomes an IOU. `claimIOU` succeeds after unpausing. | E1, INV-7 |
| U-B04 | Redeem with a component returning `false`: becomes an IOU | E1 |
| U-B05 | Harvester mint and redeem are fee-exempt | ADR-0002 |
| U-B06 | Donation: tokens sent directly raise the redeem payout pro rata, and mint amounts are unchanged | E9 |
| U-B07 | `MIN_MINT_SHARES`, zero shares and zero receiver revert | E8, E11 |
| U-B08 | Reinvest mode: a multiplier change doesn't touch units or skim. `lastMultiplier` updates. | E3, E4 |
| U-B09 | PayInWif, +0.5% multiplier: units shrink (`ceil`), the excess is skimmed to the harvester, and `onDividendSkim` is called | ADR-0006 |
| U-B10 | PayInWif, a 3× split: no skim, units unchanged | ADR-0006, E3 |
| U-B11 | PayInWif, exactly +3% skims, +3.0001% doesn't | ADR-0006 |
| U-B12 | PayInWif, a multiplier decrease: no skim | ADR-0006 |
| U-B13 | `notifyWifDividend`: the accumulator splits correctly between two holders, transfers move pending rewards correctly, and claims pay the right amounts | U1 |
| U-B14 | `notifyWifDividend` reverts for a non-harvester, in Reinvest mode, and with zero supply | ADR-0002 |
| U-B15 | `initialize` can only run once. The implementation contract itself can't be initialised. | ADR-0008 |
| Z-B01 | Fuzz mint and redeem sequences over shares in [1e12, 1e30] and units in [1, 1e24]: INV-1 holds, and no profit from round-tripping | E8 |
| I-B01 | Handler: mint, redeem, donate, pause/unpause, multiplier bump (dividend or split), sync, claimIOU. Invariants INV-1, INV-2 and INV-7. | |

### Factory and Registry (WP1)
| ID | Case | Covers |
|---|---|---|
| U-F01 | Happy path: a clone is deployed and initialised, `isBasket` is true, `vault.registerBasket` and `stakeFor` are called, and the event is emitted | |
| U-F02 | Reverts on: length mismatch, fewer than 2, more than 8, not ascending, duplicate, a disabled component, zero units, a bad name or symbol, a stake below the minimum, creation paused | E6, E11 |
| U-F03 | Only the owner can call the registry setters. Enabling requires a feed and an existing pool. | E6 |

### BackingVault (WP2)
| ID | Case | Covers |
|---|---|---|
| U-V01 | stake, requestUnstake, withdraw after the cooldown. Withdrawing early reverts. Pending unstake doesn't earn. | E21 |
| U-V02 | `settle` before the next boundary reverts `TooEarly`. After it, it succeeds once. | U3 |
| U-V03 | Beat SPY: rewards are released, backers accrue pro rata, and the curator becomes claimable | U3 |
| U-V04 | Lose to (or tie) SPY: everything queued is burned to DEAD | U3 |
| U-V05 | A stale feed (older than 4 days) or `answer <= 0` at settle: burned and re-snapshotted | ADR-0007 |
| U-V06 | No active stake when released: the backer share is burned | §5.5 |
| U-V07 | Curator below `minCuratorStake`: the curator share is burned | E21 |
| U-V08 | Donating tokens to the basket doesn't change `navOf` (unit-based) | ADR-0007 |
| U-V09 | Several missed epochs: one settle handles them all | §5.5 |
| U-V10 | Only the factory, harvester and owner can call the restricted functions. The one-time setters revert the second time. | ADR-0008 |
| I-V01 | Handler: stake, unstake, withdraw, queue, settle, claim with random time warps. Invariant INV-5. | |

### Router and Harvester (WP3, fork tests against mainnet)
| ID | Case | Covers |
|---|---|---|
| F-R01 | Buy a 3-component basket (NVDA 500, AAPL 500, MSFT 3000) with USDG. Shares are received, unused USDG is refunded, and the router's balances are 0. | INV-3 |
| F-R02 | `maxUsdgIn` too low reverts `ExcessiveInput`, and a passed deadline reverts | E13 |
| F-R03 | A spoofed `uniswapV3SwapCallback` from an EOA or a fake pool reverts | E16 |
| F-R04 | `quoteBuy` reverts with a `QuoteResult` within 0.1% of what the real buy spends | |
| F-H01 | `harvestFees` end to end: fee shares → components → USDG → WETH → ETH → WIF through the v4 hooked pool. The split adds up exactly (INV-8), DEAD receives 50%, and the vault is queued. | INV-8, E14 |
| F-H02 | `minWifOut` too high reverts. A non-keeper caller reverts. | ADR-0004 |
| F-H03 | Referral cycle: two referrers, a harvest, both claim the right amounts, and a double claim reverts | U4, INV-6 |
| F-H04 | `harvestDividends`: simulate a skim (deal NVDA to the harvester through the basket path). The basket accumulator increases and holders can claim $WIF. | U1 |
| F-H05 | Measure the WIF hook tax: log effective WIF out against the pool's mid price (informational, for keeper calibration) | E14 |
| F-E2E | Full flow: create a basket (stake WIF) → buy → warp past an epoch → harvest → settle → claims | all |

## How to run
```
# from Windows (Git Bash), using the wrapper in tools/ (it loads Node 24 via nvm and cd's into contracts/):
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npm run build
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npm test
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npx hardhat test solidity --grep U_B03
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npm run coverage
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run.sh npm run test:fork
```
